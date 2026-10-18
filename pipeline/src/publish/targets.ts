/**
 * Storage targets behind one interface (common.md "Shared storage layout"): a local directory (default), R2 through
 * its S3-compatible API (ready, unused until R2 is enabled), and an "assets" directory laid out for the static-assets
 * data Worker. Readers (the previous generation for validation) use the same interface, plus a plain HTTP base URL.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { AwsClient } from 'aws4fetch'
import type { ListedObject } from '../gc/gc.ts'

export interface PutMeta {
  contentType: string
  cacheControl: string
}

export interface Reader {
  readonly name: string
  get(key: string): Promise<Uint8Array | null>
}

export interface PublishTarget extends Reader {
  exists(key: string): Promise<boolean>
  put(key: string, body: Uint8Array, meta: PutMeta): Promise<void>
  /** Called once after the last put (manifest.json). */
  finish?(): Promise<void>
}

export const IMMUTABLE = 'public, max-age=31536000, immutable'

export function metaFor(key: string): PutMeta {
  if (key.endsWith('.json.gz')) return { contentType: 'application/gzip', cacheControl: IMMUTABLE }
  if (/^static\/[^/]+\/[^/]+\/index\.json$/.test(key))
    return { contentType: 'application/json', cacheControl: IMMUTABLE }
  if (key === 'manifest.json' || key === 'manifest.staging.json')
    return { contentType: 'application/json', cacheControl: 'public, max-age=60' }
  return { contentType: 'application/json', cacheControl: 'public, max-age=300' }
}

export class DirTarget implements PublishTarget {
  readonly name: string
  constructor(readonly dir: string) {
    this.name = `dir:${dir}`
  }
  async get(key: string): Promise<Uint8Array | null> {
    const p = join(this.dir, key)
    return existsSync(p) ? new Uint8Array(await readFile(p)) : null
  }
  async exists(key: string): Promise<boolean> {
    return existsSync(join(this.dir, key))
  }
  async put(key: string, body: Uint8Array): Promise<void> {
    const p = join(this.dir, key)
    await mkdir(dirname(p), { recursive: true })
    // Write then rename, so a reader never sees a half-written manifest.
    const tmp = `${p}.tmp-${process.pid}`
    await writeFile(tmp, body)
    await rename(tmp, p)
  }
}

/** Workers Free: 20,000 static-asset files per Worker version. */
export const ASSETS_FILE_LIMIT = 20_000

/**
 * A directory for the static-assets data Worker (`assets.directory` in its wrangler config). Same key layout,
 * plus a `_headers` file carrying the cache rules. Bus stop-days are published as shards only.
 */
export class AssetsTarget extends DirTarget {
  override readonly name: string
  constructor(
    dir: string,
    readonly fileLimit = ASSETS_FILE_LIMIT,
  ) {
    super(dir)
    this.name = `assets:${dir}`
  }
  async finish(): Promise<void> {
    const headers = [
      '/static/*',
      `  Cache-Control: ${IMMUTABLE}`,
      '/manifest.json',
      '  Cache-Control: public, max-age=60',
      '/manifest.staging.json',
      '  Cache-Control: public, max-age=60',
      '/data/*',
      '  Cache-Control: public, max-age=300',
      '/legacy/*',
      '  Cache-Control: public, max-age=300',
      '  Access-Control-Allow-Origin: *',
      '',
    ].join('\n')
    await writeFile(join(this.dir, '_headers'), headers)
    const files = await countFiles(this.dir)
    if (files > this.fileLimit)
      throw new Error(
        `assets directory has ${files} files, over the Workers limit of ${this.fileLimit} per version`,
      )
  }
}

export async function countFiles(dir: string): Promise<number> {
  let n = 0
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) n++
  return n
}

export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) out.push(relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
  }
  return out.sort()
}

export interface R2Config {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** Override for tests or a jurisdiction endpoint. */
  endpoint?: string
}

/** R2 via the S3 API (SigV4 with aws4fetch). HEAD is a Class B operation, PUT a Class A one. */
export class R2Target implements PublishTarget {
  readonly name: string
  private readonly client: AwsClient
  private readonly base: string
  constructor(
    cfg: R2Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = `r2:${cfg.bucket}`
    this.client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: 's3',
      region: 'auto',
    })
    this.base = `${cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`}/${cfg.bucket}`
  }
  private async send(method: string, key: string, init: RequestInit = {}): Promise<Response> {
    const req = await this.client.sign(`${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`, {
      method,
      ...init,
    })
    return withRetry(() => this.fetchImpl(req.clone()))
  }
  async exists(key: string): Promise<boolean> {
    const res = await this.send('HEAD', key)
    if (res.status === 404) return false
    if (!res.ok) throw new Error(`R2 HEAD ${key}: HTTP ${res.status}`)
    return true
  }
  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.send('GET', key)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`R2 GET ${key}: HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  async put(key: string, body: Uint8Array, meta: PutMeta): Promise<void> {
    const res = await this.send('PUT', key, {
      body: body as unknown as RequestInit['body'],
      headers: { 'content-type': meta.contentType, 'cache-control': meta.cacheControl },
    })
    if (!res.ok) throw new Error(`R2 PUT ${key}: HTTP ${res.status} ${await res.text()}`)
  }
  /** ListObjectsV2, 1,000 keys a page (Class A). */
  async list(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = []
    let token: string | undefined
    do {
      const q = new URLSearchParams({ 'list-type': '2', 'max-keys': '1000', prefix })
      if (token) q.set('continuation-token', token)
      const req = await this.client.sign(`${this.base}?${q}`, { method: 'GET' })
      const res = await withRetry(() => this.fetchImpl(req.clone()))
      if (!res.ok) throw new Error(`R2 LIST ${prefix}: HTTP ${res.status} ${await res.text()}`)
      const page = parseListObjectsV2(await res.text())
      out.push(...page.objects)
      token = page.next
    } while (token)
    return out
  }
  /** DeleteObjects (free), at most 1,000 keys. Throws if R2 reports any per-key error. */
  async deleteMany(keys: string[]): Promise<void> {
    if (!keys.length) return
    if (keys.length > 1000) throw new Error(`DeleteObjects takes at most 1000 keys, got ${keys.length}`)
    const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${keys
      .map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`)
      .join('')}</Delete>`
    const { createHash } = await import('node:crypto')
    const req = await this.client.sign(`${this.base}?delete`, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/xml',
        'content-md5': createHash('md5').update(body).digest('base64'),
      },
    })
    const res = await withRetry(() => this.fetchImpl(req.clone()))
    const text = await res.text()
    if (!res.ok) throw new Error(`R2 DELETE batch: HTTP ${res.status} ${text}`)
    if (/<Error>/.test(text)) throw new Error(`R2 DELETE batch reported errors: ${text.slice(0, 2000)}`)
  }
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const xmlUnescape = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** The parts of an S3 ListObjectsV2 response the GC needs. */
export function parseListObjectsV2(xml: string): { objects: ListedObject[]; next?: string } {
  const objects: ListedObject[] = []
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const part = m[1] as string
    const tag = (t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(part)?.[1]
    const key = tag('Key')
    if (key === undefined) continue
    objects.push({
      key: xmlUnescape(key),
      size: Number(tag('Size') ?? 0),
      uploaded: Date.parse(tag('LastModified') ?? ''),
    })
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
  const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
  if (truncated && !next) throw new Error('R2 LIST is truncated but has no continuation token')
  return truncated && next ? { objects, next: xmlUnescape(next) } : { objects }
}

/** Retry 429 / 5xx / network errors with backoff (R2 and the uploader can briefly throttle bulk uploads). */
export async function withRetry(fn: () => Promise<Response>, attempts = 5): Promise<Response> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fn()
      if (res.status !== 429 && res.status < 500) return res
      last = new Error(`HTTP ${res.status}`)
    } catch (e) {
      last = e
    }
    await new Promise((r) => setTimeout(r, 250 * 2 ** i))
  }
  throw last instanceof Error ? last : new Error(String(last))
}

/**
 * R2 S3 credentials from a Cloudflare API token that has R2 write permission: the access key id is the token's id
 * and the secret is the SHA-256 hex of the token value (Cloudflare R2 docs, "Get S3 API credentials from an API token").
 */
export async function r2CredentialsFromApiToken(
  token: string,
  accountId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessKeyId: string; secretAccessKey: string }> {
  const { createHash } = await import('node:crypto')
  let id: string | undefined
  for (const url of [
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
    'https://api.cloudflare.com/client/v4/user/tokens/verify',
  ]) {
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) continue
    const body = (await res.json()) as { success?: boolean; result?: { id?: string } }
    if (body.success && body.result?.id) {
      id = body.result.id
      break
    }
  }
  if (!id)
    throw new Error(
      'could not verify CLOUDFLARE_API_TOKEN (account and user token endpoints both refused it)',
    )
  return { accessKeyId: id, secretAccessKey: createHash('sha256').update(token).digest('hex') }
}

/**
 * Publish through the local uploader Worker (pipeline/r2-uploader, `wrangler dev` with a remote R2 binding), so a
 * laptop with a wrangler login can write to R2 without S3 keys. Every request carries a per-session token.
 */
export class UploaderTarget implements PublishTarget {
  readonly name: string
  constructor(
    private readonly base: string,
    private readonly token: string,
    bucket: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = `r2:${bucket} (via ${base})`
  }
  private send(method: string, key: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.base.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
    return withRetry(() =>
      this.fetchImpl(url, {
        ...init,
        method,
        headers: { ...(init.headers ?? {}), 'x-uploader-token': this.token },
      }),
    )
  }
  async exists(key: string): Promise<boolean> {
    const res = await this.send('HEAD', key)
    if (res.status === 404) return false
    if (!res.ok) throw new Error(`uploader HEAD ${key}: HTTP ${res.status}`)
    return true
  }
  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.send('GET', key)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`uploader GET ${key}: HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  async put(key: string, body: Uint8Array, meta: PutMeta): Promise<void> {
    const res = await this.send('PUT', key, {
      body: body as unknown as RequestInit['body'],
      headers: { 'content-type': meta.contentType, 'cache-control': meta.cacheControl },
    })
    if (!res.ok) throw new Error(`uploader PUT ${key}: HTTP ${res.status} ${await res.text()}`)
  }
  private async op(
    op: string,
    init: RequestInit & { query?: Record<string, string> } = {},
  ): Promise<Response> {
    const q = new URLSearchParams({ op, ...(init.query ?? {}) })
    const { query: _q, ...rest } = init
    return withRetry(() =>
      this.fetchImpl(`${this.base.replace(/\/$/, '')}/?${q}`, {
        ...rest,
        headers: { ...(rest.headers ?? {}), 'x-uploader-token': this.token },
      }),
    )
  }
  async list(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = []
    let cursor: string | undefined
    do {
      const res = await this.op('list', { method: 'GET', query: { prefix, ...(cursor ? { cursor } : {}) } })
      if (!res.ok) throw new Error(`uploader LIST ${prefix}: HTTP ${res.status} ${await res.text()}`)
      const page = (await res.json()) as {
        objects: Array<{ key: string; size: number; uploaded: string }>
        cursor?: string
      }
      for (const o of page.objects) out.push({ key: o.key, size: o.size, uploaded: Date.parse(o.uploaded) })
      cursor = page.cursor
    } while (cursor)
    return out
  }
  async deleteMany(keys: string[]): Promise<void> {
    if (!keys.length) return
    const res = await this.op('delete', {
      method: 'POST',
      body: JSON.stringify({ keys }),
      headers: { 'content-type': 'application/json' },
    })
    if (!res.ok) throw new Error(`uploader DELETE batch: HTTP ${res.status} ${await res.text()}`)
  }
}

/** Read-only source over HTTP, e.g. the deployed data Worker, for the previous manifest and indexes. */
export class HttpReader implements Reader {
  readonly name: string
  constructor(
    private readonly base: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = `http:${base}`
  }
  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.fetchImpl(`${this.base.replace(/\/$/, '')}/${key}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GET ${key}: HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

export async function readJson<T>(r: Reader, key: string): Promise<T | null> {
  const b = await r.get(key)
  return b ? (JSON.parse(new TextDecoder().decode(b)) as T) : null
}
