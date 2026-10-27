import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const beta = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.([1-9]\d*)\.g([a-f0-9]{7})$/;

/** Canonical project versions: stable or a traceable beta. */
export function assertVersion(version, { stableOnly = false } = {}) {
  if (typeof version !== 'string') throw new Error('Version must be a string');
  const match = stable.exec(version) || (!stableOnly && beta.exec(version));
  if (!match || match.slice(1, 4).some(value => !Number.isSafeInteger(Number(value)))) {
    throw new Error(`Invalid Chatiffy version: ${version}`);
  }
  return version;
}

export function betaVersion(base, run, sha) {
  assertVersion(base, { stableOnly: true });
  if (!/^[1-9]\d*$/.test(String(run)) || !Number.isSafeInteger(Number(run))) throw new Error('Positive workflow run number required');
  if (typeof sha !== 'string' || !/^[a-f0-9]{7,40}$/i.test(sha)) throw new Error('Git commit SHA required');
  return `${base}-beta.${run}.g${sha.slice(0, 7).toLowerCase()}`;
}

async function main() {
  const path = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  if (process.argv[2] === 'check') {
    assertVersion(pkg.version, { stableOnly: true });
    console.log(`Release base version: ${pkg.version}`);
  } else if (process.argv[2] === 'beta') {
    pkg.version = betaVersion(pkg.version, process.argv[3], process.argv[4]);
    await writeFile(path, JSON.stringify(pkg, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${pkg.version}\n`);
    console.log(pkg.version);
  } else throw new Error('Usage: node scripts/version.mjs check | beta <run-number> <commit-sha>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
