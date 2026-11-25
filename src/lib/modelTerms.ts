/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — model term catalog and hierarchy rules (WO-3F-02 / WO-3F-04)

   A term is identified by the FACTORS it names, never by its display string:
   `A|B` stays the same term when the UI language changes and when the label is
   localised. The catalog is built from the factors actually selected in the
   dialog, so the editor can only offer terms the run can build.

   Hierarchy modes:
     strict       a missing lower-order term is reported and the run refuses
     auto         missing lower-order terms are added and reported
     unrestricted the model is fitted as selected, with an explicit warning
   ───────────────────────────────────────────────────────────────────────── */

import type { ModelFactor, ModelTerm } from './glm';

export type HierarchyMode = 'strict' | 'auto' | 'unrestricted';

export interface TermDescriptor {
  /** Stable identity: the factor names joined; never the display label. */
  id: string;
  /** Display name, e.g. A×B. */
  name: string;
  factors: string[];
  order: number;
}

export interface TermCatalog {
  factors: { name: string; kind: ModelFactor['kind'] }[];
  terms: TermDescriptor[];
  maxOrder: number;
}

export function termId(factors: string[]): string {
  return factors.join('|');
}

export function termName(factors: string[]): string {
  return factors.join('×');
}

function blockKey(factor: string): string {
  // A derived square factor A² has A as its lower-order term (WO-3F-04).
  return factor.endsWith('²') ? factor.slice(0, -1) : factor;
}

/** Every interaction of the factors up to `maxOrder`, in model order. */
export function buildTermCatalog(factors: ModelFactor[], maxOrder = 2): TermCatalog {
  const names = factors.map((factor) => factor.name);
  const limit = Math.max(1, Math.min(maxOrder, names.length));
  const descriptors: TermDescriptor[] = [];
  for (let size = 1; size <= limit; size += 1) {
    const walk = (start: number, current: string[]) => {
      if (current.length === size) {
        descriptors.push({ id: termId(current), name: termName(current), factors: current, order: current.length });
        return;
      }
      for (let i = start; i < names.length; i += 1) walk(i + 1, [...current, names[i]]);
    };
    walk(0, []);
  }
  return {
    factors: factors.map((factor) => ({ name: factor.name, kind: factor.kind })),
    terms: descriptors,
    maxOrder: limit,
  };
}

export function defaultTermIds(catalog: TermCatalog, interactions = true): string[] {
  return catalog.terms
    .filter((term) => term.order === 1 || (interactions && term.order <= catalog.maxOrder))
    .map((term) => term.id);
}

/**
 * RSM catalog: main effects, squares and 2-way interactions, in model order.
 * A square factor's lower-order term is its linear factor (blockKey), so A²
 * requires A and A×B requires both main effects.
 */
export function buildRsmCatalog(factors: ModelFactor[]): TermCatalog {
  const names = factors.map((factor) => factor.name);
  const descriptors: TermDescriptor[] = names.map((name) => ({
    id: termId([name]),
    name,
    factors: [name],
    order: 1,
  }));
  names.forEach((name) => {
    descriptors.push({ id: termId([`${name}²`]), name: `${name}²`, factors: [`${name}²`], order: 1 });
  });
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      descriptors.push({
        id: termId([names[i], names[j]]),
        name: termName([names[i], names[j]]),
        factors: [names[i], names[j]],
        order: 2,
      });
    }
  }
  return {
    factors: [
      ...factors.map((factor) => ({ name: factor.name, kind: factor.kind })),
      ...names.map((name) => ({ name: `${name}²`, kind: 'numeric' as const })),
    ],
    terms: descriptors,
    maxOrder: 2,
  };
}

/** RSM default: every term the engine fits without pooling. */
export function rsmDefaultTermIds(catalog: TermCatalog): string[] {
  return catalog.terms.map((term) => term.id);
}

export function termsFromIds(catalog: TermCatalog, ids: string[]): ModelTerm[] {
  const byId = new Map(catalog.terms.map((term) => [term.id, term]));
  return ids
    .map((id) => byId.get(id))
    .filter((term): term is TermDescriptor => Boolean(term))
    .map((term) => ({ name: term.name, factors: term.factors }));
}

/** The lower-order terms a term requires, looked up in the catalog. */
export function requiredLowerIds(catalog: TermCatalog, id: string): string[] {
  const term = catalog.terms.find((candidate) => candidate.id === id);
  if (!term) return [];
  const required: string[] = [];
  const subsets: string[][] = [];
  const walk = (start: number, current: string[]) => {
    if (current.length > 0) subsets.push([...current]);
    for (let i = start; i < term.factors.length; i += 1) walk(i + 1, [...current, term.factors[i]]);
  };
  walk(0, []);
  subsets.forEach((subset) => {
    const wanted = subset.map(blockKey);
    const found = catalog.terms.find((candidate) => candidate.factors.length === wanted.length
      && candidate.factors.every((factor, i) => blockKey(factor) === wanted[i]));
    if (found && found.id !== id && !required.includes(found.id)) required.push(found.id);
  });
  return required;
}

export interface HierarchyResult {
  selected: string[];
  added: string[];
  removed: string[];
  violations: { termId: string; termName: string; missing: string[] }[];
  warnings: string[];
}

/**
 * Apply the hierarchy mode to a selection. Strict never changes the list;
 * auto adds the missing lower-order terms; unrestricted keeps the list and
 * records why it is unusual.
 */
export function applyHierarchy(catalog: TermCatalog, selectedIds: string[], mode: HierarchyMode): HierarchyResult {
  const selected = selectedIds.filter((id) => catalog.terms.some((term) => term.id === id));
  const violations: HierarchyResult['violations'] = [];
  selected.forEach((id) => {
    const missing = requiredLowerIds(catalog, id).filter((lower) => !selected.includes(lower));
    if (missing.length) {
      const term = catalog.terms.find((candidate) => candidate.id === id);
      violations.push({
        termId: id,
        termName: term?.name ?? id,
        missing: missing.map((lower) => catalog.terms.find((candidate) => candidate.id === lower)?.name ?? lower),
      });
    }
  });
  if (!violations.length) return { selected, added: [], removed: [], violations, warnings: [] };
  if (mode === 'auto') {
    const wanted = new Set(selected);
    violations.forEach((violation) => requiredLowerIds(catalog, violation.termId).forEach((id) => wanted.add(id)));
    const ordered = catalog.terms.map((term) => term.id).filter((id) => wanted.has(id));
    return {
      selected: ordered,
      added: ordered.filter((id) => !selected.includes(id)),
      removed: [],
      violations,
      warnings: [],
    };
  }
  if (mode === 'unrestricted') {
    return {
      selected,
      added: [],
      removed: [],
      violations,
      warnings: violations.map((violation) => violation.termName),
    };
  }
  return { selected, added: [], removed: [], violations, warnings: [] };
}

/** The model as the reader will read it: β0 plus the selected terms in order. */
export function formulaPreview(catalog: TermCatalog, selectedIds: string[], responseName = 'Y'): string {
  const selected = catalog.terms.filter((term) => selectedIds.includes(term.id));
  return selected.reduce((text, term) => `${text} + ${term.name}`, `${responseName} = β0`);
}

/**
 * Resolve the dialog's stored selection for a run. Missing or empty values fall
 * back to every main effect plus the 2-way interactions, the pre-3F behaviour.
 */
export function resolveModelSelection(
  catalog: TermCatalog,
  stored: unknown,
  pooledStored: unknown,
  mode: unknown,
  interactions = true,
): { terms: ModelTerm[]; pooled: ModelTerm[]; hierarchy: HierarchyResult; mode: HierarchyMode } {
  const hierarchyMode: HierarchyMode = mode === 'auto' || mode === 'unrestricted' ? mode : 'strict';
  const known = new Set(catalog.terms.map((term) => term.id));
  const storedIds = Array.isArray(stored) && stored.every((item) => typeof item === 'string')
    ? (stored as string[]).filter((id) => known.has(id))
    : [];
  const ids = storedIds.length ? storedIds : defaultTermIds(catalog, interactions);
  const idSet = new Set(ids);
  const rawPooled = Array.isArray(pooledStored)
    ? (pooledStored as unknown[]).filter((id): id is string => typeof id === 'string' && idSet.has(id))
    : [];
  const pooledSet = new Set(rawPooled);
  // Check hierarchy against the actual fitted model terms (excluding pooled terms)
  // so pooling a lower-order term while its higher-order interaction stays is caught.
  const activeIds = ids.filter((id) => !pooledSet.has(id));
  const hierarchy = applyHierarchy(catalog, activeIds, hierarchyMode);
  const restoredByAuto = hierarchyMode === 'auto' ? new Set(hierarchy.added) : new Set<string>();
  const finalPooledIds = rawPooled.filter((id) => !restoredByAuto.has(id));
  const fullSelectedIds = hierarchyMode === 'auto'
    ? [...new Set([...hierarchy.selected, ...finalPooledIds])]
    : ids;
  return {
    terms: termsFromIds(catalog, fullSelectedIds),
    pooled: termsFromIds(catalog, finalPooledIds),
    hierarchy,
    mode: hierarchyMode,
  };
}
