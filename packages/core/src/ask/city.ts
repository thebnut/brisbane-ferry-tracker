/**
 * "The city" (Brisbane CBD) as a destination for /v1/ask (THE-117): the one place that lists which stops count.
 *
 * A departure goes "towards the city" when its stopping pattern after the boarding stop calls at one of these stops
 * (the departures read's `city=in` filter), never by headsign text: the 232 from Krupp Rd says "City, Edward St" but
 * ends at Edward Street Stop 142 via Ann St, which no short list of busway stations would catch. Keys are the stop
 * keys of data/{mode}/stops.json (stop_id for bus and ferry, the station slug for train).
 *
 * - train: Central and Roma Street. Every line through the core calls at both, the southside lines included (South
 *   Brisbane, then Roma Street), so the inner stations either side (Fortitude Valley, South Brisbane, Bowen Hills) are
 *   not needed and stay ordinary origins ("from the valley into the city" works).
 * - ferry: North Quay, QUT Gardens Point, Riverside (Eagle St) and South Bank, the CBD reach of the river.
 * - bus: every stop on the CBD peninsula (the river to Roma Street, Wickham Tce's foot and Ann St at Wharf St; Spring
 *   Hill's Wickham Tce, Leichhardt St and St Pauls Tce left out), plus the Cultural Centre busway platforms. Taken from
 *   the 20261022 bus stop index by that outline; TransLink keeps CBD stop ids stable across timetables, and a stop
 *   this list misses only narrows "towards the city", it never adds a wrong row.
 */
import type { Mode } from '../contract/index.ts'

export const CITY_STOPS: Readonly<Record<Mode, readonly string[]>> = {
  train: ['central', 'roma-street'],
  ferry: ['317593', '319637', '317590', '321666'],
  // biome-ignore format: a dense grid of stop ids is easier to audit than one per line
  bus: [
    '1', '3', '4', '5', '6', '7', '8', '9', '10', '14', '18', '19', '20', '22', '23', '24', '25', '26', '27', '28',
    '29', '30', '32', '33', '34', '35', '36', '37', '39', '40', '41', '42', '43', '44', '45', '46', '48', '50', '51',
    '52', '56', '57', '58', '59', '60', '62', '63', '64', '65', '66', '67', '72', '74', '76', '81', '82', '83', '84',
    '87', '90', '91', '93', '94', '95', '97', '98', '99', '100', '103', '105', '106', '108', '114', '115', '116', '118',
    '121', '122', '123', '124', '125', '130', '138', '139', '141', '142', '145', '146', '148', '149', '152', '155',
    '156', '162', '166', '168', '276', '919', '929', '996', '997', '998', '999', '1001', '1002', '1003', '1004', '1008',
    '1009', '1010', '1011', '1013', '10780', '10781', '10782', '10783', '10784', '10785', '10792', '10793', '10794',
    '10802', '11168', '12111', '19094', '322695',
  ],
  tram: [],
}

/** `city` on a departures read: `in` keeps services that call at a city stop later, `out` those that don't. */
export type CityDirection = 'in' | 'out'

const sets = new Map<Mode, ReadonlySet<string>>()

/** The city's stop keys for a mode, as a set. */
export function cityStopKeys(mode: Mode): ReadonlySet<string> {
  let s = sets.get(mode)
  if (!s) {
    s = new Set(CITY_STOPS[mode])
    sets.set(mode, s)
  }
  return s
}

/** Whether a stop (or any stop of a place) is itself in the city. */
export const isCityStop = (mode: Mode, keys: readonly string[]): boolean =>
  keys.some((k) => cityStopKeys(mode).has(k))
