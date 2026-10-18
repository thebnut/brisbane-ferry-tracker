// @vitest-environment jsdom
/**
 * The shared invisible Turnstile loader's lifecycle (Codex review of #66): a sheet closed while the script is still
 * loading must not render a widget, or answer, for the sheet opened next. The script and window.turnstile are faked.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { invisibleTurnstile, TURNSTILE_SRC } from '../app/lib/turnstile.ts'

afterEach(() => {
  delete (window as { turnstile?: unknown }).turnstile
})

type Render = { el: HTMLElement; o: Record<string, unknown> }
/** The callback the widget was rendered with (throws if it wasn't rendered). */
const cb = (r: Render | undefined) => {
  if (!r) throw new Error('not rendered')
  return r.o.callback as (t: string) => void
}

function fakeApi() {
  const renders: Render[] = []
  return {
    renders,
    render: (el: HTMLElement, o: Record<string, unknown>) => {
      renders.push({ el, o })
      return `w${renders.length}`
    },
    execute: (id: string) => {
      const r = renders[Number(id.slice(1)) - 1]
      setTimeout(() => cb(r)(`tok-${id}`), 1)
    },
    reset: () => {},
    remove: () => {},
  }
}

describe('invisibleTurnstile lifecycle', () => {
  it('close mid-load, reopen: only the new instance renders, and it gets a token', async () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    const a = invisibleTurnstile('k', () => first, 'feedback')
    a.warm()
    a.dispose()
    const b = invisibleTurnstile('k', () => second, 'feedback')
    b.warm()
    const pending = b.token(2000)
    const tags = [...document.head.querySelectorAll('script')].filter((s) => s.src === TURNSTILE_SRC)
    expect(tags).toHaveLength(1)
    const api = fakeApi()
    window.turnstile = api
    tags[0]?.onload?.(new Event('load'))
    expect(await pending).toBe('tok-w1')
    expect(api.renders).toHaveLength(1)
    expect(api.renders[0]?.el).toBe(second)
    expect(api.renders[0]?.o.action).toBe('feedback')
  })

  it('a late callback from a disposed widget is ignored, and the instance can start again', async () => {
    const api = { ...fakeApi(), execute: () => {} }
    window.turnstile = api
    const t = invisibleTurnstile('k', () => document.body, 'feedback')
    const waiting = t.token(2000)
    await new Promise((r) => setTimeout(r, 5))
    t.dispose()
    expect(await waiting).toBeNull()
    cb(api.renders[0])('stale')
    const again = t.token(2000)
    await new Promise((r) => setTimeout(r, 5))
    cb(api.renders[1])('fresh')
    expect(await again).toBe('fresh')
  })
})
