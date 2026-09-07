/** Original synthesized genre rhythms, embedded for offline preview without remote music requests. */
import bachata from './dance-audio/bachata.json'
import breakdance from './dance-audio/breakdance.json'
import cumbia from './dance-audio/cumbia.json'
import martialArts from './dance-audio/martial_arts.json'
import robot from './dance-audio/robot.json'
import salsa from './dance-audio/salsa.json'
import bachataV2 from './dance-audio/bachata_v2.json'
import breakdanceV2 from './dance-audio/breakdance_v2.json'
import cumbiaV2 from './dance-audio/cumbia_v2.json'
import martialArtsV2 from './dance-audio/martial_arts_v2.json'
import robotV2 from './dance-audio/robot_v2.json'
import salsaV2 from './dance-audio/salsa_v2.json'

/** Each recording has the selected original dance's authored duration and tempo. */
export const danceAudio = {
  bachata, breakdance, cumbia, martial_arts: martialArts, robot, salsa,
  bachata_v2: bachataV2, breakdance_v2: breakdanceV2, cumbia_v2: cumbiaV2,
  martial_arts_v2: martialArtsV2, robot_v2: robotV2, salsa_v2: salsaV2,
} as const

/** Selection identity is explicit; renaming a clip never guesses or changes its soundtrack. */
export type DanceAudioId = keyof typeof danceAudio
