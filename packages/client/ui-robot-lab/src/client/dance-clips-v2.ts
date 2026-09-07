/** Larger dance revisions retain planted-foot constraints and are preview-only schema-three clips. */
import bachata from './dance-clips/bachata_v2.json'
import breakdance from './dance-clips/breakdance_v2.json'
import cumbia from './dance-clips/cumbia_v2.json'
import martialArts from './dance-clips/martial_arts_v2.json'
import robot from './dance-clips/robot_v2.json'
import salsa from './dance-clips/salsa_v2.json'

/** v2 is the authored dance revision, not a change to the training-reference JSON format. */
export const danceClipsV2 = [
  { id: 'bachata_v2', style: 'bachata', ...bachata },
  { id: 'breakdance_v2', style: 'breakdance', ...breakdance },
  { id: 'cumbia_v2', style: 'cumbia', ...cumbia },
  { id: 'martial_arts_v2', style: 'martial_arts', ...martialArts },
  { id: 'robot_v2', style: 'robot', ...robot },
  { id: 'salsa_v2', style: 'salsa', ...salsa },
] as const
