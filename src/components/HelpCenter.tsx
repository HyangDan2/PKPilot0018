import { useEffect, useMemo, useState } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { lt } from '../lib/localized';
import { HELP_CATEGORY_LABEL, type HelpEntry } from '../help/types';
import { helpByCategory, helpForAnalysis } from '../help/registry';
import { findSample } from '../samples/registry';
import { findTutorial } from '../tutorials/registry';
import { tutorialText } from '../tutorials/localize';
import { IconX } from './Icons';

/* ─────────────────────────────────────────────────────────────────────────
   Help Center (WO-3E-10)
   The manual the tutorials point at: theory, the formula the engine evaluates,
   each parameter, how to read the output, and the assumptions. Practice
   buttons open the tutorials that use the topic.
   ───────────────────────────────────────────────────────────────────────── */

interface Props {
  lang: Lang;
  initialHelpId?: string;
  onClose: () => void;
  onStartTutorial: (tutorialId: string) => void;
  onLoadSample: (sampleId: string) => void;
  onOpenTutorials: () => void;
}

export function HelpCenter({ lang, initialHelpId, onClose, onStartTutorial, onLoadSample, onOpenTutorials }: Props) {
  const groups = useMemo(() => helpByCategory(), []);
  const firstId = initialHelpId ?? groups[0]?.entries[0]?.id ?? '';
  const [selectedId, setSelectedId] = useState(firstId);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (initialHelpId) setSelectedId(initialHelpId);
  }, [initialHelpId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filteredGroups = useMemo(() => groups
    .map((group) => ({
      category: group.category,
      entries: group.entries.filter((entry) => {
        const haystack = `${lt(lang, entry.title)} ${lt(lang, entry.summary)} ${entry.analysisIds.join(' ')}`.toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
      }),
    }))
    .filter((group) => group.entries.length), [groups, lang, query]);

  const selected: HelpEntry | undefined = groups.flatMap((group) => group.entries).find((entry) => entry.id === selectedId)
    ?? groups[0]?.entries[0];

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal wide library-modal" role="dialog" aria-modal="true" aria-label={t(lang, 'help.center')} data-testid="help-center">
        <div className="modal-head">
          <div>
            <h3>{t(lang, 'help.center')}</h3>
            <div className="modal-sub">{t(lang, 'help.centerSub')}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="btn tiny" onClick={onOpenTutorials} data-testid="help-center-tutorials">{t(lang, 'tut.library')}</button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'close')} data-testid="help-center-close"><IconX size={16} /></button>
        </div>
        <div className="modal-body library-body">
          <aside className="library-list" aria-label={t(lang, 'help.center')}>
            <div className="library-search">
              <input
                className="text-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(lang, 'help.search')}
                aria-label={t(lang, 'help.search')}
                data-testid="help-search"
              />
            </div>
            <div className="help-groups">
              {filteredGroups.map((group) => (
                <div key={group.category} className="help-group">
                  <h5>{lt(lang, HELP_CATEGORY_LABEL[group.category])}</h5>
                  {group.entries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={`library-item${entry.id === selected?.id ? ' current' : ''}`}
                      onClick={() => setSelectedId(entry.id)}
                      data-testid={`help-item-${entry.id}`}
                    >
                      <span className="li-title">{lt(lang, entry.title)}</span>
                    </button>
                  ))}
                </div>
              ))}
              {!filteredGroups.length && <p className="library-empty">{t(lang, 'help.none')}</p>}
            </div>
          </aside>

          {selected && (
            <section className="library-detail help-doc" aria-label={lt(lang, selected.title)} data-testid="help-doc">
              <header>
                <div className="mono-note">{lt(lang, HELP_CATEGORY_LABEL[selected.category])}</div>
                <h4>{lt(lang, selected.title)}</h4>
                <p>{lt(lang, selected.summary)}</p>
              </header>

              <section>
                <h5>{t(lang, 'help.theory')}</h5>
                <p>{lt(lang, selected.theory)}</p>
              </section>

              {selected.formulas.length > 0 && (
                <section>
                  <h5>{t(lang, 'help.formulas')}</h5>
                  <ul className="formula-list">
                    {selected.formulas.map((formula) => (
                      <li key={formula.expression}>
                        <code>{formula.expression}</code>
                        <span>{lt(lang, formula.note)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {selected.parameters.length > 0 && (
                <section>
                  <h5>{t(lang, 'help.parameters')}</h5>
                  <table className="stat-table">
                    <tbody>
                      {selected.parameters.map((parameter) => (
                        <tr key={parameter.name.en}>
                          <td className="help-param">{lt(lang, parameter.name)}</td>
                          <td>{lt(lang, parameter.meaning)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              <section>
                <h5>{t(lang, 'help.interpretation')}</h5>
                <ul className="help-list">
                  {selected.interpretation.map((line) => <li key={line.en}>{lt(lang, line)}</li>)}
                </ul>
              </section>

              <section>
                <h5>{t(lang, 'help.assumptions')}</h5>
                <ul className="help-list assumptions">
                  {selected.assumptions.map((line) => <li key={line.en}>{lt(lang, line)}</li>)}
                </ul>
              </section>

              <section className="help-practice">
                <h5>{t(lang, 'help.practice')}</h5>
                <div className="help-practice-actions">
                  {selected.tutorialIds.map((tutorialId) => {
                    const tutorial = findTutorial(tutorialId);
                    if (!tutorial) return null;
                    return (
                      <button key={tutorialId} type="button" className="btn tiny" onClick={() => onStartTutorial(tutorialId)} data-testid={`help-practice-${tutorialId}`}>
                        {tutorialText(lang, tutorial.titleKey)}
                      </button>
                    );
                  })}
                  {selected.sampleIds.map((sampleId) => {
                    const sample = findSample(sampleId);
                    if (!sample) return null;
                    return (
                      <button key={sampleId} type="button" className="btn tiny ghost" onClick={() => onLoadSample(sampleId)} data-testid={`help-sample-${sampleId}`}>
                        {t(lang, 'help.loadSample')} · {lt(lang, sample.title)}
                      </button>
                    );
                  })}
                </div>
              </section>
            </section>
          )}
        </div>
        <div className="modal-foot">
          <span className="hint">{t(lang, 'help.centerFoot')}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t(lang, 'close')}</button>
        </div>
      </div>
    </div>
  );
}

/** Documents that explain one analysis, for a dialog or menu hook. */
export function helpLinksForAnalysis(analysisId: string): HelpEntry[] {
  return helpForAnalysis(analysisId);
}
