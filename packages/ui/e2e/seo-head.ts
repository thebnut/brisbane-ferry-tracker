/**
 * The SEO part of a page's server HTML (THE-118 PR 5): the title, every `<meta>`, the canonical link and the JSON-LD,
 * in document order. Ferry became a terminal board in PR 5 and none of this may change, so the terminal-seo specs
 * compare it with a golden copy taken from develop before that PR.
 */
import { type APIRequestContext, expect } from '@playwright/test'

export function seoHead(html: string): string[] {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? ''
  return (
    [
      ...head.matchAll(
        /<title>[\s\S]*?<\/title>|<meta\b[^>]*>|<link\b[^>]*rel="canonical"[^>]*>|<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g,
      ),
    ]
      .map((m) => m[0])
      // The CSP nonce differs per request; it isn't SEO.
      .map((tag) => tag.replace(/ nonce="[^"]*"/, ''))
  )
}

/** Each path's SEO head from its server HTML (a 200, never a redirect). */
export async function seoHeads(
  request: APIRequestContext,
  paths: string[],
): Promise<Record<string, string[]>> {
  const got: Record<string, string[]> = {}
  for (const path of paths) {
    const res = await request.get(path, { maxRedirects: 0 })
    expect(res.status(), path).toBe(200)
    got[path] = seoHead(await res.text())
  }
  return got
}
