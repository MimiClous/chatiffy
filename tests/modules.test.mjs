import test from 'node:test';
import assert from 'node:assert/strict';
import { readSettings, serializeSettings, settingsSchema } from '../build/modules/shared/settings.js';
import { parseTags, parseIrc, twitchEmoteRanges } from '../build/modules/client/irc.js';
import { cached } from '../build/modules/server/cache.js';
import { EmoteRegistry, sevenTvProvider, parse7tvSet } from '../build/modules/client/providers.js';

test('every schema setting survives serialization, including false and zero', () => {
  const original = readSettings(new URLSearchParams('background=0&spacing=0&panel=0'));
  const params = serializeSettings(original, 'schema-test');
  assert.equal(params.size, Object.keys(settingsSchema).length + 1);
  assert.deepEqual(readSettings(params), original);
});

test('legacy stored background is ignored but explicit URL still takes precedence', () => {
  const stored = key => ({ background: '1', settingsVersion: '5' })[key] ?? null;
  assert.equal(readSettings(new URLSearchParams(), stored).background, false);
  assert.equal(readSettings(new URLSearchParams('background=1'), stored).background, true);
});

test('settings normalize channel and reject invalid colors', () => {
  const config = readSettings(new URLSearchParams('channel=%23Some_Channel&text=red'));
  assert.equal(config.channel, 'some_channel');
  assert.equal(config.textColor, '#ffffff');
});

test('IRC tags decode protocol escapes and preserve embedded equals signs', () => {
  assert.deepEqual(parseTags('name=Hello\\sWorld;semi=a\\:b;line=x\\ny\\rz;slash=a\\\\b;empty;token=a=b'), {
    name: 'Hello World', semi: 'a;b', line: 'x\ny\rz', slash: 'a\\b', empty: '', token: 'a=b'
  });
});

test('IRC parser accepts unicode messages and ignores other commands', () => {
  const parsed = parseIrc('@id=123;display-name=Стример :user!user@user.tmi.twitch.tv PRIVMSG #channel :Привет 😀');
  assert.equal(parsed.user, 'user');
  assert.equal(parsed.tags.id, '123');
  assert.equal(parsed.text, 'Привет 😀');
  for (const line of ['PING :tmi.twitch.tv', ':server RECONNECT', '', 'broken']) assert.equal(parseIrc(line), null);
});

test('Twitch emote ranges are sorted independently of tag order', () => {
  const ranges = twitchEmoteRanges('25:6-10/1902:0-4,12-16');
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[0, 4], [6, 10], [12, 16]]);
  assert.match(ranges[0].url, /1902\/default\/dark\/2.0$/);
  assert.deepEqual(twitchEmoteRanges(undefined), []);
  assert.deepEqual(twitchEmoteRanges('25:bad-range'), []);
});

test('cache coalesces parallel requests and expires with injected time', async () => {
  const cache = new Map();
  let calls = 0;
  let now = 100;
  const loader = async () => ++calls;
  const load = () => cached(cache, 'item', 10, loader, () => now);
  assert.deepEqual(await Promise.all([load(), load(), load()]), [1, 1, 1]);
  now = 109;
  assert.equal(await load(), 1);
  now = 110;
  assert.equal(await load(), 2);
  assert.equal(calls, 2);
});

test('cache returns stale values on failure and retries after grace period', async () => {
  const cache = new Map([['item', { value: 'old', expiresAt: 0 }]]);
  const failed = async () => { throw new Error('Provider unavailable'); };
  assert.equal(await cached(cache, 'item', 10, failed, () => 100), 'old');
  assert.equal(cache.get('item').expiresAt, 60100);
  assert.equal(await cached(cache, 'item', 10, async () => 'new', () => 60100), 'new');
});

test('failed first cache load is removed so the next call can recover', async () => {
  const cache = new Map();
  await assert.rejects(cached(cache, 'item', 10, async () => { throw new Error('offline'); }), /offline/);
  assert.equal(cache.has('item'), false);
  assert.equal(await cached(cache, 'item', 10, async () => 0), 0);
  assert.equal(await cached(cache, 'item', 10, async () => 123), 0);
});

test('registry isolates synchronous and asynchronous provider failures', async () => {
  const registry = new EmoteRegistry()
    .register({ id: 'sync-error', load() { throw new Error('sync'); } })
    .register({ id: 'async-error', async load() { throw new Error('async'); } })
    .register({ id: 'ok', async load() { return new Map([['Hello', 'https://cdn.example/hello.webp']]); } });
  assert.deepEqual([...await registry.load({ twitchId: '1', fetch })], [['Hello', 'https://cdn.example/hello.webp']]);
});

test('registry rejects duplicate IDs and uses registration order for collisions', async () => {
  const provider = (id, url) => ({ id, async load() { return new Map([['Same', url]]); } });
  const registry = new EmoteRegistry().register(provider('first', 'https://example.com/first'));
  assert.throws(() => registry.register(provider('first', 'https://example.com/duplicate')), /Duplicate/);
  registry.register(provider('second', 'https://example.com/second'));
  assert.equal((await registry.load({ twitchId: '1', fetch })).get('Same'), 'https://example.com/second');
});

test('registry filters unsafe emote URLs', async () => {
  const registry = new EmoteRegistry().register({ id: 'untrusted', async load() {
    return new Map([['script', 'javascript:alert(1)'], ['data', 'data:image/svg+xml,x'], ['local', 'http://example.com/x'], ['safe', 'https://example.com/x']]);
  } });
  assert.deepEqual([...await registry.load({ twitchId: '1', fetch })], [['safe', 'https://example.com/x']]);
});

test('7TV parser selects webp and normalizes protocol-relative URLs', () => {
  const emotes = parse7tvSet({ emote_set: { emotes: [{ name: 'Hi', data: { host: {
    url: '//cdn.7tv.app/emote/1', files: [{ name: '1x.webp' }, { name: '2x.avif' }, { name: '2x.webp' }]
  } } }, { name: 'MissingHost' }] } });
  assert.deepEqual([...emotes], [['Hi', 'https://cdn.7tv.app/emote/1/2x.webp']]);
});

test('7TV global set remains available when channel lookup fails', async () => {
  const result = await sevenTvProvider.load({ twitchId: '1', fetch: async url => {
    if (url.includes('/users/')) throw new Error('Channel not found');
    return Response.json({ emotes: [{ name: 'Global', host: { url: '//cdn.7tv.app/global', files: [{ name: '2x.webp' }] } }] });
  } });
  assert.equal(result.get('Global'), 'https://cdn.7tv.app/global/2x.webp');
});

test('7TV malformed JSON in one set does not discard the other set', async () => {
  const result = await sevenTvProvider.load({ twitchId: '1', fetch: async url => url.includes('/users/')
    ? new Response('invalid json')
    : Response.json({ emotes: [{ name: 'Global', host: { url: '//cdn.7tv.app/global', files: [{ name: '2x.webp' }] } }] })
  });
  assert.equal(result.size, 1);
});
