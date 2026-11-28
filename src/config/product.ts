/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — product configuration (WO-FINAL-001 · WO-04)

   One record states what this build is: its identity, brand, version, base
   path, storage namespace and whether it may reach external services. The
   default build is the public HD2Lab Statelia (formerly Sigrún) and keeps the
   behaviour, storage keys and project schema of the previous builds. A
   derivative build (PKPilot0018E0001) selects the enterprise edition and
   supplies its own brand without touching the statistical engine.

   The edition is chosen at build time with VITE_EDITION=enterprise; anything
   else builds the public edition, so the existing GitHub Pages site keeps its
   UI, its behaviour and its storage keys.
   ───────────────────────────────────────────────────────────────────────── */

import { PUBLIC_EDITION } from './editions/public';
import { ENTERPRISE_EDITION } from './editions/enterprise';
import { shortName } from './editionMeta';
import { buildYearFrom } from './buildYear';

export type EditionId = 'public' | 'enterprise';

export interface ProductEdition {
  /** Stable machine identity of the product (not the edition). */
  PRODUCT_ID: string;
  EDITION_ID: EditionId;
  APP_NAME: string;
  /** Product name in Korean, for the About line. */
  APP_NAME_LOCAL: string;
  APP_VERSION: string;
  APP_PHASE: string;
  /** What kind of product this is, e.g. "Statistical Engineering Suite". */
  PRODUCT_CATEGORY: string;
  /** Display name of the analytical engine that runs the analyses. */
  ENGINE_NAME: string;
  /** Display version of that engine, e.g. "v1.0". */
  ENGINE_VERSION: string;
  /** Company / studio name that owns the product. Never invented for a derived build. */
  BRAND_NAME: string;
  /** Owner's slogan, empty when the owner has not supplied one. */
  SLOGAN: string;
  /** Copyright line, empty when the owner has not supplied one. */
  COPYRIGHT: string;
  /** Public repository, empty when the owner has not supplied one. */
  REPOSITORY_URL: string;
  /** Owner's home page, empty when the owner has not supplied one. */
  HOMEPAGE_URL: string;
  /** Deployment path the build defaults to; the asset base itself comes from Vite. */
  BASE_PATH: string;
  /** Public address of the canonical deployment, empty when it has none. */
  CANONICAL_URL: string;
  /** Prefix that keeps this edition's IndexedDB and localStorage apart. */
  STORAGE_NAMESPACE: string;
  /** Stem of exported project and practice files. */
  EXPORT_FILE_PREFIX: string;
  /** Whether the UI may link out to external services (Web-HQ, docs, social). */
  EXTERNAL_LINKS_ENABLED: boolean;
  /** One sentence, for the page description and the PWA manifest. */
  SUMMARY: string;
  /** Full page description. */
  DESCRIPTION: string;
  /** Absolute OG image URL, empty when the deployment has no public address. */
  OG_IMAGE: string;
}

export const EDITION: EditionId = import.meta.env.VITE_EDITION === 'enterprise' ? 'enterprise' : 'public';

const selected: ProductEdition = EDITION === 'enterprise' ? ENTERPRISE_EDITION : PUBLIC_EDITION;

/** The edition record with the version and base path the build actually used. */
export const PRODUCT: ProductEdition = {
  ...selected,
  // The version is injected from package.json at build time, so it cannot drift.
  APP_VERSION: import.meta.env.VITE_APP_VERSION || selected.APP_VERSION,
  BASE_PATH: import.meta.env.BASE_URL || selected.BASE_PATH,
};

export const PRODUCT_SHORT_NAME = shortName(PRODUCT);

/** Year the About panel prints; fixed at build time by VITE_BUILD_YEAR, which
 *  comes from SOURCE_DATE_EPOCH when the build is reproducible. */
export const BUILD_YEAR = Number(import.meta.env.VITE_BUILD_YEAR) || buildYearFrom(undefined);
