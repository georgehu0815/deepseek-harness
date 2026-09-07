import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { Config, MicroduckProvider } from '../src/index.ts'
import { RlxPpoConfig, validateRlxPpo } from '../src/rlx-config.ts'

const installed = { sourceRoot: '/installed/lab', pythonBin: '/installed/python' }

describe('RLX admission configuration', () => {
  it('requires an explicit interpreter and source pair', () => {
    for (const options of [{ rlxPythonBin: '/rlx/python' }, { rlxSourceRoot: '/rlx/source' }]) {
      expect(() => new MicroduckProvider(new Context(), Config({ ...installed, ...options }))).toThrow('both rlxPythonBin and rlxSourceRoot')
    }
    for (const options of [{ rlxPythonBin: './python', rlxSourceRoot: '/rlx' }, { rlxPythonBin: '/python', rlxSourceRoot: './rlx' }]) {
      expect(() => new MicroduckProvider(new Context(), Config({ ...installed, ...options }))).toThrow('absolute paths')
    }
  })
  it('resolves deployment defaults and accepts explicit numerical settings', () => {
    const resolved = RlxPpoConfig({ horizon: 12, learningRate: 0.0002, normalizeAdvantages: false })
    expect(resolved).toMatchObject({ horizon: 12, learningRate: 0.0002, normalizeAdvantages: false, numMinibatches: 4 })
    expect(() => { validateRlxPpo(resolved) }).not.toThrow()
    expect(() => new MicroduckProvider(new Context(), Config({ ...installed, rlxPythonBin: '/rlx/python', rlxSourceRoot: '/rlx' }))).not.toThrow()
  })
  it.each([
    ['horizon', 0], ['numMinibatches', 1.5], ['epochs', Number.MAX_SAFE_INTEGER + 1],
    ['learningRate', 0], ['learningRate', Infinity], ['gamma', -0.1], ['gaeLambda', 1.1],
    ['entropyCoefficient', -1], ['valueCoefficient', -1], ['observationClip', 0], ['normalizationEpsilon', 0],
  ])('rejects invalid %s before creating a process', (key, value) => {
    const config = Object.assign(RlxPpoConfig({}), { [key]: value })
    expect(() => { validateRlxPpo(config) }).toThrow('RLX')
  })
  it('allows zero discount and loss coefficients but not zero positive controls', () => {
    const config = Object.assign(RlxPpoConfig({}), { gamma: 0, gaeLambda: 0, entropyCoefficient: 0, valueCoefficient: 0 })
    expect(() => { validateRlxPpo(config) }).not.toThrow()
  })
})
