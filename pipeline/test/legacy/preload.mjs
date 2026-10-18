// Preload for running the untouched schedule-processor/process-schedule.js in tests: serve the GTFS zip from disk
// instead of the network and pin "now" to LEGACY_NOW (epoch ms).
import { readFileSync } from 'node:fs'

const zip = readFileSync(process.env.LEGACY_ZIP)
globalThis.fetch = async () => new Response(zip)

const NOW = Number(process.env.LEGACY_NOW)
const RealDate = Date
class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(NOW)
    else super(...args)
  }
  static now() {
    return NOW
  }
}
globalThis.Date = FixedDate
