import { describe, expect, it } from 'vitest'
import type { RobotPolicyId, RobotProjectRevisionId } from '@deepseek-ai/dsh-robot-lab/types'
import { encodeRosterFile, MAX_ROSTER_FILE_BYTES, parseRosterFile } from '../src/client/roster-file.ts'
import type { RosterFile } from '../src/client/roster-file.ts'

const roster: RosterFile = {
  version: 1,
  members: [{ id: 1, name: 'First duck', policyId: 'unavailable-policy' as RobotPolicyId,
    projectRevisionId: 'unknown-revision' as RobotProjectRevisionId, x: -1, z: 0 },
  { id: 2, name: 'Second duck', policyId: null, projectRevisionId: null, x: 1, z: 0 }],
  formation: 'line', spacing: 0.5,
}
const bytes = MAX_ROSTER_FILE_BYTES
function memberFile(change: Record<string, unknown>): string {
  return JSON.stringify({ ...roster, members: [{ ...roster.members[0], ...change }] })
}

describe('portable roster files', () => {
  it('round-trips references without resolving unavailable policies or projects', () => {
    const encoded = encodeRosterFile(roster)
    expect(encoded.endsWith('\n')).toBe(true)
    expect(encoded.endsWith('\n\n')).toBe(false)
    expect(parseRosterFile(encoded, 2)).toEqual(roster)
    expect(parseRosterFile(encoded, 2)).not.toBe(roster)
  })

  it('trims names and discards extra keys while preserving opaque references exactly', () => {
    const source = { ...roster, injected: true, members: [
      { ...roster.members[0]!, name: '  Custom duck  ', policyId: ' policy with spaces ' as RobotPolicyId, extra: 'ignored' },
    ] }
    expect(parseRosterFile(JSON.stringify(source), 2)).toEqual({ ...roster, members: [
      { ...roster.members[0], name: 'Custom duck', policyId: ' policy with spaces ' },
    ] })
    expect(JSON.parse(encodeRosterFile(source))).toEqual({ ...roster, members: [
      { ...roster.members[0], name: '  Custom duck  ', policyId: ' policy with spaces ' },
    ] })
  })

  it.each(['line', 'grid', 'circle'] as const)('accepts %s formation and exact numeric endpoints', (formation) => {
    const value = { ...roster, formation, spacing: 0.2,
      members: [{ ...roster.members[0], id: Number.MAX_SAFE_INTEGER - 1, x: -1000, z: 1000 }] }
    const parsed = parseRosterFile(JSON.stringify(value), 1)
    expect(parsed).toEqual(value)
    expect(Number.isSafeInteger(parsed.members[0]!.id + 1)).toBe(true)
    expect(parseRosterFile(JSON.stringify({ ...value, spacing: 3 }), 1).spacing).toBe(3)
  })

  it('accepts name and reference character limits including Unicode names', () => {
    const value = { name: '🦆'.repeat(80), policyId: 'p'.repeat(200), projectRevisionId: 'r'.repeat(200) }
    expect(parseRosterFile(memberFile(value), 1).members[0]).toMatchObject(value)
  })

  it.each([null, [], true, 1, 'text'])('rejects a non-object root %j', (value) => {
    expect(() => parseRosterFile(JSON.stringify(value), 2)).toThrow('Roster must be an object')
  })

  it('rejects malformed JSON', () => {
    expect(() => parseRosterFile('{broken', 2)).toThrow()
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid maxMembers %s', (limit) => {
    expect(() => parseRosterFile(JSON.stringify(roster), limit)).toThrow('member limit')
  })

  it.each([{}, { version: 0 }, { version: 2 }, { version: '1' }, { version: true }])('rejects unsupported version %j', (change) => {
    const { version: _version, ...content } = roster
    expect(() => parseRosterFile(JSON.stringify({ ...content, ...change }), 2)).toThrow('version')
  })

  it.each([[], null, {}, 'members'])('rejects absent or invalid members %j', (members) => {
    expect(() => parseRosterFile(JSON.stringify({ ...roster, members }), 2)).toThrow('ducks')
  })

  it('enforces total imported members and duplicate identities', () => {
    expect(() => parseRosterFile(JSON.stringify(roster), 1)).toThrow('between 1 and 1 ducks')
    expect(() => parseRosterFile(JSON.stringify({ ...roster, members: [roster.members[0], roster.members[0]] }), 2))
      .toThrow('unique positive safe integer')
  })

  it.each([null, [], 'duck'])('rejects a non-object member %j', (member) => {
    expect(() => parseRosterFile(JSON.stringify({ ...roster, members: [member] }), 1)).toThrow('Duck 1 must be an object')
  })

  it.each([
    { id: 0 }, { id: -1 }, { id: 1.5 }, { id: '1' }, { id: Number.MAX_SAFE_INTEGER }, { id: Number.MAX_SAFE_INTEGER + 1 },
    { name: '' }, { name: ' \t\n ' }, { name: null }, { name: 1 }, { name: 'n'.repeat(81) },
    { policyId: '' }, { policyId: '   ' }, { policyId: 1 }, { policyId: 'p'.repeat(201) },
    { projectRevisionId: '' }, { projectRevisionId: false }, { projectRevisionId: 'r'.repeat(201) },
    { x: null }, { x: '1' }, { x: -1000.01 }, { x: 1000.01 },
    { z: null }, { z: false }, { z: -1000.01 }, { z: 1000.01 },
  ])('rejects invalid member fields %j', (change) => {
    expect(() => parseRosterFile(memberFile(change), 1)).toThrow('Duck 1')
  })

  it.each(['id', 'name', 'policyId', 'projectRevisionId', 'x', 'z'])('requires the %s member field', (key) => {
    const member = Object.fromEntries(Object.entries(roster.members[0]!).filter(([name]) => name !== key))
    expect(() => parseRosterFile(JSON.stringify({ ...roster, members: [member] }), 1)).toThrow('Duck 1')
  })

  it.each([{ formation: 'triangle' }, { formation: null }, { spacing: 0.19 }, { spacing: 3.01 },
    { spacing: '1' }, { spacing: null }])('rejects invalid placement settings %j', (change) => {
    expect(() => parseRosterFile(JSON.stringify({ ...roster, ...change }), 2)).toThrow('Roster')
  })

  it('rejects non-finite numeric JSON values', () => {
    expect(() => parseRosterFile(memberFile({ x: 12345 }).replace('12345', '1e999'), 1)).toThrow('finite number')
  })

  it('accepts the exact UTF-8 size boundary and rejects oversized ASCII or multibyte files', () => {
    expect(MAX_ROSTER_FILE_BYTES).toBe(1048576)
    const source = JSON.stringify(roster)
    expect(parseRosterFile(source + ' '.repeat(bytes - source.length), 2)).toEqual(roster)
    expect(() => parseRosterFile(source + ' '.repeat(bytes - source.length + 1), 2)).toThrow('1 MiB')
    const multibyte = JSON.stringify({ ...roster, ignored: 'é'.repeat(bytes / 2) })
    expect(multibyte.length).toBeLessThan(bytes)
    expect(() => parseRosterFile(multibyte, 2)).toThrow('1 MiB')
  })

  it('refuses encoded files larger than the portable file size limit', () => {
    expect(() => encodeRosterFile({ ...roster, members: [{ ...roster.members[0]!, name: 'n'.repeat(bytes) }] }))
      .toThrow('1 MiB')
  })
})
