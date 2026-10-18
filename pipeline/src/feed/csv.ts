/**
 * Streaming RFC 4180 CSV reader for GTFS files. `stop_times.txt` is 199 MB / 3.5M rows, so rows are handed to a
 * callback one at a time and never held as a whole file of strings.
 */
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'

export class CsvError extends Error {}

/** Column lookup for one file: `col('stop_id')` returns the field index, or -1 when the column is absent. */
export interface CsvHeader {
  names: string[]
  col(name: string): number
}

function makeHeader(names: string[]): CsvHeader {
  const clean = names.map((n, i) => (i === 0 ? n.replace(/^﻿/, '') : n).trim())
  const idx = new Map(clean.map((n, i) => [n, i]))
  return { names: clean, col: (name) => idx.get(name) ?? -1 }
}

/** Incremental parser: feed it chunks, it emits complete records. */
class Parser {
  private field = ''
  private row: string[] = []
  private inQuotes = false
  /** A quote seen inside a quoted field: either an escaped "" or the closing quote. */
  private pendingQuote = false
  private sawAny = false

  constructor(private readonly onRecord: (fields: string[]) => void) {}

  push(chunk: string): void {
    let start = 0
    const n = chunk.length
    for (let i = 0; i < n; i++) {
      const c = chunk.charCodeAt(i)
      if (this.pendingQuote) {
        this.pendingQuote = false
        if (c === 34) {
          // "" escape: keep one quote, stay quoted
          this.field += '"'
          start = i + 1
          continue
        }
        this.inQuotes = false
        start = i
      }
      if (this.inQuotes) {
        if (c === 34) {
          this.field += chunk.slice(start, i)
          this.pendingQuote = true
          start = i + 1
        }
        continue
      }
      if (c === 44) {
        this.row.push(this.field + chunk.slice(start, i))
        this.field = ''
        start = i + 1
        this.sawAny = true
      } else if (c === 10 || c === 13) {
        this.field += chunk.slice(start, i)
        if (c === 13 && chunk.charCodeAt(i + 1) === 10) i++
        this.endRecord()
        start = i + 1
      } else if (c === 34 && start === i && this.field === '') {
        this.inQuotes = true
        start = i + 1
        this.sawAny = true
      } else {
        this.sawAny = true
      }
    }
    this.field += chunk.slice(start)
  }

  private endRecord(): void {
    if (this.row.length === 0 && this.field === '' && !this.sawAny) return // blank line
    this.row.push(this.field)
    this.onRecord(this.row)
    this.row = []
    this.field = ''
    this.sawAny = false
  }

  end(): void {
    if (this.inQuotes && !this.pendingQuote) throw new CsvError('unterminated quoted field')
    this.pendingQuote = false
    this.inQuotes = false
    if (this.row.length > 0 || this.field !== '' || this.sawAny) this.endRecord()
  }
}

/**
 * Stream a CSV file. `onRow` receives the raw fields array (reused shapes, do not keep references you don't need).
 * Rows shorter than the header are padded with ''.
 */
export async function streamCsv(
  path: string,
  onHeader: (h: CsvHeader) => void,
  onRow: (fields: string[], line: number) => void,
): Promise<number> {
  let header: CsvHeader | null = null
  let line = 0
  const parser = new Parser((fields) => {
    line++
    if (!header) {
      header = makeHeader(fields)
      onHeader(header)
      return
    }
    while (fields.length < header.names.length) fields.push('')
    onRow(fields, line)
  })
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 })
  for await (const chunk of stream) parser.push(chunk as string)
  parser.end()
  if (!header) throw new CsvError(`${path}: empty file`)
  return line - 1
}

/** Parse a whole (small) CSV file into objects keyed by column name. */
export async function readCsvObjects(path: string): Promise<Record<string, string>[]> {
  const text = await readFile(path, 'utf8')
  return parseCsvObjects(text)
}

export function parseCsvObjects(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  let header: CsvHeader | null = null
  const parser = new Parser((fields) => {
    if (!header) {
      header = makeHeader(fields)
      return
    }
    const o: Record<string, string> = {}
    header.names.forEach((n, i) => {
      o[n] = fields[i] ?? ''
    })
    out.push(o)
  })
  parser.push(text)
  parser.end()
  if (!header) throw new CsvError('empty file')
  return out
}
