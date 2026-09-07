/** Real WebGL viewport and download controls with local, non-training robot data. */
import { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { ClipSimulation } from '../../../../packages/client/ui-robot-lab/src/client/ClipSimulation.tsx'
import type { ClipSimulationProps } from '../../../../packages/client/ui-robot-lab/src/client/clip-gen-props.ts'
import { createClipGenStore } from '../../../../packages/client/ui-robot-lab/src/client/clip-gen-store.ts'
import { clipEn } from '../../../../packages/client/ui-robot-lab/src/client/clip-gen-locales.ts'
import type { RobotScene } from '@deepseek-ai/dsh-robot-lab/types'
import { fixtureProfile, readySnapshot } from '../../../../packages/client/ui-robot-lab/tests/fixtures.client.ts'

/** Mount the actual workspace with test geometry; return cleanup for React and WebGL. */
export function mount(scene: RobotScene): () => void {
  const lab = readySnapshot()
  lab.scene = scene
  lab.catalog!.profiles = [{ ...fixtureProfile, joints: fixtureProfile.joints.map((joint, index) => ({
    ...joint, index: index + 1, name: scene.jointNames[index]!, defaultPosition: scene.defaultJoints[index]!,
  })) }]
  const store = createClipGenStore(120, 8).create()
  const props = {
    useStore: selector => selector(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
    useLab: selector => selector(lab), actions: store.actions,
    t: (key, params) => {
      const template = clipEn[key as keyof typeof clipEn]
      return params === undefined ? template
        : template.replace(/\{(\w+)\}/g, (match: string, name: string) => name in params ? String(params[name]) : match)
    },
    maxDpr: 2, maxDucks: 8, maxFileBytes: 262144,
    refresh: () => {}, saveText: () => {},
  } as ClipSimulationProps
  const root = createRoot(document.getElementById('root')!)
  root.render(<ClipSimulation {...props} />)
  return () => { root.unmount() }
}
