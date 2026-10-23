/**
 * Dev's late-night check (R2-S1, R2-X6b), with the device clock mocked at about 11 pm Brisbane time (`page.clock`):
 * next-day departures carry a tomorrow marker on the Saved cards and in the Ask summary sentence. The departures
 * are synthetic rows relative to the mocked clock (routed responses), so the test never depends on the real time.
 * Saved cards render only after hydration, and the Ask summary is the edge's own renderer (answerIntent), run
 * against the same rows and clock, so client and server agree on "now".
 */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { expect, type Route, test } from '@playwright/test'
import { answerIntent } from '../../../services/edge/src/ai/answer.ts'

const DAY = 86_400
/** The next Brisbane calendar day at 23:05 (UTC+10, no DST): always ahead of the server's clock. */
const brisbaneMidnightS = (ms: number) => Math.floor((ms / 1000 + 10 * 3600) / DAY) * DAY - 10 * 3600
const NOW_S = brisbaneMidnightS(Date.now()) + DAY + 23 * 3600 + 5 * 60
const TOMORROW = new Date((NOW_S + DAY) * 1000).toLocaleDateString('en-AU', {
  timeZone: 'Australia/Brisbane',
  day: '2-digit',
  month: '2-digit',
})

/** A fixture departures response with its rows replaced: one per offset (seconds after NOW_S). */
async function withRows(route: Route, offsets: number[]): Promise<DeparturesResponse> {
  const body = (await (await route.fetch()).json()) as DeparturesResponse
  const template = body.departures[0] as Departure
  const departures = offsets.map((o, i) => ({
    ...template,
    tripInstance: `late-${i}@x`,
    status: 'scheduled' as const,
    schedDep: NOW_S + o,
    estDep: null,
    schedArrTo: template.schedArrTo == null ? null : NOW_S + o + 15 * 60,
    estArrTo: null,
  }))
  return { ...body, rtState: 'live', rtSourceTimestamp: NOW_S, generatedAt: NOW_S * 1000, departures }
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: NOW_S * 1000 })
  await page.addInitScript(() => {
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
    localStorage.setItem(
      'bft-bus-saved',
      JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
    )
  })
  // Ferry: 11:40 pm tonight, then 5:10 am tomorrow. Bus: nothing more tonight, first at 5:20 am tomorrow.
  await page.route('**/__fixtures/v1/ferry/stops/317584/departures*', async (route) =>
    route.fulfill({ json: await withRows(route, [35 * 60, 6 * 3600 + 5 * 60]) }),
  )
  await page.route('**/__fixtures/v1/bus/stops/10802/departures*', async (route) =>
    route.fulfill({ json: await withRows(route, [6 * 3600 + 15 * 60]) }),
  )
})

test('Saved cards mark next-day departures with tomorrow’s date at 11 pm (R2-S1)', async ({ page }) => {
  await page.goto('/?fixtures=1')
  const ferry = page.getByRole('link', { name: /^Ferry Ferry ·.*Bulimba/ })
  await expect(ferry).toContainText('11:40 pm')
  await expect(ferry).not.toContainText(/11:40 pm \(/)
  await expect(ferry).toContainText(`5:10 am (${TOMORROW})`)
  const bus = page.getByRole('link', { name: /^Bus Bus ·/ })
  await expect(bus).toContainText(`5:20 am (${TOMORROW})`)
})

test('the Ask summary says "tomorrow" for a next-day answer at 11 pm (R2-X6b)', async ({ page }) => {
  // Bus 10802 at 11:05 pm: the next departure is tomorrow morning.
  await page.route('**/__fixtures/v1/ask', async (route) => {
    const question = (route.request().postDataJSON() as { question: string }).question
    const rows = await (await page.request.get('/__fixtures/v1/bus/stops/10802/departures?limit=5')).json()
    const template = (rows as DeparturesResponse).departures[0] as Departure
    const body: DeparturesResponse = {
      ...(rows as DeparturesResponse),
      rtState: 'scheduled' as DeparturesResponse['rtState'],
      generatedAt: NOW_S * 1000,
      departures: [
        {
          ...template,
          status: 'scheduled',
          schedDep: NOW_S + 6 * 3600 + 15 * 60,
          estDep: null,
          estArrTo: null,
        },
      ],
    }
    const intent = {
      kind: 'departures_at' as const,
      at: { mode: 'bus' as const, key: '10802', name: 'Cultural Centre station, platform 1', score: 1 },
    }
    const a = await answerIntent(intent, async () => Response.json(body), NOW_S)
    await route.fulfill({
      json: {
        schemaVersion: 1,
        question,
        normalized: question.toLowerCase(),
        source: 'deterministic',
        intent,
        ...a,
        rows: undefined,
      },
    })
  })
  await page.goto('/?fixtures=1')
  const ask = page.getByRole('textbox', { name: 'Ask' })
  await ask.fill('next bus from cultural centre platform 1')
  await ask.press('Enter')
  const summary = page.getByText(/^Next buses from/)
  await expect(summary).toContainText(`5:20 am tomorrow (${TOMORROW})`)
  // The answer's row sits under the same day's "Tomorrow" divider (THE-118 PR 4), not a date on its time.
  const row = page.locator('[data-highlighted]').first()
  await expect(row.locator('xpath=preceding-sibling::*[@data-day-divider]')).toHaveText(/^Tomorrow · /)
  await expect(row).not.toContainText(`(${TOMORROW})`)
})
