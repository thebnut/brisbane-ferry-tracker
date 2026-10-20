// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  decodeHandoff,
  encodeHandoff,
  HANDOFF_PREFIX,
  type HandoffPayload,
  handoffCount,
  MAX_BUS,
  MAX_HANDOFF_BYTES,
  validateHandoff,
} from '../src/handoff-codec.ts'

const FERRY: HandoffPayload = {
  v: 1,
  ferry: {
    pair: { outbound: { id: '317584', name: 'Bulimba' }, inbound: { id: '317590', name: 'Riverside' } },
    remember: true,
  },
}
const TRAIN: HandoffPayload = {
  v: 1,
  train: [
    { from: 'roma-street', to: 'indooroopilly' },
    { from: 'central', to: null },
  ],
}
const BUS: HandoffPayload = { v: 1, bus: [{ id: '10802', name: 'Cultural Centre station, platform 1' }] }

/** A fragment for any JSON text (valid or not), encoded the way the handoff page does. */
const fragmentOf = (json: string) => {
  let bin = ''
  for (const b of new TextEncoder().encode(json)) bin += String.fromCharCode(b)
  return `${HANDOFF_PREFIX}${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}
const decodeJson = (v: unknown) => decodeHandoff(fragmentOf(JSON.stringify(v)))

describe('encode / decode', () => {
  it.each([
    ['ferry', FERRY],
    ['train', TRAIN],
    ['bus', BUS],
  ])('%s round-trips', (_, p) => {
    const hash = encodeHandoff(p)
    expect(hash).toMatch(/^#import=[A-Za-z0-9_-]+$/)
    expect(decodeHandoff(hash ?? '')).toEqual(p)
  })

  it('keeps non-ASCII names (UTF-8)', () => {
    const p: HandoffPayload = { v: 1, bus: [{ id: '1', name: 'Kurilpa Point – Ōtautahi 🚌' }] }
    expect(decodeHandoff(encodeHandoff(p) ?? '')).toEqual(p)
  })

  it('counts items', () => {
    expect(handoffCount(FERRY)).toBe(1)
    expect(handoffCount(TRAIN)).toBe(2)
    expect(handoffCount({ ...TRAIN, ...BUS })).toBe(3)
  })

  it('refuses to encode over the size cap', () => {
    const big: HandoffPayload = {
      v: 1,
      bus: Array.from({ length: MAX_BUS }, (_, i) => ({ id: `${i}`, name: 'x'.repeat(120) })),
    }
    expect(encodeHandoff(big)).toBeNull()
  })
})

describe('hostile fragments are rejected whole', () => {
  it.each([
    ['no prefix', '#other=abc'],
    ['empty', HANDOFF_PREFIX],
    ['not base64url', `${HANDOFF_PREFIX}abc+/=`],
    ['spaces', `${HANDOFF_PREFIX}ab cd`],
    ['percent-encoded', `${HANDOFF_PREFIX}%7B%7D`],
    ['huge', `${HANDOFF_PREFIX}${'A'.repeat(100_000)}`],
    ['just over the encoded cap', `${HANDOFF_PREFIX}${'A'.repeat(Math.ceil(MAX_HANDOFF_BYTES / 3) * 4 + 4)}`],
    ['not JSON', fragmentOf('not json')],
    ['JSON with script', fragmentOf('<script>alert(1)</script>')],
    ['truncated JSON', fragmentOf('{"v":1,"bus":[')],
    ['invalid UTF-8', `${HANDOFF_PREFIX}${btoa('\xff\xfe\xfd').replace(/=+$/, '')}`],
  ])('%s', (_, hash) => {
    expect(decodeHandoff(hash)).toBeNull()
  })

  it.each([
    ['null', null],
    ['an array', [BUS]],
    ['a string', 'x'],
    ['no version', { bus: BUS.bus }],
    ['another version', { ...BUS, v: 2 }],
    ['version as a string', { ...BUS, v: '1' }],
    ['nothing to import', { v: 1 }],
    ['an extra top-level key', { ...BUS, extra: 1 }],
    ['a __proto__ key', JSON.parse('{"v":1,"bus":[{"id":"1","name":"a"}],"__proto__":{"x":1}}')],
    ['an extra item key', { v: 1, bus: [{ id: '1', name: 'a', html: '<b>' }] }],
    ['a missing item key', { v: 1, bus: [{ id: '1' }] }],
    ['bus id with a slash', { v: 1, bus: [{ id: '../x', name: 'a' }] }],
    ['bus id too long', { v: 1, bus: [{ id: 'x'.repeat(33), name: 'a' }] }],
    ['bus id a number', { v: 1, bus: [{ id: 10802, name: 'a' }] }],
    ['empty bus name', { v: 1, bus: [{ id: '1', name: '' }] }],
    ['bus name too long', { v: 1, bus: [{ id: '1', name: 'x'.repeat(121) }] }],
    ['control characters in a name', { v: 1, bus: [{ id: '1', name: 'a\u0000b' }] }],
    ['newline in a name', { v: 1, bus: [{ id: '1', name: 'a\nb' }] }],
    [
      'too many bus stops',
      { v: 1, bus: Array.from({ length: MAX_BUS + 1 }, (_, i) => ({ id: `${i}`, name: 'a' })) },
    ],
    ['empty bus list', { v: 1, bus: [] }],
    ['bus as an object', { v: 1, bus: { id: '1', name: 'a' } }],
    ['train key with capitals', { v: 1, train: [{ from: 'Central', to: null }] }],
    ['train key with a script', { v: 1, train: [{ from: '<script>', to: null }] }],
    ['train to missing', { v: 1, train: [{ from: 'central' }] }],
    [
      'too many train favourites',
      { v: 1, train: Array.from({ length: 9 }, (_, i) => ({ from: `s${i}`, to: null })) },
    ],
    [
      'ferry id not digits',
      {
        v: 1,
        ferry: {
          ...FERRY.ferry,
          pair: { outbound: { id: 'x', name: 'a' }, inbound: { id: '1', name: 'b' } },
        },
      },
    ],
    [
      'ferry same terminal twice',
      {
        v: 1,
        ferry: {
          remember: true,
          pair: { outbound: { id: '1', name: 'a' }, inbound: { id: '1', name: 'a' } },
        },
      },
    ],
    ['ferry remember not boolean', { v: 1, ferry: { ...FERRY.ferry, remember: 'true' } }],
    ['ferry extra key', { v: 1, ferry: { ...FERRY.ferry, extra: 1 } }],
    ['one bad mode sinks the rest', { ...BUS, train: [{ from: 'BAD', to: null }] }],
  ])('%s', (_, v) => {
    expect(validateHandoff(v)).toBeNull()
    expect(decodeJson(v)).toBeNull()
  })

  it('a script string in a name is only text: kept verbatim, never interpreted', () => {
    const p: HandoffPayload = { v: 1, bus: [{ id: '1', name: '<img src=x onerror=alert(1)>' }] }
    expect(decodeJson(p)?.bus?.[0]?.name).toBe('<img src=x onerror=alert(1)>')
  })

  it('accepts the largest payload under the cap', () => {
    const list = Array.from({ length: MAX_BUS }, (_, i) => ({ id: `${i}`, name: 'x'.repeat(40) }))
    const hash = encodeHandoff({ v: 1, bus: list })
    expect(hash).not.toBeNull()
    expect(decodeHandoff(hash ?? '')?.bus).toHaveLength(MAX_BUS)
  })
})
