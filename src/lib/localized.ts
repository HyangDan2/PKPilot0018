/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — paired English / Korean text

   Tutorials, the Sample Library and the Help Center carry their prose as
   paired strings instead of interface keys: a lesson is content, and a new
   lesson must not need a new interface key (WO-3E-11 §2.2). Interface chrome
   still goes through `lib/i18n`. Both halves are required — the registry QA
   fails when either is missing, so a half-translated lesson cannot ship.
   ───────────────────────────────────────────────────────────────────────── */

import type { Lang } from '../types';

export interface LocalizedText {
  en: string;
  ko: string;
}

/** Read one language of a paired string. */
export function lt(lang: Lang, text: LocalizedText | undefined | null): string {
  if (!text) return '';
  return lang === 'ko' ? text.ko : text.en;
}

/** A paired string from one line of text, repeating it in both languages. */
export function both(text: string): LocalizedText {
  return { en: text, ko: text };
}

/** English with a Korean gloss, for statistical terms (WO-T10). */
export function bilingual(english: string, korean: string): LocalizedText {
  return { en: english, ko: korean };
}
