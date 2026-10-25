import { describe, expect, it } from 'vitest'
import { pageMethodNotAllowed } from '../src/page-method.ts'

describe('pageMethodNotAllowed', () => {
  it('lets GET and HEAD through', () => {
    expect(pageMethodNotAllowed('GET')).toBeNull()
    expect(pageMethodNotAllowed('HEAD')).toBeNull()
  })

  it('answers any other method 405 with Allow, uncached', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'get']) {
      const res = pageMethodNotAllowed(m)
      expect(res?.status, m).toBe(405)
      expect(res?.headers.get('allow')).toBe('GET, HEAD')
      expect(res?.headers.get('cache-control')).toBe('no-store')
      expect(await res?.text()).toBe('Method not allowed')
    }
  })
})
