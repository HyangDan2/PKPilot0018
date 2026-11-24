/* Sigrún — release artefact rules (build manifest, ZIP timestamps).

   Pure functions, so the rules can be tested without running a build:
   `tests/phase3e-corrective.test.ts` asserts the clamp, the reproducibility and
   the manifest fields here, and `tools/build_portable.mjs` uses the same code
   when it writes dist-portable/build-info.json and the ZIP.

   Why it exists: a ZIP entry timestamp must be a real DOS date (1980 … 2107),
   and two builds of one commit should be byte-identical when the packager says
   what time it is (`SOURCE_DATE_EPOCH`). A hard-coded date is neither true nor
   reproducible.
*/
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** ZIP stores a DOS date: 1980-01-01 00:00:00 is the earliest it can say. */
export const ZIP_MIN_YEAR = 1980;
/** …and 2107-12-31 23:59:58 the latest. */
export const ZIP_MAX_YEAR = 2107;

const MIN_DATE = Date.UTC(ZIP_MIN_YEAR, 0, 1, 0, 0, 0);
const MAX_DATE = Date.UTC(ZIP_MAX_YEAR, 11, 31, 23, 59, 58);

/**
 * The timestamp every entry of this build carries.
 *
 * `SOURCE_DATE_EPOCH` (seconds, as the reproducible-builds convention defines
 * it) wins when it is set, so the packager controls the clock; otherwise the
 * build's own time is used. Either way the value is clamped into the DOS range
 * and truncated to whole seconds, which is the resolution a ZIP can store.
 */
export function resolveBuildDate(env = process.env, now = new Date()) {
  const raw = env?.SOURCE_DATE_EPOCH;
  const seconds = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
  const base = Number.isFinite(seconds) ? new Date(seconds * 1000) : now;
  const millis = Number.isFinite(base.getTime()) ? base.getTime() : now.getTime();
  const clamped = Math.min(MAX_DATE, Math.max(MIN_DATE, millis));
  return new Date(Math.floor(clamped / 1000) * 1000);
}

/** The `YYYY-MM-DDTHH:MM:SSZ` form the ZIP writer is handed. */
export function zipTimestamp(date) {
  const resolved = resolveBuildDate({ SOURCE_DATE_EPOCH: String(date.getTime() / 1000) }, date);
  return resolved.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The git commit a build was made from, or 'unknown' outside a checkout. */
export function readCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

/** sha256 of a file, as hex. */
export function fileSha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * The manifest written beside a build.
 *
 * Every field is something a reader can check against the file they hold: which
 * source, which version, which bytes.
 */
export function buildManifest(fields) {
  const builtAt = fields.builtAt instanceof Date ? fields.builtAt : new Date(fields.builtAt);
  return {
    name: fields.name ?? 'HD2Lab Sigrún',
    version: fields.version ?? '0.0.0',
    phase: fields.phase ?? 'Phase 3',
    commit: fields.commit ?? 'unknown',
    builtAt: builtAt.toISOString(),
    zipTimestamp: fields.zipTimestamp ?? zipTimestamp(builtAt),
    file: fields.file,
    bytes: fields.bytes,
    sha256: fields.sha256,
    ...(fields.zip ? { zip: fields.zip } : {}),
    ...(fields.jsBytes !== undefined ? { jsBytes: fields.jsBytes } : {}),
    ...(fields.cssBytes !== undefined ? { cssBytes: fields.cssBytes } : {}),
    format: fields.format ?? 'iife/single-file',
    ...(fields.tools ? { tools: fields.tools } : {}),
  };
}

/** The repository-relative release folder a caller asked for, without a default. */
export function releaseDirectory(env, root) {
  const asked = env?.PORTABLE_RELEASE_DIR;
  if (!asked) return null;
  return path.isAbsolute(asked) ? asked : path.resolve(root, asked);
}
