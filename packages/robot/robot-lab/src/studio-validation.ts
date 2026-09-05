/** JSON validation for authored studio recipes before provider dispatch. */
type Row = Record<string, unknown>
function record(value: unknown, fields: string[], optional: string[] = []): Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Robot Studio requires an object')
  const row = value as Row
  if (Object.keys(row).some(key => !fields.includes(key) && !optional.includes(key))
    || fields.some(key => !Object.hasOwn(row, key))) throw new Error('Robot Studio object has missing or unsupported fields')
  return row
}
function finite(value: unknown, label: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value))) throw new Error(`Robot Studio ${label} must be a finite ${integer ? 'integer' : 'number'}`)
  return value
}
function identity(value: unknown, prefix: string): void {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`).test(value)) throw new Error(`Robot Studio requires a ${prefix} identity`)
}
/**
 * Validate studio-specific JSON; deployment limits and model membership belong to the provider.
 * @param row - Public request object with validated operation and outer keys.
 */
export function validateStudioFields(row: Row): void {
  if (row.operation === 'project' || row.operation === 'reference_preview') identity(row.projectRevisionId, 'revision')
  if (row.operation === 'train' && row.spec !== null && typeof row.spec === 'object') {
    if ('backend' in row.spec && row.spec.backend !== undefined && row.spec.backend !== 'cpu' && row.spec.backend !== 'mlx') throw new Error('Training backend must be cpu or mlx')
    if (Object.hasOwn(row.spec, 'projectSnapshot')) throw new Error('Training projectSnapshot is provider-owned')
    if ('projectRevisionId' in row.spec) identity(row.spec.projectRevisionId, 'revision')
  }
  if (row.operation !== 'save_project') return
  const recipe = record(row.recipe, ['projectId', 'name', 'profileId', 'templateId', 'templateVersion', 'parameters', 'music'], ['blocks'])
  if (recipe.projectId !== null) identity(recipe.projectId, 'project')
  // Match Python's code-point count without modifying the displayed name.
  if (typeof recipe.name !== 'string' || recipe.name.trim().length === 0 || Array.from(recipe.name).length > 64
    || /[\p{Cc}\p{Cs}]/u.test(recipe.name)) throw new Error('Robot Studio requires a nonblank name of at most 64 Unicode characters without controls')
  for (const key of ['profileId', 'templateId']) {
    if (typeof recipe[key] !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(recipe[key])) throw new Error(`Robot Studio requires a catalog ${key}`)
  }
  if (recipe.templateVersion !== 1) throw new Error('Robot Studio supports template version 1')
  const parameters = record(recipe.parameters, ['bpm', 'beats', 'moveSize'])
  const bpm = finite(parameters.bpm, 'bpm')
  const beats = finite(parameters.beats, 'beats', true)
  const moveSize = finite(parameters.moveSize, 'moveSize')
  if (bpm <= 0 || beats <= 0 || moveSize < 0 || moveSize > 1) throw new Error('Robot Studio requires positive tempo and beats and moveSize in [0,1]')
  if (Object.hasOwn(recipe, 'blocks')) {
    if (!Array.isArray(recipe.blocks) || recipe.blocks.length === 0) throw new Error('Robot Studio blocks must be a nonempty ordered array')
    let total = 0
    for (const item of recipe.blocks) {
      const block = record(item, ['templateId', 'templateVersion', 'beats', 'moveSize'])
      if (typeof block.templateId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(block.templateId)
        || block.templateVersion !== 1) throw new Error('Robot Studio block requires a versioned catalog template')
      const blockBeats = finite(block.beats, 'block beats', true)
      const blockSize = finite(block.moveSize, 'block moveSize')
      if (blockBeats <= 0 || blockSize < 0 || blockSize > 1) throw new Error('Robot Studio block beats and moveSize are out of range')
      total += blockBeats
    }
    const first = record(recipe.blocks[0], ['templateId', 'templateVersion', 'beats', 'moveSize'])
    if (first.templateId !== recipe.templateId || first.templateVersion !== recipe.templateVersion) throw new Error('Robot Studio first block must match the top-level template')
    if (!Number.isSafeInteger(total) || total !== beats) throw new Error('Robot Studio block beats must sum to project and music beats')
  }
  const music = record(recipe.music, ['version', 'style', 'bpm', 'beats', 'seed'])
  if (music.version !== 1 || !['disco', 'electronic', 'lofi', 'chiptune'].includes(String(music.style))) throw new Error('Robot Studio requires a supported music version and style')
  if (music.bpm !== bpm || music.beats !== beats) throw new Error('Robot Studio music tempo and beats must match motion')
  const seed = finite(music.seed, 'music seed', true)
  if (seed < 0 || seed > 2147483647) throw new Error('Robot Studio music seed must be in [0,2147483647]')
}
