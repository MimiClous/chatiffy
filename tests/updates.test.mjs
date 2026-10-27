import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRelease, isNewer } from '../build/modules/server/updates.js';
const release = version => ({ tag_name: `v${version}`, assets: ['', '.sha256'].map(suffix => ({ name: `Chatiffy-${version}-windows-x64.zip${suffix}`, browser_download_url: `https://github.com/MimiClous/chatiffy/releases/download/v${version}/Chatiffy-${version}-windows-x64.zip${suffix}` })) });
test('version comparison is numeric and does not downgrade or accept prereleases', () => {
  assert.equal(isNewer('1.9.9', '1.10.0'), true);
  for (const latest of ['1.5.0', '1.4.9', '1.6.0-beta.1', 'oops']) assert.equal(isNewer('1.5.0', latest), false);
  assert.equal(isNewer('1.5.0-test.1', '1.6.0'), false);
});
test('update check requires both official Windows release assets', async () => {
  const update = await checkRelease('1.5.0', true, async () => Response.json(release('1.6.0')));
  assert.equal(update.available, true); assert.equal(update.desktop, true);
  const incomplete = release('1.6.0'); incomplete.assets.pop();
  await assert.rejects(checkRelease('1.5.0', true, async () => Response.json(incomplete)), /архива/);
  const foreign = release('1.6.0'); foreign.assets[0].browser_download_url = 'https://evil.example/package.zip';
  await assert.rejects(checkRelease('1.5.0', true, async () => Response.json(foreign)), /архива/);
});
test('missing releases are harmless; errors and prereleases are reported', async () => {
  assert.equal((await checkRelease('1.5.0', false, async () => new Response('', { status: 404 }))).available, false);
  await assert.rejects(checkRelease('1.5.0', true, async () => new Response('', { status: 403 })), /403/);
  await assert.rejects(checkRelease('1.5.0', true, async () => Response.json({ ...release('1.6.0'), prerelease: true })), /стабильный/);
});
