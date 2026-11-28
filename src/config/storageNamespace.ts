/* ─────────────────────────────────────────────────────────────────────────
   Statelia — storage namespaces (WO-FINAL-001 · WO-04)

   Every durable key the application writes is listed here once. Public edition
   keeps the historical names (empty namespace). A derived edition prefixes
   them, so both editions can run on one origin without either reading or
   deleting the other's data.

   Inventory (public names):
     IndexedDB database ......... sigrun-workspace   (store: workspace, key: current)
     Autosave fallback (LS) ..... sigrun.autosave.v1
     Settings ................... sigrun.settings.v1
     Floating panel sizes ....... sigrun.floatSizes.v1
     Workspace layout ........... sigrun.workspace.v2
     Custom chart styles ........ sigrun.chartStyles.v1
     Tutorial progress .......... sigrun.tutorials.progress.v1
     Practice slot (v2/v1) ...... sigrun.tutorials.practice.v2 / .v1
     Original-project guard ..... sigrun.tutorials.original.v1

   Project files themselves stay edition-agnostic: they are portable documents,
   not storage, and both editions read and write the same .sigrun.json schema.
   ───────────────────────────────────────────────────────────────────────── */

import { PRODUCT } from './product';

export const STORAGE_NAMESPACE = PRODUCT.STORAGE_NAMESPACE;

export const STORAGE_KEY = {
  indexedDbDatabase: 'sigrun-workspace',
  autosave: 'sigrun.autosave.v1',
  settings: 'sigrun.settings.v1',
  floatSizes: 'sigrun.floatSizes.v1',
  workspace: 'sigrun.workspace.v2',
  chartStyles: 'sigrun.chartStyles.v1',
  tutorialProgress: 'sigrun.tutorials.progress.v1',
  tutorialPractice: 'sigrun.tutorials.practice.v2',
  tutorialPracticeV1: 'sigrun.tutorials.practice.v1',
  tutorialOriginal: 'sigrun.tutorials.original.v1',
} as const;

/** Apply a namespace to a historical key. Public namespace is empty. */
export function namespacedKey(key: string, namespace: string = STORAGE_NAMESPACE): string {
  return namespace ? `${namespace}${key}` : key;
}

/** The names this build actually uses, for diagnostics and tests. */
export const STORAGE_KEYS_IN_USE: string[] = Object.values(STORAGE_KEY).map((key) => namespacedKey(key));
