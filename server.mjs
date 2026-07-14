import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
const twitchClientId = process.env.TWITCH_CLIENT_ID || '';
const twitchClientSecret = process.env.TWITCH_CLIENT_SECRET || '';
let twitchToken = { value: '', expiresAt: 0 };

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

async function getTwitchToken() {
  if (!twitchClientId || !twitchClientSecret) {
    throw new Error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are not configured');
  }
  if (twitchToken.value && Date.now() < twitchToken.expiresAt) return twitchToken.value;

  const query = new URLSearchParams({
    client_id: twitchClientId,
    client_secret: twitchClientSecret,
    grant_type: 'client_credentials'
  });
  const response = await fetch(`https://id.twitch.tv/oauth2/token?${query}`, { method: 'POST' });
  if (!response.ok) throw new Error(`Twitch OAuth returned ${response.status}`);
  const data = await response.json();
  twitchToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, data.expires_in - 300) * 1000
  };
  return twitchToken.value;
}

async function twitchApi(path) {
  const token = await getTwitchToken();
  const response = await fetch(`https://api.twitch.tv/helix${path}`, {
    headers: { 'Client-Id': twitchClientId, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Twitch Helix returned ${response.status}`);
  return response.json();
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  response.end(JSON.stringify(data));
}

// Сервер намеренно минимальный: проект не требует npm install и node_modules.
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    // Twitch credentials stay on the server; OBS receives only public badge URLs.
    if (url.pathname === '/api/badges') {
      const channelId = url.searchParams.get('channelId');
      if (!/^\d+$/.test(channelId || '')) {
        sendJson(response, 400, { error: 'Valid channelId is required' });
        return;
      }
      const [globalBadges, channelBadges] = await Promise.all([
        twitchApi('/chat/badges/global'),
        twitchApi(`/chat/badges?broadcaster_id=${channelId}`)
      ]);
      sendJson(response, 200, { global: globalBadges.data, channel: channelBadges.data });
      return;
    }

    if (url.pathname === '/api/health') {
      sendJson(response, 200, { ok: true, twitchConfigured: Boolean(twitchClientId && twitchClientSecret) });
      return;
    }

    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(root, safePath);

    // Запрещаем выход из директории проекта через ../ в URL.
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(body);
  } catch (error) {
    if ((request.url || '').startsWith('/api/')) {
      sendJson(response, 503, { error: error?.message || 'API unavailable' });
      return;
    }
    response.writeHead(error?.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error?.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(port, host, () => {
  console.log(`Zakviel Chat: http://${host}:${port}`);
});
