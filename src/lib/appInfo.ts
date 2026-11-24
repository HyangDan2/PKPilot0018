/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — which build is this?

   One place states the version, so the About panel, the portable README and the
   build manifest cannot disagree about what a reader is holding. `APP_VERSION`
   is checked against package.json by `tests/phase3e-corrective.test.ts`.
   ───────────────────────────────────────────────────────────────────────── */

/** Package version of this build (package.json `version`). */
export const APP_VERSION = '1.0.0';

/** The development stage the workspace is at. */
export const APP_PHASE = 'Phase 3';

/** Product name as it is written beside the version. */
export const APP_NAME = 'HD2Lab Sigrún';

/**
 * The line the About panel shows under the banner.
 *
 * It names the version and the stage instead of a bare year: a reader reporting
 * a problem should be able to say which build they used.
 */
export function aboutVersionLine(lang: 'en' | 'ko'): string {
  const year = new Date().getFullYear();
  return lang === 'ko'
    ? `시그룬 v${APP_VERSION} · ${APP_PHASE} · ${year}`
    : `Sigrún v${APP_VERSION} · ${APP_PHASE} · ${year}`;
}

/**
 * The status bar's build line. It reads the stage from {@link APP_PHASE} so a
 * released build cannot keep advertising an earlier one (WO-TQA-13).
 */
export function statusBarLabel(): string {
  return `HD2LAB · SIGRÚN · ${APP_PHASE.toUpperCase()}`;
}
