/** Test helper: a navigator.locks stand-in for the CACHE_WRITE_LOCK tests (R9). */
/** A first-in, first-out Web Locks stand-in (shared, exclusive and ifAvailable), as navigator.locks orders requests. */
export function fakeLocks() {
  type Mode = 'shared' | 'exclusive'
  type Req = { mode: Mode; run: () => Promise<unknown> }
  const queue: Req[] = []
  let shared = 0
  let exclusive = false
  const grantable = (mode: Mode) => !exclusive && (mode === 'shared' || shared === 0)
  const start = (next: Req) => {
    if (next.mode === 'exclusive') exclusive = true
    else shared++
    void next.run().finally(() => {
      if (next.mode === 'exclusive') exclusive = false
      else shared--
      pump()
    })
  }
  const pump = () => {
    while (queue.length && grantable((queue[0] as Req).mode)) start(queue.shift() as Req)
  }
  return {
    request: (
      _name: string,
      opts: { mode: Mode; ifAvailable?: boolean },
      cb: (lock: object | null) => Promise<unknown> | unknown,
    ) =>
      new Promise((resolve, reject) => {
        if (opts.ifAvailable && (queue.length || !grantable(opts.mode))) {
          Promise.resolve(cb(null)).then(resolve, reject)
          return
        }
        queue.push({ mode: opts.mode, run: () => Promise.resolve(cb({})).then(resolve, reject) })
        pump()
      }),
  }
}

export const withLocks = async (run: () => Promise<void>) => {
  const real = (navigator as unknown as { locks?: unknown }).locks
  Object.defineProperty(navigator, 'locks', { value: fakeLocks(), configurable: true })
  try {
    await run()
  } finally {
    Object.defineProperty(navigator, 'locks', { value: real, configurable: true })
  }
}
