/* ─────────────────────────────────────────────────────────────────────────
   Statelia — restore policy (WO-FINAL-002 · Q-01/Q-02)

   Putting a project back into memory is not the same as keeping it. Every
   path that restores the reader's project — the guarded copy after a reload,
   the end of a practice, the switch to the next lesson — follows one policy:

     1. the workspace is restored (snapshot or guarded copy),
     2. the restored workspace is written to the autosave stores,
     3. the stored copy is read back and compared structurally,
     4. only a `verified` outcome may remove the protective backup.

   The comparison is `compareProjects`, the same one the practice round trip
   uses, so a difference in a cell, a model coefficient or a chart style is a
   difference here too.
   ───────────────────────────────────────────────────────────────────────── */

import type { OutputDoc, Settings, Worksheet } from '../types';
import type { CustomChartStyle } from './chartStyles';
import type { LayoutDoc } from './graphLayout';
import type { StoredModel } from './modelStore';
import { migrateWorksheet } from './project';
import { compareProjects, type ProjectMismatch } from './projectCompare';

export interface RestoredWorkspace {
  worksheets: Worksheet[];
  activeSheetId: string;
  outputs: OutputDoc[];
  settings?: Settings;
  models: StoredModel[];
  figures: LayoutDoc[];
  customChartStyles: CustomChartStyle[];
}

/** What a project file, a practice slot or the autosave payload states. */
export interface ProjectLike {
  worksheets: Worksheet[];
  activeSheetId?: string;
  settings?: Settings;
  outputs?: OutputDoc[];
  models?: unknown;
  figures?: unknown;
  customChartStyles?: unknown;
}

export function stateFromProject(project: ProjectLike): RestoredWorkspace {
  return {
    worksheets: project.worksheets,
    activeSheetId: project.activeSheetId ?? '',
    outputs: project.outputs ?? [],
    settings: project.settings,
    models: (project.models as StoredModel[] | undefined) ?? [],
    figures: (project.figures as LayoutDoc[] | undefined) ?? [],
    customChartStyles: (project.customChartStyles as CustomChartStyle[] | undefined) ?? [],
  };
}

/** The autosave payload as a workspace, or null when it holds no sheets. */
export function stateFromAutosave(payload: unknown): RestoredWorkspace | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as ProjectLike;
  if (!Array.isArray(candidate.worksheets) || candidate.worksheets.length === 0) return null;
  return stateFromProject(candidate);
}

/**
 * Does the copy that came back out of the store state the same project?
 *
 * Both sides are migrated the way the loader will hand a sheet back, so a
 * derived column sequence is not a difference; everything else is.
 */
export function restoredStateMatches(expected: RestoredWorkspace, stored: RestoredWorkspace): { ok: boolean; mismatches: ProjectMismatch[] } {
  const view = (state: RestoredWorkspace) => ({
    worksheets: (state.worksheets ?? []).map(migrateWorksheet),
    activeSheetId: state.activeSheetId,
    settings: state.settings,
    outputs: state.outputs ?? [],
    models: state.models ?? [],
    figures: state.figures ?? [],
    customChartStyles: state.customChartStyles ?? [],
  });
  return compareProjects(view(expected), view(stored));
}

export type RestorePersistence = 'verified' | 'unsaved' | 'mismatch';

export interface GuardedOriginal {
  savedAt: string;
  fingerprint: string;
}

/**
 * Must the newest guarded original replace the autosave at startup?
 *
 * Two situations say yes: the autosave holds a kept practice project (its
 * fingerprint is one of the practice slots), or the guard was written after
 * the autosave's last successful save — the guard is then the only copy of the
 * reader's latest work (a failed or never-run autosave, a forced close).
 */
export function originalBackupWins(
  original: GuardedOriginal | null,
  record: { savedAt: string } | null,
  loadedFingerprint: string,
  practiceFingerprints: string[],
): boolean {
  if (!original) return false;
  if (original.fingerprint === loadedFingerprint) return false;
  if (practiceFingerprints.includes(loadedFingerprint)) return true;
  const guardTime = Date.parse(original.savedAt);
  if (!Number.isFinite(guardTime)) return false;
  const saveTime = record ? Date.parse(record.savedAt) : Number.NaN;
  return !Number.isFinite(saveTime) || guardTime > saveTime;
}
