// HEAD/GET/PUT /{key} against the bound bucket, plus GET /?op=list&prefix=&cursor= and POST /?op=delete {keys} for
// the GC (pipeline/src/gc). Requests must carry the per-session token the CLI generates.

// Same allow-list as src/gc/gc.ts collectablePrefix: the uploader refuses to delete anything else.
const collectable = (key) =>
  /^static\/(blobs|shards)\/[^/]+$/.test(key) ||
  (/^static\/[^/]+\/.+$/.test(key) && !/^static\/(blobs|shards|\.|\.\.)\//.test(key))

export default {
  async fetch(req, env) {
    if (req.headers.get('x-uploader-token') !== env.UPLOADER_TOKEN)
      return new Response('forbidden', { status: 403 })
    const url = new URL(req.url)
    const op = url.pathname === '/' ? url.searchParams.get('op') : null
    if (op === 'list' && req.method === 'GET') {
      const cursor = url.searchParams.get('cursor') || undefined
      const page = await env.DATA.list({ prefix: url.searchParams.get('prefix') ?? '', cursor, limit: 1000 })
      return Response.json({
        objects: page.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() })),
        cursor: page.truncated ? page.cursor : undefined,
      })
    }
    if (op === 'delete' && req.method === 'POST') {
      const { keys } = await req.json()
      if (!Array.isArray(keys) || keys.length > 1000) return new Response('bad keys', { status: 400 })
      const bad = keys.filter((k) => typeof k !== 'string' || !collectable(k))
      if (bad.length) return new Response(`refusing to delete ${bad.slice(0, 5).join(', ')}`, { status: 400 })
      if (keys.length) await env.DATA.delete(keys)
      return new Response(null, { status: 204 })
    }
    const key = decodeURIComponent(url.pathname.slice(1))
    if (!key) return new Response('missing key', { status: 400 })
    if (req.method === 'HEAD') {
      const o = await env.DATA.head(key)
      return new Response(null, { status: o ? 200 : 404 })
    }
    if (req.method === 'GET') {
      const o = await env.DATA.get(key)
      return o ? new Response(o.body) : new Response(null, { status: 404 })
    }
    if (req.method === 'PUT') {
      await env.DATA.put(key, await req.arrayBuffer(), {
        httpMetadata: {
          contentType: req.headers.get('content-type') ?? 'application/octet-stream',
          cacheControl: req.headers.get('cache-control') ?? undefined,
        },
      })
      return new Response(null, { status: 201 })
    }
    return new Response('method not allowed', { status: 405 })
  },
}
