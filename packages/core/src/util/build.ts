/**
 * Build marker: every Worker response carries `x-bft-build: <short sha>` so a staging or production host can be tied
 * to the commit it runs. The deploy scripts pass `--var BUILD_SHA:<sha>` (scripts/build-sha.mjs); local dev and tests
 * have no BUILD_SHA and report "dev".
 */
export const BUILD_HEADER = 'x-bft-build'

const BUILD_SHA_RE = /^[0-9a-f]{7,40}(-dirty)?$/

/** The deployed short sha (with `-dirty` when built from a modified tree), or "dev". Never echoes anything else. */
export function buildId(raw: string | undefined): string {
  return raw && BUILD_SHA_RE.test(raw) ? raw : 'dev'
}

/** Set the marker on a response whose headers are mutable (one the Worker built), and return it. */
export function withBuild<R extends { headers: { set(name: string, value: string): void } }>(
  res: R,
  raw: string | undefined,
): R {
  res.headers.set(BUILD_HEADER, buildId(raw))
  return res
}
