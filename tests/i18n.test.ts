import { describe, expect, it } from 'vitest';
import { DICT, LANGS, resolveLabel, t } from '../src/lib/i18n';

describe('i18n', () => {
  it('defines exactly the same keys in every language', () => {
    const base = Object.keys(DICT.en).sort();
    LANGS.forEach((lang) => {
      expect(Object.keys(DICT[lang]).sort()).toEqual(base);
    });
    expect(base.length).toBeGreaterThan(150);
  });

  it('interpolates variables', () => {
    expect(t('en', 'res.descriptive', { vars: 'C1' })).toContain('C1');
    expect(t('ko', 'res.descriptive', { vars: 'C1' })).toContain('C1');
    expect(t('en', 'status.rows', { n: 12 })).toContain('12');
  });

  it('falls back to English for a missing key', () => {
    expect(t('ko', 'menu.file')).toBe('파일');
    expect(t('en', 'menu.file')).toBe('File');
  });

  it('resolves @-prefixed labels', () => {
    expect(resolveLabel('en', '@th.mean')).toBe('Mean');
    expect(resolveLabel('ko', '@th.mean')).toBe('평균');
    expect(resolveLabel('ko', 'Literal')).toBe('Literal');
  });
});
