/* ─────────────────────────────────────────────────────────────────────────
   Statelia — built-in sample datasets

   The datasets themselves live in `src/samples/` with their metadata, so the
   File menu, the Sample Library and the tutorial system all read one registry.
   This module keeps the helpers every other module imports and re-exports the
   registry for the code that only knows `DATASETS` (WO-3E-09).
   ───────────────────────────────────────────────────────────────────────── */

export { uid, makeWorksheet, emptyWorksheet } from './worksheetFactory';
export { DATASETS, SAMPLES, findSample, samplesForTutorial, tutorialsForSample } from '../samples/registry';
export type { DatasetDef, SampleDef, SampleVariable } from '../samples/types';
