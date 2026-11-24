import type { Lang } from '../../types';
import { t } from '../../lib/i18n';
import { lt } from '../../lib/localized';
import { fmt, fmtInt } from '../../lib/format';
import { findHelp } from '../../help/registry';
import { findSample } from '../../samples/registry';
import { tutorialText } from '../../tutorials/localize';
import { TUTORIALS } from '../../tutorials/registry';
import type { Tutorial } from '../../tutorials/types';
import type { TutorialSummaryData } from '../../tutorials/tutorialEngine';

/* ─────────────────────────────────────────────────────────────────────────
   Completion summary (WO-T09)
   What was done, what was verified and what was only read — and the line that
   keeps a lesson from being sold as a certificate.
   ───────────────────────────────────────────────────────────────────────── */

interface Props {
  lang: Lang;
  tutorial: Tutorial;
  summary: TutorialSummaryData;
  onReview: () => void;
  onRestart: () => void;
  onSavePractice: () => void;
  onExportPractice: () => void;
  onNextTutorial: (tutorialId: string) => void;
  onExit: () => void;
}

function duration(lang: Lang, ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return lang === 'ko' ? `${minutes}분 ${seconds}초` : `${minutes} min ${seconds} s`;
}

export function TutorialSummary({ lang, tutorial, summary, onReview, onRestart, onSavePractice, onExportPractice, onNextTutorial, onExit }: Props) {
  const next = tutorial.nextTutorialId ? TUTORIALS.find((candidate) => candidate.id === tutorial.nextTutorialId) : undefined;
  const helpDocs = tutorial.helpIds.map((id) => findHelp(id)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return (
    <section className="tut-summary" data-testid="tutorial-summary">
      <header>
        <div className="mono-note">{t(lang, 'tut.summaryKicker')}</div>
        <h2>{tutorialText(lang, tutorial.titleKey)}</h2>
        <p>{tutorialText(lang, tutorial.descriptionKey)}</p>
        {/* WO-TQA-10: finishing by skipping is not the same as finishing the practice. */}
        <p
          className={`tut-completion${summary.completion === 'skipped' ? ' warn' : ''}`}
          data-testid="tut-completion"
          data-completion={summary.completion}
        >
          {summary.completion === 'verified' && t(lang, 'tut.completionVerified')}
          {summary.completion === 'manual' && t(lang, 'tut.completionManual')}
          {summary.completion === 'skipped' && t(lang, 'tut.completionSkipped')}
          {summary.completion === 'unfinished' && t(lang, 'tut.completionUnfinished')}
        </p>
      </header>

      <div className="tut-summary-stats">
        <div><span>{summary.completed}/{summary.totalSteps}</span><small>{t(lang, 'tut.stepsDone')}</small></div>
        <div><span>{summary.validated}</span><small>{t(lang, 'tut.validatedMode')}</small></div>
        <div><span>{summary.manual}</span><small>{t(lang, 'tut.manualMode')}</small></div>
        <div><span>{summary.skipped}</span><small>{t(lang, 'tut.skipped')}</small></div>
        <div><span>{duration(lang, summary.durationMs)}</span><small>{t(lang, 'tut.duration')}</small></div>
      </div>

      <div className="tut-summary-grid">
        <section>
          <h5>{t(lang, 'tut.datasetsUsed')}</h5>
          <ul>
            {summary.sampleIds.map((id) => {
              const sample = findSample(id);
              return <li key={id}>{sample ? lt(lang, sample.title) : id}</li>;
            })}
            {!summary.sampleIds.length && <li className="mono-note">—</li>}
          </ul>
        </section>
        <section>
          <h5>{t(lang, 'tut.analysesRun')}</h5>
          <ul>
            {summary.analyses.map((id) => <li key={id}>{t(lang, `an.${id}`) || id}</li>)}
            {!summary.analyses.length && <li className="mono-note">—</li>}
          </ul>
        </section>
        <section>
          <h5>{t(lang, 'tut.concepts')}</h5>
          <ul>
            {summary.conceptKeys.map((key) => <li key={key}>{tutorialText(lang, key)}</li>)}
          </ul>
        </section>
        <section>
          <h5>{t(lang, 'tut.helpRead')}</h5>
          <ul>
            {helpDocs.map((entry) => <li key={entry.id}>{lt(lang, entry.title)}</li>)}
            {!helpDocs.length && <li className="mono-note">—</li>}
          </ul>
        </section>
      </div>

      {(summary.models.length > 0 || summary.optimizer) && (
        <section className="tut-summary-results">
          <h5>{t(lang, 'tut.keyResults')}</h5>
          {summary.models.length > 0 && (
            <table className="stat-table">
              <thead><tr><th>{t(lang, 'tut.modelName')}</th><th>{t(lang, 'tut.response')}</th><th className="al-r">R²</th></tr></thead>
              <tbody>
                {summary.models.map((model) => (
                  <tr key={model.name}>
                    <td>{model.name}</td>
                    <td>{model.response}</td>
                    <td className="al-r">{model.r2 === null ? '—' : fmt(model.r2, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {summary.optimizer && (
            <div className="tut-summary-opt" data-testid="tut-summary-optimizer">
              <div className="mono-note">{t(lang, 'tut.optimizer')} · {summary.optimizer.status} · {t(lang, 'tut.composite')} {fmt(summary.optimizer.composite, 4)}</div>
              <table className="stat-table">
                <thead><tr><th>{t(lang, 'tut.response')}</th><th className="al-r">{t(lang, 'tut.predicted')}</th></tr></thead>
                <tbody>
                  {summary.optimizer.predictions.map((prediction) => (
                    <tr key={prediction.name}>
                      <td>{prediction.name}</td>
                      <td className="al-r">{prediction.value === null ? '—' : fmt(prediction.value, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <p className="tut-disclaimer" data-testid="tut-disclaimer">{t(lang, 'tut.disclaimer')}</p>

      <div className="tut-summary-actions">
        <button type="button" className="btn" onClick={onReview} data-testid="tut-review">{t(lang, 'tut.reviewSteps')}</button>
        <button type="button" className="btn" onClick={onRestart} data-testid="tut-restart">{t(lang, 'tut.restart')}</button>
        <button type="button" className="btn" onClick={onSavePractice} data-testid="tut-save-practice">{t(lang, 'tut.saveProject')}</button>
        <button type="button" className="btn" onClick={onExportPractice} data-testid="tut-export-practice">{t(lang, 'tut.exportProject')}</button>
        {next && (
          <button type="button" className="btn primary" onClick={() => onNextTutorial(next.id)} data-testid="tut-next-tutorial">
            {t(lang, 'tut.nextTutorial')} · {tutorialText(lang, next.titleKey)}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onExit} data-testid="tut-exit-summary">{t(lang, 'tut.exitPractice')}</button>
      </div>
      <p className="mono-note">{fmtInt(summary.totalSteps)} {t(lang, 'tut.steps')}</p>
    </section>
  );
}
