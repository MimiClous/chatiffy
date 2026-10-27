import test from 'node:test';
import assert from 'node:assert/strict';
import { assertVersion, betaVersion } from '../scripts/version.mjs';

test('stable base generates a traceable beta without changing its release numbers', () => {
  assert.equal(betaVersion('1.5.0', 42, 'ABCDEF0123456789'), '1.5.0-beta.42.gabcdef0');
  assert.equal(assertVersion('1.5.0-beta.42.gabcdef0'), '1.5.0-beta.42.gabcdef0');
});

test('release checks reject prereleases, ambiguous versions and unsafe filenames', () => {
  assert.equal(assertVersion('1.5.0', { stableOnly: true }), '1.5.0');
  for (const version of ['v1.5.0', '01.5.0', '1.5', '1.5.0+build', '1.5.0-test.1', '../1.5.0', '1.5.0-beta.0.gabcdef0', '1.5.0-beta.1.ABCDEF0']) {
    assert.throws(() => assertVersion(version), /Invalid/);
  }
  assert.throws(() => assertVersion('1.5.0-beta.42.gabcdef0', { stableOnly: true }), /Invalid/);
});

test('beta generation cannot accept malformed build numbers or non-commit identifiers', () => {
  for (const run of [0, -1, '01', 'bad', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => betaVersion('1.5.0', run, 'abcdef0'));
  for (const sha of ['', 'abcdef', 'ghijkl0', '../file']) assert.throws(() => betaVersion('1.5.0', 1, sha));
  assert.throws(() => betaVersion('1.5.0-beta.1.gabcdef0', 2, 'abcdef0'));
});
