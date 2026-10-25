import { describe, expect, it } from 'vitest'
import { blockedBy, isExpectedRefusal, unexpectedCsp } from '../e2e/csp-expected.ts'

const Q = '?v=2&tid=G-MEG3CX0SFC&dt=Buranda%20busway'
// Chrome's console lines for a refused request (as captured on staging, 26 Oct 2026), and the
// securitypolicyviolation event lines transit csp.ts and ga.ts log.
const connecting = (url: string, directive = 'connect-src') =>
  `Connecting to '${url}' violates the following Content Security Policy directive: "${directive} 'self' https://analytics.google.com". The action has been blocked.`
const image = (url: string, directive = 'img-src') =>
  `Loading the image '${url}' violates the following Content Security Policy directive: "${directive} 'self' data:". The action has been blocked.`
const fetchLine = (url: string) =>
  `Fetch API cannot load ${url}. Refused to connect because it violates the document's Content Security Policy.`
const event = (url: string, directive = 'connect-src') =>
  `${directive} ${url} https://brisbanetransit.com/ga.js`
const logged = (url: string, directive = 'connect-src') => `Refused to load ${url} (${directive})`

const BEACONS = [
  `https://www.google.com/ccm/collect${Q}`,
  `https://ad.doubleclick.net/ccm/s/collect${Q}`,
  `https://stats.g.doubleclick.net/g/collect${Q}`,
  // R44-G1: Google signals' duplicate after a client route change.
  `https://www.google.com/g/collect${Q}`,
  `https://www.google.com.au/ads/ga-audiences${Q}`,
  'https://www.google.com/ads/ga-audiences?t=sr',
  'https://www.google.co.uk/ads/ga-audiences?t=sr',
]

describe('the deliberately blocked Ads and signals beacons count as expected', () => {
  it('in every shape a refusal is reported in, as connect-src or img-src', () => {
    for (const url of BEACONS) {
      for (const m of [
        connecting(url),
        image(url),
        fetchLine(url),
        event(url),
        event(url, 'img-src'),
        logged(url),
      ])
        expect(isExpectedRefusal(m), m).toBe(true)
    }
    expect(blockedBy(fetchLine(BEACONS[0] as string))).toEqual({ url: BEACONS[0], directive: 'connect-src' })
    // A securitypolicyviolation event with no source file.
    expect(isExpectedRefusal(`img-src ${BEACONS[0]} `)).toBe(true)
  })

  it('unexpectedCsp drops only them', () => {
    const other = connecting('https://evil.example/collect')
    expect(unexpectedCsp([connecting(BEACONS[0] as string), other, fetchLine(BEACONS[3] as string)])).toEqual(
      [other],
    )
  })
})

describe('any other CSP error still fails', () => {
  it('GA4’s own collection is never an expected refusal', () => {
    for (const url of [
      'https://analytics.google.com/g/collect?v=2',
      'https://region1.analytics.google.com/g/collect?v=2',
      'https://www.google-analytics.com/g/collect?v=2',
    ])
      expect(unexpectedCsp([connecting(url), fetchLine(url), event(url)])).toHaveLength(3)
  })

  it('a beacon host on another path, a lookalike host or plain http is unexpected', () => {
    for (const url of [
      'https://www.google.com/recaptcha/api.js',
      'https://www.google.com/ccm/collectx?a=1',
      'https://www.google.com.evil.example/ccm/collect?a=1',
      'https://evil.example/?https://www.google.com/ccm/collect',
      'http://www.google.com/ccm/collect?a=1',
      'https://ad.doubleclick.net/ddm/activity?a=1',
      'https://www.google.com/ads/ga-audiences.evil.example/x',
    ])
      expect(isExpectedRefusal(connecting(url)), url).toBe(false)
  })

  it('a beacon URL refused as a script, a frame or under a mismatched directive is unexpected', () => {
    const url = BEACONS[0] as string
    for (const m of [
      event(url, 'script-src-elem'),
      event(url, 'frame-src'),
      logged(url, 'script-src'),
      connecting(url, 'img-src'),
      image(url, 'connect-src'),
      `Loading the script '${url}' violates the following Content Security Policy directive: "script-src-elem 'self'". The action has been blocked.`,
    ])
      expect(isExpectedRefusal(m), m).toBe(false)
  })

  it('inline script, eval, page errors and lines it can’t read are unexpected', () => {
    for (const m of [
      "Executing inline script violates the following Content Security Policy directive 'script-src 'nonce-abc''. The action has been blocked.",
      'script-src-elem inline https://brisbanetransit.com/',
      'script-src eval ',
      'pageerror: Minified React error #418',
      "Refused to frame 'https://example.com/' because an ancestor violates the following Content Security Policy directive: \"frame-ancestors 'none'\".",
      '',
    ])
      expect(isExpectedRefusal(m), m).toBe(false)
  })
})
