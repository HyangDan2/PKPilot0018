/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — edition metadata (WO-FINAL-001 · WO-04)

   The page title, the PWA manifest and the HTML head are derived from the
   edition record here, once. The Vite plugin and the tests both read these
   functions, so a derived build cannot drift from what its config states.
   ───────────────────────────────────────────────────────────────────────── */

import type { ProductEdition } from './product';

/**
 * Short product name (the part after the owner): "Sigrún" out of
 * "HD2Lab Sigrún". Falls back to the full name when the owner is unset.
 * Lives here, not in product.ts, so the build plugin can use it in Node.
 */
export function shortName(edition: ProductEdition): string {
  return edition.BRAND_NAME && edition.APP_NAME.startsWith(edition.BRAND_NAME)
    ? edition.APP_NAME.slice(edition.BRAND_NAME.length).trim()
    : edition.APP_NAME;
}

/** "Sigrún — HD2Lab Statistical Workspace" (public), brand-aware otherwise. */
export function editionTitle(edition: ProductEdition): string {
  return edition.BRAND_NAME
    ? `${shortName(edition)} — ${edition.BRAND_NAME} Statistical Workspace`
    : `${edition.APP_NAME} — Statistical Workspace`;
}

/** "HD2LAB · SIGRÚN" style lock-up used above the About panel. */
export function editionLockup(edition: ProductEdition): string {
  const parts = [edition.BRAND_NAME, shortName(edition)].filter(Boolean);
  return parts.map((part) => part.toUpperCase()).join(' · ');
}

const MANIFEST_ICONS = [
  { src: './favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  { src: './favicon-32x32.png', sizes: '32x32', type: 'image/png', purpose: 'any' },
  { src: './apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
];

export function manifestFor(edition: ProductEdition) {
  return {
    name: editionTitle(edition),
    short_name: shortName(edition),
    description: edition.SUMMARY,
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#FAFAFD',
    theme_color: '#8B6CE8',
    lang: 'en',
    dir: 'ltr',
    categories: ['productivity', 'utilities', 'education'],
    icons: MANIFEST_ICONS,
  };
}

/**
 * Text tokens `index.html` and `portable.html` carry. The plugin substitutes
 * them at build time; the pages themselves name no brand, address or key.
 */
export function htmlTokens(edition: ProductEdition): Record<string, string> {
  return {
    '%PRODUCT_TITLE%': editionTitle(edition),
    '%PRODUCT_DESCRIPTION%': edition.DESCRIPTION,
    '%PRODUCT_SUMMARY%': edition.SUMMARY,
    '%PRODUCT_AUTHOR%': edition.BRAND_NAME,
    '%PRODUCT_CANONICAL%': edition.CANONICAL_URL,
    '%PRODUCT_OG_IMAGE%': edition.OG_IMAGE,
    '%PRODUCT_SHORT_NAME%': shortName(edition),
    '%PRODUCT_SETTINGS_KEY%': `${edition.STORAGE_NAMESPACE}sigrun.settings.v1`,
  };
}

/** Replace every known token; an unknown token is left untouched on purpose. */
export function applyHtmlTokens(html: string, edition: ProductEdition): string {
  const filled = Object.entries(htmlTokens(edition)).reduce(
    (text, [token, value]) => text.split(token).join(value),
    html,
  );
  const cleaned = stripEmptyTags(filled);
  // No public address means no image to point OG and Twitter cards at.
  return edition.OG_IMAGE
    ? cleaned
    : cleaned.replace(/^[ \t]*<meta[^>]*(?:property|name)="(?:og:image|twitter:image)[^"]*"[^>]*>\n?/gm, '');
}

/**
 * An edition without a public address leaves the canonical and OG tags empty;
 * an empty `href`/`content` is a claim the page cannot support, so the tag is
 * dropped rather than shipped blank.
 */
export function stripEmptyTags(html: string): string {
  return html
    .replace(/^[ \t]*<link[^>]*href=""[^>]*>\n?/gm, '')
    .replace(/^[ \t]*<meta[^>]*content=""[^>]*>\n?/gm, '');
}
