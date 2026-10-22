/** A small test resolver standing in for uFuzzy over the real stop index (real stop keys, so CITY_STOPS applies). */

import type { StopCandidate, StopResolver } from '../../src/ask/parser.ts'
import type { Mode } from '../../src/contract/index.ts'

const STOPS: Array<[Mode, string, string, string[]?]> = [
  ['ferry', '317584', 'Bulimba'],
  ['ferry', '317590', 'Riverside'],
  ['ferry', '317541', 'New Farm Park'],
  ['ferry', '317582', 'Northshore Hamilton', ['northshore', 'hamilton']],
  ['ferry', '321666', 'South Bank'],
  ['ferry', '317555', 'UQ St Lucia', ['uq ferry', 'st lucia']],
  ['ferry', '317592', 'Teneriffe'],
  ['ferry', '317583', 'Hawthorne'],
  ['ferry', '317593', 'North Quay'],
  ['ferry', '319637', 'QUT Gardens Point', ['qut', 'gardens point']],
  ['ferry', '317600', 'Howard Smith Wharves', ['howard smith']],
  ['ferry', '317610', 'Apollo Road'],
  ['train', 'bowen-hills', 'Bowen Hills'],
  ['train', 'central', 'Central', ['central station']],
  ['train', 'roma-street', 'Roma Street', ['roma st']],
  ['train', 'fortitude-valley', 'Fortitude Valley', ['the valley', 'valley']],
  ['train', 'domestic-airport', 'Domestic Airport', ['airport', 'the airport', 'domestic']],
  ['train', 'international-airport', 'International Airport', ['airport', 'the airport', 'international']],
  ['train', 'ferny-grove', 'Ferny Grove'],
  ['train', 'indooroopilly', 'Indooroopilly', ['indro']],
  ['train', 'south-brisbane', 'South Brisbane'],
  ['train', 'toowong', 'Toowong'],
  ['train', 'nambour', 'Nambour'],
  ['train', 'caboolture', 'Caboolture'],
  ['train', 'springfield-central', 'Springfield Central', ['springfield']],
  ['train', 'beenleigh', 'Beenleigh'],
  ['train', 'cleveland', 'Cleveland'],
  ['train', 'shorncliffe', 'Shorncliffe'],
  ['train', 'kippa-ring', 'Kippa-Ring', ['redcliffe', 'kippa ring']],
  ['train', 'gold-coast-airport', 'Varsity Lakes', ['varsity lakes', 'gold coast']],
  ['train', 'ipswich', 'Ipswich'],
  ['bus', '10802', 'Cultural Centre', ['cultural centre busway', 'cultural center']],
  ['bus', '10780', 'King George Square', ['kgs']],
  ['bus', '919', 'Queen Street bus station', ['queen street', 'queen st']],
  ['bus', '1853', 'UQ Lakes', ['uq lakes', 'uq']],
  ['bus', '2001', 'Chermside'],
  ['bus', '4975', 'Garden City'],
  ['bus', '3003', 'Carindale'],
  ['bus', '5005', 'Toowong Village', ['toowong']],
  ['bus', '2869', 'Krupp Rd near Shrapnel Rd', ['krupp road', 'krupp rd']],
  ['bus', '600001', 'Stop 001234', ['001234', '1234']],
]

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0] as number
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j] as number
      d[j] = Math.min((d[j] as number) + 1, (d[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[b.length] as number
}

export const testResolver: StopResolver = (text, mode) => {
  const q = text.toLowerCase().trim()
  const out: StopCandidate[] = []
  for (const [m, key, name, aliases] of STOPS) {
    if (mode && m !== mode) continue
    let best = 0
    for (const n of [name.toLowerCase(), ...(aliases ?? [])]) {
      const sim = 1 - lev(q, n) / Math.max(q.length, n.length)
      best = Math.max(best, sim, n.startsWith(q) && q.length >= 4 ? 0.9 : 0)
    }
    if (best > 0) out.push({ mode: m, key, name, score: best })
  }
  return out.sort((a, b) => b.score - a.score)
}
