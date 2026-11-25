/* Model Term Editor settings survive between runs and projects (WO-3F-02).
   Term identity is the stable factor-name id, never the display label, so a
   stored selection keeps its meaning when the UI language changes. */

import type { HierarchyMode } from './modelTerms';

export interface ModelSettings {
  terms: string[];
  pooled: string[];
  hierarchy: HierarchyMode;
  /** Interaction order the selection was built for. */
  order?: number;
}

const SETTINGS_KEY = 'sigrun.modelSettings.v1';

type SettingsMap = Record<string, ModelSettings>;

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readAll(store: Pick<Storage, 'getItem' | 'setItem'> | null): SettingsMap {
  if (!store) return {};
  try {
    const raw = store.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const entries: SettingsMap = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([id, value]) => {
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      const strings = (input: unknown) => Array.isArray(input) && input.every((item) => typeof item === 'string')
        ? (input as string[])
        : [];
      entries[id] = {
        terms: strings(record.terms),
        pooled: strings(record.pooled),
        hierarchy: record.hierarchy === 'auto' || record.hierarchy === 'unrestricted' ? record.hierarchy : 'strict',
        order: typeof record.order === 'number' && isFinite(record.order) ? record.order : undefined,
      };
    });
    return entries;
  } catch {
    return {};
  }
}

export function loadModelSettings(analysisId: string): ModelSettings | null {
  return readAll(storage())[analysisId] ?? null;
}

export function saveModelSettings(analysisId: string, settings: ModelSettings): void {
  const store = storage();
  if (!store) return;
  try {
    const all = readAll(store);
    all[analysisId] = settings;
    store.setItem(SETTINGS_KEY, JSON.stringify(all));
  } catch {
    /* settings are a convenience: a refused write must not break the run */
  }
}

export function clearModelSettings(analysisId: string): void {
  const store = storage();
  if (!store) return;
  try {
    const all = readAll(store);
    delete all[analysisId];
    store.setItem(SETTINGS_KEY, JSON.stringify(all));
  } catch {
    /* see saveModelSettings */
  }
}
