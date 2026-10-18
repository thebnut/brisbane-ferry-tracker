// src/utils/turnstile.js lifecycle (Codex review of #66): a modal closed while the Turnstile script is still loading
// must not render a widget, or answer, for the modal opened next. The script and window.turnstile are faked.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const scripts = [];
globalThis.window = {};
globalThis.document = { createElement: () => ({}), head: { appendChild: (s) => scripts.push(s) } };
const { invisibleTurnstile } = await import('../../src/utils/turnstile.js');

function fakeApi() {
  const renders = [];
  return {
    renders,
    render(el, o) {
      renders.push({ el, o });
      return `w${renders.length}`;
    },
    execute(id) {
      const { o } = renders[Number(id.slice(1)) - 1];
      setTimeout(() => o.callback(`tok-${id}`), 1);
    },
    reset() {},
    remove() {},
  };
}

describe('legacy invisibleTurnstile', () => {
  it('close mid-load, reopen: only the new instance renders, and it gets a token', async () => {
    const first = { id: 'first' };
    const second = { id: 'second' };
    const a = invisibleTurnstile('k', () => first, 'feedback');
    a.warm();
    a.dispose(); // modal closed before the script loaded
    const b = invisibleTurnstile('k', () => second, 'feedback');
    b.warm();
    const pending = b.token(2000);
    assert.equal(scripts.length, 1); // one script request, shared
    const api = fakeApi();
    window.turnstile = api;
    scripts[0].onload();
    assert.equal(await pending, 'tok-w1');
    assert.equal(api.renders.length, 1);
    assert.equal(api.renders[0].el, second);
    assert.equal(api.renders[0].o.action, 'feedback');
  });

  it('a late callback from a disposed widget is ignored, and the instance can start again', async () => {
    const api = fakeApi();
    api.execute = () => {}; // answer by hand
    window.turnstile = api;
    const t = invisibleTurnstile('k', () => ({}), 'feedback');
    const waiting = t.token(2000);
    await new Promise((r) => setTimeout(r, 5));
    t.dispose();
    assert.equal(await waiting, null);
    api.renders[0].o.callback('stale');
    const again = t.token(2000);
    await new Promise((r) => setTimeout(r, 5));
    api.renders[1].o.callback('fresh');
    assert.equal(await again, 'fresh');
  });
});
