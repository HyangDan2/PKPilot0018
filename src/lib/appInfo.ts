/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — which build is this?

   The version, stage, product name and brand all come from the edition record
   in src/config, so the About panel, the status bar, the page title and the
   build manifest cannot disagree — and a derived edition renames the product
   in one place. `APP_VERSION` is checked against package.json by
   `tests/phase3e-corrective.test.ts` and the config tests.
   ───────────────────────────────────────────────────────────────────────── */

import { BUILD_YEAR, PRODUCT, PRODUCT_SHORT_NAME } from '../config/product';

/** Package version of this build (injected from package.json at build time). */
export const APP_VERSION = PRODUCT.APP_VERSION;

/** The development stage the workspace is at. */
export const APP_PHASE = PRODUCT.APP_PHASE;

/** Product name as it is written beside the version. */
export const APP_NAME = PRODUCT.APP_NAME;

/** Which edition this build is. */
export const APP_EDITION = PRODUCT.EDITION_ID;

/**
 * The line the About panel shows under the banner.
 *
 * It names the version and the stage instead of a bare year: a reader reporting
 * a problem should be able to say which build they used. The year is fixed at
 * build time so a reproducible build prints the same line twice.
 */
export function aboutVersionLine(lang: 'en' | 'ko'): string {
  return lang === 'ko'
    ? `${PRODUCT.APP_NAME_LOCAL} v${APP_VERSION} · ${APP_PHASE} · ${BUILD_YEAR}`
    : `${PRODUCT_SHORT_NAME} v${APP_VERSION} · ${APP_PHASE} · ${BUILD_YEAR}`;
}

/**
 * The status bar's build line. It reads the stage from {@link APP_PHASE} so a
 * released build cannot keep advertising an earlier one (WO-TQA-13).
 */
export function statusBarLabel(): string {
  const brand = PRODUCT.BRAND_NAME ? `${PRODUCT.BRAND_NAME.toUpperCase()} · ` : '';
  return `${brand}${PRODUCT_SHORT_NAME.toUpperCase()} · ${APP_PHASE.toUpperCase()}`;
}
