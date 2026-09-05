/** Sidebar entry point for the native robot visual workspace. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './RobotLab.module.css'

/**
 * Render a focusable sidebar action, including the collapsed rail.
 * @param props - sidebar geometry and a scoped layout action.
 * @returns the studio launcher button.
 */
export function SidebarButton(props: PropsRuntime<'sidebar.footer.action'> & { open: () => void }) {
  return <button type="button" className={css.sidebar} title="Robot Studio" onClick={props.open}>
    <span aria-hidden="true">🦆</span>{props.wide && <span>Robot Studio</span>}
  </button>
}
