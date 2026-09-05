/**
 * The `geoView` projection provider: mounting geo-view beside the session
 * projection registry serves the latest reported 3D Earth view on the history
 * tail page (the wire the client Earth panel and read tools consume). Before any
 * report the value is a zero-seq null view; each `geo/view` event advances `seq`
 * and replaces `view` last-wins; a composition without geo-view has no `geoView`
 * key; unmounting removes it (HMR safety). The carrier and framework are
 * exercised unmodified.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CameraViewService from '@deepseek-ai/dsh-geo-view'

interface Bench {
  ctx: Context
  session: Session
  tailProjections(): Promise<{ asOfSeq: number; values: Record<string, unknown> } | undefined>
}

async function harness(withGeoView: boolean): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withGeoView) await ctx.plugin(CameraViewService)
  const session = ctx.sessions.create()
  return {
    ctx,
    session,
    async tailProjections() {
      return ctx.sessionProjections.snapshot(session)
    },
  }
}

/** One paginable message so the tail page is non-degenerate. */
function seedMessage(session: Session): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

describe('geoView projection provider', () => {
  it('serves a zero-seq null view before the first geo/view', async () => {
    const bench = await harness(true)
    seedMessage(bench.session)
    const projections = await bench.tailProjections()
    expect(projections?.values.geoView).toEqual({ seq: 0, view: null })
  })

  it('advances seq and replaces the view last-wins', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    session.append('geo/view', {
      source: 'agent',
      pose: { lat: 35.68, lon: 139.65, height: 500000 },
    })
    session.append('geo/view', {
      source: 'user',
      pose: { lat: 40.0, lon: -105.0, height: 12000 },
      bbox: { west: -105.1, south: 39.9, east: -104.9, north: 40.1 },
    })
    const projections = await bench.tailProjections()
    expect(projections?.values.geoView).toEqual({
      seq: 2,
      view: {
        source: 'user',
        pose: { lat: 40.0, lon: -105.0, height: 12000 },
        bbox: { west: -105.1, south: 39.9, east: -104.9, north: 40.1 },
      },
    })
    expect(projections?.asOfSeq).toBe(session.seq - 1)
  })

  it('has no geoView key when geo-view is not composed', async () => {
    const bench = await harness(false)
    seedMessage(bench.session)
    const projections = await bench.tailProjections()
    expect(projections?.values.geoView).toBeUndefined()
  })
})
