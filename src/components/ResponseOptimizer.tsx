import { useMemo, useRef, useState } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { fmt } from '../lib/format';
import type { StoredModel } from '../lib/modelStore';
import {
  DEFAULT_OPTIMIZER_SETTINGS,
  FACTOR_KINDS,
  OPTIMIZER_METHODS,
  RESPONSE_GOALS,
  type FactorKind,
  type FactorSettings,
  type OptimizerResult,
  type OptimizerSettings,
  type ResponseGoal,
  type ResponseSettings,
} from '../lib/optimizationTypes';
import {
  defaultFactorSettings,
  defaultResponseSettings,
  optimize,
  responseProblems,
  sharedFactorNames,
  suggestResponseLimits,
} from '../lib/optimizer';
import { responseLimits } from '../lib/desirability';

/* ─────────────────────────────────────────────────────────────────────────
   The response optimiser window (WO-05).

   Three tables, one button. The reader states what each response should do, how
   far each factor may move, and how hard the engine may look; the answer is the
   best condition found, every response's prediction with its intervals and its
   own desirability, and the runner-ups.

   The window never claims more than the search proved: the status badge says
   "best found" unless the space was enumerated or a local search converged, and
   a condition that leaves the fitted region is flagged where it is shown.
   ───────────────────────────────────────────────────────────────────────── */

interface Props {
  lang: Lang;
  models: StoredModel[];
  onClose: () => void;
  /** Hand the result to the workspace as an output card. */
  onInsert: (payload: { result: OptimizerResult; responses: ResponseSettings[]; factors: FactorSettings[]; models: StoredModel[] }) => void;
  /** Open the prediction profiler at a condition (the best one by default). */
  onProfiler: (payload: {
    result: OptimizerResult;
    responses: ResponseSettings[];
    factors: FactorSettings[];
    models: StoredModel[];
  }) => void;
}

function numberInput(value: number | null, onChange: (next: number | null) => void, extra: { testid?: string; placeholder?: string } = {}) {
  return (
    <input
      className="text-input num-input"
      inputMode="decimal"
      value={value === null ? '' : String(value)}
      placeholder={extra.placeholder ?? ''}
      data-testid={extra.testid}
      onChange={(event) => {
        const text = event.target.value.trim();
        if (!text) { onChange(null); return; }
        const parsed = Number(text);
        onChange(Number.isFinite(parsed) ? parsed : null);
      }}
    />
  );
}

function statusTone(status: OptimizerResult['status']): 'ok' | 'warn' | 'bad' | 'muted' {
  if (status === 'optimal') return 'ok';
  if (status === 'best-found' || status === 'limit') return 'warn';
  if (status === 'no-feasible') return 'bad';
  return 'muted';
}

export function ResponseOptimizer({ lang, models, onClose, onInsert, onProfiler }: Props) {
  const factorNames = useMemo(() => sharedFactorNames(models), [models]);
  const initialFactors = useMemo(() => factorNames.map((name) => defaultFactorSettings(models, name)), [models, factorNames]);
  const initialResponses = useMemo(
    () => suggestResponseLimits(models, models.map((model) => defaultResponseSettings(model)), initialFactors),
    [models, initialFactors],
  );
  const [responses, setResponses] = useState<ResponseSettings[]>(initialResponses);
  const [factors, setFactors] = useState<FactorSettings[]>(initialFactors);
  const [settings, setSettings] = useState<OptimizerSettings>(DEFAULT_OPTIMIZER_SETTINGS);
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [running, setRunning] = useState(false);
  const runToken = useRef(0);

  const problems = useMemo(() => responseProblems(responses), [responses]);
  const canRun = models.length > 0 && factorNames.length > 0 && !running;

  const patchResponse = (modelId: string, patch: Partial<ResponseSettings>) => {
    setResponses((prev) => prev.map((response) => (response.modelId === modelId ? { ...response, ...patch } : response)));
    setResult(null);
  };

  const patchFactor = (name: string, patch: Partial<FactorSettings>) => {
    setFactors((prev) => prev.map((factor) => (factor.name === name ? { ...factor, ...patch } : factor)));
    setResult(null);
  };

  const run = () => {
    const token = runToken.current + 1;
    runToken.current = token;
    setRunning(true);
    setResult(null);
    // A short delay lets the button paint its running state before the search
    // takes the main thread; the searches themselves stay well under a second.
    window.setTimeout(() => {
      if (runToken.current !== token) return;
      try {
        const next = optimize(models, responses, factors, settings);
        setResult(next);
      } catch (error) {
        setResult({
          status: 'invalid',
          method: settings.method,
          resolvedMethod: settings.method === 'auto' ? 'multistart' : settings.method,
          seed: settings.seed,
          solutions: [],
          evaluations: 0,
          iterations: 0,
          elapsedMs: 0,
          warnings: [],
          issues: [error instanceof Error ? error.message : 'opt.issue.noResponse'],
        });
      } finally {
        if (runToken.current === token) setRunning(false);
      }
    }, 30);
  };

  const resetAll = () => {
    setResponses(initialResponses);
    setFactors(initialFactors);
    setSettings(DEFAULT_OPTIMIZER_SETTINGS);
    setResult(null);
  };

  const best = result?.solutions[0] ?? null;
  const payload = () => ({ result: result as OptimizerResult, responses, factors, models });

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal optimizer" role="dialog" aria-modal="true" aria-label={t(lang, 'opt.title')} data-testid="optimizer">
        <div className="modal-head">
          <div>
            <h3>{t(lang, 'opt.title')}</h3>
            <div className="modal-sub">{t(lang, 'opt.subtitle', { responses: models.length, factors: factorNames.length })}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose} data-testid="opt-close">{t(lang, 'ct.close')}</button>
        </div>

        <div className="modal-body opt-body">
          <section className="opt-section" data-testid="opt-responses">
            <h5>{t(lang, 'opt.tab.responses')}</h5>
            <table className="stat-table opt-table">
              <thead>
                <tr>
                  <th>{t(lang, 'opt.col.response')}</th>
                  <th>{t(lang, 'opt.col.goal')}</th>
                  <th className="al-r">{t(lang, 'opt.col.lower')}</th>
                  <th className="al-r">{t(lang, 'opt.col.upper')}</th>
                  <th className="al-r">{t(lang, 'opt.col.target')}</th>
                  <th className="al-r">{t(lang, 'opt.col.weight')}</th>
                  <th className="al-r">{t(lang, 'opt.col.importance')}</th>
                </tr>
              </thead>
              <tbody>
                {responses.map((response) => {
                  const issues = problems[response.modelId] ?? [];
                  const limits = responseLimits(response);
                  return (
                    <tr key={response.modelId} data-testid="opt-response-row" data-model-id={response.modelId}>
                      <td>
                        <div className="opt-name">{response.name}</div>
                        {issues.length > 0 && (
                          <div className="opt-issue" data-testid={`opt-response-issue-${response.modelId}`}>
                            {issues.map((code) => t(lang, code)).join(' · ')}
                          </div>
                        )}
                        {limits && response.goal === 'target' && (
                          <div className="mono-note">{fmt(limits.lower, 4)} … {fmt(limits.upper, 4)}</div>
                        )}
                      </td>
                      <td>
                        <select
                          value={response.goal}
                          onChange={(event) => patchResponse(response.modelId, { goal: event.target.value as ResponseGoal })}
                          data-testid={`opt-goal-${response.modelId}`}
                        >
                          {RESPONSE_GOALS.map((goal) => (
                            <option key={goal} value={goal}>{t(lang, `opt.goal.${goal}`)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="al-r">{numberInput(response.lower, (next) => patchResponse(response.modelId, { lower: next }), { testid: `opt-lower-${response.modelId}` })}</td>
                      <td className="al-r">{numberInput(response.upper, (next) => patchResponse(response.modelId, { upper: next }), { testid: `opt-upper-${response.modelId}` })}</td>
                      <td className="al-r">{numberInput(response.target, (next) => patchResponse(response.modelId, { target: next }), { testid: `opt-target-${response.modelId}` })}</td>
                      <td className="al-r">{numberInput(response.weight, (next) => patchResponse(response.modelId, { weight: next ?? 1 }), { testid: `opt-weight-${response.modelId}` })}</td>
                      <td className="al-r">{numberInput(response.importance, (next) => patchResponse(response.modelId, { importance: next ?? 1 }), { testid: `opt-importance-${response.modelId}` })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="opt-section" data-testid="opt-factors">
            <h5>{t(lang, 'opt.tab.factors')}</h5>
            <table className="stat-table opt-table">
              <thead>
                <tr>
                  <th>{t(lang, 'opt.col.factor')}</th>
                  <th>{t(lang, 'opt.col.kind')}</th>
                  <th className="al-r">{t(lang, 'opt.col.lower')}</th>
                  <th className="al-r">{t(lang, 'opt.col.upper')}</th>
                  <th className="al-r">{t(lang, 'opt.col.step')}</th>
                  <th>{t(lang, 'opt.col.fixed')}</th>
                  <th className="al-r">{t(lang, 'opt.col.value')}</th>
                </tr>
              </thead>
              <tbody>
                {factors.map((factor) => (
                  <tr key={factor.name} data-testid="opt-factor-row" data-factor={factor.name}>
                    <td className="opt-name">{factor.name}</td>
                    <td>
                      <select
                        value={factor.kind}
                        onChange={(event) => patchFactor(factor.name, { kind: event.target.value as FactorKind })}
                        data-testid={`opt-kind-${factor.name}`}
                      >
                        {FACTOR_KINDS.map((kind) => (
                          <option key={kind} value={kind} disabled={kind === 'categorical' && factor.levels.length === 0}>
                            {t(lang, `opt.kind.${kind}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="al-r">
                      {factor.kind === 'categorical'
                        ? <span className="mono-note">{factor.levels.length}</span>
                        : numberInput(factor.lower, (next) => patchFactor(factor.name, { lower: next ?? factor.lower }), { testid: `opt-factor-lower-${factor.name}` })}
                    </td>
                    <td className="al-r">
                      {factor.kind === 'categorical'
                        ? <span className="mono-note">—</span>
                        : numberInput(factor.upper, (next) => patchFactor(factor.name, { upper: next ?? factor.upper }), { testid: `opt-factor-upper-${factor.name}` })}
                    </td>
                    <td className="al-r">
                      {factor.kind === 'discrete'
                        ? numberInput(factor.step, (next) => patchFactor(factor.name, { step: next ?? factor.step }), { testid: `opt-factor-step-${factor.name}` })
                        : <span className="mono-note">—</span>}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={factor.fixed}
                        onChange={(event) => patchFactor(factor.name, { fixed: event.target.checked })}
                        aria-label={t(lang, 'opt.col.fixed')}
                        data-testid={`opt-factor-fixed-${factor.name}`}
                      />
                    </td>
                    <td className="al-r">
                      {factor.fixed && (
                        factor.kind === 'categorical'
                          ? (
                            <select
                              value={String(factor.fixedValue)}
                              onChange={(event) => patchFactor(factor.name, { fixedValue: event.target.value })}
                              data-testid={`opt-factor-value-${factor.name}`}
                            >
                              {factor.levels.map((level) => <option key={level} value={level}>{level}</option>)}
                            </select>
                          )
                          : numberInput(Number(factor.fixedValue), (next) => patchFactor(factor.name, { fixedValue: next ?? 0 }), { testid: `opt-factor-value-${factor.name}` })
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="opt-section opt-search" data-testid="opt-search">
            <h5>{t(lang, 'opt.tab.search')}</h5>
            <label className="opt-field">
              <span>{t(lang, 'opt.search.method')}</span>
              <select
                value={settings.method}
                onChange={(event) => { setSettings({ ...settings, method: event.target.value as OptimizerSettings['method'] }); setResult(null); }}
                data-testid="opt-method"
              >
                {OPTIMIZER_METHODS.map((method) => (
                  <option key={method} value={method}>{t(lang, `opt.method.${method}`)}</option>
                ))}
              </select>
            </label>
            <label className="opt-field">
              <span>{t(lang, 'opt.search.seed')}</span>
              <input
                className="text-input num-input"
                inputMode="numeric"
                value={String(settings.seed)}
                onChange={(event) => { const value = Number(event.target.value); setSettings({ ...settings, seed: Number.isFinite(value) ? value : 0 }); setResult(null); }}
                data-testid="opt-seed"
              />
            </label>
            <label className="opt-field">
              <span>{t(lang, 'opt.search.grid')}</span>
              <input
                className="text-input num-input"
                inputMode="numeric"
                value={String(settings.gridPoints)}
                onChange={(event) => { const value = Number(event.target.value); setSettings({ ...settings, gridPoints: Number.isFinite(value) ? Math.max(2, Math.min(201, value)) : 21 }); setResult(null); }}
                data-testid="opt-grid"
              />
            </label>
            <label className="opt-field">
              <span>{t(lang, 'opt.search.topN')}</span>
              <input
                className="text-input num-input"
                inputMode="numeric"
                value={String(settings.topN)}
                onChange={(event) => { const value = Number(event.target.value); setSettings({ ...settings, topN: Number.isFinite(value) ? Math.max(1, Math.min(20, value)) : 5 }); setResult(null); }}
                data-testid="opt-topn"
              />
            </label>
            <button type="button" className="btn primary" onClick={run} disabled={!canRun} data-testid="opt-run">
              {running ? t(lang, 'opt.running') : t(lang, 'opt.run')}
            </button>
            <button type="button" className="btn ghost" onClick={resetAll} data-testid="opt-reset">{t(lang, 'opt.reset')}</button>
          </section>

          {result && (
            <section className="opt-result" data-testid="opt-result" data-status={result.status}>
              <div className="opt-result-head">
                <span className={`opt-badge ${statusTone(result.status)}`} data-testid="opt-status">{t(lang, `opt.status.${result.status}`)}</span>
                <span className="mono-note" data-testid="opt-method-used">
                  {t(lang, `opt.method.${result.resolvedMethod}`)} · {t(lang, 'opt.result.evaluations', { n: result.evaluations })} · {t(lang, 'opt.result.elapsed', { ms: Math.round(result.elapsedMs) })}
                </span>
                <span className="spacer" />
                {best && (
                  <>
                    <button type="button" className="btn" onClick={() => onInsert(payload())} data-testid="opt-to-output">{t(lang, 'opt.result.addOutput')}</button>
                    <button type="button" className="btn primary" onClick={() => onProfiler(payload())} data-testid="opt-to-profiler">{t(lang, 'opt.result.openProfiler')}</button>
                  </>
                )}
              </div>

              {result.issues.length > 0 && (
                <div className="opt-warn" data-testid="opt-issues">
                  {result.issues.map((code) => t(lang, code)).join(' · ')}
                </div>
              )}
              {result.warnings.length > 0 && (
                <div className="opt-warn" data-testid="opt-warnings">
                  {result.warnings.map((code) => t(lang, code)).join(' · ')}
                </div>
              )}

              {best && (
                <>
                  <div className="opt-composite">
                    <span>{t(lang, 'opt.result.composite')}</span>
                    <b data-testid="opt-composite">{best.composite.toFixed(4)}</b>
                    <span className={`opt-badge ${best.compliantAll ? 'ok' : 'bad'}`} data-testid="opt-compliant">
                      {best.compliantAll ? t(lang, 'opt.result.specOk') : t(lang, 'opt.result.specNo')}
                    </span>
                    {best.extrapolated && <span className="opt-badge warn" data-testid="opt-extrapolated">{t(lang, 'opt.warn.extrapolated')}</span>}
                  </div>

                  <h6>{t(lang, 'opt.result.conditions')}</h6>
                  <table className="stat-table" data-testid="opt-conditions">
                    <thead>
                      <tr>
                        <th>{t(lang, 'opt.col.factor')}</th>
                        <th className="al-r">{t(lang, 'opt.result.value')}</th>
                        <th className="al-r">{t(lang, 'opt.result.coded')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {factors.map((factor) => (
                        <tr key={factor.name} data-testid="opt-condition-row" data-factor={factor.name}>
                          <td>{factor.name}</td>
                          <td className="al-r">{typeof best.settings[factor.name] === 'number' ? fmt(best.settings[factor.name] as number, 5) : String(best.settings[factor.name] ?? '—')}</td>
                          <td className="al-r">{Number.isFinite(best.coded[factor.name]) ? fmt(best.coded[factor.name], 4) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <h6>{t(lang, 'opt.result.predictions')}</h6>
                  <table className="stat-table" data-testid="opt-predictions">
                    <thead>
                      <tr>
                        <th>{t(lang, 'opt.col.response')}</th>
                        <th className="al-r">{t(lang, 'opt.result.predicted')}</th>
                        <th className="al-r">{t(lang, 'opt.result.se')}</th>
                        <th className="al-r">{t(lang, 'opt.result.ci')}</th>
                        <th className="al-r">{t(lang, 'opt.result.pi')}</th>
                        <th className="al-r">{t(lang, 'opt.result.desirability')}</th>
                        <th>{t(lang, 'opt.result.spec')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {best.responses.map((response) => (
                        <tr key={response.modelId} data-testid="opt-prediction-row" data-model-id={response.modelId}>
                          <td>{response.name}</td>
                          <td className="al-r">{response.value === null ? t(lang, 'opt.notEstimable') : fmt(response.value, 5)}</td>
                          <td className="al-r">{response.se === null ? '—' : fmt(response.se, 5)}</td>
                          <td className="al-r">{response.ci ? `${fmt(response.ci[0], 4)} … ${fmt(response.ci[1], 4)}` : '—'}</td>
                          <td className="al-r">{response.pi ? `${fmt(response.pi[0], 4)} … ${fmt(response.pi[1], 4)}` : '—'}</td>
                          <td className="al-r" data-testid="opt-desirability">{response.desirability.toFixed(4)}</td>
                          <td>
                            <span className={`opt-badge ${response.compliant ? 'ok' : 'bad'}`}>
                              {response.compliant ? t(lang, 'opt.result.specOk') : t(lang, 'opt.result.specNo')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {result.solutions.length > 1 && (
                    <>
                      <h6>{t(lang, 'opt.result.alternatives', { n: result.solutions.length })}</h6>
                      <table className="stat-table" data-testid="opt-alternatives">
                        <thead>
                          <tr>
                            <th>#</th>
                            {factors.map((factor) => <th key={factor.name} className="al-r">{factor.name}</th>)}
                            <th className="al-r">{t(lang, 'opt.result.composite')}</th>
                            <th>{t(lang, 'opt.result.spec')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.solutions.map((solution, index) => (
                            <tr key={index} data-testid="opt-alternative-row">
                              <td>{index + 1}</td>
                              {factors.map((factor) => (
                                <td key={factor.name} className="al-r">
                                  {typeof solution.settings[factor.name] === 'number' ? fmt(solution.settings[factor.name] as number, 4) : String(solution.settings[factor.name] ?? '—')}
                                </td>
                              ))}
                              <td className="al-r">{solution.composite.toFixed(4)}</td>
                              <td>{solution.compliantAll ? t(lang, 'opt.result.specOk') : t(lang, 'opt.result.specNo')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        <div className="modal-foot">
          <span className="mono-note">{t(lang, 'opt.note')}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose} data-testid="opt-done">{t(lang, 'ct.close')}</button>
        </div>
      </div>
    </div>
  );
}
