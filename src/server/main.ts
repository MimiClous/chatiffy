import { publicBadges, publicChannel } from './twitch-public.js';
import { appVersion } from '../shared/version.js';
import { ProfileStore } from './profiles.js';
import { checkRelease, type ReleaseUpdate } from './updates.js';
import { homedir } from 'node:os';
import type { BadgeSet, TwitchChannel, HelixResponse, Cosmetics, CosmeticBadge, Paint } from '../shared/contracts.js';
import { cached, type CacheEntry } from './cache.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 17845);
const host = process.env.HOST || '0.0.0.0';
const twitchClientId = process.env.TWITCH_CLIENT_ID || '';
const twitchClientSecret = process.env.TWITCH_CLIENT_SECRET || '';
const allowedHosts = new Set(
  (process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
if (allowedHosts.size === 0) {
  console.warn('ALLOWED_HOSTS is empty; all HTTP requests will be rejected');
}
const profiles = new ProfileStore(join(process.env.CHATIFFY_DATA_DIR || join(homedir(), '.chatiffy'), 'profiles'));
const updates = new Map<string, CacheEntry<ReleaseUpdate>>();
const desktop = process.env.CHATIFFY_DESKTOP === '1';
const latestRelease = () => cached(updates, 'latest', 15 * 60 * 1000, () => checkRelease(appVersion, desktop));
const apiTimeoutMs = 8000;
const configuredRateLimit = Number(process.env.API_RATE_LIMIT || 600);
const apiRateLimit = Number.isFinite(configuredRateLimit) ? Math.min(5000, Math.max(60, configuredRateLimit)) : 600;

let twitchToken = { value: '', expiresAt: 0 };
let tokenRequest: Promise<string> | null = null;
const channelCache = new Map<string, CacheEntry<TwitchChannel>>();
const badgeCache = new Map<string, CacheEntry<HelixResponse<BadgeSet>>>();
const cosmeticCache = new Map<string, CacheEntry<Cosmetics>>();
const rateLimits = new Map<string, { count: number; resetAt: number }>();

const contentTypes: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
const publicFiles = new Map([
  ['/assets/fonts/Monocraft.ttf', 'assets/fonts/Monocraft.ttf'],
  ['/assets/fonts/Monocraft-Bold.ttf', 'assets/fonts/Monocraft-Bold.ttf'],
  ['/assets/chatiffy.svg', 'assets/chatiffy.svg'],
  ['/favicon.ico', 'assets/chatiffy.ico'],
  ['/', 'index.html'],
  ['/overlay', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'build/app.js'],
  ['/style.css', 'style.css']
]);

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = apiTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestTwitchToken() {
  if (!twitchClientId || !twitchClientSecret) {
    throw new Error('Twitch API credentials are not configured');
  }
  if (twitchToken.value && Date.now() < twitchToken.expiresAt) return twitchToken.value;
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const query = new URLSearchParams({
      client_id: twitchClientId,
      client_secret: twitchClientSecret,
      grant_type: 'client_credentials'
    });
    const response = await fetchWithTimeout(`https://id.twitch.tv/oauth2/token?${query}`, { method: 'POST' });
    if (!response.ok) throw new Error(`Twitch OAuth returned ${response.status}`);
    const data = await response.json();
    twitchToken = {
      value: data.access_token,
      expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 300) * 1000
    };
    return twitchToken.value;
  })();

  try { return await tokenRequest; }
  finally { tokenRequest = null; }
}

async function twitchApi<T>(path: string, retry = true): Promise<HelixResponse<T>> {
  const token = await requestTwitchToken();
  const response = await fetchWithTimeout(`https://api.twitch.tv/helix${path}`, {
    headers: { 'Client-Id': twitchClientId, Authorization: `Bearer ${token}` }
  });
  if (response.status === 401 && retry) {
    twitchToken = { value: '', expiresAt: 0 };
    return twitchApi<T>(path, false);
  }
  if (!response.ok) throw new Error(`Twitch Helix returned ${response.status}`);
  return response.json();
}

async function sevenTvCosmetics(userId: string, login: string): Promise<Cosmetics> {
  const userQuery = `query ChatiffyUser($query: String!) {
    users(query: $query, limit: 10) {
      style { color paint_id badge_id }
      connections { id platform username }
    }
  }`;
  const userResponse = await fetchWithTimeout('https://7tv.io/v3/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: userQuery, variables: { query: login } })
  });
  if (!userResponse.ok) throw new Error(`7TV user API returned ${userResponse.status}`);
  const userResult = await userResponse.json() as {
    errors?: unknown[]; data?: { users?: { style?: { color?: number; badge_id?: string; paint_id?: string }; connections?: { id: string; platform: string }[] }[] }
  };
  if (userResult.errors?.length) throw new Error('7TV user API returned an error');
  const user = userResult.data?.users?.find((candidate) => candidate.connections?.some(
    (connection) => connection.platform === 'TWITCH' && connection.id === userId
  ));
  if (!user) return { color: null, badge: null, paint: null };
  const style = user.style || {};
  const color = Number.isInteger(style.color) && style.color !== 0 ? style.color ?? null : null;
  const ids = [style.badge_id, style.paint_id].filter((id) => /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id || ''));
  if (!ids.length) {
    return { color, badge: null, paint: null };
  }

  const query = `query ChatiffyCosmetics($list: [ObjectID!]) {
    cosmetics(list: $list) {
      paints { id kind name function color angle shape image_url repeat stops { at color } shadows { x_offset y_offset radius color } }
      badges { id kind name tooltip tag }
    }
  }`;
  const cosmeticResponse = await fetchWithTimeout('https://7tv.io/v3/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { list: ids } })
  });
  if (!cosmeticResponse.ok) throw new Error(`7TV cosmetics API returned ${cosmeticResponse.status}`);
  const result = await cosmeticResponse.json() as { errors?: unknown[]; data?: { cosmetics?: { badges?: CosmeticBadge[]; paints?: Paint[] } } };
  if (result.errors?.length) throw new Error('7TV cosmetics API returned an error');
  const cosmetics = result.data?.cosmetics || {};
  const badge = cosmetics.badges?.find((item) => item.id === style.badge_id) || null;
  const paint = cosmetics.paints?.find((item) => item.id === style.paint_id) || null;

  return {
    color,
    badge: badge ? { ...badge, url: `https://cdn.7tv.app/badge/${badge.id}/2x.webp` } : null,
    paint
  };
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // Inline styles are required for sanitized user colors and live CSS variables.
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https: wss://irc-ws.chat.twitch.tv; object-src 'none'; base-uri 'none'; frame-ancestors *"
  };
}

function sendJson(response: http.ServerResponse, status: number, data: unknown, method = 'GET') {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  response.end(method === 'HEAD' ? undefined : body);
}

function allowApiRequest(request: http.IncomingMessage) {
  const ip = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= apiRateLimit;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of channelCache) if (now > (value.expiresAt || 0) + 86400000) channelCache.delete(key);
  for (const [key, value] of badgeCache) if (now > (value.expiresAt || 0) + 86400000) badgeCache.delete(key);
  for (const [key, value] of cosmeticCache) if (now > (value.expiresAt || 0) + 86400000) cosmeticCache.delete(key);
  for (const [key, value] of rateLimits) if (now > value.resetAt) rateLimits.delete(key);
}, 10 * 60 * 1000).unref();

const server = http.createServer(async (request, response) => {
  const method = request.method || 'GET';
  const rawHost = (request.headers.host || '').toLowerCase();
  const hostHeader = rawHost.startsWith('[')
    ? rawHost.slice(1, rawHost.indexOf(']'))
    : rawHost.split(':', 1)[0];
  if (!hostHeader || !allowedHosts.has(hostHeader)) {
    response.writeHead(403, {
      'Content-Type': 'text/plain; charset=utf-8',
      ...securityHeaders()
    });
    response.end('Access denied: host is not allowed');
    return;
  }

  try {
    const mutation = method === 'PUT' && /^\/api\/profiles\/[a-f0-9]{32}$/.test((request.url || '').split('?')[0]) || method === 'POST' && ['/api/desktop/update', '/api/profiles/list'].includes(request.url || '');
    if (mutation && (request.headers.origin !== `http://${request.headers.host}` && request.headers.origin !== `https://${request.headers.host}` || !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || ''))) {
      sendJson(response, 403, { error: 'Same-origin JSON request required' }, method); return;
    }
    if (method !== 'GET' && method !== 'HEAD' && !mutation) {
      sendJson(response, 405, { error: 'Method not allowed' }, method);
      return;
    }

    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/') && !allowApiRequest(request)) {
      response.setHeader('Retry-After', '60');
      sendJson(response, 429, { error: 'Too many requests' }, method);
      return;
    }

    if (url.pathname === '/api/profiles/list' && method === 'POST') {
      sendJson(response, 200, { profiles: await profiles.list() }); return;
    }
    if (url.pathname.startsWith('/api/profiles/')) {
      const id = url.pathname.slice('/api/profiles/'.length);
      if (method === 'PUT') {
        let body = '';
        for await (const chunk of request) {
          body += String(chunk);
          if (Buffer.byteLength(body) > 16384) { sendJson(response, 413, { error: 'Profile too large' }); return; }
        }
        let data: unknown;
        try { data = JSON.parse(body); } catch { sendJson(response, 400, { error: 'Invalid JSON' }); return; }
        sendJson(response, 200, await profiles.write(id, data));
      } else {
        const profile = await profiles.read(id);
        sendJson(response, profile ? 200 : 404, profile || { error: 'Profile not found' }, method);
      }
      return;
    }
    if (url.pathname === '/api/updates') {
      sendJson(response, 200, await latestRelease(), method); return;
    }
    if (url.pathname === '/api/desktop/update' && method === 'POST') {
      if (!desktop || appVersion.includes('-')) { sendJson(response, 409, { error: 'Обновление из приложения доступно только в Windows-версии.' }); return; }
      const release = await latestRelease();
      if (!release.available) { sendJson(response, 409, { error: 'Новой версии нет' }); return; }
      console.log(`CHATIFFY_UPDATE ${release.latestVersion}`);
      sendJson(response, 200, { ok: true, version: release.latestVersion }); return;
    }

    if (url.pathname === '/api/badges') {
      const channelId = url.searchParams.get('channelId');
      if (channelId !== null && !/^\d{1,20}$/.test(channelId)) {
        sendJson(response, 400, { error: 'Valid channelId is required' }, method);
        return;
      }
      const load = async (id?: string) => {
        if (twitchClientId && twitchClientSecret) {
          try { return await twitchApi<BadgeSet>(id ? `/chat/badges?broadcaster_id=${id}` : '/chat/badges/global'); }
          catch { /* Public catalog also works in portable builds without OAuth configuration. */ }
        }
        return publicBadges(id);
      };
      const global = cached(badgeCache, 'global', 60 * 60 * 1000, () => load());
      const channel = channelId ? cached(badgeCache, `channel:${channelId}`, 60 * 60 * 1000, () => load(channelId))
        : Promise.resolve({ data: [] as BadgeSet[] });
      const [globalResult, channelResult] = await Promise.allSettled([global, channel]);
      if (globalResult.status === 'rejected' && channelResult.status === 'rejected') throw globalResult.reason;
      if (globalResult.status === 'rejected' && !channelId) throw globalResult.reason;
      sendJson(response, 200, {
        global: globalResult.status === 'fulfilled' ? globalResult.value.data : [],
        channel: channelResult.status === 'fulfilled' ? channelResult.value.data : []
      }, method);
      return;
    }

    if (url.pathname === '/api/channel') {
      const login = (url.searchParams.get('login') || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{1,25}$/.test(login)) {
        sendJson(response, 400, { error: 'Valid Twitch login is required' }, method);
        return;
      }
      const channel = await cached(channelCache, login, 6 * 60 * 60 * 1000, async () => {
        let result: HelixResponse<TwitchChannel>;
        if (twitchClientId && twitchClientSecret) {
          try { result = await twitchApi<TwitchChannel>(`/users?login=${encodeURIComponent(login)}`); }
          catch { result = await publicChannel(login); }
        } else result = await publicChannel(login);
        if (!result.data?.[0]) {
          const error = new Error('Twitch channel not found');
          Object.assign(error, { status: 404 });
          throw error;
        }
        return result.data[0];
      });
      sendJson(response, 200, { id: channel.id, login: channel.login, displayName: channel.display_name }, method);
      return;
    }

    if (url.pathname === '/api/7tv-cosmetics') {
      const userId = url.searchParams.get('userId');
      const login = (url.searchParams.get('login') || '').trim().toLowerCase();
      if (!/^\d{1,20}$/.test(userId || '') || !/^[a-z0-9_]{1,25}$/.test(login)) {
        sendJson(response, 400, { error: 'Valid Twitch userId and login are required' }, method);
        return;
      }
      const cosmetics = await cached(cosmeticCache, userId!, 6 * 60 * 60 * 1000, () => sevenTvCosmetics(userId!, login));
      sendJson(response, 200, cosmetics, method);
      return;
    }

    if (url.pathname === '/api/health') {
      sendJson(response, 200, {
        ok: true,
        service: 'Chatiffy',
        version: appVersion,
        desktop,
        twitchConfigured: Boolean(twitchClientId && twitchClientSecret),
        uptimeSeconds: Math.round(process.uptime())
      }, method);
      return;
    }

    const publicFile = publicFiles.get(url.pathname);
    if (!publicFile) {
      response.writeHead(404, { ...securityHeaders(), 'Content-Type': 'text/plain; charset=utf-8' }).end(method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    const filePath = resolve(root, publicFile);
    if (!filePath.startsWith(`${root}${sep}`)) throw new Error('Invalid public file path');

    const body = await readFile(filePath);
    response.writeHead(200, {
      ...securityHeaders(),
      'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': extname(filePath) === '.html' ? 'no-store' : 'no-cache'
    });
    response.end(method === 'HEAD' ? undefined : body);
  } catch (caught: unknown) {
    const error: Error & { status?: number; code?: string } = caught instanceof Error ? caught : new Error('API unavailable');
    const isApi = (request.url || '').startsWith('/api/');
    if (isApi) {
      const status = Number(error?.status) || 503;
      sendJson(response, status, { error: error?.message || 'API unavailable' }, method);
      return;
    }
    const status = error?.code === 'ENOENT' || error?.code === 'EISDIR' ? 404 : 500;
    response.writeHead(status, { ...securityHeaders(), 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(method === 'HEAD' ? undefined : (status === 404 ? 'Not found' : 'Server error'));
  }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 100;

server.on('clientError', (_, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

server.listen(port, host, () => {
  console.log(`Chatiffy listening on http://${host}:${port}`);
  if (desktop) {
    console.log('CHATIFFY_READY');
    if (!appVersion.includes('-')) void latestRelease().then(release => { if (release.available) console.log(`CHATIFFY_UPDATE_AVAILABLE ${release.latestVersion}`); }).catch(() => {});
  }
});

function shutdown(signal: string) {
  console.log(`${signal}: shutting down Chatiffy`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// The desktop owner keeps stdin open. Closing it also shuts down the server.
if (process.env.CHATIFFY_DESKTOP === '1') {
  process.stdin.setEncoding('utf8');
  let input = '';
  process.stdin.on('data', (chunk) => {
    input = (input + chunk).slice(-128);
    if (input.includes('shutdown\n')) shutdown('desktop');
  });
  process.stdin.on('end', () => shutdown('desktop disconnected'));
  process.stdin.resume();
}
