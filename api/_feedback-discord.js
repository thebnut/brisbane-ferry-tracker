// Shared /api/feedback logic: validation, the Discord webhook body and the
// relay itself. Used by the legacy Vercel route (api/feedback.js) and the
// Workers version (apps/ferry/workers/legacy.ts, also mounted by bft-transit),
// so both answer identically. Plain, dependency-free JS: the legacy root app
// builds with npm. Types for the Workers side are in _feedback-discord.d.ts.
//
// Vercel treats `_`-prefixed files in /api/ as non-endpoints (see _cors.js).
//
// Security notes:
// - The webhook URL contains the webhook token. It is never logged: only HTTP
//   statuses and error names are.
// - `allowed_mentions: { parse: [] }` is what stops pings. User text is also
//   defused (zero-width space after `@` and `<`) so `@everyone`, `<@123>`,
//   `<@&123>` and `<#123>` don't even render as mentions, and markdown is
//   escaped so a message can't fake a masked link.

/** Discord embed limits (https://discord.com/developers/docs/resources/message#embed-object-embed-limits). */
export const DISCORD_LIMITS = Object.freeze({
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  total: 6000,
  fields: 25,
});

export const FEEDBACK_MIN = 10;
export const FEEDBACK_MAX = 1000;
export const DISCORD_TIMEOUT_MS = 8000;

export const SUCCESS_BODY = Object.freeze({ success: true, message: 'Thank you for your feedback!' });
export const UNAVAILABLE_BODY = Object.freeze({
  error: 'Feedback is temporarily unavailable. Please try again later.',
});
export const FAILED_BODY = Object.freeze({ error: 'Failed to submit feedback. Please try again later.' });
export const RATE_LIMITED_BODY = Object.freeze({
  error: 'Too many requests. Please wait a few minutes and try again.',
});

const APP_TITLES = {
  ferry: 'Feedback: BrisbaneFerry (new ferry app)',
  transit: 'Feedback: BrisbaneTransit',
  'legacy-web': 'Feedback: BrisbaneFerry (legacy web app)',
  ios: 'Feedback: BrisbaneFerry iOS app',
};

const ELLIPSIS = '…';
const ZWSP = '​';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Which app sent the feedback. The iOS app posts from its Capacitor WebView,
 * whose Origin a browser page can't forge (see _cors.js), so it wins over the
 * host's own label.
 * @param {string | null | undefined} origin
 * @param {'ferry' | 'transit' | 'legacy-web'} hostApp
 */
export function feedbackApp(origin, hostApp) {
  if (origin === 'capacitor://localhost' || origin === 'ionic://localhost') return 'ios';
  return hostApp;
}

/**
 * The legacy validation, unchanged: feedback 10–1000 characters, email format
 * when given. A missing or non-object body fails like an empty feedback.
 * @param {unknown} body
 * @returns {{ ok: true, value: { feedback: string, email: string | null, name: string | null, url: string | null } } | { ok: false, error: string }}
 */
export function validateFeedback(body) {
  const b = body && typeof body === 'object' ? body : {};
  const { feedback, email, name, url } = /** @type {Record<string, unknown>} */ (b);
  if (!feedback || typeof feedback !== 'string' || feedback.trim().length < FEEDBACK_MIN)
    return { ok: false, error: 'Feedback must be at least 10 characters long' };
  if (feedback.length > FEEDBACK_MAX)
    return { ok: false, error: 'Feedback must be less than 1000 characters' };
  if (email && (typeof email !== 'string' || !EMAIL_RE.test(email)))
    return { ok: false, error: 'Invalid email format' };
  return {
    ok: true,
    value: {
      feedback: feedback.trim(),
      email: typeof email === 'string' && email ? email : null,
      name: typeof name === 'string' && name.trim() ? name.trim() : null,
      url: typeof url === 'string' && url ? url : null,
    },
  };
}

/**
 * Cut to `max` UTF-16 units with a trailing ellipsis, never splitting a
 * surrogate pair or leaving a dangling backslash escape.
 * @param {string} s
 * @param {number} max
 */
export function truncate(s, max) {
  if (s.length <= max) return s;
  if (max <= 0) return '';
  let cut = s.slice(0, max - ELLIPSIS.length);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  // An odd run of trailing backslashes would escape the ellipsis.
  const run = cut.length - cut.replace(/\\+$/, '').length;
  if (run % 2 === 1) cut = cut.slice(0, -1);
  return cut + ELLIPSIS;
}

/**
 * Make user text inert in Discord: no mention can render (`@everyone`,
 * `@here`, `<@id>`, `<@&id>`, `<#id>`, `</cmd:id>`), and markdown is escaped
 * so `[text](url)` can't spoof a link.
 * @param {string} s
 */
export function sanitizeText(s) {
  return s
    .replace(/[\\*_~`|[\]()]/g, (c) => `\\${c}`)
    .replace(/^([ \t]*)([#>-])/gm, '$1\\$2')
    .replace(/@/g, `@${ZWSP}`)
    .replace(/</g, `<${ZWSP}`);
}

/**
 * Inline code: nothing inside renders as a mention or link, and the value
 * stays copyable. Backticks are dropped so the span can't be closed early.
 * @param {string} s
 * @param {number} max
 */
function code(s, max) {
  const inner = s.replace(/`/g, '').replace(/[\r\n]+/g, ' ');
  return `\`${truncate(inner || ' ', max - 2)}\``;
}

/** @param {{ title?: string, description?: string, footer?: { text: string }, fields?: { name: string, value: string }[] }} e */
function embedSize(e) {
  let n = (e.title ?? '').length + (e.description ?? '').length + (e.footer?.text ?? '').length;
  for (const f of e.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

/**
 * The Discord webhook body for one feedback submission. Every part is cut to
 * Discord's limits, and the embed total stays at or under 6000 characters.
 * @param {{ app: string, feedback: string, email?: string | null, name?: string | null, pageUrl?: string | null, userAgent?: string | null, now?: Date }} input
 */
export function buildDiscordPayload(input) {
  const L = DISCORD_LIMITS;
  const fields = [];
  fields.push({ name: 'Page', value: code(input.pageUrl || 'unknown', L.fieldValue), inline: false });
  // The email (bounded, in a code span) first, so cutting a long name never breaks the span.
  const email = input.email ? code(input.email, 320) : '';
  const name = input.name ? sanitizeText(input.name) : '';
  if (email || name) {
    const value = email && name ? `${email} ${truncate(name, L.fieldValue - email.length - 1)}` : email || name;
    fields.push({ name: 'Contact', value, inline: false });
  }
  fields.push({ name: 'User agent', value: code(input.userAgent || 'unknown', L.fieldValue), inline: false });

  const embed = {
    title: truncate(APP_TITLES[input.app] ?? `Feedback: ${input.app}`, L.title),
    description: truncate(sanitizeText(input.feedback), L.description),
    color: 0xf59e0b,
    fields: fields.slice(0, L.fields).map((f) => ({
      ...f,
      name: truncate(f.name, L.fieldName),
      value: truncate(f.value, L.fieldValue),
    })),
    footer: { text: truncate('brisbane-ferry-tracker', L.footer) },
    timestamp: (input.now ?? new Date()).toISOString(),
  };
  // Over the total: shorten the description first, then the field values.
  let over = embedSize(embed) - L.total;
  if (over > 0) {
    embed.description = truncate(embed.description, Math.max(1, embed.description.length - over));
    over = embedSize(embed) - L.total;
  }
  for (let i = embed.fields.length - 1; over > 0 && i >= 0; i--) {
    const f = embed.fields[i];
    f.value = truncate(f.value, Math.max(1, f.value.length - over));
    over = embedSize(embed) - L.total;
  }
  return {
    content: '',
    username: 'Brisbane Ferry feedback',
    allowed_mentions: { parse: [] },
    embeds: [embed],
  };
}

/**
 * Validate and relay one feedback submission to the Discord webhook. Never
 * throws; returns the HTTP status and JSON body to answer with. CORS, the
 * method check and rate limiting are the caller's (platform-specific) job.
 * @param {{ webhookUrl: string | undefined, body: unknown, app: string, referer?: string | null, userAgent?: string | null, fetchImpl?: typeof fetch, now?: Date }} opts
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function relayFeedback(opts) {
  if (!opts.webhookUrl) {
    console.error('[feedback] FEEDBACK_DISCORD_WEBHOOK_URL is not set; feedback is unavailable');
    return { status: 503, body: UNAVAILABLE_BODY };
  }
  const checked = validateFeedback(opts.body);
  if (!checked.ok) return { status: 400, body: { error: checked.error } };
  let target;
  try {
    target = new URL(opts.webhookUrl);
    target.searchParams.set('wait', 'true');
  } catch {
    console.error('[feedback] FEEDBACK_DISCORD_WEBHOOK_URL is not a valid URL; feedback is unavailable');
    return { status: 503, body: UNAVAILABLE_BODY };
  }
  const { feedback, email, name, url } = checked.value;
  const payload = buildDiscordPayload({
    app: opts.app,
    feedback,
    email,
    name,
    pageUrl: opts.referer || url,
    userAgent: opts.userAgent,
    now: opts.now,
  });
  const doFetch = opts.fetchImpl ?? fetch;
  let res;
  try {
    res = await doFetch(target.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
  } catch (error) {
    // The name only: a message could carry the request URL, which holds the token.
    console.error(`[feedback] Discord webhook request failed (${error instanceof Error ? error.name : 'error'})`);
    return { status: 502, body: FAILED_BODY };
  }
  if (res.ok) return { status: 200, body: SUCCESS_BODY };
  if (res.status === 429) {
    console.error('[feedback] Discord webhook rate limited (429)');
    return { status: 503, body: UNAVAILABLE_BODY };
  }
  console.error(`[feedback] Discord webhook responded ${res.status}`);
  return { status: 502, body: FAILED_BODY };
}
