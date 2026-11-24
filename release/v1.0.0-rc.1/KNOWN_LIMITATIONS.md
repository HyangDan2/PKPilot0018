# Known limitations — Sigrún v1.0.0-rc.1

These are stated so a reader is not surprised by them. None of them is a
silent approximation: each is either visible in the UI or documented here.

## Comparison with commercial software

- **Minitab was not executed directly.** The engine is checked against an
  independent Python reference (NumPy / SciPy / statsmodels) with published
  formulas where the reference has no API. Agreement demonstrates statistical
  definition consistency, not bit-for-bit equality with Minitab.
- Normal approximation and exact methods differ for some quantities (for
  example proportion power); the QA report separates these as REVIEW rather
  than declaring them identical.
- The failures-only Anderson–Darling statistic under censoring and the Weibull
  bootstrap approximations are approximations; their calibration is reported
  in `qa/reports/calibration_weibull.json`, not claimed as exact.

## Browser storage

- Measurement and worksheet data live in the browser. IndexedDB is the primary
  autosave store and localStorage the second copy; if a browser blocks both,
  the status bar says so and Save Project remains the durable path.
- A portable file opened from `file://` has an opaque origin in some browsers:
  storage can be limited to that session. Keep the file somewhere stable and
  use Save Project for anything that must survive.
- Two tabs share one origin. A newer save in one tab is reported in the other
  rather than silently overwriting it; reload to pick up the newest copy.

## Scope

- Phase 4–6 work (new analyses, new chart families, server features) is not
  part of this release. The Phase 4–6 backlogs are unchanged.
- The enterprise edition is an architecture and build path; its company name,
  logo and copyright are supplied by the owner. The shipped enterprise build
  intentionally names no company.
- PWA offline caching is not used on the hosted build: the page is fully
  computed client-side and the portable build is the offline artefact.
