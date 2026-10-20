/**
 * The `error` (and a safe `detail`) of a 5xx JSON response, for the `request` log line: a 503 that says only its
 * status and ms can't be told apart (`no static data for mode` from `static index missing`, staging 20 Oct).
 * Only server errors are read, from a clone, and never more than ERROR_BODY_MAX_BYTES: a larger or non-JSON body is
 * skipped, so a successful response costs nothing and a big one isn't read whole.
 */
export const ERROR_BODY_MAX_BYTES = 2048
const MAX_FIELD_CHARS = 120
/** A detail logged only when it looks like an identifier (a mode or generation id), never free text or user input. */
const SAFE_DETAIL = /^[A-Za-z0-9._:@-]{1,64}$/

export async function errorLogFields(res: Response): Promise<{ error?: string; detail?: string }> {
  if (res.status < 500 || !res.body) return {}
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) return {}
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > ERROR_BODY_MAX_BYTES) return {}
  try {
    const reader = (res.clone().body as ReadableStream<Uint8Array>).getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > ERROR_BODY_MAX_BYTES) {
        // Not awaited: cancelling one branch of a tee settles only once the other (the client's) is done too.
        reader.cancel().catch(() => {})
        return {}
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let at = 0
    for (const c of chunks) {
      bytes.set(c, at)
      at += c.byteLength
    }
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { error?: unknown; detail?: unknown }
    const out: { error?: string; detail?: string } = {}
    if (typeof body?.error === 'string') out.error = body.error.slice(0, MAX_FIELD_CHARS)
    if (typeof body?.detail === 'string' && SAFE_DETAIL.test(body.detail)) out.detail = body.detail
    return out
  } catch {
    return {}
  }
}
