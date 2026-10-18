import { applyCors } from './_cors.js';
import { RATE_LIMITED_BODY, feedbackApp, relayFeedback } from './_feedback-discord.js';
import { createMemoryRateLimiter } from './_rate-limit.js';

// Feedback goes to a Discord channel through FEEDBACK_DISCORD_WEBHOOK_URL
// (Vercel env, production and preview). The Workers version is
// apps/ferry/workers/legacy.ts; both share _feedback-discord.js.

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

  const { status, body } = await relayFeedback({
    webhookUrl: process.env.FEEDBACK_DISCORD_WEBHOOK_URL,
    body: readBody(req),
    app: feedbackApp(req.headers.origin, 'legacy-web'),
    referer: req.headers.referer,
    userAgent: req.headers['user-agent'],
  });
  return res.status(status).json(body);
}
