import { describe, expect, it } from 'vitest'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { decodeStrictToolArguments, encodeStrictTool } from '../src/tool-schema-codec.ts'

function tool(name: string, properties: Record<string, unknown>, required: string[]): ToolSchema {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties, required },
  }
}

describe('strict tool schema codec', () => {
  const escalation = {
    sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
    justification: { type: 'string' },
  }

  it.each([
    ['bash', { command: { type: 'string' }, description: { type: 'string' }, ...escalation }, ['command', 'description']],
    ['write', { file_path: { type: 'string' }, content: { type: 'string' }, ...escalation }, ['file_path', 'content']],
    ['edit', { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, ...escalation }, ['file_path', 'old_string', 'new_string']],
  ])('preserves omitted escalation arguments for ordinary %s calls', (name, properties, required) => {
    const canonical = tool(name, properties, required)
    const encoded = encodeStrictTool(canonical)
    const parameters = encoded.parameters as unknown as {
      required: string[]
      additionalProperties: boolean
      properties: Record<string, unknown>
    }

    expect(encoded.constrainedSampling).toEqual({ type: 'json_schema', strict: 'require' })
    expect(parameters.required).toEqual(Object.keys(properties))
    expect(parameters.additionalProperties).toBe(false)
    expect(parameters.properties['sandbox_permissions']).toEqual({
      anyOf: [escalation.sandbox_permissions, { type: 'null' }],
    })
    expect(parameters.properties['justification']).toEqual({
      anyOf: [escalation.justification, { type: 'null' }],
    })
    expect(decodeStrictToolArguments(
      [canonical],
      name,
      { ...Object.fromEntries(required.map(key => [key, 'value'])), sandbox_permissions: null, justification: null },
    )).toEqual(Object.fromEntries(required.map(key => [key, 'value'])))
    expect(canonical.parameters).toEqual({ type: 'object', properties, required })
  })

  it('recurses through required objects and arrays while preserving canonical nullable nulls', () => {
    const canonical = tool('nested', {
      options: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          retries: { type: 'integer' },
        },
      },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { note: { type: 'string' } },
        },
      },
    }, ['options', 'rows'])

    const encoded = encodeStrictTool(canonical).parameters as unknown as {
      properties: {
        options: { required: string[]; additionalProperties: boolean }
        rows: { items: { required: string[]; additionalProperties: boolean } }
      }
    }
    expect(encoded.properties.options).toMatchObject({
      required: ['label', 'retries'],
      additionalProperties: false,
    })
    expect(encoded.properties.rows.items).toMatchObject({
      required: ['note'],
      additionalProperties: false,
    })
    expect(decodeStrictToolArguments([canonical], 'nested', {
      options: { label: null, retries: null },
      rows: [{ note: null }],
    })).toEqual({ options: { label: null }, rows: [{}] })
  })

  it('passes through an optional array because its null encoding would create an unsupported union', () => {
    const canonical = tool('control_camera', {
      bbox: { type: 'array', items: { type: 'number' } },
    }, [])

    const encoded = encodeStrictTool(canonical)
    expect(encoded.constrainedSampling).toBeUndefined()
    expect(encoded.parameters).toBe(canonical.parameters)
    expect(decodeStrictToolArguments([canonical], 'control_camera', { bbox: null }))
      .toEqual({ bbox: null })
  })

  it('passes through a tool with an optional object that would need a structured union', () => {
    const canonical = tool('optional_object', {
      options: {
        type: 'object',
        additionalProperties: false,
        properties: { label: { type: 'string' } },
      },
    }, [])

    const encoded = encodeStrictTool(canonical)
    expect(encoded.constrainedSampling).toBeUndefined()
    expect(encoded.parameters).toBe(canonical.parameters)
    expect(decodeStrictToolArguments([canonical], 'optional_object', { options: null }))
      .toEqual({ options: null })
  })

  it('keeps a pre-existing scalar anyOf strict-encodable', () => {
    const canonical = tool('scalar_any_of', {
      value: { anyOf: [{ type: 'string' }, { type: 'integer' }, { type: 'null' }] },
    }, ['value'])

    const encoded = encodeStrictTool(canonical)
    expect(encoded.constrainedSampling).toEqual({ type: 'json_schema', strict: 'require' })
    expect(encoded.parameters).toMatchObject({
      properties: {
        value: { anyOf: [{ type: 'string' }, { type: 'integer' }, { type: 'null' }] },
      },
    })
  })

  it.each([
    ['object', { type: 'object', additionalProperties: false, properties: {} }],
    ['array', { type: 'array', items: { type: 'number' } }],
  ])('passes through a tool with a pre-existing anyOf %s branch', (_kind, structuredBranch) => {
    const canonical = tool('structured_any_of', {
      value: { anyOf: [structuredBranch, { type: 'null' }] },
    }, ['value'])

    const encoded = encodeStrictTool(canonical)
    expect(encoded.constrainedSampling).toBeUndefined()
    expect(encoded.parameters).toBe(canonical.parameters)
    expect(decodeStrictToolArguments([canonical], 'structured_any_of', { value: null }))
      .toEqual({ value: null })
  })

  it.each([
    ['object', ['object', 'null']],
    ['array', ['array', 'null']],
  ])('passes through a tool with an authored %s type union', (_kind, type) => {
    const canonical = tool('structured_type_union', {
      value: { type },
    }, ['value'])

    const encoded = encodeStrictTool(canonical)
    expect(encoded.constrainedSampling).toBeUndefined()
    expect(encoded.parameters).toBe(canonical.parameters)
    expect(decodeStrictToolArguments([canonical], 'structured_type_union', { value: null }))
      .toEqual({ value: null })
  })

  it('preserves optional properties whose canonical schemas already accept null', () => {
    const nullableProperties = {
      byConst: { const: null },
      byEnum: { enum: ['value', null] },
      byType: { type: 'null' },
      byTypeUnion: { type: ['string', 'null'] },
      unconstrained: { description: 'accepts every JSON value' },
    }
    const canonical = tool('nullable_forms', nullableProperties, [])

    const encoded = encodeStrictTool(canonical)
    expect(encoded.constrainedSampling).toEqual({ type: 'json_schema', strict: 'require' })
    expect(encoded.parameters).toMatchObject({ properties: nullableProperties })
    expect(decodeStrictToolArguments([canonical], 'nullable_forms', {
      byConst: null,
      byEnum: null,
      byType: null,
      byTypeUnion: null,
      unconstrained: null,
    })).toEqual({
      byConst: null,
      byEnum: null,
      byType: null,
      byTypeUnion: null,
      unconstrained: null,
    })
  })

  it.each([
    ['properties', { properties: {} }],
    ['items', { items: {} }],
    ['nested oneOf', { oneOf: [{ type: 'array' }] }],
    ['nested anyOf', { anyOf: [{ type: 'object' }] }],
  ])('passes through an anyOf branch structured by %s', (_kind, structuredBranch) => {
    const canonical = tool('implicit_structured_any_of', {
      value: { anyOf: [true, structuredBranch] },
    }, ['value'])

    const encoded = encodeStrictTool(canonical)
    expect(encoded.constrainedSampling).toBeUndefined()
    expect(encoded.parameters).toBe(canonical.parameters)
  })

  it('closes an implicit object and rejects an object declaration without properties', () => {
    const implicitObject: ToolSchema = {
      name: 'implicit_object',
      description: 'implicit_object',
      parameters: { properties: { value: true } },
    }
    const missingProperties: ToolSchema = {
      name: 'missing_properties',
      description: 'missing_properties',
      parameters: { type: 'object' },
    }

    expect(encodeStrictTool(implicitObject).constrainedSampling)
      .toEqual({ type: 'json_schema', strict: 'require' })
    expect(encodeStrictTool(missingProperties).parameters).toBe(missingProperties.parameters)
  })

  it('decodes nested values without property schemas and preserves unknown arguments', () => {
    const canonical = tool('decode_edges', {
      rows: { type: 'array', items: true },
      scalar: { type: 'string' },
    }, ['rows', 'scalar'])
    const args = { rows: [[1], { key: 'value' }], scalar: { key: 'value' }, unknown: null }

    expect(decodeStrictToolArguments([canonical], 'decode_edges', args)).toEqual(args)
    expect(decodeStrictToolArguments(undefined, 'decode_edges', args)).toBe(args)
    expect(decodeStrictToolArguments([canonical], 'missing', args)).toBe(args)
  })

  it('passes through even a scalar oneOf and preserves its null', () => {
    const canonical = tool('scalar_one_of', {
      value: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    }, ['value'])

    const encoded = encodeStrictTool(canonical)
    expect(encoded.constrainedSampling).toBeUndefined()
    expect(encoded.parameters).toBe(canonical.parameters)
    expect(decodeStrictToolArguments([canonical], 'scalar_one_of', { value: null }))
      .toEqual({ value: null })
  })

  it('passes a tool through unencoded when it contains an irreducibly open object', () => {
    const canonical = tool('mcp_open', {
      client_request_properties: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
      note: { type: 'string' },
    }, ['client_request_properties'])

    const encoded = encodeStrictTool(canonical)
    expect(encoded.constrainedSampling).toBeUndefined()
    expect(encoded.parameters).toEqual(canonical.parameters)

    // A pass-through tool is never strict, so no null is stripped, including a
    // null the model legitimately sent for an unencoded optional property.
    expect(decodeStrictToolArguments([canonical], 'mcp_open', { note: null }))
      .toEqual({ note: null })
  })
})
