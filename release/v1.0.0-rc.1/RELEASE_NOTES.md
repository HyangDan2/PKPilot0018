# Sigrún v1.0.0-rc.1 — Release Notes

Build: 1.0.0 · v1.0.0-rc.1 · commit 6db05f4

Sigrún is a pure-browser statistical and quality workspace. This release is the
Phase 3 final stabilization and enterprise-readiness build (WO-FINAL-001, corrected under WO-FINAL-002). It
adds no Phase 4 features; the existing UI, analyses and chart behaviour are
kept, and the fixes below close defects found by the corrective QA.

## Reliability

- **Practice sessions are never lost to a failed save.** Starting or resuming a
  guided practice now snapshots the reader's project, waits for the autosave to
  settle, and offers retry, export or an explicit discard if the storage
  refuses — the practice is not ended until its copy is verified.
- **Autosave reports what really happened.** The status bar shows
  SAVING / SAVED / FAILED / STORAGE_UNAVAILABLE / QUOTA_EXCEEDED; overlapping
  saves are ordered by revision, and the newest copy wins when the
  localStorage and IndexedDB copies disagree.
- **The reader's own project is guarded** before every practice, with the file
  read back and compared; a backup is never deleted on failure and a resumed
  lesson never reuses another session's original-project id.
- **A restored project is kept, not just shown.** Restoring the guarded copy —
  at startup, at the end of a practice, when keeping or exporting one, or when
  moving to the next lesson — now writes it to the autosave, reads it back and
  compares every record; the backup is removed only when that read-back is
  identical. A newer guarded copy also takes precedence over an older autosave.
- **Custom chart styles travel with the project**, including an empty list,
  when a project is opened, a practice is resumed, or the guarded copy is
  restored.
- Projects now persist worksheets, column metadata, the active sheet, outputs,
  stored models, figures, graph layout, chart styles, settings and practice
  evidence; a resumed practice is checked for tutorial version and project
  identity compatibility.

## Numerical domain

- Values at the edge of a factor's range (Lower 100000000,
  Upper 100000000.001, Value 100000000.05) are classified OUTSIDE DOMAIN. Range
  slack is derived from the ULP of the bound and the range width, so a wide
  range no longer admits a value that lies outside it, and the profiler,
  feasible region and surface agree with the classification.

## Project integrity

- Save/Open compares the project record by record — every table row, chart
  array, 3-D grid, figure position and size, model term, coefficient,
  covariance, residual variance, coding and custom style attribute — at full
  precision. The fingerprint is a change detector only; the comparison is the
  verification.
- Damaged files are refused by name (schema version, unknown block, corrupt
  row, ragged grid, unresolved chart source, duplicate panel id, …) instead of
  restoring a partial project. A failed Open leaves the open project untouched.
- Fixed: stored models lost their fitting range (`factorBounds`) when a project
  was loaded.

## Enterprise configuration

- Product identity, brand, version, base path, storage namespace, export prefix
  and the external-link policy come from one edition record. The public edition
  keeps every existing page string and storage key.
- The enterprise edition builds at a server root, writes under its own storage
  namespace, links to nothing external, and leaves brand and copyright empty
  until the owner supplies them.

## Verification

The release was verified with the project's own suites: unit tests, the Python
reference statistics QA, the portable offline E2E, the tutorial suites, the
project-guard probes, the built-page network audit, and a release artifact
verification pass. Exact counts and outcomes are recorded in
`SHA256SUMS.txt`, `build-info.json`, and the repository's
`docs/RELEASE_V1_0_0_QUALIFICATION.md`.

## Files

| file | what it is |
| --- | --- |
| `Sigrun-v1.0.0-rc.1.html` | the whole application in one HTML file (file://, offline) |
| `Sigrun-v1.0.0-rc.1-Portable.zip` | that file with a read-me, zipped |
| `Sigrun-v1.0.0-rc.1-Web.zip` | the static web build (serve the folder) |
| `SHA256SUMS.txt` | sha256 of every other file here |
| `build-info.json` | build manifest: version, commit, bytes, hashes |
| `LICENSES.txt` | every third-party package with its full license text and NOTICE files, plus the first-party content notice |
