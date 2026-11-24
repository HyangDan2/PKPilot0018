/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — Help Center registry (WO-3E-10)
   Every document is bundled at build time. Tutorials resolve `helpId` here;
   the Help Center lists the same entries by category.
   ───────────────────────────────────────────────────────────────────────── */

import type { HelpEntry, HelpCategory } from './types';
import { BASICS_HELP } from './content/basics';
import { QUALITY_HELP } from './content/quality';
import { DOE_HELP } from './content/doe';
import { MODELS_HELP } from './content/models';

export const HELP_ENTRIES: HelpEntry[] = [...BASICS_HELP, ...QUALITY_HELP, ...DOE_HELP, ...MODELS_HELP];

const BY_ID = new Map(HELP_ENTRIES.map((entry) => [entry.id, entry]));

export function findHelp(id: string): HelpEntry | undefined {
  return BY_ID.get(id);
}

/** Every help document that explains one analysis (an analysis may have none). */
export function helpForAnalysis(analysisId: string): HelpEntry[] {
  return HELP_ENTRIES.filter((entry) => entry.analysisIds.includes(analysisId));
}

export function helpForTutorial(tutorialId: string): HelpEntry[] {
  return HELP_ENTRIES.filter((entry) => entry.tutorialIds.includes(tutorialId));
}

/** Categories in reading order, each with the documents it holds. */
export function helpByCategory(): { category: HelpCategory; entries: HelpEntry[] }[] {
  const order: HelpCategory[] = [
    'getting-started',
    'data',
    'basic-statistics',
    'regression',
    'anova',
    'visualization',
    'quality',
    'msa',
    'reliability',
    'doe',
    'optimization',
  ];
  return order
    .map((category) => ({ category, entries: HELP_ENTRIES.filter((entry) => entry.category === category) }))
    .filter((group) => group.entries.length > 0);
}
