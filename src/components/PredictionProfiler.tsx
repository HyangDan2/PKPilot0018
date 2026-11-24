import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { fmt } from '../lib/format';
import type { StoredModel } from '../lib/modelStore';
import type { FactorSettings, ResponseSettings, Solution } from '../lib/optimizationTypes';
import { optimizeAsync } from '../lib/optimizer';
import { responseLimits } from '../lib/desirability';
import { centrePoint, normaliseValue, profileCurves, profilePoint } from '../lib/profiler';

/* ─────────────────────────────────────────────────────────────────────────
   The prediction profiler window (WO-06).

   One column per factor, one row per response. Each cell is the response
   plotted against that factor with every other factor held at its current
   value, so the reader can see one axis move while the rest of the world stays
   still. The column header carries the factor's slider and its typed value; the
   last column is the answer at right: the prediction, its interval and how
   desirable it is.

   Only the condition changes between renders — never the models — and a
   keystroke is debounced before it is scored, so dragging a slider does not
   rebuild every curve for every intermediate pixel of the drag.
   ───────────────────────────────────────────────────────────────────────── */

interface Props {
  lang: Lang;
  models: StoredModel[];
  responses: ResponseSettings[];
  factors: FactorSettings[];
  /** The condition to open at (the optimiser's best point, or the centre). */
  initialPoint?: Record<string, number | string> | null;
  onClose: () => void;
  /** Save the current condition into the workspace. */
  onSave: (payload: { point: Record<string, number | string>; solution: Solution | null; responses: ResponseSettings[]; factors: FactorSettings[] }) => void;
}

const CURVE_W = 148;
const CURVE_H = 66;
const DEBOUNCE_MS = 40;

export function PredictionProfiler({ lang, models, responses, factors, initialPoint, onClose, onSave }: Props) {
  const start = useMemo(() => {
    const centre = centrePoint(factors);
    const merged: Record<string, number | string> = { ...centre };
    if (initialPoint) {
      factors.forEach((factor) => {
        const value = initialPoint[factor.name];
        if (value !== undefined) merged[factor.name] = normaliseValue(factor, value);
      });
    }
    return merged;
    // The opening condition is computed once per mount of this window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [values, setValues] = useState<Record<string, number | string>>(start);
  const [applied, setApplied] = useState<Record<string, number | string>>(start);
  const [showBands, setShowBands] = useState(true);
  const [optimizeNote, setOptimizeNote] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // Debounce: the curves follow the slider a tick after the last movement.
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setApplied(values), DEBOUNCE_MS);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [values]);

  const rows = useMemo(
    () => profileCurves(models, responses, factors, applied, { resolution: 21 }),
    [models, responses, factors, applied],
  );
  const solution = useMemo(() => profilePoint(models, responses, factors, applied), [models, responses, factors, applied]);

  const setValue = (factor: FactorSettings, value: number | string) => {
    setValues((prev) => ({ ...prev, [factor.name]: normaliseValue(factor, value) }));
  };

  const reset = () => {
    setValues(centrePoint(factors));
    setApplied(centrePoint(factors));
    setOptimizeNote(null);
  };

  const doOptimize = () => {
    void (async () => {
      const result = await optimizeAsync(models, responses, factors, { method: 'auto', topN: 1 });
      const best = result.solutions[0];
      if (!best) return;
      const next: Record<string, number | string> = {};
      factors.forEach((factor) => {
        const value = best.settings[factor.name];
        if (value !== undefined) next[factor.name] = normaliseValue(factor, value);
      });
      setValues((prev) => ({ ...prev, ...next }));
      // The condition is adopted so the reader can see it, but a search that
      // missed a specification is labelled where it is shown (Stage 3C).
      setOptimizeNote(result.recommended ? null : 'opt.result.notRecommended');
    })();
  };

  const specFor = (modelId: string): { lower: number | null; upper: number | null; target: number | null } => {
    const settings = responses.find((response) => response.modelId === modelId);
    if (!settings) return { lower: null, upper: null, target: null };
    const limits = responseLimits(settings);
    return { lower: limits?.lower ?? null, upper: limits?.upper ?? null, target: limits?.target ?? settings.target };
  };

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal profiler" role="dialog" aria-modal="true" aria-label={t(lang, 'prof.title')} data-testid="profiler">
        <div className="modal-head">
          <div>
            <h3>{t(lang, 'prof.title')}</h3>
            <div className="modal-sub">{t(lang, 'prof.subtitle', { responses: models.length, factors: factors.length })}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose} data-testid="prof-close">{t(lang, 'ct.close')}</button>
        </div>

        <div className="modal-body prof-body">
          <div className="prof-controls" data-testid="prof-controls">
            <button type="button" className="btn primary" onClick={doOptimize} data-testid="prof-optimize">{t(lang, 'prof.optimize')}</button>
            <button type="button" className="btn ghost" onClick={reset} data-testid="prof-reset">{t(lang, 'prof.reset')}</button>
            <label className="prof-toggle">
              <input type="checkbox" checked={showBands} onChange={(event) => setShowBands(event.target.checked)} data-testid="prof-bands" />
              <span>{t(lang, 'prof.bands')}</span>
            </label>
            <span className="spacer" />
            <span className="opt-badge muted" data-testid="prof-composite">
              {t(lang, 'prof.composite')} <b>{solution ? solution.composite.toFixed(4) : '—'}</b>
            </span>
            <button type="button" className="btn" onClick={() => onSave({ point: applied, solution, responses, factors })} data-testid="prof-save">
              {t(lang, 'prof.save')}
            </button>
          </div>

          <div className="prof-matrix" data-testid="prof-matrix" style={{ gridTemplateColumns: `140px repeat(${factors.length}, minmax(150px, 1fr)) 150px` }}>
            {/* Header row: one column per factor, with its slider and typed value. */}
            <div className="prof-cell prof-corner">{t(lang, 'prof.response')}</div>
            {factors.map((factor) => (
              <div className="prof-cell prof-head" key={factor.name} data-testid={`prof-head-${factor.name}`}>
                <div className="prof-head-name">
                  {factor.name}
                  {factor.fixed && <span className="mono-note"> · {t(lang, 'prof.fixed')}</span>}
                </div>
                {factor.kind === 'categorical' ? (
                  <select
                    value={String(values[factor.name] ?? '')}
                    onChange={(event) => setValue(factor, event.target.value)}
                    data-testid={`prof-select-${factor.name}`}
                  >
                    {factor.levels.map((level) => <option key={level} value={level}>{level}</option>)}
                  </select>
                ) : (
                  <>
                    <input
                      type="range"
                      min={factor.lower}
                      max={factor.upper}
                      step={factor.step > 0 ? factor.step : (factor.upper - factor.lower) / 100 || 0.001}
                      value={Number(values[factor.name] ?? factor.lower)}
                      onChange={(event) => setValue(factor, event.target.value)}
                      aria-label={factor.name}
                      data-testid={`prof-slider-${factor.name}`}
                    />
                    <input
                      className="text-input num-input prof-value"
                      inputMode="decimal"
                      value={displayValue(values[factor.name])}
                      onChange={(event) => {
                        const text = event.target.value.trim();
                        if (text === '') return;
                        const parsed = Number(text);
                        if (Number.isFinite(parsed)) setValue(factor, parsed);
                      }}
                      data-testid={`prof-value-${factor.name}`}
                    />
                  </>
                )}
              </div>
            ))}
            <div className="prof-cell prof-head prof-head-answer">{t(lang, 'prof.answer')}</div>

            {/* One row per response. */}
            {rows.map((row) => {
              const spec = specFor(row.modelId);
              return (
                <ProfilerRow
                  key={row.modelId}
                  lang={lang}
                  row={row}
                  factors={factors}
                  spec={spec}
                  showBands={showBands}
                  values={values}
                />
              );
            })}
          </div>

          {optimizeNote && (
            <div className="opt-warn" data-testid="prof-not-recommended">{t(lang, optimizeNote)}</div>
          )}
          <p className="mono-note prof-note">{t(lang, 'prof.note')}</p>
        </div>

        <div className="modal-foot">
          <span className="mono-note">{t(lang, 'prof.footnote')}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose} data-testid="prof-done">{t(lang, 'ct.close')}</button>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  lang: Lang;
  row: ReturnType<typeof profileCurves>[number];
  factors: FactorSettings[];
  spec: { lower: number | null; upper: number | null; target: number | null };
  showBands: boolean;
  values: Record<string, number | string>;
}

function ProfilerRow({ lang, row, factors, spec, showBands, values }: RowProps) {
  const prediction = row.prediction;
  return (
    <>
      <div className="prof-cell prof-rowlabel" data-testid="prof-row" data-model-id={row.modelId} data-blocked={row.blocked ? '1' : '0'}>
        <div className="opt-name">{row.responseName}</div>
        <div className="mono-note">
          {prediction?.value == null ? t(lang, 'opt.notEstimable') : fmt(prediction.value, 5)}
        </div>
        {row.issues.length > 0 && (
          <div className="opt-issue" data-testid={`prof-issue-${row.modelId}`}>
            {row.issues.map((code) => t(lang, code)).join(' · ')}
          </div>
        )}
      </div>
      {row.curves.map((curve, index) => {
        const factor = factors[index];
        const specValues = [spec.lower, spec.upper, spec.target].filter((value): value is number => value !== null && Number.isFinite(value));
        const all = [...curve.mean, ...(curve.ci ? [...curve.ci.lo, ...curve.ci.hi] : []), ...(curve.pi ? [...curve.pi.lo, ...curve.pi.hi] : []), ...specValues]
          .filter((value) => Number.isFinite(value));
        const yMin = all.length ? Math.min(...all) : 0;
        const yMax = all.length ? Math.max(...all) : 1;
        const pad = (yMax - yMin) * 0.06 || 1;
        return (
          <div className="prof-cell prof-plot" key={factor.name} data-testid={`prof-cell-${row.modelId}-${factor.name}`}>
            {row.blocked ? (
              <div className="prof-empty">{t(lang, 'opt.profile.blocked')}</div>
            ) : curve.xs.length < 2 || !all.length ? (
              <div className="prof-empty">{t(lang, 'prof.noCurve')}</div>
            ) : (
              <svg width={CURVE_W} height={CURVE_H} role="img" aria-label={`${row.responseName} × ${factor.name}`}>
                {showBands && curve.pi && row.interval.pi && (
                  <polygon
                    points={bandPoints(curve.xs, curve.pi.lo, curve.pi.hi, yMin - pad, yMax + pad)}
                    fill="var(--alarm, #b4690e)"
                    opacity="0.08"
                  />
                )}
                {showBands && curve.ci && (
                  <polygon
                    points={bandPoints(curve.xs, curve.ci.lo, curve.ci.hi, yMin - pad, yMax + pad)}
                    fill="var(--accent, #6b5bd2)"
                    opacity="0.14"
                  />
                )}
                {spec.lower !== null && (
                  <line x1={0} x2={CURVE_W} y1={py(spec.lower, yMin - pad, yMax + pad)} y2={py(spec.lower, yMin - pad, yMax + pad)} className="prof-spec" />
                )}
                {spec.upper !== null && (
                  <line x1={0} x2={CURVE_W} y1={py(spec.upper, yMin - pad, yMax + pad)} y2={py(spec.upper, yMin - pad, yMax + pad)} className="prof-spec" />
                )}
                {spec.target !== null && (
                  <line x1={0} x2={CURVE_W} y1={py(spec.target, yMin - pad, yMax + pad)} y2={py(spec.target, yMin - pad, yMax + pad)} className="prof-target" />
                )}
                <polyline
                  points={curve.xs.map((x, i) => `${px(x, curve.xs)} ${py(curve.mean[i], yMin - pad, yMax + pad)}`).join(' ')}
                  className="prof-mean"
                />
                {curve.current !== null && (
                  <line
                    x1={px(curve.current, curve.xs)}
                    x2={px(curve.current, curve.xs)}
                    y1={0}
                    y2={CURVE_H}
                    className="prof-current"
                    data-testid="prof-current-line"
                  />
                )}
              </svg>
            )}
            <div className="prof-axis mono-note">
              <span>{factor.kind === 'categorical' ? String(values[factor.name] ?? '') : fmt(factor.lower, 3)}</span>
              <span>{factor.kind === 'categorical' ? '' : fmt(factor.upper, 3)}</span>
            </div>
          </div>
        );
      })}
      <div className="prof-cell prof-answer" data-testid={`prof-answer-${row.modelId}`}>
        <div className="prof-answer-value">
          {prediction?.value == null ? t(lang, 'opt.notEstimable') : fmt(prediction.value, 5)}
        </div>
        <div className="prof-desirability">
          <span>{t(lang, 'opt.result.desirability')}</span>
          <b data-testid="prof-row-desirability">{prediction ? prediction.desirability.toFixed(4) : '—'}</b>
        </div>
        {prediction?.ci && <div className="mono-note">{t(lang, 'prof.ci')} {fmt(prediction.ci[0], 4)} … {fmt(prediction.ci[1], 4)}</div>}
        {prediction?.pi && <div className="mono-note">{t(lang, 'prof.pi')} {fmt(prediction.pi[0], 4)} … {fmt(prediction.pi[1], 4)}</div>}
        {prediction && !prediction.pi && row.interval.ci && <div className="mono-note">{t(lang, 'prof.pi')} {t(lang, 'model.cmp.unavailable')}</div>}
        {prediction && (
          <span className={`opt-badge ${prediction.compliant ? 'ok' : 'bad'}`}>
            {prediction.compliant ? t(lang, 'opt.result.specOk') : t(lang, 'opt.result.specNo')}
          </span>
        )}
      </div>
    </>
  );
}

/** A typed value as a person reads it: no 2.23777343750008 in the box. */
function displayValue(value: number | string | undefined): string {
  if (value === undefined) return '';
  if (typeof value !== 'number') return value;
  if (!Number.isFinite(value)) return '';
  return String(Number(value.toPrecision(6)));
}

function px(x: number, xs: number[]): number {
  const min = xs[0];
  const max = xs[xs.length - 1];
  const span = max - min || 1;
  return ((x - min) / span) * (CURVE_W - 6) + 3;
}

function py(y: number, lo: number, hi: number): number {
  const span = hi - lo || 1;
  return CURVE_H - 4 - ((y - lo) / span) * (CURVE_H - 8);
}

function bandPoints(xs: number[], lo: number[], hi: number[], yLo: number, yHi: number): string {
  const top = xs.map((x, i) => `${px(x, xs)} ${py(hi[i], yLo, yHi)}`);
  const bottom = xs.map((x, i) => `${px(x, xs)} ${py(lo[i], yLo, yHi)}`).reverse();
  return [...top, ...bottom].join(' ');
}
