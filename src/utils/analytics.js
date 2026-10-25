// GA4 events for the legacy ferry app. public/ga-config.js defines window.gtag
// only where analytics is on; everywhere else (localhost, ad blockers, tests)
// every call here is a no-op. Nothing here may throw into the UI.
// Event contract shared with the Worker apps:
//  - engaged_visit: once per session, after 10 s visible in total plus a
//    departure board with departures or a first interaction;
//  - save_stop: a stop pair saved with "Remember selection" on.

export const SITE_MODE = 'ferry';
export const ENGAGED_FLAG_KEY = 'bft-ga-engaged';
export const ENGAGED_VISIBLE_MS = 10_000;
export const SCROLL_THRESHOLD_PX = 50;

function gtagOf(win) {
  try {
    return typeof win?.gtag === 'function' ? win.gtag : null;
  } catch {
    return null;
  }
}

// Send one GA4 event with site_mode. Returns whether gtag took it.
export function sendEvent(name, params = {}, win = globalThis.window) {
  const gtag = gtagOf(win);
  if (!gtag) return false;
  try {
    gtag('event', name, { ...params, site_mode: SITE_MODE });
    return true;
  } catch {
    return false;
  }
}

// Origin stop id only: no names, no location.
export function trackSaveStop(stopId, win = globalThis.window) {
  if (!stopId) return false;
  return sendEvent('save_stop', { mode: 'ferry', stop_id: String(stopId), value: 3, currency: 'AUD' }, win);
}

function readFlag(storage) {
  try {
    return storage?.getItem(ENGAGED_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFlag(storage) {
  try {
    storage?.setItem(ENGAGED_FLAG_KEY, '1');
  } catch {
    // Storage blocked: the tracker's own `fired` keeps it to once per page.
  }
}

// The engaged_visit timer. All environment access is injected so tests can
// drive it; createEngagedVisit() below wires it to the real page.
export function createEngagedVisitTracker({
  win,
  doc,
  storage,
  now = () => performance.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  visibleMs = ENGAGED_VISIBLE_MS,
}) {
  let fired = readFlag(storage);
  let qualified = false;
  let visibleTotal = 0;
  let visibleSince = null;
  let timer = null;
  const listeners = [];

  const isVisible = () => {
    try {
      return doc?.visibilityState !== 'hidden';
    } catch {
      return true;
    }
  };
  const elapsed = () => visibleTotal + (visibleSince === null ? 0 : now() - visibleSince);

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const stop = () => {
    cancelTimer();
    for (const [target, type, fn, opts] of listeners.splice(0)) {
      try {
        target.removeEventListener(type, fn, opts);
      } catch {
        // ignore
      }
    }
  };

  const check = () => {
    if (fired || !qualified || visibleSince === null) return;
    const remaining = visibleMs - elapsed();
    if (remaining > 0) {
      cancelTimer();
      timer = setTimer(check, remaining);
      return;
    }
    fired = true;
    stop();
    writeFlag(storage);
    sendEvent('engaged_visit', { value: 1, currency: 'AUD' }, win);
  };

  const onVisibility = () => {
    if (isVisible()) {
      if (visibleSince === null) visibleSince = now();
      check();
    } else {
      if (visibleSince !== null) visibleTotal += now() - visibleSince;
      visibleSince = null;
      cancelTimer();
    }
  };

  const markQualified = () => {
    if (fired || qualified) return;
    qualified = true;
    check();
  };

  const onScroll = (event) => {
    try {
      const target = event?.target;
      const y = target && target !== doc && typeof target.scrollTop === 'number' ? target.scrollTop : win?.scrollY;
      if (y > SCROLL_THRESHOLD_PX) markQualified();
    } catch {
      // ignore
    }
  };

  const listen = (target, type, fn, opts) => {
    try {
      target.addEventListener(type, fn, opts);
      listeners.push([target, type, fn, opts]);
    } catch {
      // ignore
    }
  };

  if (!fired) {
    if (isVisible()) visibleSince = now();
    if (doc) {
      listen(doc, 'visibilitychange', onVisibility);
      listen(doc, 'scroll', onScroll, { capture: true, passive: true });
    }
    if (win) {
      listen(win, 'pointerdown', markQualified, { capture: true, passive: true });
      listen(win, 'keydown', markQualified, { capture: true });
    }
  }

  return {
    markBoardShown: markQualified,
    markInteraction: markQualified,
    stop,
    get fired() {
      return fired;
    },
  };
}

// --- Page singleton used by the app ---

let tracker = null;

function sessionStorageOf(win) {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

// `overrides` lets tests inject a clock; the app passes none.
export function startEngagedVisit(win = globalThis.window, overrides = {}) {
  if (tracker || !win) return tracker;
  try {
    tracker = createEngagedVisitTracker({ win, doc: win.document, storage: sessionStorageOf(win), ...overrides });
  } catch {
    tracker = null;
  }
  return tracker;
}

export function stopEngagedVisit() {
  tracker?.stop();
  tracker = null;
}

export function markBoardShown() {
  tracker?.markBoardShown();
}

export function markInteraction() {
  tracker?.markInteraction();
}

// Stop selector saved: an interaction always; save_stop only when the pair was
// saved with "Remember selection" on (temporary choices don't count).
export function trackStopsSaved(stops, remembered, win = globalThis.window) {
  markInteraction();
  if (!remembered) return false;
  return trackSaveStop(stops?.outbound?.id, win);
}
