/** Local-directory DataSource for dev, tests and scripts (Node only). Reads the same key layout as R2. */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { DataObject, DataSource } from './source.ts'

export class LocalDirDataSource implements DataSource {
  readonly kind = 'local'
  constructor(private readonly dir: string) {}

  async get(key: string): Promise<DataObject | null> {
    const path = normalize(join(this.dir, key))
    if (!path.startsWith(normalize(this.dir) + sep)) return null
    try {
      const s = await stat(path)
      if (!s.isFile()) return null
      return {
        body: Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>,
        size: s.size,
      }
    } catch {
      return null
    }
  }
}
