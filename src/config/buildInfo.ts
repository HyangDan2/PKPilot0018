/* ─────────────────────────────────────────────────────────────────────────
   Statelia — build metadata (WO-B04)

   The About panel prints what this file actually is: the version, the commit
   it was built from and the day it was built. Nothing here is typed by hand —
   `vite.config.ts` and `vite.portable.config.ts` inject the commit and the
   date at build time, and the version comes from the edition record (which the
   build injects from package.json). Outside a build (vitest) the values fall
   back to `unknown` / the current build year rather than inventing a commit.
   ───────────────────────────────────────────────────────────────────────── */

import { BUILD_YEAR, PRODUCT } from './product';

const env = import.meta.env as unknown as Record<string, string | undefined>;

/** The short git commit this bundle was built from. */
export const BUILD_COMMIT = env.VITE_BUILD_COMMIT && env.VITE_BUILD_COMMIT !== '' ? env.VITE_BUILD_COMMIT : 'unknown';

/** The day the bundle was built (`YYYY-MM-DD`), empty when it was not stated. */
export const BUILD_DATE = env.VITE_BUILD_DATE ?? '';

/** Version of the build, as package.json states it. */
export const BUILD_VERSION = PRODUCT.APP_VERSION;

/** The date line the About panel prints; falls back to the build year. */
export function buildDateLabel(): string {
  return BUILD_DATE || String(BUILD_YEAR);
}
