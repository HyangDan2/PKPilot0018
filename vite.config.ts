import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { productPlugin, selectEdition } from './tools/product_plugin';
import { basePathFor } from './src/config/basePath';
import { buildYearFrom } from './src/config/buildYear';
import { readCommit } from './tools/build_manifest.mjs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const edition = selectEdition();
const root = fileURLToPath(new URL('.', import.meta.url));
/* WO-B04: the About panel prints the commit and the build day it was made from.
   SOURCE_DATE_EPOCH keeps both reproducible when the packager sets the clock. */
const buildDate = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString().slice(0, 10)
  : new Date().toISOString().slice(0, 10);

// Statelia is published under a GitHub Pages project sub-path by default; a
// customer build can state its own base with VITE_BASE_PATH (root, sub-path).
export default defineConfig({
  base: basePathFor(edition, process.env.VITE_BASE_PATH || process.env.BASE_PATH),
  plugins: [react(), productPlugin(edition)],
  define: {
    'import.meta.env.VITE_EDITION': JSON.stringify(edition.EDITION_ID),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_BUILD_YEAR': JSON.stringify(String(buildYearFrom(process.env.SOURCE_DATE_EPOCH))),
    'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(readCommit(root)),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(buildDate),
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2400,
  },
  server: { port: 5178, host: true },
  preview: { port: 4178, host: true, strictPort: true },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
