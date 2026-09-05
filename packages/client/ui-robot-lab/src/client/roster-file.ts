/** Portable roster JSON preserves policy references without requiring the current session to resolve them. */
import type { RobotPolicyId, RobotProjectRevisionId } from '@deepseek-ai/dsh-robot-lab/types'
import type { DuckMember } from './group-playback.ts'

/** Versioned roster placement and selections; policies, projects, and recordings are not embedded. */
export interface RosterFile {
  version: 1
  members: DuckMember[]
  formation: 'line' | 'grid' | 'circle'
  spacing: number
}

/** Fixed file-format security limit, independent of the deployment's duck count. */
export const MAX_ROSTER_FILE_BYTES = 1048576

function boundText(text: string): void {
  if (text.length > MAX_ROSTER_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_ROSTER_FILE_BYTES) {
    throw new Error('Roster file exceeds the 1 MiB limit.')
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || Array.from(value).length > maximum) {
    throw new Error(`${label} must be nonblank text with at most ${maximum} characters.`)
  }
  return value
}

function reference(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label, 200)
}

function number(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number between ${minimum} and ${maximum}.`)
  }
  return value
}

/**
 * Read bounded portable JSON without resolving policy or project references; unknown fields are discarded.
 * @param source - UTF-8 JSON content, limited to 1 MiB when encoded.
 * @param maxMembers - positive safe-integer deployment limit on imported ducks.
 * @returns reconstructed roster with trimmed names and exact opaque references; invalid files throw before publication.
 */
export function parseRosterFile(source: string, maxMembers: number): RosterFile {
  if (!Number.isSafeInteger(maxMembers) || maxMembers < 1) throw new Error('Roster member limit must be a positive safe integer.')
  boundText(source)
  const row = object(JSON.parse(source) as unknown, 'Roster')
  if (row.version !== 1) throw new Error('Unsupported roster version; expected 1.')
  if (!Array.isArray(row.members) || row.members.length < 1 || row.members.length > maxMembers) {
    throw new Error(`Roster must contain between 1 and ${maxMembers} ducks.`)
  }
  if (row.formation !== 'line' && row.formation !== 'grid' && row.formation !== 'circle') {
    throw new Error('Roster formation must be line, grid, or circle.')
  }
  const spacing = number(row.spacing, 'Roster spacing', 0.2, 3)
  const ids = new Set<number>()
  const members = row.members.map((value: unknown, index: number): DuckMember => {
    const label = `Duck ${index + 1}`
    const member = object(value, label)
    const id = number(member.id, `${label} id`, 1, Number.MAX_SAFE_INTEGER - 1)
    if (!Number.isSafeInteger(id) || ids.has(id)) throw new Error(`${label} id must be a unique positive safe integer.`)
    ids.add(id)
    return {
      id,
      name: text(member.name, `${label} name`, 80).trim(),
      policyId: reference(member.policyId, `${label} policy id`) as RobotPolicyId | null,
      projectRevisionId: reference(member.projectRevisionId, `${label} project revision id`) as RobotProjectRevisionId | null,
      x: number(member.x, `${label} x`, -1000, 1000),
      z: number(member.z, `${label} z`, -1000, 1000),
    }
  })
  return { version: 1, members, formation: row.formation, spacing }
}

/**
 * Encode roster selections and placements without embedding referenced artifacts or extra properties.
 * @param value - current typed roster, already constrained by its editing actions.
 * @returns readable JSON ending in one newline; output over 1 MiB throws.
 */
export function encodeRosterFile(value: RosterFile): string {
  const result = JSON.stringify({ version: value.version,
    members: value.members.map(({ id, name, policyId, projectRevisionId, x, z }) => ({ id, name, policyId, projectRevisionId, x, z })),
    formation: value.formation, spacing: value.spacing }, null, 2) + '\n'
  boundText(result)
  return result
}
