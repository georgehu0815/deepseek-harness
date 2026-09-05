/** A no-session-safe wrapper for the session-scoped Studio player. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './studio-props.ts'
import css from './RobotLab.module.css'

/** Only the visual wrapper owns the session-provider transition. */
export type RobotLabProps = PropsRuntime<'visual.workspace.view'> & PropsRenderSlots<'robot-lab.visual.player'>

/**
 * Bind the current session before rendering the shared Studio player.
 * @param props - framework-supplied session provider and authorized child slot.
 * @returns a session-selection prompt or the session-owned player.
 */
export function RobotLab(props: RobotLabProps) {
  return <props.SessionProvider empty={() => <section className={css.studio} aria-label="Robot Studio player">
    <header className={css.header}><strong>Robot Studio</strong></header>
    <p role="status">Select an existing session, or send your first message to create one.</p>
  </section>}>
    {() => props.renderSlot('robot-lab.visual.player', {})}
  </props.SessionProvider>
}
