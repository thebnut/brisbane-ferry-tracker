/**
 * Server entry: the default React Router streaming render, plus the per-request CSP nonce (workers/security.ts) on
 * every inline script React Router and React emit.
 */
import { isbot } from 'isbot'
import { renderToReadableStream } from 'react-dom/server'
import { type EntryContext, type RouterContextProvider, ServerRouter } from 'react-router'
import { cloudflareContext } from './lib/context.ts'

export const streamTimeout = 5_000

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  const nonce = loadContext.get(cloudflareContext).nonce
  let shellRendered = false
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
    {
      nonce,
      signal: AbortSignal.timeout(streamTimeout + 1_000),
      onError(error: unknown) {
        responseStatusCode = 500
        if (shellRendered) console.error(error)
      },
    },
  )
  shellRendered = true
  const ua = request.headers.get('user-agent')
  if ((ua && isbot(ua)) || routerContext.isSpaMode) await body.allReady
  responseHeaders.set('Content-Type', 'text/html')
  return new Response(body, { headers: responseHeaders, status: responseStatusCode })
}
