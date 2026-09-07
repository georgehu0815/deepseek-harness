/** Fixed model-bound dance JSON; selecting an entry copies its targets into the editable session draft. */
import bachata from './dance-clips/bachata.json'
import breakdance from './dance-clips/breakdance.json'
import cumbia from './dance-clips/cumbia.json'
import martialArts from './dance-clips/martial_arts.json'
import robot from './dance-clips/robot.json'
import salsa from './dance-clips/salsa.json'

/** Authored MicroDuck interpretations, not G1 joint mappings or trained-policy evidence. */
export const danceClips = [
  { id: 'bachata', ...bachata },
  { id: 'breakdance', ...breakdance },
  { id: 'cumbia', ...cumbia },
  { id: 'martial_arts', ...martialArts },
  { id: 'robot', ...robot },
  { id: 'salsa', ...salsa },
] as const
