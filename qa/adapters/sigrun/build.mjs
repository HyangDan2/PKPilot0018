/* Bundle the Sigrún QA adapter to a single ESM file that Node 22 (CI) and
   Node 24 (local) both run. esbuild ships with Vite, so there is no extra
   dependency to install. */
import { build } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

mkdirSync(new URL('./.build/', import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL('./cli.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: new URL('./.build/cli.mjs', import.meta.url).pathname,
  logLevel: 'warning',
  // The application reads its edition and build identity from import.meta.env;
  // a Node bundle has none, so the public edition's values are pinned here.
  define: {
    'import.meta.env.VITE_EDITION': '"public"',
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_BUILD_YEAR': '"2026"',
    'import.meta.env.BASE_URL': '"/"',
  },
});
console.log('adapter bundled → qa/adapters/sigrun/.build/cli.mjs');
