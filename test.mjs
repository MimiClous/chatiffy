import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const port = 19000 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
let child;

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch (_) { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Server did not start in time');
}

test.before(async () => {
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer();
});

test.after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
});

test('health endpoint reports service state without exposing secrets', async () => {
  const response = await fetch(`${origin}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'Chatiffy');
  assert.equal(body.twitchConfigured, false);
  assert.equal('twitchClientSecret' in body, false);
});

test('editor and overlay routes serve Chatiffy', async () => {
  for (const path of ['/', '/overlay?channel=mimiclous&lifetime=0']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Chatiffy/);
  }
});

test('only explicitly public assets can be downloaded', async () => {
  assert.equal((await fetch(`${origin}/app.js`)).status, 200);
  assert.equal((await fetch(`${origin}/style.css`)).status, 200);
  assert.equal((await fetch(`${origin}/.env`)).status, 404);
  assert.equal((await fetch(`${origin}/server.mjs`)).status, 404);
  assert.equal((await fetch(`${origin}/package.json`)).status, 404);
});

test('API validates inputs and methods before contacting Twitch', async () => {
  assert.equal((await fetch(`${origin}/api/channel?login=bad-name!`)).status, 400);
  assert.equal((await fetch(`${origin}/api/badges?channelId=oops`)).status, 400);
  assert.equal((await fetch(`${origin}/api/health`, { method: 'POST' })).status, 405);
});

test('HEAD returns headers without a response body', async () => {
  const response = await fetch(`${origin}/style.css`, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.match(response.headers.get('content-type') || '', /text\/css/);
});

test('client DOM bindings and Compose service stay consistent', async () => {
  const [html, javascript, compose] = await Promise.all([
    readFile(new URL('index.html', import.meta.url), 'utf8'),
    readFile(new URL('app.js', import.meta.url), 'utf8'),
    readFile(new URL('compose.yaml', import.meta.url), 'utf8')
  ]);
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const references = new Set([...javascript.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]));
  assert.deepEqual([...references].filter((id) => !ids.has(id)), []);
  assert.match(compose, /^services:\s*$/m);
  assert.match(compose, /^  zakvielchat:\s*$/m);
});
