/**
 * Per-environment namespace for realtime objects in the shared R2 bucket. Static data (manifest, static/, data/,
 * legacy/) is shared by every environment, but each environment runs its own RtHub, so their `rt/…` snapshots must
 * not overwrite each other. `RT_R2_PREFIX` (for example `rt-staging/`) remaps every `rt/…` key, for both the hub's
 * writes and the API's reads. Unset, or `rt/`, keeps the canonical keys (production).
 *
 * Pointers inside `rt/latest.json` keep logical `rt/…` keys; they are remapped again when read through this bucket.
 */
export function withRtPrefix(bucket: R2Bucket | undefined, prefix: string | undefined): R2Bucket | undefined {
  if (!bucket || !prefix || prefix === 'rt/') return bucket
  if (!/^[a-z0-9-]+\/$/.test(prefix)) throw new Error(`RT_R2_PREFIX must look like "name/": ${prefix}`)
  const map = (key: string) => (key.startsWith('rt/') ? prefix + key.slice(3) : key)
  return new Proxy(bucket, {
    get(target, prop, receiver) {
      if (prop === 'get' || prop === 'put' || prop === 'head' || prop === 'delete') {
        const fn = Reflect.get(target, prop, receiver) as (key: string, ...rest: unknown[]) => unknown
        return (key: string, ...rest: unknown[]) => fn.call(target, map(key), ...rest)
      }
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}

/** The Worker env with DATA_BUCKET namespaced for realtime objects. */
export function withRtNamespace<E extends { DATA_BUCKET?: R2Bucket; RT_R2_PREFIX?: string }>(env: E): E {
  const bucket = withRtPrefix(env.DATA_BUCKET, env.RT_R2_PREFIX)
  return bucket === env.DATA_BUCKET ? env : { ...env, DATA_BUCKET: bucket }
}
