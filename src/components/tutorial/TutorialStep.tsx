import { useState } from 'react';
import type { Lang } from '../../types';
import { t } from '../../lib/i18n';
import { lt } from '../../lib/localized';
import { TUTORIAL_ACTIONS } from '../../tutorials/actionRegistry';
import { findHelp } from '../../help/registry';
import { findPreset, presetShortLabel } from '../../tutorials/presets';
import { tutorialText } from '../../tutorials/localize';
import type { Tutorial, TutorialActionSpec, TutorialStep as Step, ValidationOutcome } from '../../tutorials/types';
import { stepStatusGlyph, stepStatusText } from './TutorialProgress';

/* ─────────────────────────────────────────────────────────────────────────
   One tutorial step (WO-T04 §6.3)
   The instruction, the expected result, the action button, the validation
   state and the previous/next controls, in the order a reader uses them.
   ───────────────────────────────────────────────────────────────────────── */

interface Props {
  lang: Lang;
  tutorial: Tutorial;
  step: Step;
  index: number;
  total: number;
  outcome?: ValidationOutcome;
  busy: boolean;
  canPrev: boolean;
  canNext: boolean;
  onAction: (spec: TutorialActionSpec) => void;
  onHelp: (helpId: string) => void;
  onManual: (done: boolean) => void;
  onSkip: () => void;
  onReopen: () => void;
  onPrev: () => void;
  onNext: () => void;
  onValidate: () => void;
}

function statusTone(outcome?: ValidationOutcome): 'pass' | 'pending' | 'fail' {
  return outcome?.status ?? 'pending';
}

export function TutorialStep({
  lang, step, index, total, outcome, busy, canPrev, canNext,
  onAction, onHelp, onManual, onSkip, onReopen, onPrev, onNext, onValidate,
}: Props) {
  const [hintOpen, setHintOpen] = useState(false);
  const status = outcome?.status ?? 'pending';
  const statusWord = step.completion === 'manual'
    ? (status === 'pass' ? stepStatusText(lang, 'COMPLETED') : stepStatusText(lang, 'IN_PROGRESS'))
    : status === 'pass' ? stepStatusText(lang, 'COMPLETED') : status === 'fail' ? stepStatusText(lang, 'FAILED') : stepStatusText(lang, 'IN_PROGRESS');
  const action = step.action;
  const definition = TUTORIAL_ACTIONS[action.action];
  const extraPresets = (action.presetIds ?? []).map((id) => findPreset(id)).filter((preset): preset is NonNullable<typeof preset> => Boolean(preset));
  const helpDoc = step.helpId ? findHelp(step.helpId) : undefined;

  return (
    <article className="tut-step" data-testid="tutorial-step" data-step-id={step.id} data-status={status}>
      <header className="tut-step-head">
        <span className="tut-step-index">{t(lang, 'tut.step')} {index + 1} / {total}</span>
        <span className={`tut-mode ${step.completion}`}>{step.completion === 'validated' ? t(lang, 'tut.validatedMode') : t(lang, 'tut.manualMode')}</span>
        <span className="spacer" />
        {step.optional && <span className="badge muted">{t(lang, 'tut.optional')}</span>}
      </header>

      <h3 className="tut-step-title" data-testid="tutorial-step-title">{tutorialText(lang, step.titleKey)}</h3>
      <p className="tut-instruction">{tutorialText(lang, step.instructionKey)}</p>

      <div className="tut-expected">
        <span className="tut-label">{t(lang, 'tut.expected')}</span>
        <p>{tutorialText(lang, step.expectedKey)}</p>
      </div>

      {step.hintKey && (
        <div className="tut-hint">
          <button type="button" className="link-btn" aria-expanded={hintOpen} onClick={() => setHintOpen((value) => !value)} data-testid="tut-hint-toggle">
            {hintOpen ? t(lang, 'tut.hideHint') : t(lang, 'tut.showHint')}
          </button>
          {hintOpen && <p data-testid="tut-hint">{tutorialText(lang, step.hintKey)}</p>}
        </div>
      )}

      <div className="tut-actions">
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => onAction(action)}
          data-testid={`tut-action-${action.action}`}
        >
          {t(lang, definition?.labelKey ?? 'tut.action.validate-result')}
        </button>
        {extraPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="btn tiny"
            disabled={busy}
            onClick={() => onAction({ action: 'open-analysis', analysisId: preset.analysisId, presetId: preset.id })}
            data-testid={`tut-preset-${preset.id}`}
          >
            {presetShortLabel(preset)}
          </button>
        ))}
        {helpDoc && (
          <button type="button" className="link-btn" onClick={() => onHelp(helpDoc.id)} data-testid="tut-help-link">
            {t(lang, 'tut.relatedHelp')} · {lt(lang, helpDoc.title)}
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn tiny ghost" disabled={busy} onClick={onValidate} data-testid="tut-recheck">
          {t(lang, 'tut.recheck')}
        </button>
      </div>

      <div className={`tut-status toned-${statusTone(outcome)}`} role="status" data-testid="tut-status">
        <span className="tut-status-glyph" aria-hidden>{stepStatusGlyph(status === 'pass' ? 'COMPLETED' : status === 'fail' ? 'FAILED' : 'IN_PROGRESS')}</span>
        <div>
          <b>{statusWord}</b>
          {outcome?.detail && <p>{lt(lang, outcome.detail)}</p>}
          {outcome?.evidence && <EvidenceList evidence={outcome.evidence} />}
          {step.completion === 'manual' && <p className="mono-note">{t(lang, 'tut.manualNote')}</p>}
        </div>
      </div>

      {step.completion === 'manual' && (
        <div className="tut-manual">
          <button type="button" className="btn tiny" onClick={() => onManual(true)} data-testid="tut-manual-complete">{t(lang, 'tut.markComplete')}</button>
          <button type="button" className="btn tiny ghost" onClick={() => onManual(false)} data-testid="tut-manual-incomplete">{t(lang, 'tut.markIncomplete')}</button>
        </div>
      )}

      <nav className="tut-nav" aria-label={t(lang, 'tut.stepNav')}>
        <button type="button" className="btn tiny" onClick={onPrev} disabled={!canPrev} data-testid="tut-prev">← {t(lang, 'tut.prev')}</button>
        <button type="button" className="btn tiny ghost" onClick={onSkip} data-testid="tut-skip">{t(lang, 'tut.skip')}</button>
        <button type="button" className="btn tiny ghost" onClick={onReopen} data-testid="tut-reopen">{t(lang, 'tut.reopen')}</button>
        <span className="spacer" />
        <button type="button" className="btn tiny" onClick={onNext} disabled={!canNext} data-testid="tut-next">{t(lang, 'tut.next')} →</button>
      </nav>
    </article>
  );
}

function EvidenceList({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).filter(([, value]) => value !== undefined && value !== null && typeof value !== 'object');
  if (!entries.length) return null;
  return (
    <ul className="tut-evidence">
      {entries.slice(0, 4).map(([key, value]) => (
        <li key={key}><span className="mono-note">{key}</span> {typeof value === 'number' ? Number(value.toPrecision(6)) : String(value)}</li>
      ))}
    </ul>
  );
}
