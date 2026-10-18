/**
 * Gate on a MobilityData gtfs-validator report (report.json): ERROR-level notices are structural corruption and fail
 * closed. Runs in CI after `java -jar gtfs-validator-cli.jar -i feed.zip -o report`; optional locally.
 *   node src/validate/gtfs-validator.ts report/report.json
 */
import { readFile } from 'node:fs/promises'

export interface ValidatorNotice {
  code: string
  severity: 'ERROR' | 'WARNING' | 'INFO' | string
  totalNotices: number
}

export function summarise(report: { notices?: ValidatorNotice[] }): { errors: string[]; lines: string[] } {
  const notices = report.notices ?? []
  const errors = notices.filter((n) => n.severity === 'ERROR').map((n) => `${n.code} (${n.totalNotices})`)
  const lines = ['ERROR', 'WARNING', 'INFO'].map(
    (sev) =>
      `${sev}: ${
        notices
          .filter((n) => n.severity === sev)
          .map((n) => `${n.code}×${n.totalNotices}`)
          .join(', ') || 'none'
      }`,
  )
  return { errors, lines }
}

if (import.meta.main) {
  const path = process.argv[2]
  if (!path) {
    console.error('usage: gtfs-validator.ts <report.json>')
    process.exit(1)
  }
  const { errors, lines } = summarise(JSON.parse(await readFile(path, 'utf8')))
  for (const l of lines) console.log(l)
  if (errors.length) {
    console.error(`STRUCTURAL FAILURE: gtfs-validator reported ERROR notices: ${errors.join(', ')}`)
    process.exit(2)
  }
}
