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

/** Bytes of one ranged read, with the whole object's size and the etag of the version they came from. */
export interface RangeRead {
  bytes: Uint8Array
  size: number
  etag: string
}

/**
 * Ranged reads, for the realtime combined object only (static data always uses `get`). `etag` pins the read to one
 * object version: 'changed' when the object was replaced since. A length past the end returns what there is.
 */
export interface RangeSource {
  getRange(key: string, offset: number, length: number, etag?: string): Promise<RangeRead | 'changed' | null>
}

export const supportsRange = (src: DataSource): src is DataSource & RangeSource =>
  typeof (src as Partial<RangeSource>).getRange === 'function'

/** R2 binding. Unused until R2 is enabled; then `DATA_BUCKET` takes precedence over the assets Worker. */
export class R2DataSource implements DataSource {
  readonly kind = 'r2'
  constructor(private readonly bucket: R2Bucket) {}

  async get(key: string): Promise<DataObject | null> {
    const obj = await this.bucket.get(key)
    if (!obj) return null
    return { body: obj.body as ReadableStream<Uint8Array>, etag: obj.httpEtag, size: obj.size }
  }

  async getRange(
    key: string,
    offset: number,
    length: number,
    etag?: string,
  ): Promise<RangeRead | 'changed' | null> {
    const obj = await this.bucket.get(key, {
      range: { offset, length },
      ...(etag ? { onlyIf: { etagMatches: etag } } : {}),
    })
    if (!obj) return null
    if (!('body' in obj)) return 'changed'
    return { bytes: new Uint8Array(await obj.arrayBuffer()), size: obj.size, etag: obj.etag }
  }
}

/**
 * A read over the data Worker binding is cut off after this, body included. Callers already stop waiting at their own
 * deadlines (3-6 s); this ends the subrequest itself, so it can't stay open after them (the 19 Oct peak stall).
 */
export const DATA_FETCH_TIMEOUT_MS = 10_000

/** The static-assets data Worker (`services/data`), reached over a service binding. */
export class FetcherDataSource implements DataSource {
  readonly kind = 'assets'
  constructor(
    private readonly fetcher: { fetch(input: string, init?: RequestInit): Promise<Response> },
    private readonly origin = 'https://bft-data.internal',
    private readonly timeoutMs = DATA_FETCH_TIMEOUT_MS,
  ) {}

  async get(key: string): Promise<DataObject | null> {
    const res = await this.fetcher.fetch(`${this.origin}/${encodePath(key)}`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    })
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

  /** A ranged read, logged as `key@offset+length`. Each stored array is one object version (its etag). */
  async getRange(
    key: string,
    offset: number,
    length: number,
    etag?: string,
  ): Promise<RangeRead | 'changed' | null> {
    this.reads.push(`${key}@${offset}+${length}`)
    const bytes = this.files.get(key)
    if (!bytes) return null
    const tag = versionTag(bytes)
    if (etag && etag !== tag) return 'changed'
    return { bytes: bytes.slice(offset, offset + length), size: bytes.byteLength, etag: tag }
  }
}

const versions = new WeakMap<Uint8Array, string>()
let nextVersion = 0
const versionTag = (b: Uint8Array) => {
  let v = versions.get(b)
  if (!v) {
    v = `v${++nextVersion}`
    versions.set(b, v)
  }
  return v
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

/** gzip's magic bytes (JSON text never starts with them). */
export const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b

/**
 * The text of bytes that may be gzip (a transport may already have decoded them). A corrupt or truncated gzip stream
 * rejects: DecompressionStream checks the trailer's CRC and length, and in workerd errors on a stream that ends early
 * (strict_compression_checks, the default since compatibility date 2023-08-01).
 */
export async function decodeText(bytes: Uint8Array): Promise<string> {
  if (!isGzip(bytes)) return new TextDecoder().decode(bytes)
  const stream = new Blob([bytes as unknown as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** Gunzip if the bytes are gzip, then parse JSON. */
export async function decodeJson(bytes: Uint8Array): Promise<unknown> {
  return JSON.parse(await decodeText(bytes))
}

export async function readJson(src: DataSource, key: string): Promise<unknown | null> {
  const bytes = await readBytes(src, key)
  return bytes ? decodeJson(bytes) : null
}

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
