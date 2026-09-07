// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { RobotLab } from '../src/client/RobotLab.tsx'
import type { RobotLabProps } from '../src/client/RobotLab.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const existingId = 'existing-session' as SessionId
const createdId = 'created-session' as SessionId
const workspaceId = 'studio-workspace' as WorkspaceId

type WorkspaceSnapshot = Parameters<Parameters<RobotLabProps['useWorkspaces']>[0]>[0]

function fixture() {
  const state: { sessions: SessionListState; workspaces: WorkspaceSnapshot } = {
    sessions: { ids: [existingId], byId: { [existingId]: { id: existingId, title: 'Saved dance work',
      displayTitle: 'Saved dance work', cwd: '/dance', running: false, blank: false, updatedAt: 1 } }, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined },
    workspaces: { phase: 'ready', state: 'idle', error: null, archivedSessionIds: [], items: [{
      workspaceId, title: 'Dance folder', path: '/dance', sessionIds: [existingId], createdAt: '', updatedAt: '',
    }] },
  }
  const createSession = vi.fn<RobotLabProps['createSession']>()
  const openSession = vi.fn<RobotLabProps['openSession']>()
  const props = {
    width: 480, createSession, openSession,
    t: key => en[key as keyof typeof en],
    useSessions: selector => selector(state.sessions),
    useWorkspaces: selector => selector(state.workspaces),
    SessionProvider: ({ empty, children }) => state.sessions.current === undefined ? empty?.() : children,
    renderSlot: () => <div>Session player</div>,
  } as RobotLabProps
  return { state, props, createSession, openSession }
}

describe('explicit Studio session entry', () => {
  it('offers existing sessions without creating one on inspection or selection', () => {
    const f = fixture()
    const view = render(<RobotLab {...f.props} />)
    expect(view.getByText(en['entry.intro'])).toBeTruthy()
    expect(view.getByText(en['entry.next'])).toBeTruthy()
    expect(f.createSession).not.toHaveBeenCalled()
    fireEvent.change(view.getByLabelText('Existing session'), { target: { value: existingId } })
    expect(f.openSession).toHaveBeenCalledExactlyOnceWith(existingId)
    expect(f.createSession).not.toHaveBeenCalled()
  })

  it('captures the chosen workspace and admits only one pending click', async () => {
    const f = fixture()
    const pending = Promise.withResolvers<SessionId>()
    f.createSession.mockReturnValue(pending.promise)
    const view = render(<RobotLab {...f.props} />)
    fireEvent.change(view.getByLabelText('Session workspace'), { target: { value: workspaceId } })
    const start = view.getByRole('button', { name: 'Start a Studio session' }) as HTMLButtonElement
    fireEvent.click(start); fireEvent.click(start)
    expect(start.disabled).toBe(true)
    expect(f.createSession).toHaveBeenCalledExactlyOnceWith(workspaceId)
    expect(f.openSession).not.toHaveBeenCalled()
    await act(async () => { pending.resolve(createdId) })
    expect(f.openSession).toHaveBeenCalledExactlyOnceWith(createdId)
  })

  it('reports creation failure without a fabricated session or automatic retry', async () => {
    const f = fixture()
    f.createSession.mockRejectedValue(new Error('Host refused session creation'))
    const view = render(<RobotLab {...f.props} />)
    fireEvent.click(view.getByRole('button', { name: 'Start a Studio session' }))
    expect((await view.findByRole('alert')).textContent).toContain('Host refused session creation')
    expect(f.createSession).toHaveBeenCalledExactlyOnceWith(null)
    expect(f.openSession).not.toHaveBeenCalled()
    expect((view.getByRole('button', { name: 'Start a Studio session' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it.each(['cancel', 'select', 'unmount', 'session-change'] as const)('does not open a late creation after %s', async (action) => {
    const f = fixture()
    const pending = Promise.withResolvers<SessionId>()
    f.createSession.mockReturnValue(pending.promise)
    const view = render(<RobotLab {...f.props} />)
    fireEvent.click(view.getByRole('button', { name: 'Start a Studio session' }))
    if (action === 'cancel') {
      fireEvent.click(view.getByRole('button', { name: 'Do not open when ready' }))
      expect(view.getByText(en['entry.cancelled'])).toBeTruthy()
      expect((view.getByRole('button', { name: 'Start a Studio session' }) as HTMLButtonElement).disabled).toBe(true)
    } else if (action === 'select') {
      fireEvent.change(view.getByLabelText('Existing session'), { target: { value: existingId } })
    } else if (action === 'unmount') view.unmount()
    else {
      f.state.sessions.current = existingId
      view.rerender(<RobotLab {...f.props} />)
      expect(view.getByText('Session player')).toBeTruthy()
    }
    await act(async () => { pending.resolve(createdId) })
    expect(f.openSession).not.toHaveBeenCalledWith(createdId)
    expect(f.createSession).toHaveBeenCalledOnce()
  })

  it('requires loaded lists and does not silently change a removed workspace to the default', () => {
    const f = fixture()
    f.state.workspaces = { ...f.state.workspaces, phase: 'pending', state: 'loading' }
    const view = render(<RobotLab {...f.props} />)
    expect(view.getByText(en['entry.loading'])).toBeTruthy()
    expect((view.getByRole('button', { name: 'Start a Studio session' }) as HTMLButtonElement).disabled).toBe(true)
    f.state.workspaces = { ...f.state.workspaces, phase: 'ready', state: 'idle' }
    view.rerender(<RobotLab {...f.props} />)
    fireEvent.change(view.getByLabelText('Session workspace'), { target: { value: workspaceId } })
    f.state.workspaces = { ...f.state.workspaces, items: [] }
    view.rerender(<RobotLab {...f.props} />)
    expect(view.getByRole('alert').textContent).toBe(en['entry.workspaceMissing'])
    expect((view.getByRole('button', { name: 'Start a Studio session' }) as HTMLButtonElement).disabled).toBe(true)
    expect(f.createSession).not.toHaveBeenCalled()
  })

  it('omits archived sessions and shows navigation failures without creating a replacement', () => {
    const f = fixture()
    f.state.workspaces = { ...f.state.workspaces, archivedSessionIds: [existingId] }
    const view = render(<RobotLab {...f.props} />)
    expect(view.queryByLabelText('Existing session')).toBeNull()
    f.state.workspaces = { ...f.state.workspaces, archivedSessionIds: [] }
    f.openSession.mockImplementation(() => { throw new Error('Session is unavailable') })
    view.rerender(<RobotLab {...f.props} />)
    fireEvent.change(view.getByLabelText('Existing session'), { target: { value: existingId } })
    expect(view.getByRole('alert').textContent).toContain('Session is unavailable')
    expect(f.createSession).not.toHaveBeenCalled()
  })
})
