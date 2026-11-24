import type { Lang } from '../../types';
import { t } from '../../lib/i18n';
import type { StepStatus, Tutorial, TutorialProgress } from '../../tutorials/types';

/* ─────────────────────────────────────────────────────────────────────────
   Progress display (WO-T04 §6.3, WO-T10)
   State is carried by a glyph and a word as well as a colour, so the bar and
   the step list are readable without colour vision and by a screen reader.
   ───────────────────────────────────────────────────────────────────────── */

const STATUS_TEXT: Record<StepStatus, { en: string; ko: string }> = {
  NOT_STARTED: { en: 'Not started', ko: '시작 전' },
  IN_PROGRESS: { en: 'In progress', ko: '진행 중' },
  COMPLETED: { en: 'Completed', ko: '완료' },
  SKIPPED: { en: 'Skipped', ko: '건너뜀' },
  FAILED: { en: 'Check failed', ko: '검증 실패' },
};

const STATUS_GLYPH: Record<StepStatus, string> = {
  NOT_STARTED: '○',
  IN_PROGRESS: '◐',
  COMPLETED: '✓',
  SKIPPED: '»',
  FAILED: '!',
};

export function stepStatusText(lang: Lang, status: StepStatus): string {
  return lang === 'ko' ? STATUS_TEXT[status].ko : STATUS_TEXT[status].en;
}

export function stepStatusGlyph(status: StepStatus): string {
  return STATUS_GLYPH[status];
}

interface Props {
  lang: Lang;
  tutorial: Tutorial;
  progress: TutorialProgress;
  onSelectStep?: (stepId: string) => void;
  compact?: boolean;
}

export function TutorialProgress({ lang, tutorial, progress, onSelectStep, compact }: Props) {
  const statuses = tutorial.steps.map((step) => progress.steps[step.id]?.status ?? 'NOT_STARTED');
  const done = statuses.filter((status) => status === 'COMPLETED' || status === 'SKIPPED').length;
  const validated = tutorial.steps.filter((step) => step.completion === 'validated' && progress.steps[step.id]?.status === 'COMPLETED').length;
  const percent = tutorial.steps.length ? Math.round((done / tutorial.steps.length) * 100) : 0;

  return (
    <div className="tut-progress" data-testid="tutorial-progress">
      <div className="tut-progress-head">
        <span className="tut-progress-count" data-testid="tutorial-progress-count">
          {done}/{tutorial.steps.length} {t(lang, 'tut.stepsDone')}
        </span>
        <span className="tut-progress-verified">{validated} {t(lang, 'tut.validated')}</span>
        <span className="spacer" />
        <span className="mono-note">{percent}%</span>
      </div>
      <div
        className="tut-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t(lang, 'tut.progress')}
      >
        <span className="tut-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      {!compact && (
        <ol className="tut-step-chips" aria-label={t(lang, 'tut.stepList')}>
          {tutorial.steps.map((step, index) => {
            const status = progress.steps[step.id]?.status ?? 'NOT_STARTED';
            const current = progress.currentStepId === step.id;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  className={`tut-chip status-${status.toLowerCase()}${current ? ' current' : ''}`}
                  onClick={() => onSelectStep?.(step.id)}
                  aria-current={current ? 'step' : undefined}
                  aria-label={`${index + 1}. ${t(lang, 'tut.step')} — ${stepStatusText(lang, status)}`}
                  data-testid={`tut-chip-${step.id}`}
                >
                  <span className="tut-chip-glyph" aria-hidden>{stepStatusGlyph(status)}</span>
                  <span className="tut-chip-index">{index + 1}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
