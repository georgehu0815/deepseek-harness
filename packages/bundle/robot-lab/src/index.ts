/**
 * Opt-in Robot Lab profile composition. The manifest-selected patch owns the
 * host capability, native browser contribution, and bundled choreography skill.
 * @module @deepseek-ai/dsh-robot-lab-bundle
 */
import { fileURLToPath } from 'node:url'

/**
 * Resolve the packaged instructions from this module, including through Node ESM proxies.
 * @returns Absolute skill root independent of the profile and session working directories.
 */
export function resolveChoreographySkillDir(): string {
  return fileURLToPath(new URL('../skills/', import.meta.url))
}
