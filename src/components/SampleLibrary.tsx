import { useMemo, useState } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { lt } from '../lib/localized';
import { SAMPLES } from '../samples/registry';
import type { SampleCategory } from '../samples/types';
import { findTutorial } from '../tutorials/registry';
import { tutorialText } from '../tutorials/localize';
import { IconX } from './Icons';

/* ─────────────────────────────────────────────────────────────────────────
   Sample Library (WO-3E-09)
   Every built-in dataset with its variables, units, provenance and the
   tutorials that practise on it. Loading appends a worksheet; the library never
   replaces the reader's data.
   ───────────────────────────────────────────────────────────────────────── */

interface Props {
  lang: Lang;
  /** Open with this dataset selected (from a tutorial's related-sample link). */
  initialSampleId?: string;
  onClose: () => void;
  onLoadSample: (sampleId: string) => void;
  onStartTutorial: (tutorialId: string) => void;
}

const CATEGORY_KEYS: Record<SampleCategory | 'all', { en: string; ko: string }> = {
  all: { en: 'All samples', ko: '전체 샘플' },
  process: { en: 'Process', ko: '공정' },
  comparison: { en: 'Comparison', ko: '비교' },
  regression: { en: 'Regression', ko: '회귀' },
  doe: { en: 'DOE', ko: '실험계획' },
  msa: { en: 'Measurement', ko: '측정시스템' },
  reliability: { en: 'Lifetime', ko: '수명' },
  'display-optics': { en: 'Display optics', ko: '디스플레이 광학' },
};

const ROLE_KEYS: Record<string, { en: string; ko: string }> = {
  id: { en: 'order', ko: '순서' },
  pttype: { en: 'point type', ko: '점 유형' },
  factor: { en: 'factor', ko: '요인' },
  response: { en: 'response', ko: '반응' },
  group: { en: 'group', ko: '그룹' },
  time: { en: 'time', ko: '시간' },
  censor: { en: 'censoring', ko: '중도절단' },
  reference: { en: 'actual units', ko: '실제 단위' },
};

export function SampleLibrary({ lang, initialSampleId, onClose, onLoadSample, onStartTutorial }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SampleCategory | 'all'>('all');
  const [selectedId, setSelectedId] = useState(initialSampleId ?? SAMPLES[0].id);

  const filtered = useMemo(() => SAMPLES.filter((sample) => {
    if (category !== 'all' && sample.category !== category) return false;
    const haystack = `${lt(lang, sample.title)} ${lt(lang, sample.summary)} ${sample.variables.map((variable) => variable.name).join(' ')}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [category, lang, query]);

  const selected = filterOrFirst(filtered, selectedId);

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal wide library-modal" role="dialog" aria-modal="true" aria-label={t(lang, 'sample.library')} data-testid="sample-library">
        <div className="modal-head">
          <div>
            <h3>{t(lang, 'sample.library')}</h3>
            <div className="modal-sub">{t(lang, 'sample.librarySub')}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'close')} data-testid="sample-library-close"><IconX size={16} /></button>
        </div>
        <div className="modal-body library-body">
          <aside className="library-list" aria-label={t(lang, 'sample.library')}>
            <div className="library-search">
              <input
                className="text-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(lang, 'sample.search')}
                aria-label={t(lang, 'sample.search')}
                data-testid="sample-search"
              />
              <select value={category} onChange={(event) => setCategory(event.target.value as SampleCategory | 'all')} aria-label={t(lang, 'sample.category')} data-testid="sample-category">
                {(Object.keys(CATEGORY_KEYS) as (SampleCategory | 'all')[]).map((key) => (
                  <option key={key} value={key}>{lt(lang, CATEGORY_KEYS[key])}</option>
                ))}
              </select>
            </div>
            <ul className="library-items">
              {filtered.map((sample) => (
                <li key={sample.id}>
                  <button
                    type="button"
                    className={`library-item${sample.id === selected?.id ? ' current' : ''}`}
                    onClick={() => setSelectedId(sample.id)}
                    data-testid={`sample-item-${sample.id}`}
                  >
                    <span className="li-title">{lt(lang, sample.title)}</span>
                    <span className="li-meta">{lt(lang, CATEGORY_KEYS[sample.category])} · {sample.variables.filter((variable) => variable.role === 'response').length} {t(lang, 'sample.responses')}</span>
                    {sample.synthetic && <span className="badge muted">{t(lang, 'sample.synthetic')}</span>}
                  </button>
                </li>
              ))}
              {!filtered.length && <li className="library-empty">{t(lang, 'sample.none')}</li>}
            </ul>
          </aside>

          {selected && (
            <section className="library-detail" aria-label={lt(lang, selected.title)}>
              <header>
                <h4>{lt(lang, selected.title)}</h4>
                <p>{lt(lang, selected.summary)}</p>
                <p className="mono-note">{lt(lang, selected.source)}</p>
              </header>
              <table className="stat-table sample-vars">
                <thead>
                  <tr>
                    <th>{t(lang, 'sample.column')}</th>
                    <th>{t(lang, 'sample.role')}</th>
                    <th>{t(lang, 'sample.unit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.variables.map((variable) => (
                    <tr key={variable.name}>
                      <td>{variable.name}</td>
                      <td>{lt(lang, ROLE_KEYS[variable.role] ?? { en: variable.role, ko: variable.role })}</td>
                      <td>{variable.unit ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="library-actions">
                <button type="button" className="btn primary" onClick={() => onLoadSample(selected.id)} data-testid={`sample-load-${selected.id}`}>
                  {t(lang, 'sample.loadInto')}
                </button>
              </div>

              <div className="library-related">
                <h5>{t(lang, 'sample.relatedTutorials')}</h5>
                {selected.tutorialIds.map((tutorialId) => {
                  const tutorial = findTutorial(tutorialId);
                  if (!tutorial) return null;
                  return (
                    <button key={tutorialId} type="button" className="link-btn" onClick={() => onStartTutorial(tutorialId)} data-testid={`sample-tutorial-${tutorialId}`}>
                      {tutorialText(lang, tutorial.titleKey)} →
                    </button>
                  );
                })}
                {!selected.tutorialIds.length && <p className="mono-note">{t(lang, 'sample.noTutorial')}</p>}
              </div>
            </section>
          )}
        </div>
        <div className="modal-foot">
          <span className="hint">{t(lang, 'sample.libraryFoot')}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t(lang, 'close')}</button>
        </div>
      </div>
    </div>
  );
}

function filterOrFirst<T extends { id: string }>(list: T[], id: string): T | undefined {
  return list.find((item) => item.id === id) ?? list[0];
}
