import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileStore } from '../build/modules/server/profiles.js';
test('profiles survive store recreation, isolate IDs and reject unsafe paths', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'chatiffy-profiles-'));
  try {
    const store = new ProfileStore(folder); const id = 'a'.repeat(32);
    const first = await store.write(id, { channel: 'My_Channel', fontSize: 22, background: true });
    assert.deepEqual(await new ProfileStore(folder).read(id), first);
    assert.equal(await store.read('b'.repeat(32)), null);
    const second = await store.write(id, { channel: 'My_Channel', fontSize: 30 });
    assert.notEqual(first.revision, second.revision);
    assert.equal((await store.read(id)).settings.fontSize, 30);
    await assert.rejects(store.write('../outside', {}), /Invalid profile/);
    await assert.rejects(store.write(id, []), /Settings object/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
