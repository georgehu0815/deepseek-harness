// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { RobotPolicyId, RobotSimulation } from '@deepseek-ai/dsh-robot-lab/types'
import { RobotViewer } from '../src/client/RobotViewer.tsx'
import { fixturePhysics, sourceFrame } from './fixtures.client.ts'

vi.mock('@react-three/fiber', () => ({ Canvas: () => <canvas />, useFrame: vi.fn(), useThree: vi.fn() }))
afterEach(cleanup)

const simulation: RobotSimulation = { mode: 'recorded-simulation', policyId: 'policy' as RobotPolicyId,
  policyHash: 'hash', observationProfile: 'microduck-standard-61', controlHz: 50, physics: fixturePhysics, bamSettings: {}, frames: [sourceFrame({})] }

describe('viewer keyboard scope', () => {
  it('uses frozen group recordings for accessible replay controls even without single-duck frames', () => {
    const toggle = vi.fn()
    const props = { scene: null, frames: [], playing: false, time: 0, readTime: () => 0, maxDpr: 1,
      onTogglePlayback: toggle, selectedBody: null, onBodySelect: vi.fn(), onHidden: vi.fn(),
      surface: 'studio' as const, cameraView: 'perspective' as const, cameraReset: 0 }
    const { getByRole, rerender } = render(<RobotViewer {...props} groupTracks={[
      { member: { id: 1, name: 'Duck', policyId: simulation.policyId, projectRevisionId: null, x: 1, z: -1 }, simulation },
    ]} />)
    fireEvent.keyDown(getByRole('region', { name: 'Robot simulation replay; press Space to pause or play' }), { code: 'Space', key: ' ' })
    expect(toggle).toHaveBeenCalledOnce()
    rerender(<RobotViewer {...props} frames={simulation.frames} groupTracks={[]} />)
    fireEvent.keyDown(getByRole('region', { name: 'Robot simulation stage' }), { code: 'Space', key: ' ' })
    expect(toggle).toHaveBeenCalledOnce()
  })

  it('does not start playback from Space on an empty grid', () => {
    const toggle = vi.fn()
    const view = render(<RobotViewer scene={null} frames={[]} playing={false} time={0} readTime={() => 0}
      maxDpr={1} onTogglePlayback={toggle} selectedBody={null} onBodySelect={vi.fn()} onHidden={vi.fn()}
      surface="studio" cameraView="perspective" cameraReset={0} />)
    fireEvent.keyDown(view.getByRole('region', { name: 'Robot simulation stage' }), { code: 'Space', key: ' ' })
    expect(toggle).not.toHaveBeenCalled()
  })

  it('toggles playback only when the viewport itself receives Space', () => {
    const toggle = vi.fn()
    const { getByRole } = render(<><input aria-label="Chat composer" /><RobotViewer
      scene={{ bodies: [], meshes: [], geoms: [], defaultJoints: [], jointNames: [] }}
      frames={simulation.frames} playing={false} time={0} readTime={() => 0} maxDpr={1} onTogglePlayback={toggle}
      selectedBody={null} onBodySelect={vi.fn()} onHidden={vi.fn()}
      surface="studio" cameraView="perspective" cameraReset={0} /></>)
    const chat = getByRole('textbox', { name: 'Chat composer' })
    chat.focus()
    fireEvent.keyDown(chat, { code: 'Space', key: ' ' })
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    expect(toggle).not.toHaveBeenCalled()
    const viewport = getByRole('region', { name: 'Robot simulation replay; press Space to pause or play' })
    fireEvent.pointerDown(viewport.querySelector('canvas')!)
    expect(document.activeElement).toBe(viewport)
    fireEvent.keyDown(viewport, { code: 'ArrowLeft', key: 'ArrowLeft' })
    expect(toggle).not.toHaveBeenCalled()
    fireEvent.keyDown(viewport.querySelector('canvas')!, { code: 'Space', key: ' ' })
    fireEvent.keyDown(viewport, { code: 'Space', key: ' ', repeat: true })
    expect(toggle).not.toHaveBeenCalled()
    fireEvent.keyDown(viewport, { code: 'Space', key: ' ' })
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('leaves no window keyboard handler after unmount', () => {
    const toggle = vi.fn()
    const { unmount } = render(<RobotViewer scene={{ bodies: [], meshes: [], geoms: [], defaultJoints: [], jointNames: [] }}
      frames={simulation.frames} playing={false} time={0} readTime={() => 0} maxDpr={1} onTogglePlayback={toggle}
      selectedBody={null} onBodySelect={vi.fn()} onHidden={vi.fn()}
      surface="studio" cameraView="perspective" cameraReset={0} />)
    unmount()
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    expect(toggle).not.toHaveBeenCalled()
  })
})
