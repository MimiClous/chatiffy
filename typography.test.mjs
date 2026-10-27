import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

async function editor(query = '', { storage = new Map(), profiles = new Map(), failedWrites = false, failedReads = false, storageDisabled = false, pathname = '/' } = {}) {
  const elements = new Map(); const writes = []; const history = []; const clipboard = [];
  const timers = []; const sockets = [];
  class Socket {
    static OPEN = 1; readyState = 1;
    constructor() { sockets.push(this); }
    send() {} close() { this.readyState = 3; }
  }
  const make = () => ({
    _value: '', get value() { return this._value; }, set value(value) { this._value = String(value); },
    clientWidth: 600, clientHeight: 390, children: [], dataset: {}, style: { values: {}, setProperty(k, v) { this.values[k] = v; } },
    classList: { toggle() {}, remove() {}, add() {} }, checked: false,
    append(...nodes) { this.children.push(...nodes); }, replaceChildren() { this.children = []; },
    addEventListener(event, fn) { this[event] = fn; }, querySelector() { return null; },
    focus() {}, select() {}, setAttribute() {}, remove() {}, click() { return this.onclick(); }
  });
  const get = id => { if (!elements.has(id)) elements.set(id, make()); return elements.get(id); };
  get('copyButton').disabled = true;
  const context = {
    document: { getElementById: get, createElement: make, createTextNode: text => ({ textContent: text }), documentElement: get('root'), body: get('body'), querySelectorAll: () => [] },
    location: { search: query, pathname, protocol: 'http:', origin: 'http://localhost:17845' },
    localStorage: {
      getItem(k) { if (storageDisabled) throw new Error('disabled'); return storage.get(k) ?? null; },
      setItem(k, v) { if (storageDisabled) throw new Error('disabled'); storage.set(k, v); }
    },
    fetch: async (url, options = {}) => {
      const id = url.split('/').at(-1);
      if (options.method === 'PUT') {
        if (failedWrites) return Response.json({ error: 'disk full' }, { status: 503 });
        const profile = { revision: randomUUID(), settings: JSON.parse(options.body) };
        writes.push(profile); profiles.set(id, profile); return Response.json(profile);
      }
      if (failedReads) return Response.json({}, { status: 503 });
      return profiles.has(id) ? Response.json(profiles.get(id)) : Response.json({}, { status: 404 });
    },
    WebSocket: Socket, navigator: { onLine: true, clipboard: { async writeText(value) { clipboard.push(value); } } },
    crypto: { randomUUID }, history: { replaceState(state, title, url) { history.push(url); } },
    URLSearchParams, URL, AbortController, innerWidth: 600, innerHeight: 900,
    addEventListener() {}, setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {}, confirm: () => true, prompt() {}
  };
  vm.runInNewContext(readFileSync(new URL('build/app.js', import.meta.url), 'utf8'), context);
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  return { get, profiles, storage, writes, clipboard, history, timers, sockets };
}

test('new editor automatically saves a profile and produces a stable OBS link', async () => {
  const { get, writes } = await editor('?instance=legacy&font=georgia&line=1.6');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].settings.fontFamily, 'georgia');
  const url = new URL(get('overlayUrlOutput').value);
  assert.equal(url.pathname, '/overlay');
  assert.match(url.searchParams.get('profile'), /^[a-f0-9]{32}$/);
  assert.equal(url.searchParams.size, 1);
  assert.equal(get('copyButton').disabled, false);
});

test('changing typography updates actual message preview and saves through copy', async () => {
  const { get, writes, clipboard } = await editor();
  const url = get('overlayUrlOutput').value;
  get('fontFamilyInput').value = 'arial'; get('fontFamilyInput').input();
  assert.equal(get('chat').style.values['--chat-font'], 'Arial, sans-serif');
  assert.ok(get('chat').children.length >= 5);
  await get('copyButton').onclick();
  assert.equal(writes.at(-1).settings.fontFamily, 'arial');
  assert.equal(clipboard[0], url);
  assert.equal(get('obsHelp').hidden, false);
});

test('stored profile restores on the next editor launch', async () => {
  const first = await editor();
  first.get('fontFamilyInput').value = 'consolas';
  await first.get('copyButton').onclick();
  const second = await editor('', { storage: first.storage, profiles: first.profiles });
  assert.equal(second.get('fontFamilyInput').value, 'consolas');
  assert.equal(second.get('overlayUrlOutput').value, first.get('overlayUrlOutput').value);
});

test('opening updates from the tray reuses the existing profile', async () => {
  const first = await editor();
  const second = await editor('?diagnostics=1', { storage: first.storage, profiles: first.profiles });
  assert.equal(second.get('overlayUrlOutput').value, first.get('overlayUrlOutput').value);
});

test('unavailable storage does not prevent server persistence', async () => {
  const { get, writes } = await editor('?font=verdana', { storageDisabled: true });
  assert.equal(writes[0].settings.fontFamily, 'verdana');
  assert.equal(get('copyButton').disabled, false);
});

test('failed save never copies an unsaved profile link and exposes retry', async () => {
  const { get, clipboard } = await editor('', { failedWrites: true });
  await get('copyButton').onclick();
  assert.equal(clipboard.length, 0);
  assert.equal(get('copyButton').disabled, true);
  assert.equal(get('retrySaveButton').hidden, false);
});

test('invalid channel blocks saving and gives inline feedback', async () => {
  const { get, writes } = await editor();
  const count = writes.length;
  get('channelInput').value = 'bad-channel!'; get('channelInput').change();
  await get('copyButton').onclick();
  assert.equal(writes.length, count);
  assert.match(get('channelError').textContent, /Twitch/);
});

test('reset preserves the channel and restores typography defaults', async () => {
  const { get, writes } = await editor('?channel=some_channel&font=georgia');
  get('resetButton').onclick(); await get('copyButton').onclick();
  assert.equal(writes.at(-1).settings.channel, 'some_channel');
  assert.equal(writes.at(-1).settings.fontFamily, 'monocraft');
});

test('message lifetime toggle hides timing controls and persists zero correctly', async () => {
  const { get, writes } = await editor();
  assert.equal(get('lifetimeLabel').hidden, true);
  get('hideMessagesInput').checked = true; get('hideMessagesInput').input();
  get('lifetimeInput').value = '45'; get('lifetimeInput').input();
  await get('copyButton').onclick();
  assert.equal(writes.at(-1).settings.lifetime, 45);
  get('hideMessagesInput').checked = false; get('hideMessagesInput').input();
  await get('copyButton').onclick();
  assert.equal(writes.at(-1).settings.lifetime, 0);
});

for (const value of ['NaN', 'Infinity', '-Infinity', 'oops']) test(`invalid numbers use defaults: ${value}`, async () => {
  const { get } = await editor(`?line=${value}&spacing=${value}&size=${value}`);
  assert.equal(get('lineHeightInput').value, '1.22');
  assert.equal(get('letterSpacingInput').value, '0');
  assert.equal(get('fontSizeInput').value, '28');
});

test('a failed profile load does not overwrite server data with defaults', async () => {
  const { get, writes } = await editor('?profile=' + 'b'.repeat(32), { failedReads: true });
  assert.equal(writes.length, 0);
  assert.equal(get('copyButton').disabled, true);
});


test('overlay polls its persistent profile, applies style changes and reconnects only on channel change', async () => {
  const id = 'c'.repeat(32);
  const first = await editor('?channel=first&font=arial');
  const settings = first.writes[0].settings;
  const profiles = new Map([[id, { revision: 'one', settings }]]);
  const overlay = await editor(`?profile=${id}`, { pathname: '/overlay', profiles });
  assert.equal(overlay.sockets.length, 1);
  assert.equal(overlay.get('chat').style.values['--chat-font'], 'Arial, sans-serif');
  profiles.set(id, { revision: 'two', settings: { ...settings, fontFamily: 'georgia' } });
  overlay.timers.filter(t => t.delay === 3000).at(-1).fn();
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(overlay.get('chat').style.values['--chat-font'], 'Georgia, serif');
  assert.equal(overlay.sockets.length, 1);
  profiles.set(id, { revision: 'three', settings: { ...settings, channel: 'second' } });
  overlay.timers.filter(t => t.delay === 3000).at(-1).fn();
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(overlay.sockets.length, 2);
});

test('missing persistent profile never connects to the default Twitch channel', async () => {
  const overlay = await editor('?profile=' + 'd'.repeat(32), { pathname: '/overlay' });
  assert.equal(overlay.sockets.length, 0);
  assert.match(overlay.get('status').textContent, /не найден/);
});
