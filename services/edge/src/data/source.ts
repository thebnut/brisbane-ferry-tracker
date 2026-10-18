/**
 * Storage access behind one small interface (common storage layout, transit-architecture.md §3.2).
 *
 * R2 isn't enabled on the account yet, so production reads go through the static-assets "data" Worker over a
 * service binding. The R2 implementation is ready for when it is. Tests and scripts use a local directory
 * (`./local.ts`, Node only, so the Worker bundle never pulls in node:fs).
 */

export interface DataObject {
  body: ReadableStream<Uint8Array>
  etag?: string
  size?: number
}

export interface DataSource {
  readonly kind: 'r2' | 'assets' | 'local' | 'memory'
  get(key: string): Promise<DataObject | null>
}

/** R2 binding. Unused until R2 is enabled; then `DATA_BUCKET` takes precedence over the assets Worker. */
export class R2DataSource implements DataSource {
  readonly kind = 'r2'
  constructor(private readonly bucket: R2Bucket) {}

  async get(key: string): Promise<DataObject | null> {
    const obj = await this.bucket.get(key)
    if (!obj) return null
    return { body: obj.body as ReadableStream<Uint8Array>, etag: obj.httpEtag, size: obj.size }
  }
}

/** The static-assets data Worker (`services/data`), reached over a service binding. */
export class FetcherDataSource implements DataSource {
  readonly kind = 'assets'
  constructor(
    private readonly fetcher: { fetch(input: string, init?: RequestInit): Promise<Response> },
    private readonly origin = 'https://bft-data.internal',
  ) {}

  async get(key: string): Promise<DataObject | null> {
    const res = await this.fetcher.fetch(`${this.origin}/${encodePath(key)}`)
    if (res.status === 404) return null
    if (!res.ok || !res.body) throw new Error(`data source ${key}: HTTP ${res.status}`)
    const len = res.headers.get('content-length')
    return {
      body: res.body,
      etag: res.headers.get('etag') ?? undefined,
      size: len ? Number(len) : undefined,
    }
  }
}

/** In-memory source for tests. */
export class MemoryDataSource implements DataSource {
  readonly kind = 'memory'
  readonly reads: string[] = []
  constructor(readonly files: Map<string, Uint8Array> = new Map()) {}

  async get(key: string): Promise<DataObject | null> {
    this.reads.push(key)
    const bytes = this.files.get(key)
    if (!bytes) return null
    return {
      body: new Blob([bytes as unknown as ArrayBuffer]).stream() as ReadableStream<Uint8Array>,
      size: bytes.byteLength,
    }
  }
}

const encodePath = (key: string) => key.split('/').map(encodeURIComponent).join('/')

/** Pick the data source for a Worker environment: R2 when bound, otherwise the assets Worker. */
export function dataSourceFor(env: { DATA_BUCKET?: R2Bucket; DATA?: Fetcher }): DataSource {
  if (env.DATA_BUCKET) return new R2DataSource(env.DATA_BUCKET)
  if (env.DATA) return new FetcherDataSource(env.DATA)
  throw new Error('no data source bound (DATA_BUCKET or DATA)')
}

export async function readBytes(src: DataSource, key: string): Promise<Uint8Array | null> {
  const obj = await src.get(key)
  if (!obj) return null
  return new Uint8Array(await new Response(obj.body).arrayBuffer())
}

const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b

/** Gunzip if the bytes are gzip (a transport may already have decoded them), then parse JSON. */
export async function decodeJson(bytes: Uint8Array): Promise<unknown> {
  if (!isGzip(bytes)) return JSON.parse(new TextDecoder().decode(bytes))
  const stream = new Blob([bytes as unknown as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text())
}

export async function readJson(src: DataSource, key: string): Promise<unknown | null> {
  const bytes = await readBytes(src, key)
  return bytes ? decodeJson(bytes) : null
}

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
