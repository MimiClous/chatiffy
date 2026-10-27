import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const define = { __APP_VERSION__: JSON.stringify(version) };
await Promise.all([
  build({ entryPoints: ['src/client/main.ts'], bundle: true, define, format: 'iife', platform: 'browser', target: 'chrome100', outfile: 'build/app.js' }),
  build({ entryPoints: ['src/server/main.ts'], bundle: true, define, format: 'esm', platform: 'node', target: 'node20', outfile: 'build/server.mjs' }),
  build({ entryPoints: ['src/shared/settings.ts', 'src/client/irc.ts', 'src/client/providers.ts', 'src/server/cache.ts', 'src/server/updates.ts'], bundle: true, define, format: 'esm', platform: 'neutral', target: 'es2022', outdir: 'build/modules', outbase: 'src' }),
  build({ entryPoints: ['src/server/profiles.ts'], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: 'build/modules/server/profiles.js' })
]);
