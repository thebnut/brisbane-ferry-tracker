// GA4 events for the legacy app: the engaged_visit/save_stop helper
// (src/utils/analytics.js) and the bootstrap (public/ga-config.js). Nothing here
// talks to Google: gtag is a recording stub.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  ENGAGED_FLAG_KEY,
  createEngagedVisitTracker,
  isRendered,
  markBoardShown,
  sendEvent,
  startEngagedVisit,
  stopEngagedVisit,
  trackSaveStop,
  trackStopsSaved,
} from '../../src/utils/analytics.js';

class FakeTarget {
  constructor() {
    this.handlers = new Map();
  }
  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.handlers.get(type)?.delete(fn);
  }
  dispatch(type, event = {}) {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(event);
  }
  count(type) {
    return this.handlers.get(type)?.size ?? 0;
  }
}

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
}

const throwingStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('SecurityError');
  },
};

// A page with a manual clock: advance(ms) moves performance.now() and runs due timers.
function page({ storage = new MemoryStorage(), gtag = true, visibility = 'visible' } = {}) {
  const calls = [];
  const win = new FakeTarget();
  win.scrollY = 0;
  if (gtag) win.gtag = (...args) => calls.push(args);
  const doc = new FakeTarget();
  doc.visibilityState = visibility;
  let clock = 0;
  let timers = [];
  let nextId = 1;
  const env = {
    win,
    doc,
    storage,
    calls,
    events: (name) => calls.filter((c) => c[0] === 'event' && c[1] === name),
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, at: clock + ms, fn });
      return id;
    },
    clearTimer: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
    advance(ms) {
      const end = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const due = timers[0];
        if (!due || due.at > end) break;
        timers.shift();
        clock = due.at;
        due.fn();
      }
      clock = end;
    },
    setVisibility(state) {
      doc.visibilityState = state;
      doc.dispatch('visibilitychange');
    },
    tracker(opts = {}) {
      return createEngagedVisitTracker({
        win,
        doc,
        storage,
        now: env.now,
        setTimer: env.setTimer,
        clearTimer: env.clearTimer,
        ...opts,
      });
    },
  };
  return env;
}

describe('engaged_visit', () => {
  it('fires once at 10 s visible plus a board with departures', () => {
    const p = page();
    const t = p.tracker();
    t.markBoardShown();
    p.advance(9_999);
    assert.equal(p.events('engaged_visit').length, 0);
    p.advance(1);
    assert.deepEqual(p.events('engaged_visit'), [
      ['event', 'engaged_visit', { value: 1, currency: 'AUD', site_mode: 'ferry' }],
    ]);
    t.markBoardShown();
    p.win.dispatch('pointerdown');
    p.advance(60_000);
    assert.equal(p.events('engaged_visit').length, 1);
  });

  it('fires at 10 s visible plus a first interaction (pointerdown, keydown, scroll)', () => {
    for (const interact of [
      (p) => p.win.dispatch('pointerdown'),
      (p) => p.win.dispatch('keydown'),
      (p) => {
        p.win.scrollY = 200;
        p.doc.dispatch('scroll', { target: p.doc });
      },
    ]) {
      const p = page();
      p.tracker();
      p.advance(12_000);
      assert.equal(p.events('engaged_visit').length, 0, 'not before an interaction');
      interact(p);
      assert.equal(p.events('engaged_visit').length, 1);
    }
  });

  it('a stop selection counts as an interaction (page singleton)', () => {
    const p = page();
    p.win.document = p.doc;
    p.win.sessionStorage = p.storage;
    startEngagedVisit(p.win, { now: p.now, setTimer: p.setTimer, clearTimer: p.clearTimer });
    try {
      p.advance(10_000);
      assert.equal(p.events('engaged_visit').length, 0);
      trackStopsSaved({ outbound: { id: '317584' } }, false, p.win);
      assert.equal(p.events('engaged_visit').length, 1);
      assert.equal(p.events('save_stop').length, 0, 'a temporary selection is not a save');
    } finally {
      stopEngagedVisit();
    }
  });

  it('markBoardShown on the page singleton qualifies the visit', () => {
    const p = page();
    p.win.document = p.doc;
    p.win.sessionStorage = p.storage;
    startEngagedVisit(p.win, { now: p.now, setTimer: p.setTimer, clearTimer: p.clearTimer });
    try {
      markBoardShown();
      p.advance(10_000);
      assert.equal(p.events('engaged_visit').length, 1);
    } finally {
      stopEngagedVisit();
    }
  });

  it('needs a board or an interaction: 10 s alone sends nothing, nor does a small scroll', () => {
    const p = page();
    p.tracker();
    p.win.scrollY = 10;
    p.doc.dispatch('scroll', { target: p.doc });
    p.advance(120_000);
    assert.equal(p.events('engaged_visit').length, 0);
  });

  it('does not fire at 9 s with both a board and an interaction', () => {
    const p = page();
    const t = p.tracker();
    t.markBoardShown();
    p.win.dispatch('pointerdown');
    p.advance(9_000);
    assert.equal(p.events('engaged_visit').length, 0);
  });

  it('the timer pauses while the page is hidden', () => {
    const p = page();
    const t = p.tracker();
    t.markBoardShown();
    p.advance(6_000);
    p.setVisibility('hidden');
    p.advance(60_000);
    assert.equal(p.events('engaged_visit').length, 0, 'hidden time does not count');
    p.setVisibility('visible');
    p.advance(3_999);
    assert.equal(p.events('engaged_visit').length, 0);
    p.advance(1);
    assert.equal(p.events('engaged_visit').length, 1);
  });

  it('starting hidden counts nothing until the page is shown', () => {
    const p = page({ visibility: 'hidden' });
    const t = p.tracker();
    t.markBoardShown();
    p.advance(30_000);
    assert.equal(p.events('engaged_visit').length, 0);
    p.setVisibility('visible');
    p.advance(10_000);
    assert.equal(p.events('engaged_visit').length, 1);
  });

  it('once per session: the sessionStorage flag stops a reload firing again', () => {
    const storage = new MemoryStorage();
    const first = page({ storage });
    first.tracker().markBoardShown();
    first.advance(10_000);
    assert.equal(first.events('engaged_visit').length, 1);
    assert.equal(storage.getItem(ENGAGED_FLAG_KEY), '1');

    const reload = page({ storage });
    const t = reload.tracker();
    t.markBoardShown();
    reload.advance(60_000);
    assert.equal(reload.events('engaged_visit').length, 0);
    assert.equal(reload.win.count('pointerdown'), 0, 'no listeners once already sent');
  });

  it('once per page when storage throws, and never throws itself', () => {
    const p = page({ storage: throwingStorage });
    const t = p.tracker();
    t.markBoardShown();
    p.advance(10_000);
    t.markBoardShown();
    p.win.dispatch('pointerdown');
    p.setVisibility('hidden');
    p.setVisibility('visible');
    p.advance(60_000);
    assert.equal(p.events('engaged_visit').length, 1);
  });

  it('removes its listeners after firing', () => {
    const p = page();
    p.tracker().markBoardShown();
    p.advance(10_000);
    assert.equal(p.win.count('pointerdown') + p.win.count('keydown') + p.doc.count('visibilitychange'), 0);
  });

  it('is a no-op without gtag', () => {
    const p = page({ gtag: false });
    const t = p.tracker();
    assert.doesNotThrow(() => {
      t.markBoardShown();
      p.advance(10_000);
    });
  });
});

describe('isRendered (only a displayed board qualifies)', () => {
  it('is true only for a laid-out element', () => {
    assert.equal(isRendered({ getClientRects: () => [{}] }), true);
    assert.equal(isRendered({ getClientRects: () => [] }), false, 'display:none, e.g. desktop boards on a phone');
    assert.equal(isRendered(null), false);
    assert.equal(
      isRendered({
        getClientRects() {
          throw new Error('detached');
        },
      }),
      false,
    );
  });
});

describe('sendEvent and save_stop', () => {
  it('puts site_mode on every event, overriding a caller value', () => {
    const calls = [];
    const win = { gtag: (...a) => calls.push(a) };
    sendEvent('custom', { site_mode: 'bus', x: 1 }, win);
    trackSaveStop('317584', win);
    assert.ok(calls.every((c) => c[2].site_mode === 'ferry'));
  });

  it('save_stop carries the origin id only', () => {
    const calls = [];
    const win = { gtag: (...a) => calls.push(a) };
    const stops = { outbound: { id: '317584', name: 'Bulimba ferry terminal' }, inbound: { id: '317590', name: 'Riverside' } };
    assert.equal(trackStopsSaved(stops, true, win), true);
    assert.deepEqual(calls, [
      ['event', 'save_stop', { mode: 'ferry', stop_id: '317584', value: 3, currency: 'AUD', site_mode: 'ferry' }],
    ]);
  });

  it('save_stop only on a remembered save', () => {
    const calls = [];
    const win = { gtag: (...a) => calls.push(a) };
    assert.equal(trackStopsSaved({ outbound: { id: '317584' } }, false, win), false);
    assert.deepEqual(calls, []);
  });

  it('is a no-op without gtag, or when gtag throws', () => {
    assert.equal(sendEvent('x', {}, {}), false);
    assert.equal(sendEvent('x', {}, undefined), false);
    assert.equal(trackSaveStop('1', { gtag: 'not a function' }), false);
    assert.equal(
      trackSaveStop('1', {
        gtag() {
          throw new Error('blocked');
        },
      }),
      false,
    );
    assert.doesNotThrow(() => trackStopsSaved(null, true, {}));
  });
});

// Runs public/ga-config.js in a sandbox for a given URL.
function bootstrap(href) {
  const url = new URL(href);
  const appended = [];
  const window = {
    location: { protocol: url.protocol, hostname: url.hostname },
  };
  const document = {
    head: { appendChild: (el) => appended.push(el) },
    createElement: (tag) => ({ tag }),
  };
  window.document = document;
  const context = vm.createContext({ window, document, Date });
  vm.runInContext(readFileSync(new URL('../../public/ga-config.js', import.meta.url), 'utf8'), context);
  const config = window.dataLayer?.map((args) => Array.from(args)).find((a) => a[0] === 'config');
  return { window, appended, config };
}

describe('public/ga-config.js', () => {
  const contract = {
    site_mode: 'ferry',
    linker: { domains: ['brisbaneferry.com', 'brisbanebus.com', 'brisbanetrain.com', 'brisbanetransit.com'] },
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  };

  for (const href of ['https://www.brisbaneferry.com/', 'https://ferry.lifemap.au/', 'capacitor://localhost/']) {
    it(`on for ${href}: config with the contract, gtag/js loaded`, () => {
      const { window, appended, config } = bootstrap(href);
      assert.equal(typeof window.gtag, 'function');
      assert.deepEqual(JSON.parse(JSON.stringify(config)), ['config', 'G-MEG3CX0SFC', contract]);
      assert.equal(appended.length, 1);
      assert.equal(appended[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-MEG3CX0SFC');
      assert.equal(appended[0].async, true);
    });
  }

  it('on with debug_mode for Vercel pre-prod', () => {
    const { config } = bootstrap('https://brisbane-ferry-tracker.vercel.app/');
    assert.equal(config[2].debug_mode, true);
    assert.equal(config[2].site_mode, 'ferry');
  });

  for (const href of ['http://localhost:5173/', 'http://127.0.0.1:8981/', 'https://thebnut.github.io/brisbane-ferry-tracker/']) {
    it(`off for ${href}: no gtag, no request to Google`, () => {
      const { window, appended } = bootstrap(href);
      assert.equal(window.gtag, undefined);
      assert.equal(window.dataLayer, undefined);
      assert.deepEqual(appended, []);
    });
  }
});

describe('legacy CSP: Google Analytics origins', () => {
  const root = new URL('../../', import.meta.url);
  const vercel = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'));
  const header = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const directive = (csp, name) =>
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .find((d) => d[0] === name)
      .slice(1);
  const GA = ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'];

  for (const [name, csp] of [
    ['vercel.json', header],
    ['index.html meta', meta],
  ]) {
    it(`${name} allows gtag in script-src and GA hits in connect-src and img-src`, () => {
      assert.ok(directive(csp, 'script-src').includes('https://www.googletagmanager.com'));
      for (const origin of GA) {
        assert.ok(directive(csp, 'connect-src').includes(origin), `connect-src ${origin}`);
        assert.ok(directive(csp, 'img-src').includes(origin), `img-src ${origin}`);
      }
    });
  }

  it('index.html loads gtag/js only through ga-config.js', () => {
    assert.ok(html.includes('<script src="/ga-config.js"></script>'));
    assert.ok(!html.includes('googletagmanager.com/gtag/js'));
  });
});
