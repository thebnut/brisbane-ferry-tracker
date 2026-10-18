import { describe, expect, it } from 'vitest'
import { withRtNamespace, withRtPrefix } from '../src/data/rt-prefix.ts'

function fakeBucket() {
  const store = new Map<string, string>()
  const bucket = {
    async get(k: string) {
      return store.has(k) ? { text: async () => store.get(k) as string } : null
    },
    async put(k: string, v: string) {
      store.set(k, v)
      return {}
    },
    async head(k: string) {
      return store.has(k) ? {} : null
    },
    async delete(k: string) {
      store.delete(k)
    },
    list: async () => ({ objects: [...store.keys()].map((key) => ({ key })) }),
  }
  return { bucket: bucket as unknown as R2Bucket, store }
}

describe('RT_R2_PREFIX namespacing', () => {
  it('remaps rt/ keys for reads and writes, leaves static keys shared', async () => {
    const { bucket, store } = fakeBucket()
    const b = withRtPrefix(bucket, 'rt-staging/') as R2Bucket
    await b.put('rt/latest.json', 'p')
    await b.put('rt/ferry/latest.json', 'f')
    await b.put('manifest.json', 'm')
    expect([...store.keys()].sort()).toEqual([
      'manifest.json',
      'rt-staging/ferry/latest.json',
      'rt-staging/latest.json',
    ])
    expect(await (await b.get('rt/latest.json'))?.text()).toBe('p')
    expect(await bucket.get('rt/latest.json')).toBeNull()
  })
  it('production (unset or rt/) uses the canonical keys and the original binding', () => {
    const { bucket } = fakeBucket()
    expect(withRtPrefix(bucket, undefined)).toBe(bucket)
    expect(withRtPrefix(bucket, 'rt/')).toBe(bucket)
    const env = { DATA_BUCKET: bucket }
    expect(withRtNamespace(env)).toBe(env)
  })
  it('rejects malformed prefixes', () => {
    const { bucket } = fakeBucket()
    expect(() => withRtPrefix(bucket, '../x')).toThrow()
    expect(() => withRtPrefix(bucket, 'rt-staging')).toThrow()
  })
})
