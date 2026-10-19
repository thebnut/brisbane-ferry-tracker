// Turnstile gate for /api/feedback, shared by the legacy Vercel route
// (api/feedback.js) and the Workers version (apps/ferry/workers/legacy.ts,
// also mounted by bft-transit). Plain, dependency-free JS like
// _feedback-discord.js; types are in _turnstile.d.ts.
//
// Web clients send a Turnstile token (`turnstileToken`, widget action
// "feedback"). Neither relay holds the Turnstile secret: the token is checked by
// bft-api's POST /v1/turnstile/verify (services/edge/src/ai/routes.ts), which
// already has TURNSTILE_SECRET. This module then checks what siteverify said:
// success, the action, and that the token was solved on the same host the
// feedback was posted to (so a token from one of the widget's other hostnames
// can't be spent here).
//
// The iOS app (Capacitor WebView, Origin capacitor://localhost) sends no token:
// it can't run the widget on a capacitor:// page. Trade-off, stated plainly:
// - A browser page can't send that Origin, and can't make the iOS header pass
//   without it, so browsers can't use the iOS path.
// - Non-browser clients (curl, scripts) can send any Origin and any header. For
//   them the iOS path is protected only by the per-IP rate limit and the
//   feedback validation, exactly as /api/feedback was before Turnstile.
// - The app header (X-BFT-Client: ios/<n>) adds no protection against those
//   clients; it only labels newer builds. Installed builds don't send it, so it
//   is not required (IOS_REQUIRE_CLIENT_HEADER). Requiring it would break
//   feedback in every installed iOS build until an app update, for no security
//   gain. Flip the constant once old builds are gone if labelling is wanted.

/** Origins only the Capacitor iOS WebView produces (see _cors.js). */
export const IOS_ORIGINS = Object.freeze(['capacitor://localhost', 'ionic://localhost']);
/** Header newer iOS builds send (src/components/FeedbackModal.jsx). */
export const IOS_CLIENT_HEADER = 'x-bft-client';
export const IOS_CLIENT_RE = /^ios\/[0-9A-Za-z._-]{1,32}$/;
/** Decided above: installed iOS builds send no header, and they keep working. */
export const IOS_REQUIRE_CLIENT_HEADER = false;

/** The widget action the web clients render (siteverify echoes it back). */
export const TURNSTILE_ACTION = 'feedback';
export const VERIFY_TIMEOUT_MS = 6000;
export const MAX_TOKEN_LENGTH = 2048;

export const TURNSTILE_FAILED_BODY = Object.freeze({
  error: 'The bot check failed. Please reload the page and try again.',
});
export const TURNSTILE_UNAVAILABLE_BODY = Object.freeze({
  error: 'The bot check is temporarily unavailable. Please try again later.',
});

/**
 * Whether this request takes the token-less iOS path.
 * @param {string | null | undefined} origin
 * @param {string | null | undefined} clientHeader
 * @param {boolean} [requireHeader]
 */
export function isIosRequest(origin, clientHeader, requireHeader = IOS_REQUIRE_CLIENT_HEADER) {
  if (!origin || !IOS_ORIGINS.includes(origin)) return false;
  if (clientHeader != null && clientHeader !== '' && !IOS_CLIENT_RE.test(clientHeader)) return false;
  return requireHeader ? typeof clientHeader === 'string' && IOS_CLIENT_RE.test(clientHeader) : true;
}

/** "Host" header or URL host, lowercased, without the port. */
export function normalizeHost(host) {
  if (typeof host !== 'string' || !host) return null;
  return host.trim().toLowerCase().replace(/:\d+$/, '') || null;
}

/**
 * Ask bft-api to verify the token. Throws on any transport or upstream error,
 * so the caller fails closed. `post` does the HTTP call (service binding or
 * fetch) and returns a Response.
 * @param {(body: string, signal: AbortSignal) => Promise<Response>} post
 * @param {string} token
 * @param {string | null} remoteip
 * @returns {Promise<{ success: boolean, hostname: string | null, action: string | null }>}
 */
export async function verifyWithApi(post, token, remoteip) {
  const body = JSON.stringify(remoteip ? { token, remoteip } : { token });
  const res = await post(body, AbortSignal.timeout(VERIFY_TIMEOUT_MS));
  if (!res.ok) throw new Error(`verify ${res.status}`);
  const r = await res.json();
  return {
    success: r?.success === true,
    hostname: typeof r?.hostname === 'string' ? r.hostname : null,
    action: typeof r?.action === 'string' ? r.action : null,
  };
}

/**
 * The gate. Returns null when the request may go on to validation and the
 * Discord relay, or the status and JSON body to answer with. Never throws.
 * @param {{ origin?: string | null, clientHeader?: string | null, body: unknown, host: string | null | undefined, remoteip?: string | null, verify: (token: string, remoteip: string | null) => Promise<{ success: boolean, hostname: string | null, action: string | null }> }} opts
 * @returns {Promise<null | { status: number, body: object }>}
 */
export async function checkTurnstile(opts) {
  if (isIosRequest(opts.origin, opts.clientHeader)) return null;
  const token =
    opts.body && typeof opts.body === 'object' ? /** @type {Record<string, unknown>} */ (opts.body).turnstileToken : undefined;
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) {
    console.warn('[feedback] no Turnstile token');
    return { status: 403, body: TURNSTILE_FAILED_BODY };
  }
  const host = normalizeHost(opts.host);
  let r;
  try {
    r = await opts.verify(token, opts.remoteip || null);
  } catch (error) {
    // Fail closed. The error name only: never the token.
    console.error(`[feedback] Turnstile verify failed (${error instanceof Error ? error.name : 'error'})`);
    return { status: 503, body: TURNSTILE_UNAVAILABLE_BODY };
  }
  if (!r.success || r.action !== TURNSTILE_ACTION || !host || normalizeHost(r.hostname) !== host) {
    console.warn(`[feedback] Turnstile rejected (success=${r.success}, action ok=${r.action === TURNSTILE_ACTION}, host ok=${!!host && normalizeHost(r.hostname) === host})`);
    return { status: 403, body: TURNSTILE_FAILED_BODY };
  }
  return null;
}
