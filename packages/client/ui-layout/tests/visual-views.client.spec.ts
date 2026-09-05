import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { expect, it, vi } from 'vitest'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { visualViews } from '../src/client/visual-views.ts'

it('publishes stable tab metadata and removes contributions when their fiber is disposed', async () => {
  const ctx = new Context()
  const registry = ctx.plugin(SlotRegistry)
  await registry.await()
  const shell = ctx.plugin({ inject: ['slots'], apply(scope: Context) {
    scope.slots.register({ name: 'root', children: { 'visual.workspace.view': { kind: 'list', scope: 'session-maybe' } } }, (_props: PropsRenderSlots<'visual.workspace.view'>) => null)
  } })
  await shell.await()
  const views = visualViews(ctx.get('slots')!)
  const empty = views.getSnapshot()
  expect(views.getSnapshot()).toBe(empty)
  const changed = vi.fn()
  const off = views.subscribe(changed)
  const earth = ctx.plugin({ inject: ['slots'], apply(scope: Context) {
    scope.slots.inject('visual.workspace.view', () => scope.slots.register({ name: 'visual.workspace.view', id: 'earth', order: 10, label: () => 'Earth 3D' }, () => null))
  } })
  const robot = ctx.plugin({ inject: ['slots'], apply(scope: Context) {
    scope.slots.inject('visual.workspace.view', () => scope.slots.register({ name: 'visual.workspace.view', id: 'robot-lab', order: 20, label: () => 'MicroDuck' }, () => null))
  } })
  await earth.await(); await robot.await()
  expect(views.getSnapshot()).toEqual([{ id: 'earth', label: 'Earth 3D' }, { id: 'robot-lab', label: 'MicroDuck' }])
  expect(changed).toHaveBeenCalled()
  await robot.dispose()
  expect(views.getSnapshot()).toEqual([{ id: 'earth', label: 'Earth 3D' }])
  await earth.dispose()
  expect(views.getSnapshot()).toEqual([])
  off()
  await shell.dispose()
  await registry.dispose()
})
