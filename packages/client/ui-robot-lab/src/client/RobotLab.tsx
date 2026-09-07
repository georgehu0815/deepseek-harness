/** Explicit Session entry for Studio; opening the viewer never starts a model turn. */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from './studio-props.ts'
import css from './RobotLab.module.css'

/** Owned Session Controller commands; creation alone never opens or trains a robot. */
export interface StudioEntryInjected {
  createSession: (workspaceId: WorkspaceId | null) => Promise<SessionId>
  openSession: (sessionId: SessionId) => void
}

/** Only the visual wrapper owns the session-provider transition. */
export type RobotLabProps = PropsRuntime<'visual.workspace.view'> & PropsRenderSlots<'robot-lab.visual.player'>
  & PropsLocale<'robot-lab'> & InjectFace<StudioEntryInjected>

/**
 * Bind the current session or offer explicit creation and selection through the Session Controller.
 * @param props - framework sources, locale, session provider and owned creation/navigation callbacks.
 * @returns the session-owned player or an entry form that never sends a chat message.
 */
export function RobotLab(props: RobotLabProps) {
  const sessions = props.useSessions(value => value)
  const workspaces = props.useWorkspaces(value => value)
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId | null>(null)
  const [creating, setCreating] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempt = useRef<{ open: boolean } | null>(null)
  useEffect(() => () => { attempt.current = null }, [])
  useEffect(() => { if (sessions.current !== undefined && attempt.current !== null) attempt.current.open = false }, [sessions.current])
  const ready = sessions.phase === 'ready' && workspaces.phase === 'ready'
  const workspaceExists = workspaceId === null || workspaces.items.some(item => item.workspaceId === workspaceId)
  const choices = sessions.ids.filter(id => !workspaces.archivedSessionIds.includes(id))
  const start = async () => {
    if (attempt.current !== null || !ready || !workspaceExists) return
    const request = { open: true }
    attempt.current = request
    setCreating(true); setCancelled(false); setError(null)
    try {
      const id = await props.createSession(workspaceId)
      if (attempt.current === request && request.open) props.openSession(id)
    } catch (reason) {
      if (attempt.current === request) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (attempt.current === request) { attempt.current = null; setCreating(false) }
    }
  }
  return <props.SessionProvider empty={() => <section className={css.studio} aria-label={props.t('entry.player')}>
    <header className={css.header}><strong>{props.t('entry.title')}</strong></header>
    <div className={css.content}>
      <p role="status">{props.t(creating ? 'entry.creating' : 'entry.intro')}</p>
      <p>{props.t('entry.next')}</p>
      {!ready && <p>{props.t('entry.loading')}</p>}
      <label>{props.t('entry.workspace')}<select value={workspaceId ?? ''} disabled={!ready || creating}
        onChange={(event) => {
          const workspace = workspaces.items.find(item => item.workspaceId === event.target.value)
          setWorkspaceId(workspace?.workspaceId ?? null)
        }}>
        <option value="">{props.t('entry.defaultWorkspace')}</option>
        {workspaces.items.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title} · {item.path}</option>)}
      </select></label>
      {!workspaceExists && <p role="alert">{props.t('entry.workspaceMissing')}</p>}
      <button type="button" className={css.primaryAction} disabled={!ready || !workspaceExists || creating}
        onClick={() => { void start() }}>{props.t('entry.start')}</button>
      {creating && !cancelled && <button type="button" onClick={() => {
        if (attempt.current !== null) attempt.current.open = false
        setCancelled(true)
      }}>{props.t('entry.cancel')}</button>}
      {cancelled && <p>{props.t('entry.cancelled')}</p>}
      {error !== null && <p role="alert" className={css.error}>{props.t('entry.error')} {error}</p>}
      {choices.length > 0 && <label>{props.t('entry.existing')}<select value="" disabled={!ready} onChange={(event) => {
        const id = choices.find(id => id === event.target.value)
        if (id === undefined) return
        if (attempt.current !== null) attempt.current.open = false
        setError(null)
        try { props.openSession(id) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
      }}><option value="">{props.t('entry.chooseExisting')}</option>{choices.map(id => <option key={id} value={id}>
          {sessions.byId[id]?.title ?? props.t('entry.untitled')} · {id}
        </option>)}</select></label>}
    </div>
  </section>}>
    {props.renderSlot('robot-lab.visual.player', {})}
  </props.SessionProvider>
}
