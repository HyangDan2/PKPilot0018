/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — tutorial text registry

   Lesson prose is stored as paired English/Korean strings and addressed by a
   stable key derived from the tutorial and step ids. The interface chrome still
   goes through `lib/i18n`; this registry exists so a new tutorial needs no new
   interface key and no new component (WO-T10, §2.2).
   ───────────────────────────────────────────────────────────────────────── */

import type { Lang } from '../types';
import type { LocalizedText } from '../lib/localized';

const TEXT = new Map<string, LocalizedText>();

/** Register one paired string and return its key. Refuses a half translation. */
export function registerText(key: string, text: LocalizedText): string {
  if (!text || !text.en || !text.ko) {
    throw new Error(`tutorial.text.incomplete: ${key}`);
  }
  TEXT.set(key, text);
  return key;
}

export function tutorialText(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const text = TEXT.get(key);
  const raw = text ? (lang === 'ko' ? text.ko : text.en) : key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function hasTutorialText(key: string): boolean {
  return TEXT.has(key);
}

export function tutorialTextEntry(key: string): LocalizedText | undefined {
  return TEXT.get(key);
}

export function tutorialTextKeys(): string[] {
  return [...TEXT.keys()].sort();
}

/** Test hook: the registry is built when the course modules are imported. */
export function resetTutorialText(): void {
  TEXT.clear();
}
