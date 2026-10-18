// Invisible Cloudflare Turnstile for the legacy feedback modal (web only; the
// iOS app posts token-less, see api/_turnstile.js). Plain-JS counterpart of
// apps/ferry/app/lib/turnstile.ts. The script loads only when the modal opens.
// Tokens are single-use and valid for 300 s; ours are refreshed after 240 s.

// Public sitekey of the "bft-transit-ask" widget (the secret stays on bft-api).
// Its hostnames don't include the Vercel preview (brisbane-ferry-tracker.vercel.app),
// so web feedback can't pass the check there.
export const TURNSTILE_SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY || '0x4AAAAAAFZ6yPZTYH3xrIMT';
export const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_TTL_MS = 240_000;

let script = null;

function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')));
    s.onerror = () => {
      script = null;
      reject(new Error('turnstile failed to load'));
    };
    document.head.appendChild(s);
  });
  return script;
}

/** `p`, or null once `ms` have passed. */
function within(p, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {string} sitekey
 * @param {() => HTMLElement | null} container where the widget renders if it needs an interaction
 * @param {string} action echoed by siteverify; the relay requires "feedback"
 */
export function invisibleTurnstile(sitekey, container, action) {
  let api = null;
  let id = null;
  let ready = null;
  let inflight = null;
  let settle = null;

  const finish = (t) => {
    if (t) ready = { token: t, at: Date.now() };
    settle?.(t);
    settle = null;
  };

  async function solve() {
    try {
      api ??= await loadScript();
      const el = container();
      if (!el) return null;
      if (id == null)
        id = api.render(el, {
          sitekey,
          execution: 'execute',
          appearance: 'interaction-only',
          action,
          callback: (t) => finish(t),
          'error-callback': () => finish(null),
          'expired-callback': () => {
            ready = null;
          },
          'timeout-callback': () => finish(null),
        });
      else api.reset(id);
      const result = new Promise((resolve) => {
        settle = resolve;
      });
      api.execute(id);
      return await result;
    } catch {
      return null;
    }
  }

  const fresh = () => (ready && Date.now() - ready.at < TOKEN_TTL_MS ? ready.token : null);

  return {
    /** Start loading and solving in the background, so a token is ready by submit. */
    warm() {
      if (fresh() || inflight) return;
      inflight = within(solve(), 30_000).finally(() => {
        inflight = null;
      });
    },
    /** A fresh token, or null when Turnstile can't load or answer in time. Single use. */
    async token(timeoutMs = 30_000) {
      let t = fresh();
      if (!t) t = await within(inflight ?? solve(), timeoutMs);
      ready = null;
      return t;
    },
    dispose() {
      if (api && id != null) api.remove(id);
      id = null;
    },
  };
}
