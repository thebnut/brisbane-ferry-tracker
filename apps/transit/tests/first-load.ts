/** Stand-in for the per-request CSP nonce: same length and entropy as a real one, so it compresses alike. */
const FIXED_NONCE = 'q3Zt8LwKpB1xYc7RfN2mVg=='
/** Render times are this close to the root's `__bftRenderedAt` (the root and page loaders run within a few ms). */
const RENDER_WINDOW_MS = 5_000
/**
 * Render times land this long after the pinned instant: like a real render that follows its API answer, so they share
 * the leading digits with the data's timestamps but never equal the fixtures' `generatedAt` (which is the pinned
 * instant), and so never compress better than they would for real.
 */
const RENDER_LAG_MS = 1_234

/**
 * The page's inline scripts with the per-request noise made constant, for the first-load budget: the CSP nonce
 * (random) and the server's real-clock render times. Each render time becomes `pinned + RENDER_LAG_MS` plus its offset
 * from the root's, so values keep their length and stay distinct from each other and from the fixture data. Only numbers within 5 s of the real render time change; fixture
 * timestamps (on the pinned day, never the real clock) are left as they are.
 */
export function stableInline(html: string, nonce: string | undefined, pinned: number): string {
  let inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .join('')
  if (nonce) inline = inline.split(nonce).join(FIXED_NONCE)
  const rendered = Number(/__bftRenderedAt=(\d{13})/.exec(inline)?.[1])
  if (!rendered) return inline
  return inline.replace(/\b\d{13}\b/g, (n) => {
    const offset = Number(n) - rendered
    return Math.abs(offset) <= RENDER_WINDOW_MS ? String(pinned + RENDER_LAG_MS + offset) : n
  })
}
