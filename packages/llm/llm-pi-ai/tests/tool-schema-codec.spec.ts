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

  it('recurses through objects and arrays while preserving canonical nullable nulls', () => {
    const canonical = tool('nested', {
      options: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { oneOf: [{ type: 'string' }, { type: 'null' }] },
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
    }, [])

    const encoded = encodeStrictTool(canonical).parameters as unknown as {
      properties: {
        options: { anyOf: [{ required: string[]; additionalProperties: boolean }, { type: 'null' }] }
        rows: { anyOf: [{ items: { required: string[]; additionalProperties: boolean } }, { type: 'null' }] }
      }
    }
    expect(encoded.properties.options.anyOf[0]).toMatchObject({
      required: ['label', 'retries'],
      additionalProperties: false,
    })
    expect(encoded.properties.rows.anyOf[0].items).toMatchObject({
      required: ['note'],
      additionalProperties: false,
    })
    expect(decodeStrictToolArguments([canonical], 'nested', {
      options: { label: null, retries: null },
      rows: [{ note: null }],
    })).toEqual({ options: { label: null }, rows: [{}] })
  })

  it('passes a tool through unencoded when it contains an irreducibly open object', () => {
    const canonical = tool('mcp_open', {
      client_request_properties: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
      note: { type: 'string' },
    }, [])

    const encoded = encodeStrictTool(canonical)
    expect(encoded.constrainedSampling).toBeUndefined()
    expect(encoded.parameters).toEqual(canonical.parameters)

    // A pass-through tool is never strict, so no null is stripped, including a
    // null the model legitimately sent for an unencoded optional property.
    expect(decodeStrictToolArguments([canonical], 'mcp_open', { note: null }))
      .toEqual({ note: null })
  })
})
