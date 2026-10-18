// Legacy Vercel /api/feedback → Discord webhook. fetch is mocked: no test makes a network call.
import assert from 'node:assert/strict';
import process from 'node:process';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import handler, { TURNSTILE_VERIFY_URL } from '../../api/feedback.js';
import { buildDiscordPayload, DISCORD_LIMITS } from '../../api/_feedback-discord.js';
import { createMemoryRateLimiter } from '../../api/_rate-limit.js';

const HOOK = 'https://discord.test/api/webhooks/0/test-token-secret';
let ipCounter = 0;
/** A fresh client IP per request unless given, so the module-level limiter doesn't couple tests. */
const nextIp = () => `192.0.2.${++ipCounter}`;

/** Object bodies get a Turnstile token unless they set `turnstileToken` themselves. */
function call({ method = 'POST', body, headers = {} } = {}) {
  const withToken =
    body && typeof body === 'object' && !('turnstileToken' in body) ? { turnstileToken: 'tok-web', ...body } : body;
  const req = {
    method,
    body: withToken,
    url: '/api/feedback',
    headers: {
      host: 'www.brisbaneferry.com',
      origin: 'https://www.brisbaneferry.com',
      referer: 'https://www.brisbaneferry.com/',
      'user-agent': 'TestUA/1.0',
      'x-forwarded-for': nextIp(),
      ...headers,
    },
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    end() {
      return this;
    },
  };
  return Promise.resolve(handler(req, res)).then(() => res);
}

const good = { feedback: 'This is long enough feedback', email: 'rider@example.com', name: 'Rider' };
const OK_VERDICT = { success: true, hostname: 'www.brisbaneferry.com', action: 'feedback' };
let logged;
let fetchMock;
/** bft-api-prod's /v1/turnstile/verify (siteverify mocked: no network) and the Discord webhook, separately. */
let verifyImpl;
let discordImpl;
const isVerify = (c) => String(c.arguments[0]) === TURNSTILE_VERIFY_URL;
const discordCalls = () => fetchMock.mock.calls.filter((c) => !isVerify(c));
const verifyCalls = () => fetchMock.mock.calls.filter(isVerify);

beforeEach(() => {
  logged = [];
  for (const m of ['log', 'info', 'warn', 'error'])
    mock.method(console, m, (...args) => logged.push(args.map(String).join(' ')));
  verifyImpl = async () => Response.json(OK_VERDICT);
  discordImpl = async () => new Response('{}', { status: 200 });
  fetchMock = mock.method(globalThis, 'fetch', async (url, init) =>
    String(url) === TURNSTILE_VERIFY_URL ? verifyImpl(url, init) : discordImpl(url, init),
  );
  process.env.FEEDBACK_DISCORD_WEBHOOK_URL = HOOK;
});

afterEach(() => {
  for (const line of logged) {
    assert.ok(!line.includes('discord.test'), `logged the webhook host: ${line}`);
    assert.ok(!line.includes('test-token-secret'), `logged the webhook token: ${line}`);
  }
  mock.restoreAll();
  delete process.env.FEEDBACK_DISCORD_WEBHOOK_URL;
});

describe('legacy /api/feedback (Vercel)', () => {
  it('posts the Discord payload to the secret URL and answers as before', async () => {
    const res = await call({ body: good });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, message: 'Thank you for your feedback!' });
    assert.equal(res.headers['access-control-allow-origin'], 'https://www.brisbaneferry.com');
    assert.equal(discordCalls().length, 1);
    const [url, init] = discordCalls()[0].arguments;
    assert.equal(url, `${HOOK}?wait=true`);
    const payload = JSON.parse(init.body);
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    assert.equal(payload.content, '');
    assert.equal(payload.username, 'Brisbane Ferry feedback');
    const [embed] = payload.embeds;
    assert.equal(embed.title, 'Feedback: BrisbaneFerry (legacy web app)');
    assert.equal(embed.description, 'This is long enough feedback');
    assert.deepEqual(
      embed.fields.map((f) => [f.name, f.value]),
      [
        ['Page', '`https://www.brisbaneferry.com/`'],
        ['Contact', '`rider@example.com` Rider'],
        ['User agent', '`TestUA/1.0`'],
      ],
    );
    assert.match(embed.timestamp, /^\d{4}-\d\d-\d\dT/);
  });

  it('titles iOS submissions from the Capacitor Origin', async () => {
    await call({ body: good, headers: { origin: 'capacitor://localhost' } });
    const payload = JSON.parse(discordCalls()[0].arguments[1].body);
    assert.equal(payload.embeds[0].title, 'Feedback: BrisbaneFerry iOS app');
  });

  it('neutralises mentions', async () => {
    await call({ body: { feedback: 'ping @everyone @here <@123> <@&9> <#5>' } });
    const d = JSON.parse(discordCalls()[0].arguments[1].body).embeds[0].description;
    for (const bad of ['@everyone', '@here', '<@123>', '<@&9>', '<#5>']) assert.ok(!d.includes(bad), bad);
  });

  it('unset secret: 503, a clear log line, no fetch', async () => {
    delete process.env.FEEDBACK_DISCORD_WEBHOOK_URL;
    const res = await call({ body: good });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: 'Feedback is temporarily unavailable. Please try again later.' });
    assert.equal(discordCalls().length, 0);
    assert.ok(logged.some((l) => l.includes('FEEDBACK_DISCORD_WEBHOOK_URL is not set')));
  });

  for (const [discord, ours] of [
    [400, 502],
    [500, 502],
    [429, 503],
  ]) {
    it(`Discord ${discord} → ${ours}, logging the status only`, async () => {
      discordImpl = async () => new Response('{"message":"nope"}', { status: discord });
      const res = await call({ body: good });
      assert.equal(res.statusCode, ours);
      assert.match(res.body.error, /Please try again later/);
      assert.ok(logged.some((l) => l.includes(String(discord))));
      assert.ok(!logged.some((l) => l.includes('nope')));
    });
  }

  it('network error → 502, error name only in the log', async () => {
    discordImpl = async () => {
      throw new TypeError(`fetch failed ${HOOK}`);
    };
    const res = await call({ body: good });
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { error: 'Failed to submit feedback. Please try again later.' });
    assert.ok(logged.some((l) => l.includes('TypeError')));
  });

  it('validation is unchanged and makes no fetch; bad bodies are a 400, not a throw', async () => {
    const cases = [
      [{ feedback: 'short' }, 'Feedback must be at least 10 characters long'],
      [{ feedback: 'x'.repeat(1001) }, 'Feedback must be less than 1000 characters'],
      [{ feedback: 'This is long enough feedback', email: 'bad' }, 'Invalid email format'],
      [{ feedback: 'This is long enough feedback', email: 42 }, 'Invalid email format'],
    ];
    for (const [body, error] of cases) {
      const res = await call({ body });
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.deepEqual(res.body, { error });
    }
    // A missing or malformed body has no token: 403 on web, 400 from the iOS app (token-less path).
    for (const body of [undefined, 'not json']) {
      assert.equal((await call({ body })).statusCode, 403);
      const ios = await call({ body, headers: { origin: 'capacitor://localhost' } });
      assert.equal(ios.statusCode, 400);
      assert.deepEqual(ios.body, { error: 'Feedback must be at least 10 characters long' });
    }
    assert.equal(discordCalls().length, 0);
  });

  it('a JSON string body (text/plain) is parsed', async () => {
    const res = await call({ body: JSON.stringify({ ...good, turnstileToken: 't' }) });
    assert.equal(res.statusCode, 200);
  });

  it('GET is a 405, OPTIONS a 200', async () => {
    assert.equal((await call({ method: 'GET' })).statusCode, 405);
    assert.equal((await call({ method: 'OPTIONS' })).statusCode, 200);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('rate limit: the 4th submission from one IP in 10 minutes is a 429 with no fetch', async () => {
    const headers = { 'x-forwarded-for': '198.51.100.20, 10.0.0.1' };
    for (let i = 0; i < 3; i++) assert.equal((await call({ body: good, headers })).statusCode, 200);
    const res = await call({ body: good, headers });
    assert.equal(res.statusCode, 429);
    assert.match(res.body.error, /^Too many requests/);
    assert.equal(res.headers['retry-after'], '600');
    assert.equal(discordCalls().length, 3);
    assert.equal(verifyCalls().length, 3);
    // Another IP is unaffected.
    assert.equal((await call({ body: good })).statusCode, 200);
  });
});

describe('legacy /api/feedback Turnstile gate', () => {
  it('a valid web token is verified by bft-api-prod with the client IP, then posted to Discord', async () => {
    const res = await call({ body: { ...good, turnstileToken: 'tok-1' }, headers: { 'x-forwarded-for': '198.51.100.7' } });
    assert.equal(res.statusCode, 200);
    assert.equal(verifyCalls().length, 1);
    const [, init] = verifyCalls()[0].arguments;
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { token: 'tok-1', remoteip: '198.51.100.7' });
    assert.equal(discordCalls().length, 1);
  });

  const rejected = [
    ['missing token', { feedback: good.feedback, turnstileToken: undefined }, OK_VERDICT],
    ['empty token', { ...good, turnstileToken: '' }, OK_VERDICT],
    ['invalid token', { ...good, turnstileToken: 't' }, { success: false, hostname: null, action: null }],
    ['wrong hostname', { ...good, turnstileToken: 't' }, { ...OK_VERDICT, hostname: 'next.brisbaneferry.com' }],
    ['wrong action', { ...good, turnstileToken: 't' }, { ...OK_VERDICT, action: 'ask' }],
  ];
  for (const [name, body, verdict] of rejected) {
    it(`${name} → 403, no Discord call`, async () => {
      verifyImpl = async () => Response.json(verdict);
      const res = await call({ body });
      assert.equal(res.statusCode, 403);
      assert.match(res.body.error, /bot check failed/);
      assert.equal(discordCalls().length, 0);
    });
  }

  for (const [name, impl] of [
    ['network error', async () => { throw new TypeError('fetch failed'); }],
    ['bft-api 502', async () => Response.json({ error: 'siteverify_unavailable' }, { status: 502 })],
    ['bft-api 503 (no secret)', async () => Response.json({ error: 'turnstile_not_configured' }, { status: 503 })],
  ]) {
    it(`verify ${name} fails closed: 503, no Discord call, token not logged`, async () => {
      verifyImpl = impl;
      const res = await call({ body: { ...good, turnstileToken: 'tok-secret-value' } });
      assert.equal(res.statusCode, 503);
      assert.match(res.body.error, /temporarily unavailable/);
      assert.equal(discordCalls().length, 0);
      assert.ok(!logged.some((l) => l.includes('tok-secret-value')));
    });
  }

  it('iOS (Capacitor Origin) needs no token, with or without the app header, and is still rate limited', async () => {
    const headers = { origin: 'capacitor://localhost', 'x-forwarded-for': '198.51.100.30' };
    const body = { feedback: good.feedback, turnstileToken: undefined };
    assert.equal((await call({ body, headers })).statusCode, 200);
    assert.equal((await call({ body, headers: { ...headers, 'x-bft-client': 'ios/1' } })).statusCode, 200);
    assert.equal((await call({ body, headers })).statusCode, 200);
    assert.equal((await call({ body, headers })).statusCode, 429);
    assert.equal(verifyCalls().length, 0);
    assert.equal(discordCalls().length, 3);
  });

  for (const [name, headers] of [
    ['a browser Origin with the iOS header', { origin: 'https://www.brisbaneferry.com', 'x-bft-client': 'ios/1' }],
    ['no Origin with the iOS header', { origin: undefined, 'x-bft-client': 'ios/1' }],
    ['the Capacitor Origin with a malformed header', { origin: 'capacitor://localhost', 'x-bft-client': '<script>' }],
  ]) {
    it(`spoof attempt, ${name}, without a token → 403`, async () => {
      const res = await call({ body: { feedback: good.feedback, turnstileToken: undefined }, headers });
      assert.equal(res.statusCode, 403);
      assert.equal(discordCalls().length, 0);
    });
  }

  it('CORS allows the X-BFT-Client header', async () => {
    const res = await call({ method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } });
    assert.match(res.headers['access-control-allow-headers'], /X-BFT-Client/);
  });
});

describe('createMemoryRateLimiter', () => {
  it('allows `limit` per window per key, then frees up as the window slides', () => {
    let t = 0;
    const l = createMemoryRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    assert.equal(l.check('a'), true);
    assert.equal(l.check('a'), true);
    assert.equal(l.check('a'), false);
    assert.equal(l.check('b'), true);
    t = 1001;
    assert.equal(l.check('a'), true);
  });

  it('the next request a window after the last sweep drops expired keys', () => {
    let t = 0;
    const l = createMemoryRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
    l.check('a');
    l.check('b');
    assert.equal(l.size(), 2);
    t = 2001;
    l.check('c');
    assert.equal(l.size(), 1);
  });

  it('stays bounded at maxKeys, dropping expired keys first, then the oldest', () => {
    let t = 0;
    const l = createMemoryRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3, now: () => t });
    for (const k of ['a', 'b', 'c']) l.check(k);
    t = 10;
    assert.equal(l.check('d'), true);
    assert.equal(l.size(), 3);
    // 'a' was the oldest and got evicted, so it is allowed again.
    assert.equal(l.check('a'), true);
    t = 5000;
    for (const k of ['x', 'y', 'z']) l.check(k);
    assert.ok(l.size() <= 3);
  });
});

describe('Discord limits in the shared formatter', () => {
  it('keeps the embed total ≤ 6000 with every part cut', () => {
    const e = buildDiscordPayload({
      app: 'ferry',
      feedback: 'f'.repeat(9000),
      name: 'n'.repeat(3000),
      email: `${'e'.repeat(2000)}@x.co`,
      pageUrl: 'p'.repeat(3000),
      userAgent: 'u'.repeat(3000),
    }).embeds[0];
    const total =
      e.title.length + e.description.length + e.footer.text.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    assert.ok(total <= DISCORD_LIMITS.total, String(total));
    assert.ok(e.description.length <= DISCORD_LIMITS.description);
    for (const f of e.fields) assert.ok(f.value.length <= DISCORD_LIMITS.fieldValue);
  });
});
