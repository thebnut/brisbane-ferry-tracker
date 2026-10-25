/**
 * The apps' pages answer GET and HEAD only. No route exports an `action`, and each Worker handles its own other-method
 * endpoints (the Ask proxy, the legacy feedback post, the fixture Ask) before its React Router handler. So any other
 * method reaching that handler is a scanner's probe (POST /, /xmlrpc.php, /graphql, /wp-json/…). React Router answers
 * it 405 as well, but logs its internal 405 at error level with a stack, which buried real errors in Workers Logs
 * (114 such lines in 3 days, 25 Oct 2026). The Workers answer it here instead, before React Router.
 */

/** A 405 for a page request with any method but GET or HEAD; null for those. */
export function pageMethodNotAllowed(method: string): Response | null {
  if (method === 'GET' || method === 'HEAD') return null
  return new Response('Method not allowed', {
    status: 405,
    headers: { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}
