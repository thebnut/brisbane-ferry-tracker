import { applyCors } from './_cors.js';
import { RATE_LIMITED_BODY, feedbackApp, relayFeedback, validateFeedback } from './_feedback-discord.js';
import { createMemoryRateLimiter } from './_rate-limit.js';
import { IOS_CLIENT_HEADER, checkTurnstile, verifyWithApi } from './_turnstile.js';

// Feedback goes to a Discord channel through FEEDBACK_DISCORD_WEBHOOK_URL
// (Vercel env, production and preview). The Workers version is
// apps/ferry/workers/legacy.ts; both share _feedback-discord.js.
//
// Web submissions need a Turnstile token, checked by bft-api-prod (which holds
// the PROD widget's TURNSTILE_SECRET; this route has none) and then by
// _turnstile.js (action and hostname). So every Vercel build must ship the PROD
// sitekey (src/utils/turnstile.js). The iOS app posts token-less; see
// _turnstile.js for that trade-off. The Vercel preview host
// (brisbane-ferry-tracker.vercel.app) isn't one of the PROD widget's hostnames,
// so web feedback fails there by design.
export const TURNSTILE_VERIFY_URL = 'https://api.brisbaneferry.com/v1/turnstile/verify';

// 3 submissions per IP per 10 minutes, per warm instance (best effort: see
// _rate-limit.js). A Vercel Firewall rate-limit rule is the robust option.
export const FEEDBACK_RATE_LIMIT = { limit: 3, windowMs: 10 * 60 * 1000 };
const limiter = createMemoryRateLimiter(FEEDBACK_RATE_LIMIT);

/** Vercel sets x-real-ip and overwrites x-forwarded-for, so clients can't spoof them. */
function clientIp(req) {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/** The JSON body; null when it's missing or malformed (Vercel's req.body getter throws on bad JSON). */
function readBody(req) {
  try {
    const body = req.body;
    if (typeof body !== 'string') return body ?? null;
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // BRI-20: CORS via shared allowlist helper (was wildcard *).
  applyCors(req, res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!limiter.check(clientIp(req))) {
    console.warn('[feedback] rate limited');
    res.setHeader('Retry-After', String(FEEDBACK_RATE_LIMIT.windowMs / 1000));
    return res.status(429).json(RATE_LIMITED_BODY);
  }

  const parsed = readBody(req);
  // Validated before Turnstile, so a post that can only get a 400 never spends its token or a verify call.
  const checked = validateFeedback(parsed);
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const ip = clientIp(req);
  const denied = await checkTurnstile({
    origin: req.headers.origin,
    clientHeader: req.headers[IOS_CLIENT_HEADER],
    body: parsed,
    host: req.headers.host,
    remoteip: ip === 'unknown' ? null : ip,
    verify: (token, remoteip) =>
      verifyWithApi(
        (body, signal) =>
          fetch(TURNSTILE_VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal,
          }),
        token,
        remoteip,
      ),
  });
  if (denied) return res.status(denied.status).json(denied.body);

  const { status, body } = await relayFeedback({
    webhookUrl: process.env.FEEDBACK_DISCORD_WEBHOOK_URL,
    body: parsed,
    app: feedbackApp(req.headers.origin, 'legacy-web'),
    referer: req.headers.referer,
    userAgent: req.headers['user-agent'],
  });
  return res.status(status).json(body);
}
