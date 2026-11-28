/* ─────────────────────────────────────────────────────────────────────────
   Statelia — official brand artwork (WO-B02)

   The owner's images live in this folder under fixed names. This module is the
   only reader: a file that is present is returned as a bundled URL (hashed in
   the hosted build, inlined as a data URL in the portable build), and a file
   that is absent returns `undefined` so the component draws its text fallback.

   Nothing here draws, recolours or substitutes a logo: WO-B02 forbids
   regenerating the official artwork, and a missing image must degrade to text,
   never to a different mark.
   ───────────────────────────────────────────────────────────────────────── */

/// <reference types="vite/client" />

const ARTWORK = import.meta.glob('./*.{webp,png,jpg,jpeg,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export type BrandAssetName =
  | 'statelia-splash.webp'
  | 'statelia-splash.png'
  | 'statelia-symbol.png'
  | 'statelia-logo.png'
  | 'sigrdrifa-engine-logo.png'
  | 'hd2lab-logo.png';

/** URL of one official file, or `undefined` while it has not been supplied. */
export function brandAsset(name: BrandAssetName): string | undefined {
  return ARTWORK[`./${name}`];
}

/** The first of several accepted file names (e.g. webp, then png). */
export function firstBrandAsset(...names: BrandAssetName[]): string | undefined {
  for (const name of names) {
    const url = brandAsset(name);
    if (url) return url;
  }
  return undefined;
}
