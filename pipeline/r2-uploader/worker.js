// HEAD/GET/PUT /{key} against the bound bucket. Requests must carry the per-session token the CLI generates.
export default {
  async fetch(req, env) {
    if (req.headers.get('x-uploader-token') !== env.UPLOADER_TOKEN)
      return new Response('forbidden', { status: 403 })
    const key = decodeURIComponent(new URL(req.url).pathname.slice(1))
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
