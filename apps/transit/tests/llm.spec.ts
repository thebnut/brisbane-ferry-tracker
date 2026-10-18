import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/** Questions the deterministic parser can't answer, so they need the LLM path. */
const QUESTIONS = [
  'when is the next citycat from the cultural centre heading towards uq',
  'is the 66 bus from cultural centre running on time right now',
  'what trains are leaving central for the gold coast in the next half hour',
  'any problems with ferries on the river today',
]

test('Ask box: LLM path end to end with a real Turnstile token', async ({ page, request }) => {
  const before = await (await request.get('https://bft-api.brisbanetransit.workers.dev/v1/ask/status')).json()
  await page.goto('/')
  const ask = page.getByRole('textbox', { name: 'Ask' })
  const results = []
  for (const q of QUESTIONS) {
    await ask.fill(q)
    const res = page.waitForResponse((r) => r.url().endsWith('/v1/ask') && r.request().method() === 'POST', {
      timeout: 90_000,
    })
    await ask.press('Enter')
    const r = await res
    const sent = r.request().postDataJSON() as { question: string; turnstileToken?: string }
    const body = await r.json()
    results.push({
      question: q,
      status: r.status(),
      sentToken: typeof sent.turnstileToken === 'string' && sent.turnstileToken.length > 20,
      source: body.source,
      answer: body.answer,
      departures: body.departures?.length ?? 0,
      ai: body.ai ?? null,
      rounds: body.rounds ?? null,
      costUsd: body.costUsd ?? null,
    })
    if (typeof body.answer !== 'string') console.log('NO ANSWER', r.status(), JSON.stringify(body))
    else await expect(page.locator('[data-ask-source]')).toContainText(body.answer.slice(0, 20))
  }
  const after = await (await request.get('https://bft-api.brisbanetransit.workers.dev/v1/ask/status')).json()
  const out = { at: new Date().toISOString(), before, after, results }
  if (process.env.LLM_OUT) writeFileSync(process.env.LLM_OUT, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  expect(results.every((r) => r.sentToken)).toBe(true)
  expect(results.some((r) => r.source === 'llm')).toBe(true)
})
