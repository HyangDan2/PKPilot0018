import type { Lang } from '../../types';
import { t } from '../../lib/i18n';
import { lt } from '../../lib/localized';
import { tutorialText } from '../../tutorials/localize';
import { findTutorial, TUTORIALS } from '../../tutorials/registry';
import type { TutorialProgress, ValidationOutcome, TutorialActionSpec } from '../../tutorials/types';
import type { TutorialSummaryData } from '../../tutorials/tutorialEngine';
import type { TutorialPhase } from '../../tutorials/sessionMachine';
import { findSample } from '../../samples/registry';
import { TutorialProgress as ProgressView } from './TutorialProgress';
import { TutorialStep } from './TutorialStep';
import { TutorialSummary } from './TutorialSummary';
import { IconX } from '../Icons';

/* ─────────────────────────────────────────────────────────────────────────
   Tutorial runner (WO-T04)
   The docked panel (desktop) or bottom sheet (mobile). It never replaces the
   workspace: the worksheet, the analysis dialogs and the output stay usable
   beside it, and closing it leaves the practice session intact.
   ───────────────────────────────────────────────────────────────────────── */

interface Props {
  lang: Lang;
  tutorialId: string;
  progress: TutorialProgress;
  outcomes: Record<string, ValidationOutcome>;
  summary: TutorialSummaryData;
  completed: boolean;
  reviewing: boolean;
  onShowSummary: () => void;
  busy: boolean;
  message: string | null;
  practiceMode: 'isolated' | 'current' | null;
  practiceSaved: boolean;
  collapsed: boolean;
  phase: TutorialPhase;
  storageWarning: string | null;
  onAction: (spec: TutorialActionSpec) => void;
  onHelp: (helpId: string) => void;
  onManual: (done: boolean) => void;
  onSkip: () => void;
  onReopen: () => void;
  onPrev: () => void;
  onNext: () => void;
  onValidate: () => void;
  onSelectStep: (stepId: string) => void;
  onRestart: () => void;
  onReview: () => void;
  onSavePractice: () => void;
  onExportPractice: () => void;
  onNextTutorial: (tutorialId: string) => void;
  onExitPractice: () => void;
  onForceExit: () => void;
  onTogglePause: () => void;
  onClosePanel: () => void;
  onToggleCollapse: () => void;
  onOpenLibrary: () => void;
}

export function TutorialRunner(props: Props) {
  const {
    lang, tutorialId, progress, outcomes, summary, completed, reviewing, onShowSummary, busy, message, practiceMode, practiceSaved, collapsed, phase, storageWarning,
    onAction, onHelp, onManual, onSkip, onReopen, onPrev, onNext, onValidate, onSelectStep,
    onRestart, onReview, onSavePractice, onExportPractice, onNextTutorial, onExitPractice,
    onForceExit, onTogglePause, onClosePanel, onToggleCollapse, onOpenLibrary,
  } = props;

  const tutorial = findTutorial(tutorialId);
  if (!tutorial) return null;
  const index = Math.max(0, tutorial.steps.findIndex((step) => step.id === progress.currentStepId));
  const current = tutorial.steps[index] ?? tutorial.steps[0];
  const sampleTitles = tutorial.sampleIds.map((id) => findSample(id)).filter((sample): sample is NonNullable<typeof sample> => Boolean(sample));
  const nextTutorial = tutorial.nextTutorialId ? findTutorial(tutorial.nextTutorialId) : undefined;

  if (collapsed) {
    return (
      <aside className="tutorial-dock collapsed" data-testid="tutorial-dock" aria-label={t(lang, 'tut.panel')}>
        <button type="button" className="tut-collapsed-bar" onClick={onToggleCollapse} data-testid="tut-expand" aria-expanded={false}>
          <span className="tut-collapsed-label">{t(lang, 'tut.panel')}</span>
          <span>{tutorialText(lang, tutorial.titleKey)}</span>
          <span className="mono-note">{index + 1}/{tutorial.steps.length}</span>
        </button>
        <button type="button" className="btn tiny ghost" onClick={onForceExit} data-testid="tut-collapsed-force-exit" title={t(lang, 'tut.forceExit')}>
          {t(lang, 'tut.forceExitShort')}
        </button>
      </aside>
    );
  }

  return (
    <aside className="tutorial-dock" data-testid="tutorial-dock" aria-label={t(lang, 'tut.panel')}>
      <header className="tut-head">
        <div className="tut-head-text">
          <div className="mono-note">{t(lang, 'tut.dockKicker')}{tutorial.flagship ? ` · ${t(lang, 'tut.flagship')}` : ''}</div>
          <h2>{tutorialText(lang, tutorial.titleKey)}</h2>
        </div>
        <div className="tut-head-actions">
          <button type="button" className="btn tiny ghost" onClick={onTogglePause} data-testid="tut-pause" aria-pressed={phase === 'PAUSED'}>
            {phase === 'PAUSED' ? t(lang, 'tut.resumeSession') : t(lang, 'tut.pause')}
          </button>
          <button type="button" className="btn tiny ghost" onClick={onForceExit} data-testid="tut-force-exit" title={t(lang, 'tut.forceExitNote')}>
            {t(lang, 'tut.forceExitShort')}
          </button>
          <button type="button" className="icon-btn" onClick={onOpenLibrary} title={t(lang, 'tut.library')} aria-label={t(lang, 'tut.library')} data-testid="tut-open-library">☰</button>
          <button type="button" className="icon-btn" onClick={onToggleCollapse} title={t(lang, 'tut.collapse')} aria-label={t(lang, 'tut.collapse')} data-testid="tut-collapse">–</button>
          <button type="button" className="icon-btn" onClick={onClosePanel} title={t(lang, 'tut.closePanel')} aria-label={t(lang, 'tut.closePanel')} data-testid="tut-close"><IconX size={15} /></button>
        </div>
      </header>

      <div className="tut-practice-bar" data-testid="tut-practice-bar">
        <span className={`badge ${practiceMode === 'current' ? 'warn' : 'ok'}`}>
          {practiceMode === 'current' ? t(lang, 'tut.practiceCurrent') : t(lang, 'tut.practiceIsolated')}
        </span>
        <span className="tut-practice-note">
          {practiceMode === 'current' ? t(lang, 'tut.practiceCurrentNote') : t(lang, 'tut.practiceIsolatedNote')}
        </span>
        {/* WO-TQA-12: the session and project a verdict belongs to are stated, not implied. */}
        <span className="mono-note" data-testid="tut-session-id">
          {t(lang, 'tut.sessionId')} {progress.sessionId}{progress.practiceProjectId ? ` · ${progress.practiceProjectId}` : ''}
        </span>
        <span className="spacer" />
        <button type="button" className="btn tiny ghost" onClick={onExitPractice} data-testid="tut-exit">{t(lang, 'tut.exitPractice')}</button>
      </div>

      {storageWarning && <p className="tut-warning" role="alert" data-testid="tut-storage-warning">{storageWarning}</p>}
      {phase === 'PAUSED' && <p className="tut-warning" role="status" data-testid="tut-paused-note">{t(lang, 'tut.pausedNote')}</p>}
      {phase === 'EXITING' && <p className="tut-warning" role="status" data-testid="tut-exiting-note">{t(lang, 'tut.exitingNote')}</p>}
      {message && <p className="tut-message" role="status" data-testid="tut-message">{message}</p>}

      {completed ? (
        <div className="tut-scroll">
          <TutorialSummary
            lang={lang}
            tutorial={tutorial}
            summary={summary}
            onReview={onReview}
            onRestart={onRestart}
            onSavePractice={onSavePractice}
            onExportPractice={onExportPractice}
            onNextTutorial={onNextTutorial}
            onExit={onExitPractice}
          />
        </div>
      ) : (
        <div className="tut-scroll">
          <ProgressView lang={lang} tutorial={tutorial} progress={progress} onSelectStep={onSelectStep} />
          <TutorialStep
            lang={lang}
            tutorial={tutorial}
            step={current}
            index={index}
            total={tutorial.steps.length}
            outcome={outcomes[current.id]}
            busy={busy}
            canPrev={index > 0}
            canNext={index < tutorial.steps.length - 1}
            onAction={onAction}
            onHelp={onHelp}
            onManual={onManual}
            onSkip={onSkip}
            onReopen={onReopen}
            onPrev={onPrev}
            onNext={onNext}
            onValidate={onValidate}
          />
          <details className="tut-about">
            <summary>{t(lang, 'tut.aboutThisLesson')}</summary>
            <div className="tut-about-body">
              <h5>{t(lang, 'tut.structure.learn')}</h5>
              <p>{tutorialText(lang, tutorial.structure.learnKey)}</p>
              <h5>{t(lang, 'tut.structure.data')}</h5>
              <p>{tutorialText(lang, tutorial.structure.dataKey)}</p>
              <p className="mono-note">{sampleTitles.map((sample) => lt(lang, sample.title)).join(' · ')}</p>
              <h5>{t(lang, 'tut.structure.analysis')}</h5>
              <p>{tutorialText(lang, tutorial.structure.analysisKey)}</p>
              <h5>{t(lang, 'tut.structure.inputs')}</h5>
              <p>{tutorialText(lang, tutorial.structure.inputsKey)}</p>
              <h5>{t(lang, 'tut.structure.check')}</h5>
              <p>{tutorialText(lang, tutorial.structure.checkKey)}</p>
              <h5>{t(lang, 'tut.structure.interpret')}</h5>
              <p>{tutorialText(lang, tutorial.structure.interpretKey)}</p>
              <h5>{t(lang, 'tut.structure.conclusion')}</h5>
              <p>{tutorialText(lang, tutorial.structure.conclusionKey)}</p>
              <ul className="tut-objectives">
                {tutorial.objectiveKeys.map((key) => <li key={key}>{tutorialText(lang, key)}</li>)}
              </ul>
              <p className="mono-note">{Math.round(TUTORIALS.length)} {t(lang, 'tut.lessonsAvailable')}
                {nextTutorial ? ` · ${t(lang, 'tut.nextTutorial')}: ${tutorialText(lang, nextTutorial.titleKey)}` : ''}
              </p>
              {practiceSaved && <p className="mono-note">{t(lang, 'tut.practiceSaved')}</p>}
            </div>
          </details>
        </div>
      )}

      <footer className="tut-foot">
        <button type="button" className="btn tiny ghost" onClick={onRestart} data-testid="tut-restart-footer">{t(lang, 'tut.restart')}</button>
        {reviewing && <button type="button" className="btn tiny" onClick={onShowSummary} data-testid="tut-show-summary">{t(lang, 'tut.showSummary')}</button>}
        <span className="spacer" />
        <button type="button" className="btn tiny" onClick={onSavePractice} data-testid="tut-save-footer">{t(lang, 'tut.savePractice')}</button>
      </footer>
    </aside>
  );
}
