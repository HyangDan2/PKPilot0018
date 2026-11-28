/* ─────────────────────────────────────────────────────────────────────────
   Statelia — deployment base path (WO-FINAL-001 · WO-04)

   The same source tree is published at a GitHub Pages sub-path, at a server
   root, under a customer-chosen sub-path, and as one portable file opened from
   file://. Only this function decides which of those a build targets:

     portable build                    → './'  (nothing resolves against a root)
     VITE_BASE_PATH / BASE_PATH given  → that path, normalised
     enterprise edition                → '/'
     public edition                    → '/PKPilot0018/'

   Vite applies the value to every asset URL it rewrites; the app itself reads
   import.meta.env.BASE_URL, so no component needs to know the answer.
   ───────────────────────────────────────────────────────────────────────── */

import type { EditionId, ProductEdition } from './product';

export function normalizeBasePath(value: string): string {
  if (!value || value === './') return './';
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export function resolveBasePath(input: {
  edition: EditionId;
  defaultBasePath: string;
  requested?: string;
  portable?: boolean;
}): string {
  if (input.portable) return './';
  if (input.requested && input.requested.trim()) return normalizeBasePath(input.requested.trim());
  return normalizeBasePath(input.defaultBasePath || (input.edition === 'enterprise' ? '/' : '/PKPilot0018/'));
}

export function basePathFor(edition: ProductEdition, requested?: string, portable = false): string {
  return resolveBasePath({
    edition: edition.EDITION_ID,
    defaultBasePath: edition.BASE_PATH,
    requested,
    portable,
  });
}
