import { useMemo, useState } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import {
  applyHierarchy,
  defaultTermIds,
  formulaPreview,
  type HierarchyMode,
  type TermCatalog,
} from '../lib/modelTerms';
import { IconPlus, IconX } from './Icons';

export interface ModelChoice {
  terms: string[];
  pooled: string[];
  hierarchy: HierarchyMode;
  order: number;
}

interface Props {
  catalog: TermCatalog;
  lang: Lang;
  analysisId: string;
  terms?: string[];
  pooled?: string[];
  hierarchy?: HierarchyMode;
  order: number;
  orderLocked?: boolean;
  onOrderChange: (order: number) => void;
  onClose: () => void;
  onSave: (choice: ModelChoice) => void;
}

/**
 * WO-3F-02 / WO-3F-03 / WO-3F-04 — the single term editor shared by GLM,
 * factorial DOE and response-surface runs. Selections are stable factor-name
 * ids (`A|B`), so they survive a language change and a catalogue rebuild.
 */
export function ModelTermsDialog({
  catalog,
  lang,
  analysisId,
  terms,
  pooled,
  hierarchy = 'strict',
  order,
  orderLocked,
  onOrderChange,
  onClose,
  onSave,
}: Props) {
  const known = useMemo(() => new Set(catalog.terms.map((term) => term.id)), [catalog]);
  const [selected, setSelected] = useState<string[]>(() => {
    const stored = (terms ?? []).filter((id) => known.has(id));
    return stored.length ? stored : defaultTermIds(catalog, true);
  });
  const [pooledIds, setPooledIds] = useState<string[]>(() => (pooled ?? []).filter((id) => known.has(id)));
  const [mode, setMode] = useState<HierarchyMode>(hierarchy);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSelection = useMemo(() => selected.filter((id) => known.has(id)), [selected, known]);
  const activePooled = useMemo(() => pooledIds.filter((id) => activeSelection.includes(id)), [pooledIds, activeSelection]);
  const modelIds = useMemo(() => activeSelection.filter((id) => !activePooled.includes(id)), [activeSelection, activePooled]);

  const hierarchyResult = useMemo(() => applyHierarchy(catalog, activeSelection, mode), [catalog, activeSelection, mode]);
  const violations = hierarchyResult.violations;
  const needsApproval = mode === 'unrestricted' && violations.length > 0;

  const byId = (id: string) => catalog.terms.find((term) => term.id === id);
  const available = catalog.terms.filter((term) => !activeSelection.includes(term.id));
  const nameOf = (id: string) => byId(id)?.name ?? id;
  const missingNames = [...new Set(violations.flatMap((violation) => violation.missing))];

  const add = (id: string) => setSelected((prev) => (prev.includes(id) ? prev : [...prev, id]));
  const remove = (id: string) => {
    setSelected((prev) => prev.filter((candidate) => candidate !== id));
    setPooledIds((prev) => prev.filter((candidate) => candidate !== id));
  };
  const pool = (id: string) => {
    if (!activeSelection.includes(id)) return;
    setPooledIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };
  const restore = (id: string) => setPooledIds((prev) => prev.filter((candidate) => candidate !== id));
  const addAll = () => setSelected(catalog.terms.map((term) => term.id));
  const removeAll = () => {
    setSelected([]);
    setPooledIds([]);
  };
  const reset = () => {
    setSelected(defaultTermIds(catalog, true));
    setPooledIds([]);
  };
  const resetPooling = () => setPooledIds([]);

  const currentOrder = Math.max(1, ...selected.map((id) => byId(id)?.order ?? 1));

  const save = () => {
    if (mode === 'strict' && violations.length) {
      setError(t(lang, 'model.hierarchyViolation', { terms: missingNames.join(', ') }));
      return;
    }
    if (needsApproval && !approved) {
      setError(t(lang, 'model.unrestrictedWarning'));
      return;
    }
    const applied = mode === 'auto' ? hierarchyResult.selected : activeSelection;
    onSave({ terms: applied, pooled: activePooled, hierarchy: mode, order: currentOrder });
  };

  const orderChoices = [1, 2, 3];

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 900, width: 'min(900px, 94vw)' }} role="dialog" aria-modal="true" aria-label={t(lang, 'model.dialogTitle')} data-testid="model-terms-dialog">
        <div className="modal-head">
          <div>
            <h3>{t(lang, 'model.dialogTitle')}</h3>
            <div className="modal-sub">{analysisId.toUpperCase()} · {catalog.factors.length} FACTORS</div>
          </div>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'dlg.cancel')}><IconX size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="dlg-grid">
            <div className="dlg-col">
              <div className="dlg-box">
                <header><span className="mono-note">{t(lang, 'model.available')}</span><span className="spacer" /><span className="mono-note">{available.length}</span></header>
                <div className="var-list" data-testid="mt-available">
                  {available.map((term) => (
                    <button key={term.id} type="button" className="var-row" onClick={() => add(term.id)} data-testid={`mt-add-${term.id}`}>
                      <span className="v-name">{term.name}</span>
                      <span className="v-meta">{term.order}</span>
                      <span className="v-add"><IconPlus size={11} /></span>
                    </button>
                  ))}
                  {available.length === 0 && <p className="nav-empty">{t(lang, 'model.termsEmpty')}</p>}
                </div>
              </div>
            </div>

            <div className="dlg-col">
              <div className="dlg-box">
                <header><span className="mono-note">{t(lang, 'model.selected')}</span><span className="spacer" /><span className="mono-note">{modelIds.length}</span></header>
                <div className="var-list" data-testid="mt-selected">
                  <div className="var-row" aria-disabled="true">
                    <span className="v-name">{t(lang, 'model.intercept')}</span>
                  </div>
                  {modelIds.map((id) => (
                    <div key={id} className="var-row" data-testid={`mt-selected-${id}`}>
                      <span className="v-name">{nameOf(id)}</span>
                      <span className="spacer" />
                      <button type="button" className="btn tiny" onClick={() => pool(id)} data-testid={`mt-pool-${id}`}>{t(lang, 'model.pool')}</button>
                      <button type="button" className="icon-btn" onClick={() => remove(id)} aria-label={t(lang, 'model.remove')} data-testid={`mt-remove-${id}`}><IconX size={12} /></button>
                    </div>
                  ))}
                  {modelIds.length === 0 && <p className="nav-empty">{t(lang, 'model.termsEmpty')}</p>}
                </div>
              </div>

              <div className="dlg-box" style={{ marginTop: 10 }}>
                <header>
                  <span className="mono-note">{t(lang, 'model.errorPool')}</span>
                  <span className="spacer" />
                  <button type="button" className="btn tiny" onClick={resetPooling} data-testid="mt-reset-pooling">{t(lang, 'model.resetPooling')}</button>
                </header>
                <div className="var-list" data-testid="mt-pooled">
                  {activePooled.map((id) => (
                    <div key={id} className="var-row" data-testid={`mt-pooled-${id}`}>
                      <span className="v-name">{nameOf(id)}</span>
                      <span className="spacer" />
                      <button type="button" className="btn tiny" onClick={() => restore(id)} data-testid={`mt-restore-${id}`}>{t(lang, 'model.restore')}</button>
                    </div>
                  ))}
                  {activePooled.length === 0 && <p className="nav-empty">—</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="dlg-box" style={{ marginTop: 10, padding: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <button type="button" className="btn tiny" onClick={addAll} data-testid="mt-add-all">{t(lang, 'model.addAll')}</button>
              <button type="button" className="btn tiny" onClick={removeAll} data-testid="mt-remove-all">{t(lang, 'model.removeAll')}</button>
              <button type="button" className="btn tiny" onClick={reset} data-testid="mt-reset">{t(lang, 'model.reset')}</button>
              <span className="spacer" />
              <label className="mono-note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {t(lang, 'model.order')}
                <select
                  className="select-input"
                  value={order}
                  disabled={orderLocked}
                  onChange={(event) => onOrderChange(Number(event.target.value))}
                  data-testid="mt-order"
                >
                  {orderChoices.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="mono-note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {t(lang, 'model.hierarchy')}
                <select
                  className="select-input"
                  value={mode}
                  onChange={(event) => { setMode(event.target.value as HierarchyMode); setApproved(false); setError(null); }}
                  data-testid="mt-hierarchy"
                >
                  <option value="strict">{t(lang, 'model.hierarchy.strict')}</option>
                  <option value="auto">{t(lang, 'model.hierarchy.auto')}</option>
                  <option value="unrestricted">{t(lang, 'model.hierarchy.unrestricted')}</option>
                </select>
              </label>
            </div>
            <div className="mono-note" style={{ marginTop: 8 }}>{t(lang, 'model.formula')}</div>
            <div className="mono-note" style={{ marginTop: 4 }} data-testid="mt-formula">{formulaPreview(catalog, modelIds)}</div>
            <p className="hint" style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 6 }}>{t(lang, 'model.poolNote')}</p>
            {mode === 'auto' && violations.length > 0 && (
              <div className="dlg-error" data-testid="mt-auto-add">{t(lang, 'model.autoAdd', { terms: missingNames.join(', ') })}</div>
            )}
            {mode === 'strict' && violations.length > 0 && (
              <div className="dlg-error" data-testid="mt-hierarchy-warning">
                {t(lang, 'model.hierarchyViolation', { terms: missingNames.join(', ') })}
              </div>
            )}
            {needsApproval && (
              <label className="check-row" style={{ marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(event) => { setApproved(event.target.checked); setError(null); }}
                  data-testid="mt-approve"
                />
                {t(lang, 'model.unrestrictedApprove')}
              </label>
            )}
            {needsApproval && (
              <div className="dlg-error" data-testid="mt-unrestricted-warning">{t(lang, 'model.unrestrictedWarning')}</div>
            )}
            {error && <div className="dlg-error" data-testid="mt-error">{error}</div>}
          </div>
        </div>

        <div className="modal-foot">
          <span className="hint">{t(lang, 'model.excluded')}: {available.length}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose} data-testid="mt-cancel">{t(lang, 'dlg.cancel')}</button>
          <button type="button" className="btn primary" onClick={save} data-testid="mt-save">{t(lang, 'dlg.ok')}</button>
        </div>
      </div>
    </div>
  );
}
