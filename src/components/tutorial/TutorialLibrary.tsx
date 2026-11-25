import { useMemo, useState } from 'react';
import type { Lang } from '../../types';
import { t } from '../../lib/i18n';
import { lt } from '../../lib/localized';
import { tutorialText } from '../../tutorials/localize';
import {
  TUTORIALS, TUTORIAL_CATEGORY_LABEL, TUTORIAL_DIFFICULTY_LABEL, totalStepCount,
} from '../../tutorials/registry';
import type { TutorialCategory, TutorialDifficulty, TutorialProgress } from '../../tutorials/types';
import { completionKind } from '../../tutorials/tutorialEngine';
import { findSample } from '../../samples/registry';
import { IconX } from '../Icons';

/* ─────────────────────────────────────────────────────────────────────────
   Tutorial Library (WO-T03)
   All twelve lessons with search, category and difficulty filters, progress,
   learning objectives and the related datasets. Starting never touches the
   reader's own project without an explicit choice (WO-T06).
   ───────────────────────────────────────────────────────────────────────── */

interface Props {
  lang: Lang;
  progressMap: Record<string, TutorialProgress>;
  activeTutorialId: string | null;
  onClose: () => void;
  onStart: (tutorialId: string) => void;
  onResume: (tutorialId: string) => void;
  onRestart: (tutorialId: string) => void;
  onOpenSample: (sampleId: string) => void;
  /** WO-3F-01: force exit stays reachable while the tutorial panel is closed. */
  onForceExit: () => void;
}

const DIFFICULTIES: TutorialDifficulty[] = ['intro', 'beginner', 'intermediate', 'advanced'];

export function TutorialLibrary({ lang, progressMap, activeTutorialId, onClose, onStart, onResume, onRestart, onOpenSample, onForceExit }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<TutorialCategory | 'all'>('all');
  const [difficulty, setDifficulty] = useState<TutorialDifficulty | 'all'>('all');

  const filtered = useMemo(() => TUTORIALS.filter((tutorial) => {
    if (category !== 'all' && tutorial.category !== category) return false;
    if (difficulty !== 'all' && tutorial.difficulty !== difficulty) return false;
    const haystack = `${tutorialText(lang, tutorial.titleKey)} ${tutorialText(lang, tutorial.descriptionKey)} ${tutorialText(lang, tutorial.structure.learnKey)}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [category, difficulty, lang, query]);

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal wide library-modal" role="dialog" aria-modal="true" aria-label={t(lang, 'tut.library')} data-testid="tutorial-library">
        <div className="modal-head">
          <div>
            <h3>{t(lang, 'tut.library')}</h3>
            <div className="modal-sub">{TUTORIALS.length} {t(lang, 'tut.lessons')} · {totalStepCount()} {t(lang, 'tut.steps')} · {t(lang, 'tut.levelNote')}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'close')} data-testid="tutorial-library-close"><IconX size={16} /></button>
        </div>

        {activeTutorialId && (
          <div className="tut-active-session" data-testid="tut-library-active-session">
            <span>{t(lang, 'tut.activeSessionNote')}</span>
            <span className="spacer" />
            <button type="button" className="btn tiny ghost danger" onClick={onForceExit} data-testid="tut-library-force-exit">
              {t(lang, 'tut.forceExit')}
            </button>
          </div>
        )}

        <div className="modal-body library-body tutorial-body">
          <aside className="library-list" aria-label={t(lang, 'tut.library')}>
            <div className="library-search">
              <input
                className="text-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(lang, 'tut.search')}
                aria-label={t(lang, 'tut.search')}
                data-testid="tutorial-search"
              />
              <div className="library-filters">
                <select value={category} onChange={(event) => setCategory(event.target.value as TutorialCategory | 'all')} aria-label={t(lang, 'tut.category')} data-testid="tutorial-category">
                  <option value="all">{t(lang, 'tut.allCategories')}</option>
                  {(Object.keys(TUTORIAL_CATEGORY_LABEL) as TutorialCategory[]).map((key) => (
                    <option key={key} value={key}>{lt(lang, TUTORIAL_CATEGORY_LABEL[key])}</option>
                  ))}
                </select>
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as TutorialDifficulty | 'all')} aria-label={t(lang, 'tut.difficulty')} data-testid="tutorial-difficulty">
                  <option value="all">{t(lang, 'tut.allLevels')}</option>
                  {DIFFICULTIES.map((key) => (
                    <option key={key} value={key}>{lt(lang, TUTORIAL_DIFFICULTY_LABEL[key])}</option>
                  ))}
                </select>
              </div>
            </div>

            <ul className="library-items tut-list">
              {filtered.map((tutorial) => {
                const progress = progressMap[tutorial.id];
                const done = progress ? Object.values(progress.steps).filter((step) => step.status === 'COMPLETED' || step.status === 'SKIPPED').length : 0;
                const percent = Math.round((done / tutorial.steps.length) * 100);
                const inProgress = progress && progress.status !== 'completed';
                const active = tutorial.id === activeTutorialId;
                return (
                  <li key={tutorial.id}>
                    <div className={`tut-card${active ? ' current' : ''}`} data-testid={`tut-card-${tutorial.id}`}>
                      <div className="tut-card-head">
                        <h4>{tutorialText(lang, tutorial.titleKey)}</h4>
                        {tutorial.flagship && <span className="badge ok">{t(lang, 'tut.flagship')}</span>}
                        {progress && completionKind(tutorial, progress) !== 'unfinished' && (
                          <span className={`badge${completionKind(tutorial, progress) === 'skipped' ? ' warn' : ''}`} data-testid={`tut-card-state-${tutorial.id}`}>
                            {completionKind(tutorial, progress) === 'skipped' ? t(lang, 'tut.skippedEnding') : t(lang, 'tut.completed')}
                          </span>
                        )}
                      </div>
                      <p className="tut-card-desc">{tutorialText(lang, tutorial.descriptionKey)}</p>
                      <div className="tut-card-meta">
                        <span>{lt(lang, TUTORIAL_CATEGORY_LABEL[tutorial.category])}</span>
                        <span>{lt(lang, TUTORIAL_DIFFICULTY_LABEL[tutorial.difficulty])}</span>
                        <span>{tutorial.estimatedMinutes} {t(lang, 'tut.minutes')}</span>
                        <span>{tutorial.steps.length} {t(lang, 'tut.steps')}</span>
                        {progress && <span>{percent}%</span>}
                      </div>
                      <ul className="tut-card-objectives">
                        {tutorial.objectiveKeys.slice(0, 2).map((key) => <li key={key}>{tutorialText(lang, key)}</li>)}
                      </ul>
                      <div className="tut-card-samples">
                        {tutorial.sampleIds.map((sampleId) => {
                          const sample = findSample(sampleId);
                          if (!sample) return null;
                          return (
                            <button key={sampleId} type="button" className="link-btn" onClick={() => onOpenSample(sampleId)}>
                              {lt(lang, sample.title)}
                            </button>
                          );
                        })}
                      </div>
                      <div className="tut-card-actions">
                        {active ? (
                          <span className="badge ok">{t(lang, 'tut.running')}</span>
                        ) : inProgress ? (
                          <>
                            <button type="button" className="btn primary tiny" onClick={() => onResume(tutorial.id)} data-testid={`tut-resume-${tutorial.id}`}>{t(lang, 'tut.resume')}</button>
                            <button type="button" className="btn tiny ghost" onClick={() => onRestart(tutorial.id)} data-testid={`tut-restart-${tutorial.id}`}>{t(lang, 'tut.restart')}</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn primary tiny" onClick={() => onStart(tutorial.id)} data-testid={`tut-start-${tutorial.id}`}>
                              {progress?.status === 'completed' ? t(lang, 'tut.startAgain') : t(lang, 'tut.start')}
                            </button>
                            {progress?.status === 'completed' && (
                              <button type="button" className="btn tiny ghost" onClick={() => onRestart(tutorial.id)}>{t(lang, 'tut.restart')}</button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
              {!filtered.length && <li className="library-empty">{t(lang, 'tut.none')}</li>}
            </ul>
          </aside>
        </div>

        <div className="modal-foot">
          <span className="hint">{t(lang, 'tut.libraryFoot')}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t(lang, 'close')}</button>
        </div>
      </div>
    </div>
  );
}
