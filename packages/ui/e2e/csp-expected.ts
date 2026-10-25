/**
 * The CSP refusals a page with GA on is expected to log, and nothing else.
 *
 * With GA_MEASUREMENT_ID set (production and staging), gtag.js also fires the Google Ads and Google signals beacons
 * that the GA4 property's Ads link and signals settings ask for. The CSP refuses them on purpose: only GA4's own
 * collection origins are allowed (analytics-config.ts), and the Ads beacon carries `dt=document.title`, which names
 * the stop. Silencing them is a GA4/Ads admin change, never a wider CSP. So a check against a GA-on page counts these
 * refusals as expected, and any other CSP refusal, page error or line it can't read still fails it.
 *
 * Plain TypeScript (type stripping only), so node scripts can import it as well as the Playwright specs.
 */

/** The deliberately blocked beacon endpoints: an exact host and path, any query. */
export const BLOCKED_BEACONS: readonly RegExp[] = [
  // Google Ads (the property's Ads link).
  /^https:\/\/www\.google\.com\/ccm\/collect(?:\?|$)/,
  /^https:\/\/ad\.doubleclick\.net\/ccm\/s\/collect(?:\?|$)/,
  // Google signals.
  /^https:\/\/stats\.g\.doubleclick\.net\/g\/collect(?:\?|$)/,
  // Google signals' duplicate hit after a client route change (R44-G1).
  /^https:\/\/www\.google\.com\/g\/collect(?:\?|$)/,
  // Google signals audiences, on the visitor's country Google domain: only the ones seen (www.google.com.au from
  // Australia, www.google.com elsewhere). Another country's would need adding here once seen.
  /^https:\/\/www\.google\.(?:com|com\.au)\/ads\/ga-audiences(?:\?|$)/,
]

/** A beacon is a fetch/sendBeacon (connect-src) or an image ping (img-src); a script or frame never is. */
const BEACON_DIRECTIVES = new Set(['connect-src', 'img-src'])

/**
 * The blocked URL and directive in each shape a refusal is reported in: Chrome's console lines, and the
 * `securitypolicyviolation` events the specs log themselves (`<directive> <blockedURI> [<sourceFile>]`, transit
 * csp.ts; `Refused to load <blockedURI> (<directive>)`, ga.ts). Null for anything else.
 */
export function blockedBy(message: string): { url: string; directive: string | null } | null {
  const line =
    /^(Connecting to|Loading the image) '(https:\/\/[^']+)' violates the following Content Security Policy directive: "([a-z-]+)(?: [^"]*)?"\. The action has been blocked\.$/.exec(
      message,
    )
  if (line) {
    // The console names the directive, and the verb must agree with it (a fetch is connect-src, an image img-src).
    const verb = line[1] === 'Connecting to' ? 'connect-src' : 'img-src'
    return { url: line[2] as string, directive: line[3] === verb ? verb : null }
  }
  // Chrome's second line for a refused fetch: it names no directive (a fetch is always connect-src).
  const fetchLine =
    /^Fetch API cannot load (https:\/\/\S+)\. Refused to connect because it violates the document's Content Security Policy\.$/.exec(
      message,
    )
  if (fetchLine) return { url: fetchLine[1] as string, directive: 'connect-src' }
  const event = /^([a-z-]+) (https:\/\/\S+)(?: \S*)?$/.exec(message)
  if (event) return { url: event[2] as string, directive: event[1] as string }
  const logged = /^Refused to load (https:\/\/\S+) \(([a-z-]+)\)$/.exec(message)
  if (logged) return { url: logged[1] as string, directive: logged[2] as string }
  return null
}

/** True for a refusal of one of the deliberately blocked beacons (BLOCKED_BEACONS), as a beacon. */
export function isExpectedRefusal(message: string): boolean {
  const b = blockedBy(message)
  return (
    b != null &&
    b.directive != null &&
    BEACON_DIRECTIVES.has(b.directive) &&
    BLOCKED_BEACONS.some((re) => re.test(b.url))
  )
}

/** The CSP violations (and page errors) a check must still fail on: everything but the expected beacon refusals. */
export function unexpectedCsp(messages: readonly string[]): string[] {
  return messages.filter((m) => !isExpectedRefusal(m))
}
