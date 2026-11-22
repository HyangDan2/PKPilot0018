/* Bundle the Sigrún QA adapter to a single ESM file that Node 22 (CI) and
   Node 24 (local) both run. esbuild ships with Vite, so there is no extra
   dependency to install. */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync(new URL('./.build/', import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL('./cli.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: new URL('./.build/cli.mjs', import.meta.url).pathname,
  logLevel: 'warning',
});
console.log('adapter bundled → qa/adapters/sigrun/.build/cli.mjs');
