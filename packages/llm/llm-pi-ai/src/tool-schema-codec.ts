/** Strict-provider encoding for optional JSON Schema object properties. @module dsh-llm-pi-ai/tool-schema-codec */

import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { Tool as PiTool } from '@earendil-works/pi-ai'

/** Narrow to a non-array JSON Schema record. */
function isSchemaRecord(schema: unknown): schema is Record<string, unknown> {
  return typeof schema === 'object' && schema !== null && !Array.isArray(schema)
}

/** Return the fixed property map when a node declares one, else undefined. */
function propertyMapOf(node: Record<string, unknown>): Record<string, unknown> | undefined {
  const properties = node['properties']
  return isSchemaRecord(properties) ? properties : undefined
}

/** Return whether a schema accepts JSON null before transport encoding. */
function acceptsNull(schema: unknown): boolean {
  if (!isSchemaRecord(schema)) return false
  if (schema['const'] === null) return true
  if (Array.isArray(schema['enum']) && schema['enum'].includes(null)) return true
  if (schema['type'] === 'null' || (Array.isArray(schema['type']) && schema['type'].includes('null'))) return true
  for (const keyword of ['oneOf', 'anyOf'] as const) {
    if (Array.isArray(schema[keyword]) && schema[keyword].some(acceptsNull)) return true
  }
  return schema['type'] === undefined && schema['oneOf'] === undefined && schema['anyOf'] === undefined
}

/**
 * Return whether every object in a schema can be closed for OpenAI strict
 * sampling. An open map (`additionalProperties` truthy) or a typed object
 * with no fixed `properties` cannot be represented, so its tool is sent
 * unencoded instead of being distorted.
 */
function strictEncodable(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(strictEncodable)
  if (!isSchemaRecord(schema)) return true
  const declaresObject = schema['type'] === 'object'
    || (Array.isArray(schema['type']) && schema['type'].includes('object'))
  const properties = propertyMapOf(schema)
  if (declaresObject || properties !== undefined) {
    if (schema['additionalProperties'] !== undefined && schema['additionalProperties'] !== false) return false
    if (properties === undefined) return false
  }
  return Object.values(schema).every(strictEncodable)
}

/** Clone and recursively encode one strict-encodable schema. */
function encodeNode(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(encodeNode)
  if (!isSchemaRecord(schema)) return schema

  const encoded: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) encoded[key] = encodeNode(value)

  const properties = propertyMapOf(schema)
  if (properties === undefined) return encoded

  const required = new Set(Array.isArray(schema['required']) ? schema['required'] : [])
  const encodedProperties = encoded['properties'] as Record<string, unknown>
  for (const [name, property] of Object.entries(properties)) {
    if (!required.has(name) && !acceptsNull(property)) {
      encodedProperties[name] = { anyOf: [encodedProperties[name], { type: 'null' }] }
    }
  }
  encoded.required = Object.keys(properties)
  encoded.additionalProperties = false
  return encoded
}

/**
 * Encode a Harness tool for a provider that requires OpenAI strict schemas.
 * A strict-encodable tool has its optional properties rewritten as required
 * nullable properties and requests required constrained sampling; a tool whose
 * schema contains an irreducibly open object is passed through unchanged and
 * left non-strict, so the provider does not reject it.
 * @param tool - the canonical Harness tool schema.
 * @returns a detached pi-ai tool.
 */
export function encodeStrictTool(tool: ToolSchema): PiTool {
  if (!strictEncodable(tool.parameters)) {
    return { name: tool.name, description: tool.description, parameters: tool.parameters }
  }
  return {
    name: tool.name,
    description: tool.description,
    parameters: encodeNode(tool.parameters) as PiTool['parameters'],
    constrainedSampling: { type: 'json_schema', strict: 'require' },
  }
}

/** Normalize transport placeholders recursively against one original schema. */
function decodeNode(value: unknown, schema: unknown): unknown {
  if (Array.isArray(value)) {
    return isSchemaRecord(schema) ? value.map(item => decodeNode(item, schema['items'])) : value
  }
  if (typeof value !== 'object' || value === null || !isSchemaRecord(schema)) return value

  const properties = propertyMapOf(schema)
  if (properties === undefined) return value

  const required = new Set(Array.isArray(schema['required']) ? schema['required'] : [])
  const decoded: Record<string, unknown> = {}
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    const property = properties[name]
    if (property !== undefined && item === null && !required.has(name) && !acceptsNull(property)) continue
    decoded[name] = property === undefined ? item : decodeNode(item, property)
  }
  return decoded
}

/**
 * Remove only null placeholders introduced for optional non-nullable fields of
 * a strict-encoded tool. A tool passed through unencoded, and any null the
 * canonical schema accepts, is left untouched.
 * @param tools - canonical Harness tool schemas for the request.
 * @param name - returned tool name.
 * @param args - parsed provider arguments.
 * @returns detached arguments in canonical Harness form.
 */
export function decodeStrictToolArguments(
  tools: readonly ToolSchema[] | undefined,
  name: string,
  args: unknown,
): unknown {
  const schema = tools?.find(tool => tool.name === name)?.parameters
  return schema === undefined || !strictEncodable(schema) ? args : decodeNode(args, schema)
}
