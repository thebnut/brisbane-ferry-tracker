/**
 * A small synthetic SEQ-like GTFS feed for tests: ferry (express vs all-stops, a no-pickup terminus and a
 * no-drop-off stop), train (parent stations with platforms, a cross-midnight run), tram, and bus (a 24:xx trip and a
 * loop that repeats a stop). Tests mutate the tables to tamper with it.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'

export type Table = string[][]
export type SynthFeed = Record<string, Table>

const csvField = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
export const toCsv = (t: Table) => `${t.map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`

/** Service window: Mon 19 Oct 2026 .. Mon 26 Oct 2026 is inside start..end. */
export function baseFeed(): SynthFeed {
  const stopTimes: Table = [
    ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'pickup_type', 'drop_off_type'],
  ]
  const trips: Table = [
    ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'block_id', 'shape_id'],
  ]
  const add = (trip: string[], rows: Array<[string, string, string?, string?]>) => {
    trips.push(trip)
    rows.forEach(([stop, time, pickup, drop], i) => {
      stopTimes.push([trip[2] as string, time, time, stop, String((i + 1) * 10), pickup ?? '0', drop ?? '0'])
    })
  }
  // Ferry: all-stops F1 Apollo Road → Bulimba → Hawthorne → Riverside, express F11 Bulimba → Riverside.
  for (const [i, h] of ['06', '07', '08', '17'].entries()) {
    add(
      ['F1-1', 'WK', `F1-${i}`, 'Riverside', '1', '', ''],
      [
        ['317580', `${h}:00:00`],
        ['317584', `${h}:05:00`],
        ['317586', `${h}:12:00`, '0', '1'],
        ['317590', `${h}:25:00`, '1'],
      ],
    )
    add(
      ['F11-1', 'WK', `F11-${i}`, 'Riverside', '1', '', ''],
      [
        ['317584', `${h}:10:00`],
        ['317590', `${h}:22:00`, '1'],
      ],
    )
  }
  add(
    ['F1-1', 'WE', 'F1-we', 'Riverside', '1', '', ''],
    [
      ['317584', '09:05:00'],
      ['317590', '09:30:00'],
    ],
  )
  // Train: Domestic Airport → Bowen Hills → Central, including a run past midnight.
  for (const [i, t] of [
    ['05', '00'],
    ['23', '40'],
    ['24', '10'],
  ].entries()) {
    const [h, m] = t as [string, string]
    const plus = (mins: number) => {
      const total = Number(h) * 60 + Number(m) + mins
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`
    }
    add(
      ['BDBR-1', 'WK', `BD-${i}`, 'Central', '1', '', ''],
      [
        ['600200', plus(0)],
        ['600100', plus(15)],
        ['600016', plus(20)],
      ],
    )
    add(
      ['BRBD-1', 'WK', `BR-${i}`, 'Domestic Airport', '0', '', ''],
      [
        ['600017', plus(5)],
        ['600101', plus(10)],
        ['600201', plus(25)],
      ],
    )
  }
  add(
    ['BDBR-1', 'WE', 'BD-we', 'Central', '1', '', ''],
    [
      ['600200', '08:00:00'],
      ['600100', '08:15:00'],
      ['600016', '08:20:00'],
    ],
  )
  // Tram
  add(
    ['GLKN-1', 'WK', 'G-1', 'Broadbeach', '0', '', ''],
    [
      ['700001', '10:00:00'],
      ['700002', '10:10:00'],
    ],
  )
  // Bus: Cultural Centre platform 1 → Adelaide St → Queen St, a 24:30 trip, and a loop that repeats 1001.
  add(
    ['66-1', 'WK', 'B66-1', 'RBWH', '0', '', ''],
    [
      ['10802', '07:00:00'],
      ['1001', '07:05:00'],
      ['1002', '07:10:00'],
    ],
  )
  add(
    ['66-1', 'WK', 'B66-night', 'RBWH', '0', '', ''],
    [
      ['10802', '24:30:00'],
      ['1001', '24:35:00'],
      ['1002', '24:40:00'],
    ],
  )
  add(
    ['400-1', 'WK', 'B400-loop', '', '0', '', ''],
    [
      ['1001', '09:00:00'],
      ['1002', '09:05:00'],
      ['10802', '09:10:00'],
      ['1001', '09:20:00'],
    ],
  )
  add(
    ['66-1', 'WE', 'B66-we', 'RBWH', '0', '', ''],
    [
      ['10802', '10:00:00'],
      ['1001', '10:05:00'],
    ],
  )

  return {
    'agency.txt': [
      ['agency_name', 'agency_url', 'agency_timezone', 'agency_lang'],
      ['Synthlink', 'https://example.com/', 'Australia/Brisbane', 'en'],
    ],
    'feed_info.txt': [
      ['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_start_date', 'feed_end_date'],
      ['Test', 'https://example.com/', 'en', '20261001', '20261231'],
    ],
    'calendar.txt': [
      [
        'service_id',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
        'start_date',
        'end_date',
      ],
      ['WK', '1', '1', '1', '1', '1', '0', '0', '20261001', '20261231'],
      ['WE', '0', '0', '0', '0', '0', '1', '1', '20261001', '20261231'],
    ],
    'calendar_dates.txt': [['service_id', 'date', 'exception_type']],
    'routes.txt': [
      [
        'route_id',
        'route_short_name',
        'route_long_name',
        'route_desc',
        'route_type',
        'route_url',
        'route_color',
        'route_text_color',
      ],
      ['F1-1', 'F1', 'All stops CityCat', '', '4', '', '00A1E0', 'FFFFFF'],
      ['F11-1', 'F11', 'Express CityCat', '', '4', '', '0072CE', 'FFFFFF'],
      ['BDBR-1', 'BDBR', 'Airport - Central', '', '2', '', 'FFC425', '000000'],
      ['BRBD-1', 'BRBD', 'Central - Airport', '', '2', '', 'FFC425', '000000'],
      ['GLKN-1', 'GLKN', 'G:link', '', '0', '', 'D8E21E', '000000'],
      ['66-1', '66', 'UQ - RBWH, "busway"', '', '3', '', 'E463A4', '1D1D1D'],
      ['400-1', '400', 'Loop', '', '3', '', '', ''],
    ],
    'stops.txt': [
      [
        'stop_id',
        'stop_code',
        'stop_name',
        'stop_desc',
        'stop_lat',
        'stop_lon',
        'zone_id',
        'stop_url',
        'location_type',
        'parent_station',
        'platform_code',
      ],
      ['317580', '317580', 'Apollo Road ferry terminal', '', ' -27.445', ' 153.090', '1', '', '0', '', ''],
      ['317584', '317584', 'Bulimba ferry terminal', '', ' -27.452', ' 153.061', '1', '', '0', '', ''],
      ['317586', '317586', 'Hawthorne ferry terminal', '', ' -27.463', ' 153.057', '1', '', '0', '', ''],
      ['317590', '317590', 'Riverside ferry terminal', '', ' -27.467', ' 153.031', '1', '', '0', '', ''],
      ['place_censta', '', 'Central station', '', ' -27.466', ' 153.026', '1', '', '1', '', ''],
      [
        '600016',
        '600016',
        'Central station, platform 3',
        '',
        ' -27.4661',
        ' 153.0261',
        '1',
        '',
        '0',
        'place_censta',
        '3',
      ],
      [
        '600017',
        '600017',
        'Central station, platform 2',
        '',
        ' -27.4662',
        ' 153.0262',
        '1',
        '',
        '0',
        'place_censta',
        '2',
      ],
      ['place_bowsta', '', 'Bowen Hills station', '', ' -27.444', ' 153.039', '1', '', '1', '', ''],
      [
        '600100',
        '600100',
        'Bowen Hills station, platform 1',
        '',
        ' -27.4441',
        ' 153.0391',
        '1',
        '',
        '0',
        'place_bowsta',
        '1',
      ],
      [
        '600101',
        '600101',
        'Bowen Hills station, platform 2',
        '',
        ' -27.4442',
        ' 153.0392',
        '1',
        '',
        '0',
        'place_bowsta',
        '2',
      ],
      ['place_domsta', '', 'Domestic Airport station', '', ' -27.392', ' 153.120', '2', '', '1', '', ''],
      [
        '600200',
        '600200',
        'Domestic Airport station, platform 1',
        '',
        ' -27.3921',
        ' 153.1201',
        '2',
        '',
        '0',
        'place_domsta',
        '1',
      ],
      [
        '600201',
        '600201',
        'Domestic Airport station, platform 2',
        '',
        ' -27.3922',
        ' 153.1202',
        '2',
        '',
        '0',
        'place_domsta',
        '2',
      ],
      [
        '700001',
        '700001',
        'Gold Coast University Hospital',
        '',
        ' -27.961',
        ' 153.381',
        '5',
        '',
        '0',
        '',
        '',
      ],
      ['700002', '700002', 'Broadbeach South', '', ' -28.036', ' 153.431', '5', '', '0', '', ''],
      ['place_ccbs', '', 'Cultural Centre station', '', ' -27.4728', ' 153.0203', '1', '', '1', '', ''],
      [
        '10802',
        '010802',
        'Cultural Centre station, platform 1',
        '',
        ' -27.4729',
        ' 153.0204',
        '1',
        '',
        '0',
        'place_ccbs',
        '1',
      ],
      ['1001', '001001', 'Adelaide St, stop 1', '', ' -27.468', ' 153.026', '1', '', '0', '', ''],
      ['1002', '001002', 'Queen St, stop 2', '', ' -27.469', ' 153.027', '1', '', '0', '', ''],
    ],
    'trips.txt': trips,
    'stop_times.txt': stopTimes,
  }
}

export async function writeFeed(feed: SynthFeed, dir?: string): Promise<string> {
  const d = dir ?? (await mkdtemp(join(tmpdir(), 'bft-synth-')))
  await mkdir(d, { recursive: true })
  for (const [name, table] of Object.entries(feed)) await writeFile(join(d, name), toCsv(table))
  return d
}

export function feedZip(feed: SynthFeed): Uint8Array {
  const enc = new TextEncoder()
  return zipSync(Object.fromEntries(Object.entries(feed).map(([n, t]) => [n, enc.encode(toCsv(t))])))
}

/** A build instant: Tuesday 20 Oct 2026 03:15 Brisbane. */
export const NOW = Date.parse('2026-10-19T17:15:00Z')
export const D = '20261020'

/** Overwrite one cell (row 0 is the header). */
export function setCell(feed: SynthFeed, file: string, row: number, col: number, value: string): void {
  const r = feed[file]?.[row]
  if (!r) throw new Error(`${file} has no row ${row}`)
  r[col] = value
}
