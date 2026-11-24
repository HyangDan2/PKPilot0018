import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* Sigrún — portable (single-file) build.
 *
 * The GitHub Pages build in vite.config.ts publishes ES modules under
 * /PKPilot0018/. A browser opening a page from file:// refuses those: module
 * scripts are blocked by CORS, and module preloading has no origin to resolve
 * against. This config produces one classic-script bundle instead:
 *
 *   • iife output + inlineDynamicImports → a single <script> with no import
 *   • assetsInlineLimit: Infinity        → every asset becomes a data: URL
 *   • base: './'                         → nothing depends on the site root
 *
 * tools/build_portable.mjs then inlines the JS and the CSS into portable.html
 * so the artefact is one file. The page itself has no PWA manifest, no
 * canonical link and no remote OG image: those only mean something on a
 * server, and a file:// page must not go looking for them.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    outDir: 'dist-portable/_raw',
    emptyOutDir: true,
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: 'portable.html',
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'sigrun.js',
        assetFileNames: 'sigrun.[ext]',
      },
    },
  },
});
