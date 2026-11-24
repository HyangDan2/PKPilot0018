/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — build plugin (WO-FINAL-001 · WO-04)

   Chooses the edition at build time, substitutes the product tokens in the
   HTML shell, and emits the PWA manifest from the same edition record. The
   pages and the manifest therefore state one brand, one address and one
   storage key — the ones in src/config/editions.
   ───────────────────────────────────────────────────────────────────────── */

import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { PUBLIC_EDITION } from '../src/config/editions/public';
import { ENTERPRISE_EDITION } from '../src/config/editions/enterprise';
import type { ProductEdition } from '../src/config/product';
import { applyHtmlTokens, manifestFor } from '../src/config/editionMeta';

export function selectEdition(env: NodeJS.ProcessEnv = process.env): ProductEdition {
  return env.VITE_EDITION === 'enterprise' ? ENTERPRISE_EDITION : PUBLIC_EDITION;
}

export function productPlugin(edition: ProductEdition = selectEdition()): Plugin {
  const manifest = `${JSON.stringify(manifestFor(edition), null, 2)}\n`;
  let resolved: ResolvedConfig | null = null;
  return {
    name: 'sigrun-product',
    configResolved(config) {
      resolved = config;
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => applyHtmlTokens(html, edition),
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0].endsWith('/manifest.json')) {
          res.setHeader('Content-Type', 'application/manifest+json');
          res.end(manifest);
          return;
        }
        next();
      });
    },
    closeBundle() {
      if (!resolved) return;
      const outDir = path.resolve(resolved.root, resolved.build.outDir);
      if (!fs.existsSync(outDir)) return;
      fs.writeFileSync(path.join(outDir, 'manifest.json'), manifest, 'utf8');
      // The portable packager has no TypeScript: it reads the record here.
      fs.writeFileSync(path.join(outDir, 'product.json'), `${JSON.stringify(edition, null, 2)}\n`, 'utf8');
    },
  };
}
