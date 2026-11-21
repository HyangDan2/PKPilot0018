import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Sigrún is published under a GitHub Pages project sub-path.
export default defineConfig({
  base: '/PKPilot0018/',
  plugins: [react()],
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
