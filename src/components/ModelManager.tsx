import { useMemo, useState } from 'react';
import type { Lang, Worksheet } from '../types';
import { t } from '../lib/i18n';
import { fmt, fmtInt } from '../lib/format';
import {
  checkCompatibility,
  modelSurface,
  predictStoredModel,
  structureIssues,
  type InputMode,
  type PredictionResult,
} from '../lib/modelPredictor';
import {
  compareStoredModels,
  modelStaleness,
  type StoredModel,
} from '../lib/modelStore';

interface Props {
  lang: Lang;
  models: StoredModel[];
  worksheets: Worksheet[];
  activeSheetId: string;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRefit: (id: string) => void;
  onContour: (model: StoredModel) => void;
}

interface PredictionState {
  mode: InputMode;
  values: Record<string, string>;
  result: PredictionResult | null;
}

const NO_PREDICTION: PredictionState = { mode: 'actual', values: {}, result: null };

function kindLabel(lang: Lang, kind: StoredModel['kind']): string {
  return t(lang, `model.kind.${kind}`);
}

function staleLabel(lang: Lang, model: StoredModel, worksheets: Worksheet[]): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  const report = modelStaleness(model, worksheets);
  if (report.state === 'fresh') return { text: t(lang, 'model.stale.fresh'), tone: 'ok' };
  if (report.state === 'stale') return { text: t(lang, 'model.stale.stale'), tone: 'warn' };
  if (report.state === 'missing-data') {
    return { text: t(lang, 'model.stale.missing', { what: report.detail.missing?.join(', ') ?? '' }), tone: 'warn' };
  }
  return { text: t(lang, 'model.stale.untracked'), tone: 'muted' };
}

export function ModelManager({
  lang, models, worksheets, activeSheetId, onClose, onRename, onDuplicate, onDelete, onRefit, onContour,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(models[0]?.id ?? null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<PredictionState>(NO_PREDICTION);

  const selected = models.find((model) => model.id === selectedId) ?? models[0] ?? null;
  const sheet = worksheets.find((ws) => ws.id === activeSheetId) ?? worksheets[0];
  const staleness = selected ? modelStaleness(selected, worksheets) : null;
  const compatibility = useMemo(
    () => (selected && sheet ? checkCompatibility(selected, sheet.columns) : null),
    [lang, selected, sheet],
  );
  const selectedIds = compareIds.filter((id) => models.some((model) => model.id === id));
  const comparison = selectedIds.length >= 2 ? compareStoredModels(models.filter((model) => selectedIds.includes(model.id))) : null;

  const select = (id: string) => {
    setSelectedId(id);
    setNameDraft(null);
    setPrediction(NO_PREDICTION);
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  };

  const setPredictionValue = (name: string, value: string) => {
    setPrediction((prev) => ({ ...prev, values: { ...prev.values, [name]: value }, result: null }));
  };

  const predicted = (): void => {
    if (!selected) return;
    setPrediction((prev) => ({
      ...prev,
      result: predictStoredModel(selected, prev.values, { mode: prev.mode }),
    }));
  };

  const contourReady = selected ? selected.predictors.filter((p) => p.kind === 'numeric').length >= 2 : false;
  const previewSurface = useMemo(() => {
    if (!selected || !contourReady) return null;
    const numeric = selected.predictors.filter((p) => p.kind === 'numeric');
    try {
      const surface = modelSurface(selected, { xName: numeric[0].name, yName: numeric[1].name, resolution: 9 });
      const flat = surface.z.flat().filter((value) => Number.isFinite(value));
      return { min: flat.length ? Math.min(...flat) : Number.NaN, max: flat.length ? Math.max(...flat) : Number.NaN, issues: structureIssues(selected) };
    } catch {
      return { min: Number.NaN, max: Number.NaN, issues: structureIssues(selected) };
    }
    // The preview depends on the selected model only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, contourReady]);

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal model-manager" role="dialog" aria-modal="true" aria-label={t(lang, 'model.title')} data-testid="model-manager">
        <div className="modal-head">
          <div>
            <h3>{t(lang, 'model.title')}</h3>
            <div className="modal-sub">{t(lang, 'model.subtitle', { n: models.length })}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose} data-testid="mm-close">{t(lang, 'ct.close')}</button>
        </div>

        <div className="modal-body mm-body">
          <aside className="mm-list" data-testid="mm-list">
            {models.length === 0 && (
              <p className="mm-empty" data-testid="mm-empty">{t(lang, 'model.empty')}</p>
            )}
            {models.map((model) => {
              const stale = staleLabel(lang, model, worksheets);
              return (
                <div
                  key={model.id}
                  className={`mm-item${model.id === selected?.id ? ' current' : ''}`}
                  data-testid="mm-item"
                  data-model-id={model.id}
                  data-stale={stale.tone}
                  onClick={() => select(model.id)}
                >
                  <label className="mm-check" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={compareIds.includes(model.id)}
                      onChange={() => toggleCompare(model.id)}
                      aria-label={t(lang, 'model.compareAdd', { name: model.name })}
                      data-testid={`mm-pick-${model.id}`}
                    />
                  </label>
                  <div className="mm-item-text">
                    <div className="mm-item-name">{model.name}</div>
                    <div className="mm-item-meta">
                      {kindLabel(lang, model.kind)} · {model.response.name} ← {model.predictors.map((p) => p.name).join(', ')}
                    </div>
                    <div className={`mm-badge ${stale.tone}`}>{stale.text}</div>
                  </div>
                </div>
              );
            })}
          </aside>

          <section className="mm-detail" data-testid="mm-detail">
            {!selected && <p className="mm-empty">{t(lang, 'model.emptyDetail')}</p>}
            {selected && (
              <>
                <div className="mm-head">
                  {nameDraft === null ? (
                    <h4 data-testid="mm-selected-name">{selected.name}</h4>
                  ) : (
                    <input
                      className="text-input"
                      value={nameDraft}
                      autoFocus
                      onChange={(event) => setNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { onRename(selected.id, nameDraft); setNameDraft(null); }
                        if (event.key === 'Escape') setNameDraft(null);
                      }}
                      data-testid="mm-name-input"
                    />
                  )}
                  <span className="mm-kind">{kindLabel(lang, selected.kind)}</span>
                  <span className="spacer" />
                  <button type="button" className="btn ghost" onClick={() => setNameDraft(selected.name)} data-testid="mm-rename">
                    {t(lang, 'model.rename')}
                  </button>
                  {nameDraft !== null && (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => { onRename(selected.id, nameDraft); setNameDraft(null); }}
                      data-testid="mm-rename-ok"
                    >
                      {t(lang, 'dlg.ok')}
                    </button>
                  )}
                  <button type="button" className="btn ghost" onClick={() => onDuplicate(selected.id)} data-testid="mm-duplicate">
                    {t(lang, 'model.duplicate')}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => onRefit(selected.id)}
                    disabled={staleness?.state === 'missing-data' || staleness?.state === 'untracked'}
                    title={t(lang, 'model.refitHint')}
                    data-testid="mm-refit"
                  >
                    {t(lang, 'model.refit')}
                  </button>
                  <button
                    type="button"
                    className="btn ghost danger"
                    onClick={() => onDelete(selected.id)}
                    data-testid="mm-delete"
                  >
                    {t(lang, 'model.delete')}
                  </button>
                </div>

                <div className="mm-grid">
                  <div className="mm-facts">
                    <div className="mm-fact"><span>{t(lang, 'model.fact.id')}</span><b className="mono-note">{selected.id}</b></div>
                    <div className="mm-fact"><span>{t(lang, 'model.fact.response')}</span><b>{selected.response.name}</b></div>
                    <div className="mm-fact"><span>{t(lang, 'model.fact.predictors')}</span><b>{selected.predictors.map((p) => p.name).join(', ')}</b></div>
                    <div className="mm-fact"><span>{t(lang, 'model.fact.terms')}</span><b>{fmtInt(selected.terms.length + 1)}</b></div>
                    <div className="mm-fact"><span>{t(lang, 'model.fact.dfe')}</span><b>{selected.residual?.df != null ? fmtInt(selected.residual.df) : t(lang, 'model.na')}</b></div>
                    <div className="mm-fact"><span>{t(lang, 'model.fact.covariance')}</span><b>{selected.covariance ? t(lang, 'model.cmp.available') : t(lang, 'model.cmp.unavailable')}</b></div>
                    <div className="mm-fact"><span>{t(lang, 'model.fact.training')}</span><b>{selected.training ? `${selected.training.sheetName ?? '—'} · ${fmtInt(selected.training.rows)}` : t(lang, 'model.na')}</b></div>
                    <div className="mm-fact"><span>{t(lang, 'model.fact.created')}</span><b>{selected.createdAt.slice(0, 16).replace('T', ' ')}</b></div>
                    <div className="mm-fact"><span>{t(lang, 'model.fact.updated')}</span><b>{selected.updatedAt.slice(0, 16).replace('T', ' ')}</b></div>
                  </div>
                  <div className="mm-diagnostics">
                    <table className="stat-table">
                      <thead>
                        <tr>
                          <th>{t(lang, 'model.col.term')}</th>
                          <th className="al-r">{t(lang, 'model.col.coef')}</th>
                          <th className="al-r">{t(lang, 'model.col.se')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.coefficients.map((coefficient) => (
                          <tr key={coefficient.label} data-testid="mm-coef-row" data-estimable={coefficient.estimable ? '1' : '0'}>
                            <td>{coefficient.label}</td>
                            <td className="al-r">{coefficient.estimable ? fmt(coefficient.value, 5) : t(lang, 'model.notEstimableShort')}</td>
                            <td className="al-r">{coefficient.se != null && Number.isFinite(coefficient.se) ? fmt(coefficient.se, 5) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mm-section">
                  <h5>{t(lang, 'model.predict.title')}</h5>
                  <div className="mm-predict">
                    <label className="mm-mode">
                      <span>{t(lang, 'model.predict.mode')}</span>
                      <select
                        value={prediction.mode}
                        onChange={(event) => setPrediction({ ...NO_PREDICTION, mode: event.target.value as InputMode })}
                        data-testid="mm-predict-mode"
                      >
                        <option value="actual">{t(lang, 'model.unit.actual')}</option>
                        <option value="coded">{t(lang, 'model.unit.coded')}</option>
                      </select>
                    </label>
                    {selected.predictors.map((predictor) => (
                      <label className="mm-input" key={predictor.name}>
                        <span>
                          {predictor.name}
                          {predictor.unit ? ` (${predictor.unit})` : ''}
                          {predictor.coding ? ` · ${t(lang, predictor.coding.mode === 'coded' ? 'model.unit.coded' : 'model.unit.actual')}` : ''}
                        </span>
                        {predictor.kind === 'categorical' ? (
                          <select
                            value={prediction.values[predictor.name] ?? predictor.levels?.[0] ?? ''}
                            onChange={(event) => setPredictionValue(predictor.name, event.target.value)}
                            data-testid={`mm-input-${predictor.name}`}
                          >
                            {(predictor.levels ?? []).map((level) => <option key={level} value={level}>{level}</option>)}
                          </select>
                        ) : (
                          <input
                            className="text-input"
                            inputMode="decimal"
                            value={prediction.values[predictor.name] ?? ''}
                            placeholder={predictor.coding
                              ? fmt(prediction.mode === 'coded' && predictor.coding.mode === 'actual' ? 0 : predictor.coding.center, 4)
                              : '0'}
                            onChange={(event) => setPredictionValue(predictor.name, event.target.value)}
                            data-testid={`mm-input-${predictor.name}`}
                          />
                        )}
                      </label>
                    ))}
                    <button type="button" className="btn primary" onClick={predicted} data-testid="mm-predict">
                      {t(lang, 'model.predict.run')}
                    </button>
                  </div>

                  {prediction.result && (
                    <div className="mm-result" data-testid="mm-prediction" data-nonestimable={prediction.result.nonEstimable.length ? '1' : '0'}>
                      {prediction.result.value != null ? (
                        <>
                          <div className="mm-result-main">
                            <span>{t(lang, 'model.predict.value')}</span>
                            <b>{fmt(prediction.result.value, 6)}</b>
                          </div>
                          <div className="mm-result-row">
                            <span>{t(lang, 'model.predict.se')}</span>
                            <b>{prediction.result.se != null ? fmt(prediction.result.se, 6) : t(lang, 'model.na')}</b>
                          </div>
                          <div className="mm-result-row">
                            <span>{t(lang, 'model.predict.pi')}</span>
                            <b>{prediction.result.pi ? `${fmt(prediction.result.pi[0], 5)} … ${fmt(prediction.result.pi[1], 5)}` : t(lang, 'model.na')}</b>
                          </div>
                        </>
                      ) : (
                        <div className="mm-warn" data-testid="mm-nonestimable">
                          {prediction.result.nonEstimable.length
                            ? t(lang, 'model.predict.nonEstimable', { terms: prediction.result.nonEstimable.join(', ') })
                            : t(lang, 'model.predict.invalid')}
                        </div>
                      )}
                      {prediction.result.issues.length > 0 && (
                        <div className="mm-warn" data-testid="mm-predict-issues">
                          {prediction.result.issues.map((issue) => t(lang, issue)).join(' · ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="mm-section">
                  <h5>{t(lang, 'model.followup.title')}</h5>
                  <div className="mm-followup">
                    <button
                      type="button"
                      className="btn"
                      disabled={!contourReady || Boolean(staleness && staleness.state === 'missing-data')}
                      onClick={() => onContour(selected)}
                      data-testid="mm-contour"
                    >
                      {t(lang, 'model.followup.contour')}
                    </button>
                    <button type="button" className="btn" disabled data-testid="mm-surface">
                      {t(lang, 'model.followup.surface')}
                    </button>
                    <button type="button" className="btn" disabled data-testid="mm-optimizer">
                      {t(lang, 'model.followup.optimizer')}
                    </button>
                    <span className="mono-note">{t(lang, 'model.followup.later')}</span>
                  </div>
                  {previewSurface && (
                    <p className="mono-note" data-testid="mm-surface-preview">
                      {t(lang, 'model.followup.preview', {
                        min: Number.isFinite(previewSurface.min) ? fmt(previewSurface.min, 4) : '—',
                        max: Number.isFinite(previewSurface.max) ? fmt(previewSurface.max, 4) : '—',
                      })}
                    </p>
                  )}
                  {compatibility && !compatibility.ok && (
                    <div className="mm-warn" data-testid="mm-compat">
                      {t(lang, 'model.compat.title')}: {compatibility.problems.map((problem) => `${problem.variable} (${t(lang, problem.code)})`).join(', ')}
                    </div>
                  )}
                  {structureIssues(selected).length > 0 && (
                    <div className="mm-warn" data-testid="mm-structure">
                      {structureIssues(selected).join(' · ')}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        {comparison && (
          <div className="mm-compare" data-testid="mm-compare-table">
            <h5>{t(lang, 'model.compare.title', { n: selectedIds.length })}</h5>
            <table className="stat-table">
              <thead>
                <tr>
                  <th>{t(lang, 'model.compare.metric')}</th>
                  {models.filter((model) => selectedIds.includes(model.id)).map((model) => (
                    <th key={model.id} className="al-r">{model.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.key}>
                    <td>{t(lang, row.label)}</td>
                    {models.filter((model) => selectedIds.includes(model.id)).map((model) => (
                      <td key={model.id} className="al-r">
                        {row.values[model.id]?.startsWith('model.') ? t(lang, row.values[model.id]) : row.values[model.id]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-foot">
          <span className="mono-note" data-testid="mm-compare-count">{t(lang, 'model.compare.selected', { n: selectedIds.length })}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose} data-testid="mm-done">{t(lang, 'ct.close')}</button>
        </div>
      </div>
    </div>
  );
}
