/**
 * P6b: the favourites a mode host hands to BrisbaneTransit in the URL fragment (`#import=<base64url JSON>`), which never
 * reaches a server. The mode host's handoff page (handoff.ts) builds it; transit decodes it here, lazily, only when a
 * page opens with that fragment.
 *
 * Strict by design: only the known keys, in each store's own shapes (ferry pair, train favourites, bus saved stops), a
 * size cap, and the whole payload is rejected on any error, so nothing malformed reaches the stores. It is only ever
 * parsed as JSON and validated, never evaluated or put into HTML.
 */

export const HANDOFF_PREFIX = '#import='
/** The JSON's UTF-8 size limit (the handoff page trims lists to fit). */
export const MAX_HANDOFF_BYTES = 4096
export const MAX_TRAIN = 8
export const MAX_BUS = 50

export interface HandoffStop {
  id: string
  name: string
}
export interface HandoffPayload {
  v: 1
  /** The ferry app's remembered terminal pair (brisbane-ferry-selected-stops); remember = it was in localStorage. */
  ferry?: { pair: { outbound: HandoffStop; inbound: HandoffStop }; remember: boolean }
  /** bft-train-favourites */
  train?: { from: string; to: string | null }[]
  /** bft-bus-saved */
  bus?: HandoffStop[]
}

// Limits shared with the handoff page's script (handoff.ts), which filters to them so one odd item can't sink the rest.
export const FERRY_ID_RE = /^\d{1,12}$/
export const TRAIN_KEY_RE = /^[a-z0-9-]{1,64}$/
export const BUS_ID_RE = /^[\w-]{1,32}$/
export const FERRY_NAME_MAX = 100
export const BUS_NAME_MAX = 120
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
export const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/
const B64URL_RE = /^[A-Za-z0-9_-]+$/
/** The longest fragment value that can decode to MAX_HANDOFF_BYTES. */
const MAX_ENCODED = Math.ceil(MAX_HANDOFF_BYTES / 3) * 4

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
/** Exactly these own keys (JSON.parse makes "__proto__" an own key, so it fails here too). */
const hasKeys = (v: Record<string, unknown>, keys: readonly string[], optional: readonly string[] = []) =>
  Object.keys(v).every((k) => keys.includes(k) || optional.includes(k)) &&
  keys.every((k) => Object.hasOwn(v, k))
const text = (v: unknown, max: number, min = 0): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max && !CONTROL_CHARS_RE.test(v)

function ferryStop(v: unknown): HandoffStop | null {
  if (!isRecord(v) || !hasKeys(v, ['id', 'name'])) return null
  return typeof v.id === 'string' && FERRY_ID_RE.test(v.id) && text(v.name, FERRY_NAME_MAX)
    ? { id: v.id, name: v.name }
    : null
}

function ferry(v: unknown): HandoffPayload['ferry'] | null {
  if (!isRecord(v) || !hasKeys(v, ['pair', 'remember']) || typeof v.remember !== 'boolean') return null
  const p = v.pair
  if (!isRecord(p) || !hasKeys(p, ['outbound', 'inbound'])) return null
  const outbound = ferryStop(p.outbound)
  const inbound = ferryStop(p.inbound)
  return outbound && inbound && outbound.id !== inbound.id
    ? { pair: { outbound, inbound }, remember: v.remember }
    : null
}

function train(v: unknown): HandoffPayload['train'] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_TRAIN) return null
  const out: NonNullable<HandoffPayload['train']> = []
  for (const f of v) {
    if (!isRecord(f) || !hasKeys(f, ['from', 'to'])) return null
    if (typeof f.from !== 'string' || !TRAIN_KEY_RE.test(f.from)) return null
    if (f.to !== null && (typeof f.to !== 'string' || !TRAIN_KEY_RE.test(f.to))) return null
    out.push({ from: f.from, to: f.to })
  }
  return out
}

function bus(v: unknown): HandoffPayload['bus'] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_BUS) return null
  const out: HandoffStop[] = []
  for (const s of v) {
    if (!isRecord(s) || !hasKeys(s, ['id', 'name'])) return null
    if (typeof s.id !== 'string' || !BUS_ID_RE.test(s.id) || !text(s.name, BUS_NAME_MAX, 1)) return null
    out.push({ id: s.id, name: s.name })
  }
  return out
}

/** The validated payload, or null for anything else (whole payload rejected). */
export function validateHandoff(v: unknown): HandoffPayload | null {
  if (!isRecord(v) || !hasKeys(v, ['v'], ['ferry', 'train', 'bus']) || v.v !== 1) return null
  const out: HandoffPayload = { v: 1 }
  if (Object.hasOwn(v, 'ferry')) {
    const f = ferry(v.ferry)
    if (!f) return null
    out.ferry = f
  }
  if (Object.hasOwn(v, 'train')) {
    const t = train(v.train)
    if (!t) return null
    out.train = t
  }
  if (Object.hasOwn(v, 'bus')) {
    const b = bus(v.bus)
    if (!b) return null
    out.bus = b
  }
  return out.ferry || out.train || out.bus ? out : null
}

/** `#import=…` → payload, or null (wrong prefix, too big, not base64url, not UTF-8 JSON, or invalid). */
export function decodeHandoff(hash: string): HandoffPayload | null {
  if (!hash.startsWith(HANDOFF_PREFIX)) return null
  const enc = hash.slice(HANDOFF_PREFIX.length)
  if (enc.length === 0 || enc.length > MAX_ENCODED || !B64URL_RE.test(enc)) return null
  try {
    const bin = atob(enc.replace(/-/g, '+').replace(/_/g, '/'))
    if (bin.length > MAX_HANDOFF_BYTES) return null
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return validateHandoff(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch {
    return null
  }
}

/** The fragment for a payload (the handoff page's script does the same in plain JS); null when over the cap. */
export function encodeHandoff(payload: HandoffPayload): string | null {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  if (bytes.length > MAX_HANDOFF_BYTES) return null
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `${HANDOFF_PREFIX}${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/** Items in a payload (the notice's "Your N stops"). */
export const handoffCount = (p: HandoffPayload) =>
  (p.ferry ? 1 : 0) + (p.train?.length ?? 0) + (p.bus?.length ?? 0)
