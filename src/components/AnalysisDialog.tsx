import { useEffect, useMemo, useState } from 'react';
import type { Lang, Worksheet } from '../types';
import { analysisTermCatalog, defaultValues, type AnalysisDef, type SlotDef } from '../lib/analyses';
import { t } from '../lib/i18n';
import { loadModelSettings, saveModelSettings } from '../lib/modelSettings';
import { resolveModelSelection, type HierarchyMode } from '../lib/modelTerms';
import { IconPlus, IconX } from './Icons';
import { ModelTermsDialog, type ModelChoice } from './ModelTermsDialog';

interface Props {
  def: AnalysisDef;
  lang: Lang;
  sheet: Worksheet;
  initial?: Record<string, unknown>;
  onClose: () => void;
  onRun: (values: Record<string, unknown>) => string | null;
  /** Reports the dialog's current values, so an external Run action uses what the reader sees. */
  onValuesChange?: (values: Record<string, unknown>) => void;
}

function columnMeta(sheet: Worksheet, ref: string): { id: string; name: string; type: string; n: number } | null {
  const col = sheet.columns.find((c) => c.id === ref);
  if (!col) return null;
  const n = col.values.filter((v) => v !== null && v !== '').length;
  return { id: col.id, name: col.name, type: col.type, n };
}

export function normalizeValues(def: AnalysisDef, initial?: Record<string, unknown>, saved?: { terms: string[]; pooled: string[]; hierarchy: HierarchyMode } | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...defaultValues(def), ...(initial ?? {}) };
  if (saved) {
    if (next.terms === undefined) next.terms = saved.terms;
    if (next.pooled === undefined) next.pooled = saved.pooled;
    if (next.hierarchy === undefined) next.hierarchy = saved.hierarchy;
  }
  def.slots.forEach((slot) => {
    const value = next[slot.key];
    // A single-column slot became a list when the analysis gained multi-variable
    // support: projects saved before that still hold one column id as a string.
    if (slot.kind === 'vars') {
      if (typeof value === 'string') next[slot.key] = value ? [value] : [];
      else if (!Array.isArray(value)) next[slot.key] = [];
    }
    if (slot.kind === 'col' && Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string');
      next[slot.key] = typeof first === 'string' ? first : '';
    }
  });
  return next;
}

export function AnalysisDialog({ def, lang, sheet, initial, onClose, onRun, onValuesChange }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() => normalizeValues(def, initial, loadModelSettings(def.id)));
  const [active, setActive] = useState<string>(() => def.slots.find((s) => s.kind === 'vars' || s.kind === 'col')?.key ?? '');
  const [tab, setTab] = useState<'main' | 'options' | 'graphs'>('main');
  const [picked, setPicked] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);

  const groups = useMemo(() => {
    const present = new Set(def.slots.map((s) => s.group ?? 'main'));
    return (['main', 'options', 'graphs'] as const).filter((g) => present.has(g));
  }, [def]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    onValuesChange?.(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const activeSlot = def.slots.find((s) => s.key === active);

  const hasModelSlot = def.slots.some((slot) => slot.kind === 'model');
  const catalog = hasModelSlot ? analysisTermCatalog(def.id, sheet, values) : null;
  const hasOrderSlot = def.slots.some((slot) => slot.key === 'order');
  const hasInteractionsSlot = def.slots.some((slot) => slot.key === 'interactions');
  const orderValue = hasOrderSlot
    ? Math.max(1, Math.min(3, Math.round(Number(values.order) || 2)))
    : hasInteractionsSlot && values.interactions === false ? 1 : 2;
  const resolvedModel = catalog
    ? resolveModelSelection(catalog, values.terms, values.pooled, values.hierarchy, values.interactions !== false)
    : null;

  const applyModelChoice = (choice: ModelChoice) => {
    setValues((prev) => {
      const next: Record<string, unknown> = { ...prev, terms: choice.terms, pooled: choice.pooled, hierarchy: choice.hierarchy };
      if (hasOrderSlot) next.order = String(choice.order);
      if (hasInteractionsSlot) next.interactions = choice.order > 1;
      return next;
    });
    saveModelSettings(def.id, { terms: choice.terms, pooled: choice.pooled, hierarchy: choice.hierarchy, order: choice.order });
    setModelOpen(false);
    setError(null);
  };

  const changeModelOrder = (order: number) => {
    setValues((prev) => {
      const next: Record<string, unknown> = { ...prev };
      if (hasOrderSlot) next.order = String(order);
      if (hasInteractionsSlot) next.interactions = order > 1;
      return next;
    });
  };

  const addColumn = (slotKey: string, ref: string) => {
    const slot = def.slots.find((s) => s.key === slotKey);
    if (!slot) return;
    const next: Record<string, unknown> = { ...values };
    if (slot.kind === 'col') {
      next[slotKey] = ref;
    } else if (slot.kind === 'vars') {
      const current = (values[slotKey] as string[]) ?? [];
      if (current.includes(ref)) return;
      next[slotKey] = [...current, ref];
    } else {
      return;
    }
    setValues(next);
    setPicked(ref);
    const nextEmpty = def.slots.find((candidate) => {
      if (candidate.key === slotKey || !candidate.required) return false;
      if (candidate.kind === 'col') return !next[candidate.key];
      if (candidate.kind === 'vars') return !(next[candidate.key] as string[])?.length;
      return false;
    });
    if (nextEmpty) setActive(nextEmpty.key);
  };

  const targetSlot = (): string => {
    if (activeSlot && (activeSlot.kind === 'vars' || activeSlot.kind === 'col')) return activeSlot.key;
    return def.slots.find((s) => s.kind === 'vars' || s.kind === 'col')?.key ?? '';
  };

  const removeChip = (slotKey: string, ref: string) => {
    setValues((prev) => {
      const slot = def.slots.find((s) => s.key === slotKey);
      if (slot?.kind === 'col') return { ...prev, [slotKey]: '' };
      const current = (prev[slotKey] as string[]) ?? [];
      return { ...prev, [slotKey]: current.filter((r) => r !== ref) };
    });
  };

  const submit = () => {
    const missing = def.slots.filter((slot) => {
      if (!slot.required) return false;
      const value = values[slot.key];
      if (slot.kind === 'col') return !value;
      if (slot.kind === 'vars') return !Array.isArray(value) || value.length === 0;
      return false;
    });
    if (missing.length) {
      setError(t(lang, 'dlg.required', { slot: t(lang, missing[0].label) }));
      return;
    }
    if (def.slots.some((s) => s.key === 'formula') && !String(values.formula ?? '').trim()) {
      setError(t(lang, 'calc.emptyFormula'));
      return;
    }
    const message = onRun(values);
    if (message) setError(message);
  };

  const renderSlot = (slot: SlotDef) => {
    const value = values[slot.key];
    if (slot.kind === 'model') {
      const violationTerms = resolvedModel
        ? [...new Set(resolvedModel.hierarchy.violations.flatMap((violation) => violation.missing))].join(', ')
        : '';
      return (
        <div key={slot.key} className="slot" data-testid="model-slot">
          <span className="slot-label">{t(lang, slot.label)}</span>
          <div className="mono-note" style={{ fontSize: 11.5 }} data-testid="model-summary">
            {resolvedModel
              ? t(lang, 'model.summary', {
                terms: resolvedModel.terms.length - resolvedModel.pooled.length,
                pooled: resolvedModel.pooled.length,
                mode: t(lang, `model.hierarchy.${resolvedModel.mode}`),
              })
              : t(lang, 'model.termsNoFactors')}
          </div>
          <button type="button" className="btn tiny" onClick={() => setModelOpen(true)} disabled={!catalog} data-testid="model-edit">
            {t(lang, 'model.edit')}
          </button>
          {resolvedModel && resolvedModel.mode === 'strict' && resolvedModel.hierarchy.violations.length > 0 && (
            <div className="dlg-error" data-testid="model-violation">{t(lang, 'model.hierarchyViolation', { terms: violationTerms })}</div>
          )}
        </div>
      );
    }
    if (slot.kind === 'vars') {
      const refs = (value as string[]) ?? [];
      return (
        <div key={slot.key} className="slot">
          <span className="slot-label">{t(lang, slot.label)}{slot.required && <span className="req">*</span>}</span>
          <div
            className={`slot-input${active === slot.key ? ' active' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`${t(lang, slot.label)} — ${t(lang, 'dlg.active')}`}
            onClick={() => setActive(slot.key)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setActive(slot.key);
              }
            }}
            data-testid={`slot-${slot.key}`}
          >
            {refs.length === 0 && <span className="ph">{t(lang, 'dlg.selectColumn')}</span>}
            {refs.map((ref) => {
              const meta = columnMeta(sheet, ref);
              return (
                <span className="chip" key={ref}>
                  {meta ? meta.name || meta.id : ref}
                  <button type="button" onClick={(event) => { event.stopPropagation(); removeChip(slot.key, ref); }} aria-label="remove"><IconX size={10} /></button>
                </span>
              );
            })}
          </div>
        </div>
      );
    }
    if (slot.kind === 'col') {
      const ref = typeof value === 'string' ? value : '';
      const meta = ref ? columnMeta(sheet, ref) : null;
      return (
        <div key={slot.key} className="slot">
          <span className="slot-label">{t(lang, slot.label)}{slot.required && <span className="req">*</span>}</span>
          <div
            className={`slot-input${active === slot.key ? ' active' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`${t(lang, slot.label)} — ${t(lang, 'dlg.active')}`}
            onClick={() => setActive(slot.key)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setActive(slot.key);
              }
            }}
            data-testid={`slot-${slot.key}`}
          >
            {!meta && <span className="ph">{t(lang, 'dlg.selectColumn')}</span>}
            {meta && (
              <span className="chip">
                {meta.name || meta.id}
                <button type="button" onClick={(event) => { event.stopPropagation(); removeChip(slot.key, ref); }} aria-label="remove"><IconX size={10} /></button>
              </span>
            )}
          </div>
        </div>
      );
    }
    if (slot.kind === 'num') {
      return (
        <div key={slot.key} className="slot">
          <span className="slot-label">{t(lang, slot.label)}</span>
          <input
            className="num-input"
            type="number"
            value={String(value ?? '')}
            min={slot.min}
            max={slot.max}
            step={slot.step ?? 'any'}
            onChange={(event) => setValues((prev) => ({ ...prev, [slot.key]: event.target.value }))}
            data-testid={`field-${slot.key}`}
          />
        </div>
      );
    }
    if (slot.kind === 'select') {
      return (
        <div key={slot.key} className="slot">
          <span className="slot-label">{t(lang, slot.label)}</span>
          <select
            className="select-input"
            value={String(value ?? '')}
            onChange={(event) => setValues((prev) => ({ ...prev, [slot.key]: event.target.value }))}
            data-testid={`field-${slot.key}`}
          >
            {(slot.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>{t(lang, option.label)}</option>
            ))}
          </select>
        </div>
      );
    }
    if (slot.kind === 'check') {
      return (
        <label key={slot.key} className="check-row">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => setValues((prev) => ({ ...prev, [slot.key]: event.target.checked }))}
            data-testid={`field-${slot.key}`}
          />
          {t(lang, slot.label)}
        </label>
      );
    }
    return (
      <div key={slot.key} className="slot">
        <span className="slot-label">{t(lang, slot.label)}{slot.required && <span className="req">*</span>}</span>
        <input
          className="text-input"
          value={String(value ?? '')}
          placeholder={slot.placeholder}
          onChange={(event) => setValues((prev) => ({ ...prev, [slot.key]: event.target.value }))}
          data-testid={`field-${slot.key}`}
        />
      </div>
    );
  };

  const visible = def.slots.filter((slot) => (slot.group ?? 'main') === tab);

  return (
    <>
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t(lang, def.titleKey)} data-testid="analysis-dialog">
        <div className="modal-head">
          <div>
            <h3>{t(lang, def.titleKey)}</h3>
            <div className="modal-sub">{sheet.name.toUpperCase()} · {sheet.columns.length} COLUMNS</div>
          </div>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'dlg.cancel')}><IconX size={16} /></button>
        </div>

        <div className="modal-body">
          {groups.length > 1 && (
            <div className="dlg-tabs" role="tablist">
              {groups.map((group) => (
                <button
                  key={group}
                  type="button"
                  role="tab"
                  aria-selected={tab === group}
                  onClick={() => setTab(group)}
                  data-testid={`tab-${group}`}
                >
                  {t(lang, group === 'main' ? 'dlg.variables' : group === 'options' ? 'dlg.options' : 'dlg.graphs')}
                </button>
              ))}
            </div>
          )}

          <div className="dlg-grid">
            <div className="dlg-col">
              <div className="dlg-box">
                <header>
                  <span className="mono-note">{t(lang, 'dlg.variables')}</span>
                  <span className="spacer" />
                  <span className="mono-note">{activeSlot ? t(lang, activeSlot.label) : ''}</span>
                </header>
                <div className="var-list" data-testid="variable-list">
                  {sheet.columns.map((col) => {
                    const n = col.values.filter((v) => v !== null && v !== '').length;
                    return (
                      <button
                        key={col.id}
                        type="button"
                        className={`var-row${picked === col.id ? ' selected' : ''}`}
                        onDoubleClick={() => addColumn(targetSlot(), col.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            addColumn(targetSlot(), col.id);
                          }
                        }}
                        onClick={() => setPicked(col.id)}
                        data-testid={`var-${col.id}`}
                      >
                        <span className="v-id">{col.id}{col.type === 'text' ? '-T' : col.type === 'date' ? '-D' : ''}</span>
                        <span className="v-name">{col.name || '—'}</span>
                        <span className="v-meta">{n}</span>
                        <span
                          className="v-add"
                          role="button"
                          tabIndex={-1}
                          onClick={(event) => { event.stopPropagation(); addColumn(targetSlot(), col.id); }}
                          title={t(lang, 'dlg.active')}
                        >
                          <IconPlus size={11} />
                        </span>
                      </button>
                    );
                  })}
                  {sheet.columns.length === 0 && <p className="nav-empty">{t(lang, 'dlg.noColumns')}</p>}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => activeSlot && picked && addColumn(activeSlot.key, picked)}
                  disabled={!picked || !active}
                  data-testid="add-selected"
                >
                  <IconPlus size={12} /> {t(lang, 'dlg.add')}
                </button>
                <span className="hint" style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{t(lang, 'dlg.hint')}</span>
              </div>
            </div>

            <div className="dlg-col">
              <div className="dlg-box" style={{ padding: 10 }}>
                {visible.map(renderSlot)}
                {visible.length === 0 && <p className="nav-empty">—</p>}
              </div>
              {error && <div className="dlg-error" data-testid="dialog-error">{error}</div>}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className="hint">{activeSlot ? `${t(lang, 'dlg.active')}: ${t(lang, activeSlot.label)}` : ''}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>{t(lang, 'dlg.cancel')}</button>
          <button type="button" className="btn primary" onClick={submit} data-testid="dialog-ok">{t(lang, 'dlg.ok')}</button>
        </div>
      </div>
    </div>
    {modelOpen && catalog && (
      <ModelTermsDialog
        catalog={catalog}
        lang={lang}
        analysisId={def.id}
        terms={Array.isArray(values.terms) ? (values.terms as string[]) : undefined}
        pooled={Array.isArray(values.pooled) ? (values.pooled as string[]) : undefined}
        hierarchy={values.hierarchy === 'auto' || values.hierarchy === 'unrestricted' ? values.hierarchy : 'strict'}
        order={orderValue}
        orderLocked={!hasOrderSlot}
        onOrderChange={changeModelOrder}
        onClose={() => setModelOpen(false)}
        onSave={applyModelChoice}
      />
    )}
    </>
  );
}
