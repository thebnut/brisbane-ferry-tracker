import { describe, expect, it } from 'vitest'
import { createLogger } from '../src/log.ts'
import { SOURCE_LAG_MS, SOURCE_STALE_MIN_MS, SourceWatch, staleAfterMs } from '../src/rt/source-watch.ts'

const T0 = 1_792_482_480_000

function setup(cycleMs: number) {
  const lines: Array<Record<string, unknown>> = []
  const log = createLogger({}, (l) => lines.push(JSON.parse(l)))
  return { w: new SourceWatch(log, cycleMs), lines, msgs: () => lines.map((l) => l.msg) }
}

/** Polls every cycleMs from T0; the header time is what `ts(i)` says (s), as TransLink's lags ~20 s behind. */
function run(
  w: SourceWatch,
  cycleMs: number,
  polls: number,
  ts: (i: number, now: number) => number,
  from = 0,
) {
  for (let i = from; i < from + polls; i++) {
    const now = T0 + i * cycleMs
    w.observe('TripUpdates', ts(i, now), now, 100 + i)
  }
}

const advancing = (_i: number, now: number) => Math.floor((now - 20_000) / 10_000) * 10
const frozenAfter = (k: number, cycleMs: number) => (i: number, now: number) =>
  advancing(i, i < k ? now : T0 + k * cycleMs)

describe('rt source watch (R14-RT1)', () => {
  it('thresholds: 90 s, or three polls at a slower cadence', () => {
    expect(staleAfterMs(15_000)).toBe(SOURCE_STALE_MIN_MS)
    expect(staleAfterMs(30_000)).toBe(SOURCE_STALE_MIN_MS)
    expect(staleAfterMs(60_000)).toBe(180_000)
  })

  for (const cycleMs of [15_000, 30_000]) {
    it(`an advancing header never logs, including normal lag and repeats (${cycleMs / 1000} s polls)`, () => {
      const { w, lines } = setup(cycleMs)
      // A header that only moves in 10 s steps repeats on some 15 s polls, and lags up to ~25 s.
      run(w, cycleMs, 400, (i, now) => Math.floor((now - 25_000 - (i % 3) * 5_000) / 10_000) * 10)
      expect(lines).toEqual([])
      expect(w.stale()).toEqual([])
    })

    it(`a frozen header logs one stale line per episode, then one recovered line (${cycleMs / 1000} s polls)`, () => {
      const { w, lines, msgs } = setup(cycleMs)
      run(w, cycleMs, 10, advancing)
      // Frozen for 7 minutes (the 07:48 to 07:55 staging episode was ~7).
      const frozenPolls = Math.round(420_000 / cycleMs)
      run(w, cycleMs, frozenPolls, frozenAfter(10, cycleMs), 10)
      expect(msgs()).toEqual(['rt source stale'])
      const stale = lines[0] as Record<string, number | string>
      expect(stale.feed).toBe('TripUpdates')
      expect(stale.level).toBe('warn')
      expect(stale.ageS as number).toBeGreaterThan(90)
      expect(stale.ageS as number).toBeLessThan(90 + 25 + cycleMs / 1000 + 1)
      expect(stale.polls as number).toBeGreaterThanOrEqual(3)
      expect(stale.sourceTimestamp).toBe(advancing(0, T0 + 10 * cycleMs))
      expect(w.stale()).toEqual(['TripUpdates'])
      // It advances again: recovered, with the episode's length.
      run(w, cycleMs, 5, advancing, 10 + frozenPolls)
      expect(msgs()).toEqual(['rt source stale', 'rt source recovered'])
      const rec = lines[1] as Record<string, number>
      expect(rec.staleS).toBeGreaterThanOrEqual(420 - cycleMs / 1000)
      expect(rec.staleS).toBeLessThanOrEqual(420 + cycleMs / 1000)
      expect(w.stale()).toEqual([])
      // A second freeze is a new episode: one more stale line.
      const k = 15 + frozenPolls
      run(w, cycleMs, frozenPolls, frozenAfter(k, cycleMs), k)
      expect(msgs()).toEqual(['rt source stale', 'rt source recovered', 'rt source stale'])
    })
  }

  it('a short freeze (under 90 s) does not log', () => {
    const { w, lines } = setup(15_000)
    run(w, 15_000, 10, advancing)
    run(w, 15_000, 4, frozenAfter(10, 15_000), 10) // 60 s frozen
    run(w, 15_000, 10, advancing, 14)
    expect(lines).toEqual([])
  })

  it('a header that is old from the start still needs three unchanged polls', () => {
    const { w, msgs } = setup(30_000)
    const old = Math.floor((T0 - 600_000) / 1000)
    w.observe('TripUpdates', old, T0, 1)
    w.observe('TripUpdates', old, T0 + 30_000, 2)
    w.observe('TripUpdates', old, T0 + 60_000, 3)
    expect(msgs()).toEqual([])
    w.observe('TripUpdates', old, T0 + 90_000, 4)
    expect(msgs()).toEqual(['rt source stale'])
  })

  it('feeds are judged separately, and one without a header time is ignored', () => {
    const { w, lines } = setup(30_000)
    for (let i = 0; i < 20; i++) {
      const now = T0 + i * 30_000
      w.observe('TripUpdates/Ferry', advancing(i, now), now, i)
      w.observe('TripUpdates/Bus', advancing(i, T0), now, i)
      w.observe('VehiclePositions', 0, now, i)
    }
    expect(lines.map((l) => [l.msg, l.feed])).toEqual([['rt source stale', 'TripUpdates/Bus']])
    expect(w.stale()).toEqual(['TripUpdates/Bus'])
  })

  // THE-111: TransLink's TripUpdates header ran 149 s and 279 s behind on 21 Oct while still advancing.
  const behind = (lagMs: number) => (_i: number, now: number) => Math.floor((now - lagMs) / 10_000) * 10

  /** A lag growing 5 s a poll from 20 s, starting at poll `i0`: the header still moves 10 s every 15 s poll. */
  const ramp = (i0: number) => (i: number, now: number) =>
    Math.floor((now - 20_000 - (i - i0) * 5_000) / 1000)

  it('an advancing header over 90 s behind logs one lagging line per episode, then caught up', () => {
    const { w, lines, msgs } = setup(15_000)
    // 4 minutes 150 s behind, header still moving every poll (judged from the second poll on).
    run(w, 15_000, 16, behind(150_000))
    expect(msgs()).toEqual(['rt source lagging'])
    expect(lines[0]).toMatchObject({ level: 'warn', feed: 'TripUpdates', seq: 101 })
    expect(lines[0]?.ageS as number).toBeGreaterThan(SOURCE_LAG_MS / 1000)
    expect(lines[0]?.ageS as number).toBeLessThanOrEqual(160)
    expect(w.lagging()).toEqual(['TripUpdates'])
    expect(w.stale()).toEqual([])
    // Back to normal lag: one caught-up line with how long it lagged.
    run(w, 15_000, 10, advancing, 16)
    expect(msgs()).toEqual(['rt source lagging', 'rt source caught up'])
    expect(lines[1]).toMatchObject({ level: 'info', feed: 'TripUpdates', laggedS: 225, seq: 116 })
    expect(lines[1]?.ageS as number).toBeLessThan(30)
    expect(w.lagging()).toEqual([])
    // A lag that grows while the header keeps moving is a new episode once past 90 s.
    run(w, 15_000, 20, ramp(26), 26)
    expect(msgs()).toEqual(['rt source lagging', 'rt source caught up', 'rt source lagging'])
    expect(w.stale()).toEqual([])
  })

  it('a lag at or under 90 s does not log', () => {
    const { w, lines } = setup(15_000)
    run(w, 15_000, 40, behind(85_000))
    expect(lines).toEqual([])
  })

  it('a frozen header is stale, not also lagging, and its first sighting is not judged', () => {
    const { w, msgs } = setup(15_000)
    run(w, 15_000, 10, advancing)
    const frozenPolls = 28 // 7 minutes
    run(w, 15_000, frozenPolls, frozenAfter(10, 15_000), 10)
    expect(msgs()).toEqual(['rt source stale'])
    expect(w.lagging()).toEqual([])
    // It recovers straight to normal lag: recovered only.
    run(w, 15_000, 5, advancing, 10 + frozenPolls)
    expect(msgs()).toEqual(['rt source stale', 'rt source recovered'])
    // A new feed first seen far behind is not lagging until its header is seen to advance.
    const old = Math.floor((T0 - 600_000) / 1000)
    w.observe('VehiclePositions', old, T0, 1)
    expect(msgs()).toHaveLength(2)
    w.observe('VehiclePositions', old + 10, T0 + 15_000, 2)
    expect(msgs().at(-1)).toBe('rt source lagging')
  })

  it('a lagging feed that then freezes logs stale once, and lagging is not repeated', () => {
    const { w, msgs } = setup(15_000)
    run(w, 15_000, 8, behind(150_000))
    const ts = behind(150_000)(0, T0 + 7 * 15_000)
    for (let i = 8; i < 30; i++) w.observe('TripUpdates', ts, T0 + i * 15_000, 100 + i)
    expect(msgs()).toEqual(['rt source lagging', 'rt source stale'])
    // Moves again, still far behind: the freeze ends, the lagging episode carries on (no second lagging line).
    run(w, 15_000, 4, behind(150_000), 30)
    expect(msgs()).toEqual(['rt source lagging', 'rt source stale', 'rt source recovered'])
    expect(w.lagging()).toEqual(['TripUpdates'])
  })
})
