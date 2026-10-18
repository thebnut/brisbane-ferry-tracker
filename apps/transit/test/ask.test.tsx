// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AskBox } from '../app/components/AskBox.tsx'
import { reasonMessage, toResult } from '../app/lib/ask.ts'
import { fixtureAsk } from '../app/lib/fixtures.server.ts'
import { makeQueryClient } from '../app/lib/queries.ts'

/** Every ai.reason bft-api can send (budget.ts, routes.ts, llm.ts on feat/p8-ai-layer) plus the HTTP 429 body. */
const REASONS = [
  'disabled',
  'budget_exhausted',
  'budget',
  'ip_quota',
  'capacity',
  'turnstile_failed',
  'turnstile_not_configured',
  'gateway_not_configured',
  'provider_rate_limited',
  'provider_500',
  'provider_error',
  'refusal',
  'bad_final_answer',
  'ungrounded',
  'no_final_answer',
  'too_many_rounds',
  'rate_limited',
  'something_new',
]

describe('ai.reason messages', () => {
  it.each(REASONS)('%s has a friendly message, never the raw code', (r) => {
    const m = reasonMessage(r)
    expect(m).toBeTruthy()
    if (r.includes('_')) expect(m).not.toContain(r)
    expect(m).not.toMatch(/_/)
  })

  it('names the specific limits', () => {
    expect(reasonMessage('ip_quota')).toMatch(/today's limit/)
    expect(reasonMessage('budget_exhausted')).toMatch(/month's budget/)
    expect(reasonMessage('capacity')).toMatch(/busy/)
    expect(reasonMessage(undefined, 429)).toMatch(/Too many questions/)
    expect(reasonMessage(undefined)).toBeNull()
  })
})

describe('toResult', () => {
  it('keeps the answer and rows, and the hint plus a notice when the AI could not run', () => {
    const ok = toResult(200, {
      schemaVersion: 1,
      source: 'llm',
      answer: 'A',
      departures: [{ route: 'X' }],
      costUsd: 0.002,
    })
    expect(ok).toMatchObject({ answer: 'A', source: 'llm', notice: null, costUsd: 0.002 })
    expect(ok.departures).toHaveLength(1)
    const capped = toResult(200, {
      source: 'fallback',
      answer: 'Try: …',
      ai: { enabled: true, reason: 'capacity' },
    })
    expect(capped.answer).toBe('Try: …')
    expect(capped.notice).toMatch(/busy/)
    const turnstile = toResult(403, {
      source: 'fallback',
      answer: 'Try: …',
      ai: { enabled: true, reason: 'turnstile_failed' },
    })
    expect(turnstile.notice).toMatch(/bot/)
  })

  it('an AI switched off is not an error to show', () => {
    expect(toResult(200, { source: 'fallback', answer: 'Try', ai: { enabled: false } }).notice).toBeNull()
  })

  it('a 429 or a broken body becomes a friendly answer', () => {
    expect(toResult(429, { error: 'rate_limited' })).toMatchObject({
      source: 'error',
      answer: expect.stringMatching(/Too many/),
    })
    expect(toResult(502, null).answer).toMatch(/didn't work/)
  })
})

function renderAsk(root: Record<string, unknown>) {
  const Stub = createRoutesStub([{ id: 'root', path: '/', loader: () => root, Component: AskBox }])
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <Stub initialEntries={['/']} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as { turnstile?: unknown }).turnstile
})

describe('AskBox', () => {
  it('sends a fresh invisible Turnstile token with the question and renders rows and the AI note', async () => {
    let callback: ((t: string) => void) | null = null
    window.turnstile = {
      render: (_el, opts) => {
        callback = opts.callback as (t: string) => void
        return 'w1'
      },
      execute: () => setTimeout(() => callback?.('tok-123'), 5),
      reset: vi.fn(),
      remove: vi.fn(),
    }
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { question: string }
      return fixtureAsk(body.question)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderAsk({ turnstileSitekey: '0x4AAAAAAFZ6yPZTYH3xrIMT', fixtures: false })
    const input = await screen.findByRole('textbox', { name: 'Ask' })
    fireEvent.change(input, { target: { value: 'next train from Bowen Hills to the airport' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await screen.findByText(/From Bowen Hills station/)
    expect(fetchMock).toHaveBeenCalledWith('/v1/ask', expect.objectContaining({ method: 'POST' }))
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1].body))
    expect(sent).toEqual({
      question: 'next train from Bowen Hills to the airport',
      turnstileToken: 'tok-123',
    })
    expect(await screen.findByText('7:58 pm')).toBeInTheDocument()
    expect(screen.getByText(/help from AI/)).toBeInTheDocument()
  })

  it('without Turnstile (blocked or no sitekey) still asks, without a token, and shows the reason', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
      fixtureAsk(JSON.parse(String(init.body)).question as string),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAsk({ turnstileSitekey: null, fixtures: false })
    const input = await screen.findByRole('textbox', { name: 'Ask' })
    fireEvent.change(input, { target: { value: 'where is my train #reason:ip_quota' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/today's limit/))
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1].body))).not.toHaveProperty('turnstileToken')
  })

  it('fixture mode posts to the fixture API', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
      fixtureAsk(JSON.parse(String(init.body)).question as string),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAsk({ turnstileSitekey: 'x', fixtures: true })
    const input = await screen.findByRole('textbox', { name: 'Ask' })
    fireEvent.change(input, { target: { value: 'next ferry from Bulimba' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await screen.findByText(/From Bulimba ferry terminal/)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/__fixtures/v1/ask')
  })
})
