import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChartSpec, Lang } from '../types';
import type {
  AxisConfig,
  ChartConfig,
  ChartStylePresetId,
  ContourColormap,
  ContourConfig,
  ContourRenderMode,
  ContourResolution,
  ExportBackground,
  ExportConfig,
  LegendPosition,
  MarkerShape,
  ReferenceLineConfig,
  SurfaceRenderMode,
  SurfaceProjection,
  SurfaceViewConfig,
  FeasibleConfig,
  FeasibleBasis,
} from '../lib/chartConfig';
import { defaultChartConfig, defaultSurfaceViewConfig, defaultFeasibleConfig, defaultErrorBarConfig } from '../lib/chartConfig';
import {
  ChartConfigHistory,
  factorPairCount,
  fullChartConfig,
  hasSecondaryY,
  rsmViewIsExtrapolated,
} from '../lib/chartConfigOps';
import type { ChartStylePack } from '../lib/chartConfigOps';
import {
  CHART_STYLE_IDS,
  CHART_STYLE_PRESETS,
  deleteCustomStyle,
  loadCustomStyles,
  saveCustomStyle,
  type CustomChartStyle,
} from '../lib/chartStyles';
import { EXPORT_DPI_PRESETS, physicalToPixels, pixelsToPhysical, resolveExportSize } from '../lib/chartExport';
import { codedToActual } from '../lib/doe';
import { commonNumericFactors } from '../lib/feasible';
import { SURFACE_VIEW_PRESETS, surfaceResolutionPoints } from '../lib/surface3d';
import { factorDisplayRange } from '../lib/modelPredictor';
import { getChartWarnings } from '../lib/charts';
import { t } from '../lib/i18n';

export type ChartDrawerTab = 'general' | 'scale' | 'series' | 'style' | 'reference' | 'legend' | 'export' | 'surface' | 'feasible';

const BASE_TABS: { id: ChartDrawerTab; key: string }[] = [
  { id: 'general', key: 'cd.tab.general' },
  { id: 'scale', key: 'cd.tab.scale' },
  { id: 'series', key: 'cd.tab.series' },
  { id: 'style', key: 'cd.tab.style' },
  { id: 'reference', key: 'cd.tab.reference' },
  { id: 'legend', key: 'cd.tab.legend' },
  { id: 'export', key: 'cd.tab.export' },
];

/** The 3D tab belongs to a 3D chart; the overlaid tab to an overlaid one. */
function tabsFor(chart: ChartSpec): { id: ChartDrawerTab; key: string }[] {
  const extra: { id: ChartDrawerTab; key: string }[] = [];
  if (chart.kind === 'surface3d') extra.push({ id: 'surface', key: 'cd.tab.surface' });
  if (chart.kind === 'overlaid') extra.push({ id: 'feasible', key: 'cd.tab.feasible' });
  return [...BASE_TABS.slice(0, 4), ...extra, ...BASE_TABS.slice(4)];
}

const COLORMAPS: ContourColormap[] = ['sigrun-classic', 'viridis', 'cividis', 'plasma', 'inferno', 'turbo', 'coolwarm', 'rdbu', 'grayscale'];
const MARKERS: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'none'];

interface Props {
  lang: Lang;
  chart: ChartSpec;
  initialTab?: ChartDrawerTab;
  initialAxis?: 'x' | 'y' | 'z' | 'y2';
  onPreview: (config: ChartConfig) => void;
  onApply: (config: ChartConfig) => void;
  onClose: () => void;
  onReset: (config: ChartConfig) => void;
  onExport: (config: ChartConfig, format: 'svg' | 'png') => void;
  onCopyPng: (config: ChartConfig) => void;
  onBatchExport: (config: ChartConfig, format: 'svg' | 'png') => void;
  onGeneratePairs: (config: ChartConfig) => void;
  styleClipboard: ChartStylePack | null;
  onCopyStyle: (config: ChartConfig) => void;
  onPasteStyle: (config: ChartConfig) => void;
  onApplyAll: (config: ChartConfig) => void;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function num(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function show(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '' : String(value);
}

function seriesCountOf(chart: ChartSpec): number {
  switch (chart.kind) {
    case 'line': return chart.series.length;
    case 'scatter': return chart.series?.length ?? (chart.groups?.length ?? 1);
    case 'bar': return chart.groups?.length || chart.items.length;
    case 'pareto': return chart.items.length;
    default: return 0;
  }
}

/* ── small controls ───────────────────────────────────────────────────── */

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="cd-row">
      <span className="cd-row-label">{label}</span>
      <span className="cd-row-control">{children}</span>
      {hint && <small className="cd-hint">{hint}</small>}
    </label>
  );
}

function NumberField({
  label, value, onChange, min, max, step, placeholder, testId,
}: { label: string; value: number | null | undefined; onChange: (value: number | null) => void; min?: number; max?: number; step?: number; placeholder?: string; testId?: string }) {
  return (
    <Row label={label}>
      <input
        className="cd-input"
        type="number"
        value={show(value)}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(event) => onChange(num(event.target.value))}
        {...(testId ? { 'data-testid': testId } : {})}
      />
    </Row>
  );
}

function TextField({ label, value, onChange, placeholder, testId }: { label: string; value: string | undefined; onChange: (value: string) => void; placeholder?: string; testId?: string }) {
  return (
    <Row label={label}>
      <input className="cd-input" type="text" value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} {...(testId ? { 'data-testid': testId } : {})} />
    </Row>
  );
}

function SelectField<T extends string>({
  label, value, options, onChange, testId,
}: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; testId?: string }) {
  return (
    <Row label={label}>
      <select className="cd-input" value={value} onChange={(event) => onChange(event.target.value as T)} {...(testId ? { 'data-testid': testId } : {})}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </Row>
  );
}

function Toggle({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (value: boolean) => void; testId?: string }) {
  return (
    <label className="cd-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} {...(testId ? { 'data-testid': testId } : {})} />
      <span>{label}</span>
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string | undefined; onChange: (value: string) => void }) {
  const safe = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#1f2937';
  return (
    <Row label={label}>
      <span className="cd-color">
        <input type="color" value={safe} onChange={(event) => onChange(event.target.value)} aria-label={label} />
        <input className="cd-input" type="text" value={value ?? ''} placeholder="auto" onChange={(event) => onChange(event.target.value)} />
      </span>
    </Row>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="cd-group">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

/**
 * Data extent of one axis, used only to seed a sensible default when the
 * reader switches on an axis break: an empty break (from = to) describes
 * nothing, so the drawer needs a starting window that the chart actually has.
 */
function axisDataRange(chart: ChartSpec, axis: 'x' | 'y'): [number, number] | null {
  const numbers: number[] = [];
  const push = (value: unknown) => { if (typeof value === 'number' && Number.isFinite(value)) numbers.push(value); };
  if (chart.kind === 'scatter') {
    chart.points.forEach((point) => { push(axis === 'x' ? point.x : point.y); });
    chart.series?.forEach((series) => series.points.forEach((point) => { push(axis === 'x' ? point.x : point.y); }));
    if (axis === 'x') chart.xDomain?.forEach(push);
    else chart.yDomain?.forEach(push);
  } else if (chart.kind === 'line') {
    chart.series.forEach((series) => series.points.forEach((point) => { push(axis === 'x' ? point.x : point.y); }));
  } else if (chart.kind === 'bar') {
    if (axis === 'y') {
      chart.items.forEach((item) => push(item.value));
      chart.groups?.forEach((group) => group.values.forEach(push));
    }
  } else if (chart.kind === 'timeseries' || chart.kind === 'boxplot') {
    if (axis === 'y') {
      if (chart.kind === 'timeseries') chart.values.forEach(push);
      else chart.groups.forEach((group) => group.values.forEach(push));
    }
  } else if (chart.kind === 'contour' || chart.kind === 'surface3d') {
    const values = axis === 'x' ? chart.xs : chart.ys;
    values.forEach(push);
  }
  if (numbers.length < 2) return null;
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  return max > min ? [min, max] : null;
}

/* ── drawer ───────────────────────────────────────────────────────────── */

export function ChartPropertiesDrawer({
  lang, chart, initialTab = 'general', initialAxis = 'x', onPreview, onApply, onClose, onReset, onExport, onCopyPng, onBatchExport,
  onGeneratePairs, styleClipboard, onCopyStyle, onPasteStyle, onApplyAll,
}: Props) {
  const [draft, setDraft] = useState<ChartConfig>(() => {
    const config = fullChartConfig(chart);
    if (!config.appearance?.title && chart.title) config.appearance = { ...(config.appearance ?? {}), title: chart.title };
    return config;
  });
  const [tab, setTab] = useState<ChartDrawerTab>(initialTab);
  const [scaleAxis, setScaleAxis] = useState<'x' | 'y' | 'z' | 'y2'>(initialAxis);
  const [pointStyleIndex, setPointStyleIndex] = useState(0);
  const [customStyles, setCustomStyles] = useState<CustomChartStyle[]>(() => loadCustomStyles());
  const [styleName, setStyleName] = useState('');
  const history = useRef(new ChartConfigHistory(60));
  const [, force] = useState(0);
  const sessionKey = useRef(`${chart.kind}-${(chart.title ?? '')}-${Math.random()}`);

  const contourReady = chart.kind === 'contour';
  const model = chart.kind === 'contour' ? chart.rsmModel : undefined;
  const surfaceChart = chart.kind === 'surface3d' ? chart : null;
  const surfaceModel = surfaceChart?.model;
  const surfaceNumeric = surfaceModel ? surfaceModel.predictors.filter((predictor) => predictor.kind === 'numeric') : [];
  const overlaidChart = chart.kind === 'overlaid' ? chart : null;
  const overlaidModels = overlaidChart?.models ?? [];
  const overlaidFactors = useMemo(() => commonNumericFactors(overlaidModels), [overlaidModels]);
  const surfaceCfg: SurfaceViewConfig = { ...defaultSurfaceViewConfig(), ...(draft.surface ?? {}) };
  const feasibleCfg: FeasibleConfig = { ...defaultFeasibleConfig(), ...(draft.feasible ?? {}) };
  const intervalBlocked = overlaidChart?.feasible?.intervalBlocked ?? [];
  const tLabel = (key: string) => t(lang, key);

  useEffect(() => {
    // A new chart (or the same card reopened) starts from its committed config.
    const fresh = fullChartConfig(chart);
    if (!fresh.appearance?.title && chart.title) fresh.appearance = { ...(fresh.appearance ?? {}), title: chart.title };
    setDraft(fresh);
    setTab(initialTab);
    setScaleAxis(initialAxis);
    history.current.clear();
    onPreview(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey.current]);

  const commit = (next: ChartConfig) => {
    history.current.push(draft);
    setDraft(next);
    onPreview(next);
    force((value) => value + 1);
  };

  const patch = (mutate: (config: ChartConfig) => void) => {
    const next = clone(draft);
    mutate(next);
    commit(next);
  };

  const axisKey: 'xAxis' | 'yAxis' | 'series' = scaleAxis === 'y2' ? 'yAxis' : scaleAxis === 'z' ? 'series' : scaleAxis === 'x' ? 'xAxis' : 'yAxis';
  const axis: AxisConfig = (draft[axisKey === 'series' ? 'xAxis' : axisKey] ?? {}) as AxisConfig;
  const contour = { ...defaultChartConfig().contour!, ...(draft.contour ?? {}) } as ContourConfig;
  const exportCfg = { ...defaultChartConfig().export!, ...(draft.export ?? {}) } as ExportConfig;
  const rsm = draft.rsm ?? {};
  const warnings = useMemo(() => getChartWarnings(chart, draft), [chart, draft]);
  const logWarning = warnings.find((warning) => warning.code === 'log-nonpositive');
  const extrapolated = Boolean(model && rsmViewIsExtrapolated(model, rsm));
  const exportSize = resolveExportSize(exportCfg, 560, 300);

  const axisOptions: { value: 'x' | 'y' | 'z' | 'y2'; label: string }[] = [
    { value: 'x' as const, label: tLabel('cd.axis.x') },
    { value: 'y' as const, label: tLabel('cd.axis.y') },
  ];
  if (contourReady || chart.kind === 'surface3d') axisOptions.push({ value: 'z' as const, label: tLabel('cd.axis.z') });
  if (hasSecondaryY(chart)) axisOptions.push({ value: 'y2' as const, label: tLabel('cd.axis.y2') });

  /** Upsert one response's specification inside the feasible block. */
  const setSpec = (name: string, field: 'lsl' | 'usl' | 'target', value: number | null) => {
    patch((config) => {
      const specs = [...(config.feasible?.specs ?? [])];
      const index = specs.findIndex((entry) => entry.name === name);
      const current = index >= 0 ? specs[index] : { name, lsl: null, usl: null, target: null };
      const next = { ...current, [field]: value };
      if (index >= 0) specs[index] = next;
      else specs.push(next);
      config.feasible = { ...(config.feasible ?? {}), specs };
    });
  };

  const patchAxis = (mutate: (axisConfig: AxisConfig) => void) => {
    patch((config) => {
      const key = axisKey;
      const base = key === 'series' ? config.xAxis : config[key];
      const next = { ...(base ?? {}) };
      mutate(next as AxisConfig);
      if (key === 'series') config.xAxis = next;
      else if (key === 'xAxis') config.xAxis = next;
      else config.yAxis = next;
    });
  };

  const undo = () => {
    const previous = history.current.undo(draft);
    if (!previous) return;
    setDraft(previous);
    onPreview(previous);
    force((value) => value + 1);
  };

  const redo = () => {
    const next = history.current.redo(draft);
    if (!next) return;
    setDraft(next);
    onPreview(next);
    force((value) => value + 1);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const updateExport = (mutate: (config: ExportConfig) => void) => {
    const next = clone(exportCfg);
    mutate(next);
    patch((config) => { config.export = next; });
  };

  /** Physical size wins unless the author typed an explicit pixel box. */
  const editPhysical = (mutate: (config: ExportConfig) => void) => {
    updateExport((config) => { mutate(config); config.widthPx = 0; config.heightPx = 0; });
  };

  return (
    <div className="cd-backdrop" data-testid="chart-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="cd-panel" role="dialog" aria-modal="false" aria-label={tLabel('cd.title')} data-testid="chart-drawer">
        <header className="cd-head">
          <div>
            <h3>{tLabel('cd.title')}</h3>
            <div className="cd-sub">{t(lang, 'cd.subtitle', { kind: chart.kind.toUpperCase() })}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={undo} disabled={!history.current.state().canUndo} title={tLabel('cd.undo')} aria-label={tLabel('cd.undo')} data-testid="cd-undo">↶</button>
          <button type="button" className="icon-btn" onClick={redo} disabled={!history.current.state().canRedo} title={tLabel('cd.redo')} aria-label={tLabel('cd.redo')} data-testid="cd-redo">↷</button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tLabel('ct.close')} data-testid="cd-close">✕</button>
        </header>

        <nav className="cd-tabs" role="tablist">
          {tabsFor(chart).map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`cd-tab${tab === entry.id ? ' active' : ''}`}
              onClick={() => setTab(entry.id)}
              data-testid={`cd-tab-${entry.id}`}
            >
              {tLabel(entry.key)}
            </button>
          ))}
        </nav>

        <div className="cd-body">
          {tab === 'general' && (
            <>
              <Group title={tLabel('cd.section.title')}>
                <TextField label={tLabel('cd.titleLabel')} value={draft.appearance?.title ?? chart.title ?? ''} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), title: value }; })} />
                <TextField label={tLabel('cd.subtitleLabel')} value={draft.appearance?.subtitle ?? ''} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), subtitle: value }; })} />
                <Toggle label={tLabel('cd.titleVisible')} checked={draft.appearance?.titleVisible !== false} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), titleVisible: value }; })} />
              </Group>
              <Group title={tLabel('cd.section.size')}>
                <NumberField label={tLabel('cd.sizeWidth')} value={draft.appearance?.width} min={260} step={10} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), width: value ?? 560 }; })} />
                <NumberField label={tLabel('cd.sizeHeight')} value={draft.appearance?.height || null} min={120} step={10} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), height: value ?? 0 }; })} />
                <NumberField
                  label={tLabel('cd.aspect')}
                  value={draft.appearance?.aspectRatio}
                  step={0.1}
                  onChange={(value) => patch((config) => {
                    // Choosing an aspect ratio sets the height that realises it.
                    const ratio = value && value > 0.2 ? value : 1.6;
                    const width = config.appearance?.width ?? 560;
                    config.appearance = { ...(config.appearance ?? {}), aspectRatio: ratio, height: Math.round(width / ratio) };
                  })}
                />
                <div className="cd-margins">
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <label key={side} className="cd-mini">
                      <span>{tLabel(`cd.margin${side[0].toUpperCase()}${side.slice(1)}`)}</span>
                      <input
                        className="cd-input"
                        type="number"
                        value={show(draft.appearance?.margins?.[side])}
                        onChange={(event) => patch((config) => {
                          const margins = { top: 18, right: 20, bottom: 42, left: 54, ...(config.appearance?.margins ?? {}) };
                          margins[side] = num(event.target.value) ?? 0;
                          config.appearance = { ...(config.appearance ?? {}), margins };
                        })}
                      />
                    </label>
                  ))}
                </div>
              </Group>

              {contourReady && (
                <Group title={tLabel('cd.section.rsm')}>
                  <SelectField<ContourResolution>
                    label={tLabel('cd.resolution')}
                    value={contour.resolution}
                    options={[
                      { value: 'draft', label: tLabel('cd.res.draft') },
                      { value: 'standard', label: tLabel('cd.res.standard') },
                      { value: 'high', label: tLabel('cd.res.high') },
                      { value: 'ultra', label: tLabel('cd.res.ultra') },
                    ]}
                    onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), resolution: value }; })}
                  />
                  <SelectField<ContourRenderMode>
                    label={tLabel('cd.renderMode')}
                    value={contour.renderMode}
                    options={[
                      { value: 'lines', label: tLabel('cd.mode.lines') },
                      { value: 'filled', label: tLabel('cd.mode.filled') },
                      { value: 'filled-lines', label: tLabel('cd.mode.filledLines') },
                      { value: 'heatmap-continuous', label: tLabel('cd.mode.heatContinuous') },
                      { value: 'heatmap-discrete', label: tLabel('cd.mode.heatDiscrete') },
                    ]}
                    onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), renderMode: value }; })}
                  />
                  {model && (
                    <>
                      <SelectField
                        label={tLabel('cd.xFactor')}
                        value={String(rsm.xFactorIndex ?? 0)}
                        options={model.factorNames.map((name, i) => ({ value: String(i), label: name }))}
                        onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), xFactorIndex: Number(value) }; })}
                      />
                      <SelectField
                        label={tLabel('cd.yFactor')}
                        value={String(rsm.yFactorIndex ?? 1)}
                        options={model.factorNames.map((name, i) => ({ value: String(i), label: name }))}
                        onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), yFactorIndex: Number(value) }; })}
                      />
                      <SelectField
                        label={tLabel('cd.unitMode')}
                        value={rsm.unitMode ?? 'coded'}
                        options={[
                          { value: 'coded', label: tLabel('cd.unit.coded') },
                          { value: 'actual', label: tLabel('cd.unit.actual') },
                        ]}
                        onChange={(value) => patch((config) => {
                          config.rsm = { ...(config.rsm ?? {}), unitMode: value as 'coded' | 'actual', factorRanges: {}, holdingValues: {} };
                        })}
                      />
                      <div className="cd-sublabel">{tLabel('cd.holding')}</div>
                      {model.factorNames.map((name, index) => {
                        if (index === (rsm.xFactorIndex ?? 0) || index === (rsm.yFactorIndex ?? 1)) return null;
                        const fallback = (rsm.unitMode ?? 'coded') === 'actual' ? codedToActual(model, index, 0) : 0;
                        return (
                          <NumberField
                            key={name}
                            label={name}
                            value={rsm.holdingValues?.[index] ?? fallback}
                            step={0.1}
                            onChange={(value) => patch((config) => {
                              config.rsm = { ...(config.rsm ?? {}), holdingValues: { ...(config.rsm?.holdingValues ?? {}), [index]: value ?? 0 } };
                            })}
                          />
                        );
                      })}
                      <div className="cd-sublabel">{tLabel('cd.displayRange')}</div>
                      {[rsm.xFactorIndex ?? 0, rsm.yFactorIndex ?? 1].filter((v, i, list) => list.indexOf(v) === i).map((index) => {
                        const bound = model.codedBounds[index] ?? { min: -1, max: 1 };
                        const actual = (rsm.unitMode ?? 'coded') === 'actual';
                        const lo = actual ? codedToActual(model, index, bound.min) : bound.min;
                        const hi = actual ? codedToActual(model, index, bound.max) : bound.max;
                        const range = rsm.factorRanges?.[index];
                        return (
                          <div key={`range-${index}`} className="cd-pair">
                            <span className="cd-pair-label">{model.factorNames[index]}</span>
                            <input
                              className="cd-input"
                              type="number"
                              aria-label={`${model.factorNames[index]} ${tLabel('cd.rangeMin')}`}
                              value={show(range?.min ?? lo)}
                              onChange={(event) => patch((config) => {
                                const current = config.rsm?.factorRanges?.[index] ?? { min: lo, max: hi };
                                config.rsm = {
                                  ...(config.rsm ?? {}),
                                  factorRanges: { ...(config.rsm?.factorRanges ?? {}), [index]: { ...current, min: num(event.target.value) ?? lo } },
                                };
                              })}
                            />
                            <input
                              className="cd-input"
                              type="number"
                              aria-label={`${model.factorNames[index]} ${tLabel('cd.rangeMax')}`}
                              value={show(range?.max ?? hi)}
                              onChange={(event) => patch((config) => {
                                const current = config.rsm?.factorRanges?.[index] ?? { min: lo, max: hi };
                                config.rsm = {
                                  ...(config.rsm ?? {}),
                                  factorRanges: { ...(config.rsm?.factorRanges ?? {}), [index]: { ...current, max: num(event.target.value) ?? hi } },
                                };
                              })}
                            />
                          </div>
                        );
                      })}
                      <div className="cd-inline">
                        <Toggle label={tLabel('cd.showExperimental')} checked={rsm.showExperimentalPoints !== false} onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), showExperimentalPoints: value }; })} />
                        <Toggle label={tLabel('cd.showStationary')} checked={rsm.showStationaryPoint !== false} onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), showStationaryPoint: value }; })} />
                        <Toggle label={tLabel('cd.showOptimal')} checked={rsm.showOptimalPoint === true} onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), showOptimalPoint: value }; })} />
                      </div>
                      {extrapolated && (
                        <div className="cd-warn" data-testid="cd-extrapolation" role="status">
                          <b>{tLabel('cd.extrapolation')}</b>
                          <span>{model.stationary?.outsideRegion ? tLabel('cd.stationaryOutside') : tLabel('cd.extrapolationBody')}</span>
                        </div>
                      )}
                      <button type="button" className="btn ghost cd-wide" onClick={() => onGeneratePairs(draft)} data-testid="cd-generate-pairs">
                        {tLabel('cd.generatePairs')}
                      </button>
                      <small className="cd-hint">{t(lang, 'cd.generatePairsHint', { n: factorPairCount(model) })}</small>
                    </>
                  )}
                </Group>
              )}
            </>
          )}

          {tab === 'scale' && (
            <>
              <div className="cd-subtabs">
                {axisOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`cd-chip${scaleAxis === option.value ? ' active' : ''}`}
                    onClick={() => setScaleAxis(option.value)}
                    data-testid={`cd-axis-${option.value}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {scaleAxis === 'z' ? (
                <>
                  <Group title={tLabel('cd.levels')}>
                    <NumberField label={tLabel('cd.zMin')} value={contour.zMin} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), zMin: value }; })} />
                    <NumberField label={tLabel('cd.zMax')} value={contour.zMax} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), zMax: value }; })} />
                    <SelectField
                      label={tLabel('cd.levelMode')}
                      value={contour.levelMode}
                      options={[
                        { value: 'auto', label: tLabel('cd.level.auto') },
                        { value: 'manual', label: tLabel('cd.level.manual') },
                        { value: 'custom', label: tLabel('cd.level.custom') },
                      ]}
                      onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), levelMode: value as ContourConfig['levelMode'] }; })}
                    />
                    <NumberField label={tLabel('cd.levelCount')} value={contour.levelCount} min={2} max={50} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), levelCount: value ?? 10 }; })} />
                    {contour.levelMode === 'manual' && (
                      <NumberField label={tLabel('cd.levelInterval')} value={contour.levelInterval} step={0.1} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), levelInterval: value }; })} />
                    )}
                    {contour.levelMode === 'custom' && (
                      <TextField
                        label={tLabel('cd.customLevels')}
                        value={contour.customLevels.join(', ')}
                        onChange={(value) => patch((config) => {
                          const levels = value.split(',').map((part) => Number(part.trim())).filter((v) => Number.isFinite(v));
                          config.contour = { ...(config.contour ?? {}), customLevels: levels };
                        })}
                      />
                    )}
                  </Group>
                  <Group title={tLabel('cd.target')}>
                    <NumberField label={tLabel('cd.target')} value={contour.targetValue} step={0.1} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), targetValue: value }; })} />
                    <NumberField label={tLabel('cd.tolerance')} value={contour.targetTolerance} step={0.1} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), targetTolerance: value }; })} />
                    <NumberField label={tLabel('cd.specLsl')} value={contour.specLsl} step={0.1} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), specLsl: value }; })} />
                    <NumberField label={tLabel('cd.specUsl')} value={contour.specUsl} step={0.1} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), specUsl: value }; })} />
                    <Toggle label={tLabel('cd.specRegion')} checked={contour.showSpecRegion} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), showSpecRegion: value }; })} />
                  </Group>

                  <Group title={tLabel('cd.contourColors')}>
                    <label className="cd-row cd-column">
                      <span className="cd-row-label">{tLabel('cd.customStops')}</span>
                      <textarea
                        className="cd-input"
                        rows={3}
                        placeholder="0:#f6f3ff, 10:#a78bfa, 20:#45308f"
                        value={contour.customStops.map((stop) => `${stop.value}:${stop.color}`).join('\n')}
                        onChange={(event) => patch((config) => {
                          const stops = event.target.value.split(/[\n,]/).map((line) => line.trim()).filter(Boolean).map((line) => {
                            const [value, color] = line.split(':');
                            return { value: Number(value), color: (color ?? '').trim() };
                          }).filter((stop) => Number.isFinite(stop.value) && /^#[0-9a-f]{3,8}$/i.test(stop.color));
                          config.contour = { ...(config.contour ?? {}), customStops: stops };
                        })}
                        data-testid="cd-custom-stops"
                      />
                      <small className="cd-hint">{tLabel('cd.customStopsHint')}</small>
                    </label>
                    <ColorField label={tLabel('cd.underflow')} value={contour.underflowColor} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), underflowColor: value }; })} />
                    <ColorField label={tLabel('cd.overflow')} value={contour.overflowColor} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), overflowColor: value }; })} />
                    <SelectField
                      label={tLabel('cd.maskedStyle')}
                      value={contour.maskedStyle}
                      options={[
                        { value: 'blank', label: tLabel('cd.masked.blank') },
                        { value: 'gray', label: tLabel('cd.masked.gray') },
                        { value: 'hatch', label: tLabel('cd.masked.hatch') },
                      ]}
                      onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), maskedStyle: value as ContourConfig['maskedStyle'] }; })}
                      testId="cd-masked-style"
                    />
                    <NumberField label={tLabel('cd.labelFont')} value={contour.labelFontSize} min={4} max={24} step={0.2} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), labelFontSize: value ?? 7.4 }; })} testId="cd-label-size" />
                    <NumberField label={tLabel('cd.labelDecimals')} value={contour.labelDecimals} min={0} max={8} step={1} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), labelDecimals: value }; })} testId="cd-label-decimals" />
                  </Group>

                  <Group title={tLabel('cd.levelStyles')}>
                    <p className="cd-hint">{tLabel('cd.levelStylesHint')}</p>
                    {Array.from({ length: Math.max(2, Math.min(12, contour.levelCount)) }, (_, index) => {
                      const style = contour.levelStyles.find((entry) => entry.index === index) ?? { index };
                      const update = (patchStyle: (entry: NonNullable<ContourConfig['levelStyles']>[number]) => void) => patch((config) => {
                        const current = [...(config.contour?.levelStyles ?? [])];
                        const at = current.findIndex((entry) => entry.index === index);
                        const next = at >= 0 ? { ...current[at] } : { index };
                        patchStyle(next);
                        if (at >= 0) current[at] = next;
                        else current.push(next);
                        config.contour = { ...(config.contour ?? {}), levelStyles: current };
                      });
                      return (
                        <div className="cd-pair" key={index} data-testid={`cd-level-${index}`}>
                          <span className="cd-pair-label">{index + 1}</span>
                          <input className="cd-input" type="color" aria-label={`level ${index + 1} color`} value={/^#[0-9a-f]{6}$/i.test(style.color ?? '') ? (style.color as string) : '#8b6ce8'} onChange={(event) => update((entry) => { entry.color = event.target.value; })} />
                          <input className="cd-input" type="number" step={0.2} min={0} max={8} aria-label={`level ${index + 1} width`} value={show(style.lineWidth ?? contour.lineWidth)} onChange={(event) => update((entry) => { entry.lineWidth = num(event.target.value) ?? contour.lineWidth; })} />
                          <input className="cd-input" type="text" placeholder="dash" aria-label={`level ${index + 1} dash`} value={style.lineDash ?? ''} onChange={(event) => update((entry) => { entry.lineDash = event.target.value; })} />
                          <input type="checkbox" aria-label={`level ${index + 1} label`} checked={style.showLabel ?? contour.showContourLabels} onChange={(event) => update((entry) => { entry.showLabel = event.target.checked; })} />
                        </div>
                      );
                    })}
                  </Group>
                </>
              ) : (
                <>
                  <Group title={tLabel('cd.scaleAxis')}>
                    <Toggle label={tLabel('cd.autoRange')} checked={axis.autoRange !== false} onChange={(value) => patchAxis((config) => { config.autoRange = value; if (value) { config.min = null; config.max = null; } })} />
                    <NumberField label={tLabel('cd.min')} value={axis.min} onChange={(value) => patchAxis((config) => { config.min = value; config.autoRange = value == null && config.max == null; })} />
                    <NumberField label={tLabel('cd.max')} value={axis.max} onChange={(value) => patchAxis((config) => { config.max = value; config.autoRange = value == null && config.min == null; })} />
                    <NumberField label={tLabel('cd.majorInterval')} value={axis.majorInterval} step={0.1} onChange={(value) => patchAxis((config) => { config.majorInterval = value; })} />
                    <NumberField label={tLabel('cd.minorInterval')} value={axis.minorInterval} step={0.1} onChange={(value) => patchAxis((config) => { config.minorInterval = value; })} />
                    <SelectField
                      label={tLabel('cd.scaleType')}
                      value={axis.scale ?? 'linear'}
                      options={[
                        { value: 'linear', label: tLabel('cd.scale.linear') },
                        { value: 'log10', label: tLabel('cd.scale.log10') },
                        { value: 'ln', label: tLabel('cd.scale.ln') },
                        { value: 'symlog', label: tLabel('cd.scale.symlog') },
                        { value: 'power', label: tLabel('cd.scale.power') },
                      ]}
                      onChange={(value) => patchAxis((config) => { config.scale = value as AxisConfig['scale']; })}
                      testId="cd-scale-type"
                    />
                    {axis.scale === 'power' && (
                      <NumberField label={tLabel('cd.power')} value={axis.power ?? 0.5} step={0.05} min={0.05} max={5} onChange={(value) => patchAxis((config) => { config.power = value ?? 0.5; })} testId="cd-power" />
                    )}
                    {axis.scale === 'symlog' && (
                      <NumberField label={tLabel('cd.logConstant')} value={axis.logConstant ?? 1} step={0.1} onChange={(value) => patchAxis((config) => { config.logConstant = value && value > 0 ? value : 1; })} testId="cd-log-constant" />
                    )}
                    {logWarning && <div className="cd-warn" data-testid="cd-log-warning" role="status">{tLabel('cd.logWarning')}</div>}
                    <Toggle label={tLabel('cd.reverse')} checked={axis.reverse === true} onChange={(value) => patchAxis((config) => { config.reverse = value; })} />
                    <TextField label={tLabel('cd.axisTitle')} value={axis.title} onChange={(value) => patchAxis((config) => { config.title = value; })} />
                    <TextField label={tLabel('cd.axisUnit')} value={axis.unit} onChange={(value) => patchAxis((config) => { config.unit = value; })} />
                    <NumberField label={tLabel('cd.decimals')} value={axis.decimals} min={0} max={12} onChange={(value) => patchAxis((config) => { config.decimals = value; })} />
                    <Toggle label={tLabel('cd.scientific')} checked={axis.scientific === true} onChange={(value) => patchAxis((config) => { config.scientific = value; })} />
                    <Toggle label={tLabel('cd.thousands')} checked={axis.thousandsSep === true} onChange={(value) => patchAxis((config) => { config.thousandsSep = value; })} />
                    <SelectField
                      label={tLabel('cd.tickDirection')}
                      value={axis.tickDirection ?? 'out'}
                      options={[
                        { value: 'in', label: tLabel('cd.tick.in') },
                        { value: 'out', label: tLabel('cd.tick.out') },
                        { value: 'both', label: tLabel('cd.tick.both') },
                        { value: 'none', label: tLabel('cd.tick.none') },
                      ]}
                      onChange={(value) => patchAxis((config) => { config.tickDirection = value as AxisConfig['tickDirection']; })}
                    />
                    <Toggle label={tLabel('cd.majorGrid')} checked={axis.showMajorGrid !== false} onChange={(value) => patchAxis((config) => { config.showMajorGrid = value; })} />
                    <Toggle label={tLabel('cd.minorGrid')} checked={axis.showMinorGrid === true} onChange={(value) => patchAxis((config) => { config.showMinorGrid = value; })} />
                    <NumberField label={tLabel('cd.axisMargin')} value={axis.axisMargin} step={0.01} onChange={(value) => patchAxis((config) => { config.axisMargin = value ?? 0.06; })} />
                    <SelectField
                      label={tLabel('cd.crossAt')}
                      value={typeof axis.crossAt === 'number' ? 'custom' : (axis.crossAt ?? 'auto')}
                      options={[
                        { value: 'auto', label: tLabel('cd.cross.auto') },
                        { value: 'zero', label: tLabel('cd.cross.zero') },
                        { value: 'custom', label: tLabel('cd.cross.custom') },
                      ]}
                      onChange={(value) => patchAxis((config) => {
                        config.crossAt = value === 'custom' ? 0 : (value as 'auto' | 'zero');
                      })}
                    />
                    {typeof axis.crossAt === 'number' && (
                      <NumberField label={tLabel('cd.cross.custom')} value={axis.crossAt} onChange={(value) => patchAxis((config) => { config.crossAt = value ?? 'auto'; })} />
                    )}
                    {(chart.kind === 'probplot' || chart.kind === 'normalprob') && (
                      <Toggle label={tLabel('cd.probGrid')} checked={draft.probplot?.showProbGrid !== false} onChange={(value) => patch((config) => { config.probplot = { ...(config.probplot ?? {}), showProbGrid: value }; })} />
                    )}
                    {chart.kind === 'control' && (
                      <Toggle label={tLabel('cd.stageLimits')} checked={draft.spc?.showStagedLimits !== false} onChange={(value) => patch((config) => { config.spc = { ...(config.spc ?? {}), showStagedLimits: value }; })} />
                    )}
                    {(chart.kind === 'bar' || chart.kind === 'pareto') && (
                      <>
                        <label className="cd-row cd-column">
                          <span className="cd-row-label">{tLabel('cd.categoryOrder')}</span>
                          <textarea
                            className="cd-input"
                            rows={3}
                            value={(axis.categoryOrder ?? []).join('\n')}
                            onChange={(event) => patchAxis((config) => {
                              const order = event.target.value.split('\n').map((line) => line.trim()).filter(Boolean);
                              config.categoryOrder = order.length ? order : undefined;
                            })}
                          />
                          <small className="cd-hint">{tLabel('cd.categoryOrderHint')}</small>
                        </label>
                      </>
                    )}
                  </Group>

                  <Group title={tLabel('cd.ticksAdvanced')}>
                    <NumberField label={tLabel('cd.tickCount')} value={axis.tickCount} min={2} max={20} step={1} onChange={(value) => patchAxis((config) => { config.tickCount = value == null ? null : Math.round(value); })} testId="cd-tick-count" />
                    <TextField
                      label={tLabel('cd.tickValues')}
                      value={(axis.tickValues ?? []).join(', ')}
                      placeholder="0, 10, 20"
                      onChange={(value) => patchAxis((config) => {
                        const values = value.split(',').map((part) => Number(part.trim())).filter((v) => Number.isFinite(v));
                        config.tickValues = values;
                        config.tickCount = values.length ? null : config.tickCount ?? null;
                      })}
                    />
                    <small className="cd-hint">{tLabel('cd.tickValuesHint')}</small>
                    <NumberField label={tLabel('cd.minorCount')} value={axis.minorTickCount} min={1} max={20} step={1} onChange={(value) => patchAxis((config) => { config.minorTickCount = value == null ? null : Math.round(value); })} testId="cd-minor-count" />
                    <NumberField label={tLabel('cd.tickLength')} value={axis.tickLength} min={0} max={40} step={0.5} onChange={(value) => patchAxis((config) => { config.tickLength = value; })} testId="cd-tick-length" />
                    <Toggle label={tLabel('cd.axisLine')} checked={axis.showAxisLine !== false} onChange={(value) => patchAxis((config) => { config.showAxisLine = value; })} testId="cd-axis-line" />
                    <Toggle label={tLabel('cd.tickLabels')} checked={axis.showTickLabels !== false} onChange={(value) => patchAxis((config) => { config.showTickLabels = value; })} testId="cd-tick-labels" />
                  </Group>

                  <Group title={tLabel('cd.axisBreak')}>
                    <Toggle
                      label={tLabel('cd.axisBreakOn')}
                      checked={Boolean(axis.axisBreak)}
                      onChange={(value) => patchAxis((config) => {
                        const range: [number, number] = config.min != null && config.max != null && config.max > config.min
                          ? [config.min, config.max]
                          : (axisDataRange(chart, scaleAxis === 'x' ? 'x' : 'y') ?? [0, 10]);
                        const span = range[1] - range[0];
                        config.axisBreak = value ? { from: range[0] + span * 0.4, to: range[0] + span * 0.6, size: 10 } : null;
                      })}
                      testId="cd-axis-break"
                    />
                    {axis.axisBreak && (
                      <>
                        <NumberField label={tLabel('cd.breakFrom')} value={axis.axisBreak.from} onChange={(value) => patchAxis((config) => { if (config.axisBreak && value != null) config.axisBreak = { ...config.axisBreak, from: value }; })} testId="cd-break-from" />
                        <NumberField label={tLabel('cd.breakTo')} value={axis.axisBreak.to} onChange={(value) => patchAxis((config) => { if (config.axisBreak && value != null) config.axisBreak = { ...config.axisBreak, to: value }; })} testId="cd-break-to" />
                        <NumberField label={tLabel('cd.breakSize')} value={axis.axisBreak.size} min={2} max={60} step={1} onChange={(value) => patchAxis((config) => { if (config.axisBreak) config.axisBreak = { ...config.axisBreak, size: value ?? 10 }; })} testId="cd-break-size" />
                        <small className="cd-hint">{tLabel('cd.axisBreakHint')}</small>
                      </>
                    )}
                  </Group>

                  <Group title={tLabel('cd.dateAxis')}>
                    <Toggle
                      label={tLabel('cd.dateAxisOn')}
                      checked={Boolean(axis.dateAxis)}
                      onChange={(value) => patchAxis((config) => { config.dateAxis = value ? { epoch: 0, unit: 'day', format: 'date' } : null; })}
                      testId="cd-date-axis"
                    />
                    {axis.dateAxis && (
                      <>
                        <NumberField label={tLabel('cd.dateEpoch')} value={axis.dateAxis.epoch} step={86400000} onChange={(value) => patchAxis((config) => { if (config.dateAxis) config.dateAxis = { ...config.dateAxis, epoch: value ?? 0 }; })} testId="cd-date-epoch" />
                        <SelectField
                          label={tLabel('cd.dateUnit')}
                          value={axis.dateAxis.unit}
                          options={[
                            { value: 'day', label: tLabel('cd.date.day') },
                            { value: 'week', label: tLabel('cd.date.week') },
                            { value: 'month', label: tLabel('cd.date.month') },
                            { value: 'year', label: tLabel('cd.date.year') },
                          ]}
                          onChange={(value) => patchAxis((config) => { if (config.dateAxis) config.dateAxis = { ...config.dateAxis, unit: value }; })}
                          testId="cd-date-unit"
                        />
                        <SelectField
                          label={tLabel('cd.dateFormat')}
                          value={axis.dateAxis.format}
                          options={[
                            { value: 'date', label: tLabel('cd.dateFormat.date') },
                            { value: 'month-year', label: tLabel('cd.dateFormat.month') },
                            { value: 'year', label: tLabel('cd.dateFormat.year') },
                          ]}
                          onChange={(value) => patchAxis((config) => { if (config.dateAxis) config.dateAxis = { ...config.dateAxis, format: value }; })}
                          testId="cd-date-format"
                        />
                        <small className="cd-hint">{tLabel('cd.dateHint')}</small>
                      </>
                    )}
                  </Group>

                  <Group title={tLabel('cd.secondaryAxis')}>
                    <Toggle
                      label={tLabel('cd.secondaryOn')}
                      checked={Boolean(axis.secondary)}
                      onChange={(value) => patchAxis((config) => { config.secondary = value ? { title: '', unit: '', min: null, max: null, decimals: null, showGrid: false } : null; })}
                      testId="cd-secondary"
                    />
                    {axis.secondary && (
                      <>
                        <TextField label={tLabel('cd.axisTitle')} value={axis.secondary.title} onChange={(value) => patchAxis((config) => { if (config.secondary) config.secondary = { ...config.secondary, title: value }; })} />
                        <TextField label={tLabel('cd.axisUnit')} value={axis.secondary.unit} onChange={(value) => patchAxis((config) => { if (config.secondary) config.secondary = { ...config.secondary, unit: value }; })} />
                        <NumberField label={tLabel('cd.min')} value={axis.secondary.min} onChange={(value) => patchAxis((config) => { if (config.secondary) config.secondary = { ...config.secondary, min: value }; })} />
                        <NumberField label={tLabel('cd.max')} value={axis.secondary.max} onChange={(value) => patchAxis((config) => { if (config.secondary) config.secondary = { ...config.secondary, max: value }; })} />
                        <NumberField label={tLabel('cd.decimals')} value={axis.secondary.decimals} min={0} max={12} onChange={(value) => patchAxis((config) => { if (config.secondary) config.secondary = { ...config.secondary, decimals: value }; })} />
                        <Toggle label={tLabel('cd.majorGrid')} checked={axis.secondary.showGrid === true} onChange={(value) => patchAxis((config) => { if (config.secondary) config.secondary = { ...config.secondary, showGrid: value }; })} />
                      </>
                    )}
                    <small className="cd-hint">{tLabel('cd.secondaryHint')}</small>
                  </Group>
                </>
              )}
            </>
          )}

          {tab === 'series' && (
            <>
              <Group title={tLabel('cd.seriesLook')}>
                <NumberField label={tLabel('cd.lineWidth')} value={draft.series?.lineWidth} step={0.1} min={0.5} max={8} onChange={(value) => patch((config) => { config.series = { ...(config.series ?? {}), lineWidth: value ?? 1.7 }; })} />
                <TextField label={tLabel('cd.lineDash')} value={draft.series?.lineDash} placeholder="6 3" onChange={(value) => patch((config) => { config.series = { ...(config.series ?? {}), lineDash: value }; })} />
                <SelectField
                  label={tLabel('cd.markerShape')}
                  value={draft.series?.markerShape ?? 'circle'}
                  options={MARKERS.map((shape) => ({ value: shape, label: tLabel(`cd.shape.${shape}`) }))}
                  onChange={(value) => patch((config) => { config.series = { ...(config.series ?? {}), markerShape: value }; })}
                />
                <NumberField label={tLabel('cd.markerSize')} value={draft.series?.markerSize} step={0.2} min={1} max={12} onChange={(value) => patch((config) => { config.series = { ...(config.series ?? {}), markerSize: value ?? 3.1 }; })} />
                <NumberField label={tLabel('cd.fillOpacity')} value={draft.series?.fillOpacity} step={0.05} min={0} max={1} onChange={(value) => patch((config) => { config.series = { ...(config.series ?? {}), fillOpacity: value ?? 0.72 }; })} />
                <TextField
                  label={tLabel('cd.palette')}
                  value={(draft.series?.palette ?? []).join(', ')}
                  onChange={(value) => patch((config) => {
                    const colors = value.split(',').map((part) => part.trim()).filter(Boolean);
                    config.series = { ...(config.series ?? {}), palette: colors };
                  })}
                />
                <small className="cd-hint">{tLabel('cd.paletteHint')}</small>
              </Group>

              <Group title={tLabel('cd.seriesAdvanced')}>
                <Toggle label={tLabel('cd.areaFill')} checked={draft.seriesAdvanced?.areaFill === true} onChange={(value) => patch((config) => { config.seriesAdvanced = { ...(config.seriesAdvanced ?? {}), areaFill: value }; })} testId="cd-area-fill" />
                <NumberField label={tLabel('cd.areaOpacity')} value={draft.seriesAdvanced?.areaOpacity} step={0.05} min={0} max={1} onChange={(value) => patch((config) => { config.seriesAdvanced = { ...(config.seriesAdvanced ?? {}), areaOpacity: value ?? 0.22 }; })} testId="cd-area-opacity" />
                <Toggle label={tLabel('cd.dropLines')} checked={draft.seriesAdvanced?.dropLines === true} onChange={(value) => patch((config) => { config.seriesAdvanced = { ...(config.seriesAdvanced ?? {}), dropLines: value }; })} testId="cd-drop-lines" />
                <ColorField label={tLabel('cd.dropLineColor')} value={draft.seriesAdvanced?.dropLineColor} onChange={(value) => patch((config) => { config.seriesAdvanced = { ...(config.seriesAdvanced ?? {}), dropLineColor: value }; })} />
                <TextField
                  label={tLabel('cd.seriesOrder')}
                  value={(draft.seriesAdvanced?.order ?? []).join(', ')}
                  placeholder="1, 0"
                  onChange={(value) => patch((config) => {
                    const order = value.split(',').map((part) => Number(part.trim())).filter((index) => Number.isInteger(index) && index >= 0);
                    config.seriesAdvanced = { ...(config.seriesAdvanced ?? {}), order };
                  })}
                />
                <small className="cd-hint">{tLabel('cd.seriesOrderHint')}</small>
                <TextField
                  label={tLabel('cd.secondarySeries')}
                  value={(draft.seriesAdvanced?.secondarySeries ?? []).join(', ')}
                  placeholder="1"
                  testId="cd-secondary-series"
                  onChange={(value) => patch((config) => {
                    const indices = value.split(',').map((part) => Number(part.trim())).filter((index) => Number.isInteger(index) && index >= 0);
                    config.seriesAdvanced = { ...(config.seriesAdvanced ?? {}), secondarySeries: indices };
                  })}
                />
                <small className="cd-hint">{tLabel('cd.secondarySeriesHint')}</small>
              </Group>

              <Group title={tLabel('cd.errorBars')}>
                <SelectField
                  label={tLabel('cd.errorKind')}
                  value={draft.seriesAdvanced?.errorBars?.kind ?? 'none'}
                  options={[
                    { value: 'none', label: tLabel('cd.errorNone') },
                    { value: 'sd', label: tLabel('cd.errorSd') },
                    { value: 'se', label: tLabel('cd.errorSe') },
                    { value: 'ci', label: tLabel('cd.errorCi') },
                  ]}
                  onChange={(value) => patch((config) => { config.seriesAdvanced = { ...(config.seriesAdvanced ?? {}), errorBars: { ...defaultErrorBarConfig(), ...(config.seriesAdvanced?.errorBars ?? {}), kind: value as 'none' | 'sd' | 'se' | 'ci' } }; })}
                  testId="cd-error-kind"
                />
                <SelectField
                  label={tLabel('cd.errorScope')}
                  value={draft.seriesAdvanced?.errorBars?.scope ?? 'point'}
                  options={[
                    { value: 'point', label: tLabel('cd.errorPoint') },
                    { value: 'series', label: tLabel('cd.errorSeries') },
                  ]}
                  onChange={(value) => patch((config) => { config.seriesAdvanced = { ...(config.seriesAdvanced ?? {}), errorBars: { ...defaultErrorBarConfig(), ...(config.seriesAdvanced?.errorBars ?? {}), scope: value as 'point' | 'series' } }; })}
                  testId="cd-error-scope"
                />
                <NumberField label={tLabel('cd.errorConf')} value={draft.seriesAdvanced?.errorBars?.conf} step={0.01} min={0.5} max={0.999} onChange={(value) => patch((config) => { config.seriesAdvanced = { ...(config.seriesAdvanced ?? {}), errorBars: { ...defaultErrorBarConfig(), ...(config.seriesAdvanced?.errorBars ?? {}), conf: value ?? 0.95 } }; })} testId="cd-error-conf" />
                <NumberField label={tLabel('cd.errorCaps')} value={draft.seriesAdvanced?.errorBars?.capWidth} step={1} min={0} max={20} onChange={(value) => patch((config) => { config.seriesAdvanced = { ...(config.seriesAdvanced ?? {}), errorBars: { ...defaultErrorBarConfig(), ...(config.seriesAdvanced?.errorBars ?? {}), capWidth: value ?? 3 } }; })} testId="cd-error-caps" />
                <small className="cd-hint">{tLabel('cd.errorHint')}</small>
              </Group>

              <Group title={tLabel('cd.pointStyle')}>
                <NumberField label={tLabel('cd.pointIndex')} value={pointStyleIndex + 1} min={1} step={1} onChange={(value) => setPointStyleIndex(Math.max(0, Math.round((value ?? 1) - 1)))} testId="cd-point-index" />
                <SelectField
                  label={tLabel('cd.markerShape')}
                  value={(draft.seriesAdvanced?.pointStyles?.[pointStyleIndex]?.shape ?? 'circle') as MarkerShape}
                  options={MARKERS.map((shape) => ({ value: shape, label: tLabel(`cd.shape.${shape}`) }))}
                  onChange={(value) => patch((config) => {
                    config.seriesAdvanced = {
                      ...(config.seriesAdvanced ?? {}),
                      pointStyles: { ...(config.seriesAdvanced?.pointStyles ?? {}), [pointStyleIndex]: { ...(config.seriesAdvanced?.pointStyles?.[pointStyleIndex] ?? {}), shape: value } },
                    };
                  })}
                  testId="cd-point-shape"
                />
                <NumberField label={tLabel('cd.markerSize')} value={draft.seriesAdvanced?.pointStyles?.[pointStyleIndex]?.size} step={0.2} min={1} max={12} onChange={(value) => patch((config) => {
                  config.seriesAdvanced = {
                    ...(config.seriesAdvanced ?? {}),
                    pointStyles: { ...(config.seriesAdvanced?.pointStyles ?? {}), [pointStyleIndex]: { ...(config.seriesAdvanced?.pointStyles?.[pointStyleIndex] ?? {}), size: value ?? undefined } },
                  };
                })} />
                <ColorField label={tLabel('cd.color')} value={draft.seriesAdvanced?.pointStyles?.[pointStyleIndex]?.color} onChange={(value) => patch((config) => {
                  config.seriesAdvanced = {
                    ...(config.seriesAdvanced ?? {}),
                    pointStyles: { ...(config.seriesAdvanced?.pointStyles ?? {}), [pointStyleIndex]: { ...(config.seriesAdvanced?.pointStyles?.[pointStyleIndex] ?? {}), color: value } },
                  };
                })} />
                <small className="cd-hint">{tLabel('cd.pointStyleHint')}</small>
              </Group>

              {seriesCountOf(chart) > 0 && (
                <Group title={tLabel('cd.perSeries')}>
                  {Array.from({ length: seriesCountOf(chart) }, (_, index) => {
                    const override = draft.series?.perSeries?.[index] ?? {};
                    return (
                      <div key={index} className="cd-series">
                        <span className="cd-series-name">{t(lang, 'cd.seriesN', { n: index + 1 })}</span>
                        <span className="cd-color">
                          <input
                            type="color"
                            aria-label={`${t(lang, 'cd.seriesN', { n: index + 1 })} ${tLabel('cd.color')}`}
                            value={/^#[0-9a-f]{6}$/i.test(override.color ?? '') ? (override.color as string) : (CHART_STYLE_PRESETS[(draft.appearance?.preset as ChartStylePresetId) ?? 'engineering']?.series[index % 6] ?? '#1f4e79')}
                            onChange={(event) => patch((config) => {
                              config.series = {
                                ...(config.series ?? {}),
                                perSeries: { ...(config.series?.perSeries ?? {}), [index]: { ...(config.series?.perSeries?.[index] ?? {}), color: event.target.value } },
                              };
                            })}
                          />
                          <input
                            className="cd-input"
                            type="text"
                            value={override.color ?? ''}
                            placeholder="auto"
                            onChange={(event) => patch((config) => {
                              config.series = {
                                ...(config.series ?? {}),
                                perSeries: { ...(config.series?.perSeries ?? {}), [index]: { ...(config.series?.perSeries?.[index] ?? {}), color: event.target.value || undefined } },
                              };
                            })}
                          />
                        </span>
                        <label className="cd-mini-inline">
                          <input
                            type="checkbox"
                            checked={override.visible !== false}
                            onChange={(event) => patch((config) => {
                              config.series = {
                                ...(config.series ?? {}),
                                perSeries: { ...(config.series?.perSeries ?? {}), [index]: { ...(config.series?.perSeries?.[index] ?? {}), visible: event.target.checked } },
                              };
                            })}
                          />
                          {tLabel('cd.visible')}
                        </label>
                      </div>
                    );
                  })}
                </Group>
              )}

              <Group title={tLabel('cd.chartOptions')}>
                {chart.kind === 'scatter' && (
                  <>
                    <Toggle label={tLabel('cd.opt.fit')} checked={draft.scatter?.showRegression !== false} onChange={(value) => patch((config) => { config.scatter = { ...(config.scatter ?? {}), showRegression: value }; })} />
                    <Toggle label={tLabel('cd.opt.meanCi')} checked={draft.scatter?.showMeanCi === true} onChange={(value) => patch((config) => { config.scatter = { ...(config.scatter ?? {}), showMeanCi: value }; })} />
                    <Toggle label={tLabel('cd.opt.predBand')} checked={draft.scatter?.showPredictionBand === true} onChange={(value) => patch((config) => { config.scatter = { ...(config.scatter ?? {}), showPredictionBand: value }; })} />
                    <Toggle label={tLabel('cd.opt.equation')} checked={draft.scatter?.showEquation === true} onChange={(value) => patch((config) => { config.scatter = { ...(config.scatter ?? {}), showEquation: value }; })} />
                    <Toggle label={tLabel('cd.opt.r2')} checked={draft.scatter?.showR2 !== false} onChange={(value) => patch((config) => { config.scatter = { ...(config.scatter ?? {}), showR2: value }; })} />
                    <Toggle label={tLabel('cd.opt.dataLabels')} checked={draft.scatter?.showDataLabels === true} onChange={(value) => patch((config) => { config.scatter = { ...(config.scatter ?? {}), showDataLabels: value }; })} />
                  </>
                )}
                {chart.kind === 'histogram' && (
                  <>
                    <NumberField label={tLabel('cd.opt.bins')} value={draft.histogram?.binCount} min={2} max={80} onChange={(value) => patch((config) => { config.histogram = { ...(config.histogram ?? {}), binCount: value }; })} />
                    <NumberField label={tLabel('cd.opt.binWidth')} value={draft.histogram?.binWidth} step={0.1} onChange={(value) => patch((config) => { config.histogram = { ...(config.histogram ?? {}), binWidth: value }; })} />
                    <NumberField label={tLabel('cd.opt.binStart')} value={draft.histogram?.binStart} step={0.1} onChange={(value) => patch((config) => { config.histogram = { ...(config.histogram ?? {}), binStart: value }; })} />
                    <SelectField
                      label={tLabel('cd.opt.yMode')}
                      value={draft.histogram?.type ?? 'frequency'}
                      options={[
                        { value: 'frequency', label: tLabel('cd.opt.frequency') },
                        { value: 'relative', label: tLabel('cd.opt.relative') },
                        { value: 'density', label: tLabel('cd.opt.density') },
                      ]}
                      onChange={(value) => patch((config) => { config.histogram = { ...(config.histogram ?? {}), type: value as 'frequency' | 'relative' | 'density' }; })}
                    />
                    <Toggle label={tLabel('cd.opt.fittedCurve')} checked={draft.histogram?.showFittedCurve === true} onChange={(value) => patch((config) => { config.histogram = { ...(config.histogram ?? {}), showFittedCurve: value }; })} />
                    <Toggle label={tLabel('cd.opt.specLines')} checked={draft.histogram?.showSpecLines !== false} onChange={(value) => patch((config) => { config.histogram = { ...(config.histogram ?? {}), showSpecLines: value }; })} />
                    <Toggle label={tLabel('cd.opt.mean')} checked={draft.histogram?.showMean === true} onChange={(value) => patch((config) => { config.histogram = { ...(config.histogram ?? {}), showMean: value }; })} />
                    <Toggle label={tLabel('cd.opt.median')} checked={draft.histogram?.showMedian === true} onChange={(value) => patch((config) => { config.histogram = { ...(config.histogram ?? {}), showMedian: value }; })} />
                  </>
                )}
                {chart.kind === 'boxplot' && (
                  <>
                    <SelectField
                      label={tLabel('cd.opt.orientation')}
                      value={draft.boxplot?.orientation ?? 'vertical'}
                      options={[
                        { value: 'vertical', label: tLabel('cd.opt.vertical') },
                        { value: 'horizontal', label: tLabel('cd.opt.horizontal') },
                      ]}
                      onChange={(value) => patch((config) => { config.boxplot = { ...(config.boxplot ?? {}), orientation: value as 'vertical' | 'horizontal' }; })}
                    />
                    <Toggle label={tLabel('cd.opt.outliers')} checked={draft.boxplot?.showOutliers !== false} onChange={(value) => patch((config) => { config.boxplot = { ...(config.boxplot ?? {}), showOutliers: value }; })} />
                    <SelectField
                      label={tLabel('cd.opt.whisker')}
                      value={draft.boxplot?.whiskerRule ?? 'iqr'}
                      options={[
                        { value: 'iqr', label: tLabel('cd.opt.whiskerIqr') },
                        { value: 'minmax', label: tLabel('cd.opt.whiskerMinMax') },
                        { value: 'p5_95', label: tLabel('cd.opt.whiskerP595') },
                      ]}
                      onChange={(value) => patch((config) => { config.boxplot = { ...(config.boxplot ?? {}), whiskerRule: value as 'iqr' | 'minmax' | 'p5_95' }; })}
                    />
                    <Toggle label={tLabel('cd.opt.meanMarker')} checked={draft.boxplot?.showMean !== false} onChange={(value) => patch((config) => { config.boxplot = { ...(config.boxplot ?? {}), showMean: value }; })} />
                    <Toggle label={tLabel('cd.opt.points')} checked={draft.boxplot?.showPoints === true} onChange={(value) => patch((config) => { config.boxplot = { ...(config.boxplot ?? {}), showPoints: value }; })} />
                  </>
                )}
                {chart.kind === 'control' && (
                  <>
                    <Toggle label={tLabel('cd.opt.limits')} checked={draft.spc?.showLimits !== false} onChange={(value) => patch((config) => { config.spc = { ...(config.spc ?? {}), showLimits: value }; })} />
                    <Toggle label={tLabel('cd.opt.centerLine')} checked={draft.spc?.showCenter !== false} onChange={(value) => patch((config) => { config.spc = { ...(config.spc ?? {}), showCenter: value }; })} />
                    <Toggle label={tLabel('cd.opt.violations')} checked={draft.spc?.showViolations !== false} onChange={(value) => patch((config) => { config.spc = { ...(config.spc ?? {}), showViolations: value }; })} />
                    <Toggle label={tLabel('cd.opt.specLines')} checked={draft.spc?.showSpecLines === true} onChange={(value) => patch((config) => { config.spc = { ...(config.spc ?? {}), showSpecLines: value }; })} />
                    <NumberField label={tLabel('cd.opt.windowFrom')} value={draft.spc?.observationWindow?.from} min={1} onChange={(value) => patch((config) => {
                      const to = config.spc?.observationWindow?.to ?? (chart.kind === 'control' ? chart.panel.points.length : 0);
                      config.spc = { ...(config.spc ?? {}), observationWindow: value == null ? null : { from: Math.max(1, Math.round(value)), to } };
                    })} />
                    <NumberField label={tLabel('cd.opt.windowTo')} value={draft.spc?.observationWindow?.to} min={1} onChange={(value) => patch((config) => {
                      const from = config.spc?.observationWindow?.from ?? 1;
                      config.spc = { ...(config.spc ?? {}), observationWindow: value == null ? null : { from, to: Math.max(from, Math.round(value)) } };
                    })} />
                    <Toggle label={tLabel('cd.opt.dataLabels')} checked={draft.spc?.showDataLabels === true} onChange={(value) => patch((config) => { config.spc = { ...(config.spc ?? {}), showDataLabels: value }; })} />
                  </>
                )}
                {chart.kind === 'capability' && (
                  <>
                    <Toggle label={tLabel('cd.opt.withinCurve')} checked={draft.capability?.showWithinCurve !== false} onChange={(value) => patch((config) => { config.capability = { ...(config.capability ?? {}), showWithinCurve: value }; })} />
                    <Toggle label={tLabel('cd.opt.overallCurve')} checked={draft.capability?.showOverallCurve === true} onChange={(value) => patch((config) => { config.capability = { ...(config.capability ?? {}), showOverallCurve: value }; })} />
                    <Toggle label={tLabel('cd.opt.defectShading')} checked={draft.capability?.shadeOutOfSpec !== false} onChange={(value) => patch((config) => { config.capability = { ...(config.capability ?? {}), shadeOutOfSpec: value }; })} />
                    <SelectField
                      label={tLabel('cd.opt.statsPlacement')}
                      value={draft.capability?.statsPlacement ?? 'below'}
                      options={[
                        { value: 'below', label: tLabel('cd.opt.statsBelow') },
                        { value: 'inside', label: tLabel('cd.opt.statsInside') },
                        { value: 'none', label: tLabel('cd.opt.statsNone') },
                      ]}
                      onChange={(value) => patch((config) => { config.capability = { ...(config.capability ?? {}), statsPlacement: value as 'below' | 'inside' | 'none' }; })}
                    />
                    <NumberField label={tLabel('cd.opt.bins')} value={draft.capability?.binCount} min={3} max={60} onChange={(value) => patch((config) => { config.capability = { ...(config.capability ?? {}), binCount: value }; })} />
                  </>
                )}
                {(chart.kind === 'probplot' || chart.kind === 'normalprob') && (
                  <>
                    <Toggle label={tLabel('cd.opt.probGrid')} checked={draft.probplot?.showProbGrid !== false} onChange={(value) => patch((config) => { config.probplot = { ...(config.probplot ?? {}), showProbGrid: value }; })} />
                    <Toggle label={tLabel('cd.opt.ciBand')} checked={draft.probplot?.showCi !== false} onChange={(value) => patch((config) => { config.probplot = { ...(config.probplot ?? {}), showCi: value }; })} />
                    <Toggle label={tLabel('cd.opt.fit')} checked={draft.probplot?.showFitLine !== false} onChange={(value) => patch((config) => { config.probplot = { ...(config.probplot ?? {}), showFitLine: value }; })} />
                  </>
                )}
                {(chart.kind === 'line' || chart.kind === 'bar' || chart.kind === 'pareto' || chart.kind === 'timeseries') && (
                  <>
                    <Toggle label={tLabel('cd.opt.markers')} checked={draft.lineBarPareto?.showMarkers !== false} onChange={(value) => patch((config) => { config.lineBarPareto = { ...(config.lineBarPareto ?? {}), showMarkers: value }; })} />
                    <Toggle label={tLabel('cd.opt.lines')} checked={draft.lineBarPareto?.showLines !== false} onChange={(value) => patch((config) => { config.lineBarPareto = { ...(config.lineBarPareto ?? {}), showLines: value }; })} />
                    <Toggle label={tLabel('cd.opt.dataLabels')} checked={draft.lineBarPareto?.showDataLabels === true} onChange={(value) => patch((config) => { config.lineBarPareto = { ...(config.lineBarPareto ?? {}), showDataLabels: value }; })} />
                    <Toggle label={tLabel('cd.opt.refLines')} checked={draft.lineBarPareto?.showRefLines !== false} onChange={(value) => patch((config) => { config.lineBarPareto = { ...(config.lineBarPareto ?? {}), showRefLines: value }; })} />
                    {chart.kind === 'line' && (
                      <>
                        <TextField
                          label={tLabel('cd.opt.secondary')}
                          value={(draft.lineBarPareto?.secondarySeries ?? []).map((n) => n + 1).join(', ')}
                          onChange={(value) => patch((config) => {
                            const list = value.split(',').map((part) => Number(part.trim()) - 1).filter((v) => Number.isInteger(v) && v >= 0);
                            config.lineBarPareto = { ...(config.lineBarPareto ?? {}), secondarySeries: list };
                          })}
                        />
                        <small className="cd-hint">{tLabel('cd.opt.secondaryHint')}</small>
                      </>
                    )}
                  </>
                )}
              </Group>
            </>
          )}

          {tab === 'style' && (
            <>
              <Group title={tLabel('cd.stylePreset')}>
                <div className="cd-styles">
                  {CHART_STYLE_IDS.map((id) => {
                    const preset = CHART_STYLE_PRESETS[id];
                    const active = (draft.appearance?.preset ?? 'engineering') === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`cd-style${active ? ' active' : ''}`}
                        onClick={() => patch((config) => { config.appearance = { ...(config.appearance ?? {}), preset: id }; })}
                        data-testid={`cd-preset-${id}`}
                      >
                        <span className="cd-swatches">
                          {preset.series.slice(0, 4).map((color, index) => (
                            <i key={index} style={{ background: color.startsWith('var(') ? ['#8b6ce8', '#10b981', '#3b82f6', '#f59e0b'][index] : color }} />
                          ))}
                        </span>
                        <span>{t(lang, `cd.preset.${id}`)}</span>
                      </button>
                    );
                  })}
                </div>
              </Group>
              <Group title={tLabel('cd.customStyles')}>
                {customStyles.length === 0 && <small className="cd-hint">{tLabel('cd.noCustomStyles')}</small>}
                {customStyles.map((style) => (
                  <div key={style.id} className="cd-series">
                    <span className="cd-series-name">{style.name}</span>
                    <button type="button" className="btn ghost" onClick={() => patch((config) => { config.appearance = { ...(config.appearance ?? {}), preset: `custom:${style.id}` as ChartStylePresetId }; })}>{tLabel('cd.applyStyle')}</button>
                    <button type="button" className="btn ghost" onClick={() => setCustomStyles(deleteCustomStyle(style.id))}>{tLabel('cd.deleteStyle')}</button>
                  </div>
                ))}
                <div className="cd-inline">
                  <input className="cd-input" type="text" value={styleName} placeholder={tLabel('cd.styleName')} onChange={(event) => setStyleName(event.target.value)} data-testid="cd-style-name" />
                  <button
                    type="button"
                    className="btn ghost"
                    data-testid="cd-style-save"
                    onClick={() => {
                      const name = styleName.trim();
                      if (!name) return;
                      const base = (draft.appearance?.preset ?? 'engineering') as ChartStylePresetId;
                      const stored = saveCustomStyle({
                        id: `s${Date.now().toString(36)}`,
                        name,
                        base: base.startsWith('custom:') ? 'engineering' : base,
                        overrides: {
                          chartBg: draft.appearance?.chartBg,
                          plotBg: draft.appearance?.plotBg,
                          axisColor: draft.appearance?.axisColor,
                          tickColor: draft.appearance?.tickColor,
                          labelColor: draft.appearance?.labelColor,
                          gridColor: draft.appearance?.gridColor,
                          fontSize: draft.appearance?.fontSize,
                          fontFamily: draft.appearance?.fontFamily,
                        },
                      });
                      setCustomStyles(stored);
                      setStyleName('');
                    }}
                  >
                    {tLabel('cd.saveStyle')}
                  </button>
                </div>
              </Group>
              <Group title={tLabel('cd.exportBackground')}>
                <ColorField label={tLabel('cd.chartBg')} value={draft.appearance?.chartBg} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), chartBg: value }; })} />
                <ColorField label={tLabel('cd.plotBg')} value={draft.appearance?.plotBg} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), plotBg: value }; })} />
                <TextField label={tLabel('cd.fontFamily')} value={draft.appearance?.fontFamily} placeholder="Inter, system-ui" onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), fontFamily: value }; })} />
                <NumberField label={tLabel('cd.fontSize')} value={draft.appearance?.fontSize} step={0.5} min={6} max={20} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), fontSize: value ?? 10.5 }; })} />
                <ColorField label={tLabel('cd.axisColor')} value={draft.appearance?.axisColor} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), axisColor: value }; })} />
                <ColorField label={tLabel('cd.tickColor')} value={draft.appearance?.tickColor} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), tickColor: value }; })} />
                <ColorField label={tLabel('cd.labelColor')} value={draft.appearance?.labelColor} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), labelColor: value }; })} />
                <ColorField label={tLabel('cd.gridColor')} value={draft.appearance?.gridColor} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), gridColor: value }; })} />
                <NumberField label={tLabel('cd.borderWidth')} value={draft.appearance?.borderWidth} step={0.2} min={0} max={6} onChange={(value) => patch((config) => { config.appearance = { ...(config.appearance ?? {}), borderWidth: value ?? 1 }; })} />
              </Group>
              {contourReady && (
                <Group title={tLabel('cd.contourLook')}>
                  <SelectField
                    label={tLabel('cd.colormap')}
                    value={contour.colormap}
                    options={COLORMAPS.map((map) => ({ value: map, label: map === 'sigrun-classic' ? t(lang, 'cd.preset.sigrun-classic') : map.charAt(0).toUpperCase() + map.slice(1) }))}
                    onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), colormap: value }; })}
                  />
                  <SelectField
                    label={tLabel('cd.colorbarMode')}
                    value={contour.colorbarMode}
                    options={[
                      { value: 'continuous', label: tLabel('cd.colorbar.continuous') },
                      { value: 'discrete', label: tLabel('cd.colorbar.discrete') },
                    ]}
                    onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), colorbarMode: value as 'continuous' | 'discrete' }; })}
                  />
                  <SelectField
                    label={tLabel('cd.colorbarPosition')}
                    value={contour.colorbarPosition}
                    options={[
                      { value: 'right', label: tLabel('cd.pos.right') },
                      { value: 'bottom', label: tLabel('cd.pos.bottom') },
                      { value: 'left', label: tLabel('cd.pos.left') },
                    ]}
                    onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), colorbarPosition: value as ContourConfig['colorbarPosition'] }; })}
                  />
                  <TextField label={tLabel('cd.colorbarTitle')} value={contour.colorbarTitle} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), colorbarTitle: value }; })} />
                  <TextField label={tLabel('cd.colorbarUnit')} value={contour.colorbarUnit} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), colorbarUnit: value }; })} />
                  <Toggle label={tLabel('cd.contourLabels')} checked={contour.showContourLabels} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), showContourLabels: value }; })} />
                  <NumberField label={tLabel('cd.contourLineWidth')} value={contour.lineWidth} step={0.2} min={0.4} max={5} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), lineWidth: value ?? 1 }; })} />
                  <ColorField label={tLabel('cd.contourLineColor')} value={contour.lineColor} onChange={(value) => patch((config) => { config.contour = { ...(config.contour ?? {}), lineColor: value }; })} />
                </Group>
              )}
            </>
          )}

          {tab === 'reference' && (
            <Group title={tLabel('cd.tab.reference')}>
              {(draft.referenceLines ?? []).length === 0 && <small className="cd-hint">{tLabel('cd.refEmpty')}</small>}
              {(draft.referenceLines ?? []).map((line, index) => (
                <div key={line.id} className="cd-ref">
                  <div className="cd-inline">
                    <select
                      className="cd-input"
                      value={line.axis}
                      aria-label={tLabel('cd.refAxis')}
                      onChange={(event) => patch((config) => {
                        const list = [...(config.referenceLines ?? [])];
                        list[index] = { ...list[index], axis: event.target.value as 'x' | 'y' };
                        config.referenceLines = list;
                      })}
                    >
                      <option value="x">X</option>
                      <option value="y">Y</option>
                    </select>
                    <input
                      className="cd-input"
                      type="number"
                      aria-label={tLabel('cd.refValue')}
                      value={show(line.value)}
                      onChange={(event) => patch((config) => {
                        const list = [...(config.referenceLines ?? [])];
                        list[index] = { ...list[index], value: num(event.target.value) ?? 0 };
                        config.referenceLines = list;
                      })}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={tLabel('cd.refRemove')}
                      onClick={() => patch((config) => { config.referenceLines = (config.referenceLines ?? []).filter((_, i) => i !== index); })}
                    >✕</button>
                  </div>
                  <div className="cd-inline">
                    <input
                      className="cd-input"
                      type="text"
                      aria-label={tLabel('cd.refLabel')}
                      placeholder={tLabel('cd.refLabel')}
                      value={line.label}
                      onChange={(event) => patch((config) => {
                        const list = [...(config.referenceLines ?? [])];
                        list[index] = { ...list[index], label: event.target.value };
                        config.referenceLines = list;
                      })}
                    />
                    <input
                      type="color"
                      aria-label={tLabel('cd.refColor')}
                      value={/^#[0-9a-f]{6}$/i.test(line.color) ? line.color : '#b91c1c'}
                      onChange={(event) => patch((config) => {
                        const list = [...(config.referenceLines ?? [])];
                        list[index] = { ...list[index], color: event.target.value };
                        config.referenceLines = list;
                      })}
                    />
                    <label className="cd-mini-inline">
                      <input
                        type="checkbox"
                        checked={line.visible}
                        onChange={(event) => patch((config) => {
                          const list = [...(config.referenceLines ?? [])];
                          list[index] = { ...list[index], visible: event.target.checked };
                          config.referenceLines = list;
                        })}
                      />
                      {tLabel('cd.visible')}
                    </label>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn ghost cd-wide"
                data-testid="cd-ref-add"
                onClick={() => patch((config) => {
                  const next: ReferenceLineConfig = {
                    id: `ref-${Date.now().toString(36)}`,
                    axis: 'y',
                    value: 0,
                    label: '',
                    color: '#b91c1c',
                    width: 1.2,
                    dash: '4 3',
                    visible: true,
                  };
                  config.referenceLines = [...(config.referenceLines ?? []), next];
                })}
              >
                {tLabel('cd.refAdd')}
              </button>
            </Group>
          )}

          {tab === 'legend' && (
            <Group title={tLabel('cd.tab.legend')}>
              <Toggle label={tLabel('cd.legendVisible')} checked={draft.legend?.visible !== false} onChange={(value) => patch((config) => { config.legend = { ...(config.legend ?? {}), visible: value }; })} />
              <SelectField<LegendPosition>
                label={tLabel('cd.legendPosition')}
                value={draft.legend?.position ?? 'top-right'}
                options={[
                  { value: 'top-right', label: tLabel('cd.legendTopRight') },
                  { value: 'top-left', label: tLabel('cd.legendTopLeft') },
                  { value: 'bottom', label: tLabel('cd.legendBottom') },
                  { value: 'right', label: tLabel('cd.legendRight') },
                  { value: 'none', label: tLabel('cd.legendNone') },
                ]}
                onChange={(value) => patch((config) => { config.legend = { ...(config.legend ?? {}), position: value }; })}
              />
              <NumberField label={tLabel('cd.legendFontSize')} value={draft.legend?.fontSize} step={0.2} min={6} max={16} onChange={(value) => patch((config) => { config.legend = { ...(config.legend ?? {}), fontSize: value ?? 8.6 }; })} />
              <Toggle label={tLabel('cd.legendBackground')} checked={draft.legend?.showBackground !== false} onChange={(value) => patch((config) => { config.legend = { ...(config.legend ?? {}), showBackground: value }; })} />
            </Group>
          )}

          {tab === 'surface' && surfaceChart && (
            <>
              {surfaceModel && surfaceNumeric.length >= 2 ? (
                <Group title={tLabel('cd.section.surfaceModel')}>
                  <SelectField
                    label={tLabel('cd.xFactor')}
                    value={String(rsm.xFactorIndex ?? 0)}
                    options={surfaceNumeric.map((predictor, index) => ({ value: String(index), label: predictor.name }))}
                    onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), xFactorIndex: Number(value) }; })}
                  />
                  <SelectField
                    label={tLabel('cd.yFactor')}
                    value={String(rsm.yFactorIndex ?? 1)}
                    options={surfaceNumeric.map((predictor, index) => ({ value: String(index), label: predictor.name }))}
                    onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), yFactorIndex: Number(value) }; })}
                  />
                  <SelectField
                    label={tLabel('cd.unitMode')}
                    value={(rsm.unitMode ?? 'actual') as 'coded' | 'actual'}
                    options={[
                      { value: 'coded', label: tLabel('cd.unit.coded') },
                      { value: 'actual', label: tLabel('cd.unit.actual') },
                    ]}
                    onChange={(value) => patch((config) => {
                      config.rsm = { ...(config.rsm ?? {}), unitMode: value as 'coded' | 'actual', factorRanges: {}, holdingValues: {} };
                    })}
                  />
                  <div className="cd-sublabel">{tLabel('cd.holding')}</div>
                  {surfaceNumeric.map((predictor, index) => {
                    if (index === (rsm.xFactorIndex ?? 0) || index === (rsm.yFactorIndex ?? 1)) return null;
                    return (
                      <NumberField
                        key={predictor.name}
                        label={predictor.name}
                        value={rsm.holdingValues?.[index]}
                        step={0.1}
                        onChange={(value) => patch((config) => {
                          config.rsm = { ...(config.rsm ?? {}), holdingValues: { ...(config.rsm?.holdingValues ?? {}), [index]: value ?? 0 } };
                        })}
                      />
                    );
                  })}
                  <div className="cd-sublabel">{tLabel('cd.displayRange')}</div>
                  {[rsm.xFactorIndex ?? 0, rsm.yFactorIndex ?? 1].filter((value, index, list) => list.indexOf(value) === index).map((index) => {
                    const predictor = surfaceNumeric[index];
                    if (!predictor || !surfaceModel) return null;
                    const fallback = factorDisplayRange(surfaceModel, predictor, (rsm.unitMode ?? 'actual') as 'coded' | 'actual');
                    const range = rsm.factorRanges?.[index];
                    return (
                      <div key={`surface-range-${index}`} className="cd-pair">
                        <span className="cd-pair-label">{predictor.name}</span>
                        <input
                          className="cd-input"
                          type="number"
                          aria-label={`${predictor.name} ${tLabel('cd.rangeMin')}`}
                          value={show(range?.min ?? fallback[0])}
                          onChange={(event) => patch((config) => {
                            const current = config.rsm?.factorRanges?.[index] ?? { min: fallback[0], max: fallback[1] };
                            config.rsm = {
                              ...(config.rsm ?? {}),
                              factorRanges: { ...(config.rsm?.factorRanges ?? {}), [index]: { ...current, min: num(event.target.value) ?? fallback[0] } },
                            };
                          })}
                        />
                        <input
                          className="cd-input"
                          type="number"
                          aria-label={`${predictor.name} ${tLabel('cd.rangeMax')}`}
                          value={show(range?.max ?? fallback[1])}
                          onChange={(event) => patch((config) => {
                            const current = config.rsm?.factorRanges?.[index] ?? { min: fallback[0], max: fallback[1] };
                            config.rsm = {
                              ...(config.rsm ?? {}),
                              factorRanges: { ...(config.rsm?.factorRanges ?? {}), [index]: { ...current, max: num(event.target.value) ?? fallback[1] } },
                            };
                          })}
                        />
                      </div>
                    );
                  })}
                  <div className="cd-inline">
                    <Toggle label={tLabel('cd.showExperimental')} checked={rsm.showExperimentalPoints !== false} onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), showExperimentalPoints: value }; })} />
                    <Toggle label={tLabel('cd.showStationary')} checked={rsm.showStationaryPoint !== false} onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), showStationaryPoint: value }; })} />
                    <Toggle label={tLabel('cd.showOptimal')} checked={rsm.showOptimalPoint === true} onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), showOptimalPoint: value }; })} />
                  </div>
                  {surfaceChart.extrapolated && (
                    <div className="cd-warn" data-testid="cd-surface-extrapolation" role="status">
                      <b>{tLabel('cd.extrapolation')}</b>
                      <span>{tLabel('cd.extrapolationBody')}</span>
                    </div>
                  )}
                  {surfaceModel.design?.points?.length ? (
                    <small className="cd-hint" data-testid="cd-surface-runs">{t(lang, 'cd.surface.runs', { n: surfaceModel.design.points.length })}</small>
                  ) : null}
                </Group>
              ) : (
                <div className="cd-warn" data-testid="cd-surface-no-model">
                  <b>{tLabel('cd.surface.noModel')}</b>
                  <span>{tLabel('cd.surface.noModelBody')}</span>
                </div>
              )}

              <Group title={tLabel('cd.section.surfaceGeometry')}>
                <SelectField<ContourResolution>
                  label={tLabel('cd.resolution')}
                  testId="cd-surface-resolution"
                  value={surfaceCfg.resolution}
                  options={[
                    { value: 'draft', label: tLabel('cd.res.draft') },
                    { value: 'standard', label: tLabel('cd.res.standard') },
                    { value: 'high', label: tLabel('cd.res.high') },
                    { value: 'ultra', label: tLabel('cd.res.ultra') },
                  ]}
                  onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), resolution: value }; })}
                />
                <SelectField<SurfaceRenderMode>
                  label={tLabel('cd.surface.renderMode')}
                  testId="cd-surface-render-mode"
                  value={surfaceCfg.renderMode}
                  options={[
                    { value: 'surface', label: tLabel('cd.surface.mode.surface') },
                    { value: 'wireframe', label: tLabel('cd.surface.mode.wireframe') },
                    { value: 'both', label: tLabel('cd.surface.mode.both') },
                  ]}
                  onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), renderMode: value }; })}
                />
                <SelectField<ContourColormap>
                  label={tLabel('cd.surface.colormap')}
                  value={surfaceCfg.colormap}
                  options={COLORMAPS.map((id) => ({ value: id, label: id }))}
                  onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), colormap: value }; })}
                />
                <NumberField label={tLabel('cd.surface.opacity')} value={surfaceCfg.opacity} min={0.1} max={1} step={0.05} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), opacity: value ?? 1 }; })} />
                <NumberField label={tLabel('cd.surface.meshDensity')} value={surfaceCfg.meshDensity} min={1} max={40} step={1} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), meshDensity: value ?? 8 }; })} />
                <NumberField label={tLabel('cd.surface.meshWidth')} value={surfaceCfg.meshLineWidth} min={0} max={6} step={0.1} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), meshLineWidth: value ?? 0.6 }; })} />
                <NumberField label={tLabel('cd.surface.zScale')} value={surfaceCfg.zScale} min={0.2} max={4} step={0.1} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), zScale: value ?? 1 }; })} />
                <SelectField<SurfaceProjection>
                  label={tLabel('cd.surface.projection')}
                  testId="cd-surface-projection"
                  value={surfaceCfg.projection}
                  options={[
                    { value: 'perspective', label: tLabel('cd.surface.perspective') },
                    { value: 'orthographic', label: tLabel('cd.surface.orthographic') },
                  ]}
                  onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), projection: value }; })}
                />
                <SelectField<'surface' | 'white' | 'dark'>
                  label={tLabel('cd.surface.background')}
                  value={surfaceCfg.background}
                  options={[
                    { value: 'surface', label: tLabel('cd.surface.bg.surface') },
                    { value: 'white', label: tLabel('cd.surface.bg.white') },
                    { value: 'dark', label: tLabel('cd.surface.bg.dark') },
                  ]}
                  onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), background: value }; })}
                />
                <div className="cd-inline">
                  <Toggle label={tLabel('cd.surface.colorbar')} checked={surfaceCfg.colorbar} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), colorbar: value }; })} />
                  <Toggle label={tLabel('cd.surface.axes')} checked={surfaceCfg.showAxes} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), showAxes: value }; })} />
                  <Toggle label={tLabel('cd.surface.points')} checked={surfaceCfg.showPoints} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), showPoints: value }; })} />
                  <Toggle label={tLabel('cd.surface.floor')} checked={surfaceCfg.showFloorContours} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), showFloorContours: value }; })} />
                </div>
                {surfaceCfg.showFloorContours && (
                  <NumberField label={tLabel('cd.surface.floorLevels')} value={surfaceCfg.floorLevelCount} min={2} max={20} step={1} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), floorLevelCount: value ?? 8 }; })} />
                )}
              </Group>

              <Group title={tLabel('cd.section.surfaceLight')}>
                <Toggle label={tLabel('cd.surface.lighting')} checked={surfaceCfg.lighting} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), lighting: value }; })} />
                <NumberField label={tLabel('cd.surface.lightAzimuth')} value={surfaceCfg.lightAzimuth} min={-360} max={360} step={5} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), lightAzimuth: value ?? 135 }; })} />
                <NumberField label={tLabel('cd.surface.lightElevation')} value={surfaceCfg.lightElevation} min={-90} max={90} step={5} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), lightElevation: value ?? 55 }; })} />
                <NumberField label={tLabel('cd.surface.ambient')} value={surfaceCfg.ambient} min={0} max={1} step={0.05} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), ambient: value ?? 0.45 }; })} />
                <NumberField label={tLabel('cd.surface.diffuse')} value={surfaceCfg.diffuse} min={0} max={2} step={0.05} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), diffuse: value ?? 0.6 }; })} />
              </Group>

              <Group title={tLabel('cd.section.surfaceCamera')}>
                <NumberField label={tLabel('cd.surface.azimuth')} value={surfaceCfg.camera.azimuth} min={0} max={360} step={5} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), camera: { ...(config.surface?.camera ?? defaultSurfaceViewConfig().camera), azimuth: value ?? 0 } }; })} />
                <NumberField label={tLabel('cd.surface.elevation')} value={surfaceCfg.camera.elevation} min={2} max={89} step={2} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), camera: { ...(config.surface?.camera ?? defaultSurfaceViewConfig().camera), elevation: value ?? 28 } }; })} />
                <NumberField label={tLabel('cd.surface.zoom')} value={surfaceCfg.camera.zoom} min={0.4} max={3} step={0.1} onChange={(value) => patch((config) => { config.surface = { ...(config.surface ?? {}), camera: { ...(config.surface?.camera ?? defaultSurfaceViewConfig().camera), zoom: value ?? 1 } }; })} />
                <div className="cd-inline">
                  {(['isometric', 'top', 'front', 'side'] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="btn ghost"
                      data-testid={`cd-surface-view-${preset}`}
                      onClick={() => patch((config) => {
                        const base = config.surface?.camera ?? defaultSurfaceViewConfig().camera;
                        config.surface = { ...(config.surface ?? {}), camera: { ...base, ...SURFACE_VIEW_PRESETS[preset], panX: 0, panY: 0 } };
                      })}
                    >
                      {tLabel(`cd.surface.view.${preset}`)}
                    </button>
                  ))}
                  <button type="button" className="btn ghost" data-testid="cd-surface-reset-camera" onClick={() => patch((config) => { config.surface = { ...(config.surface ?? {}), camera: { ...defaultSurfaceViewConfig().camera } }; })}>
                    {tLabel('cd.surface.resetCamera')}
                  </button>
                </div>
                <small className="cd-hint">{t(lang, 'cd.surface.gridPoints', { n: surfaceResolutionPoints(surfaceCfg.resolution) })}</small>
              </Group>
            </>
          )}

          {tab === 'feasible' && overlaidChart && (
            <>
              <Group title={tLabel('cd.section.feasibleModel')}>
                {overlaidFactors.factors.length >= 2 ? (
                  <>
                    <SelectField
                      label={tLabel('cd.xFactor')}
                      value={String(rsm.xFactorIndex ?? 0)}
                      options={overlaidFactors.factors.map((factor, index) => ({ value: String(index), label: factor.unit ? `${factor.name} (${factor.unit})` : factor.name }))}
                      onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), xFactorIndex: Number(value) }; })}
                    />
                    <SelectField
                      label={tLabel('cd.yFactor')}
                      value={String(rsm.yFactorIndex ?? 1)}
                      options={overlaidFactors.factors.map((factor, index) => ({ value: String(index), label: factor.unit ? `${factor.name} (${factor.unit})` : factor.name }))}
                      onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), yFactorIndex: Number(value) }; })}
                    />
                    <SelectField
                      label={tLabel('cd.unitMode')}
                      value={(rsm.unitMode ?? 'actual') as 'coded' | 'actual'}
                      options={[
                        { value: 'coded', label: tLabel('cd.unit.coded') },
                        { value: 'actual', label: tLabel('cd.unit.actual') },
                      ]}
                      onChange={(value) => patch((config) => { config.rsm = { ...(config.rsm ?? {}), unitMode: value as 'coded' | 'actual', factorRanges: {}, holdingValues: {} }; })}
                    />
                    <div className="cd-sublabel">{tLabel('cd.holding')}</div>
                    {overlaidFactors.factors.map((factor, index) => {
                      const xIndex = rsm.xFactorIndex ?? 0;
                      const yIndex = rsm.yFactorIndex ?? 1;
                      if (index === xIndex || index === yIndex) return null;
                      const predictor = factor.variables[0]?.predictor;
                      const fallback = predictor && overlaidModels[0] ? factorDisplayRange(overlaidModels[0], predictor, (rsm.unitMode ?? 'actual') as 'coded' | 'actual') : [0, 0];
                      return (
                        <NumberField
                          key={factor.name}
                          label={factor.name}
                          value={rsm.holdingValues?.[index] ?? (fallback[0] + fallback[1]) / 2}
                          step={0.1}
                          onChange={(value) => patch((config) => {
                            config.rsm = { ...(config.rsm ?? {}), holdingValues: { ...(config.rsm?.holdingValues ?? {}), [index]: value ?? 0 } };
                          })}
                        />
                      );
                    })}
                  </>
                ) : (
                  <div className="cd-warn">{tLabel('cd.feasible.noCommon')}</div>
                )}
                {overlaidFactors.problems.length > 0 && (
                  <div className="cd-warn" data-testid="cd-feasible-problems">
                    {overlaidFactors.problems.map((problem) => <span key={problem}>{t(lang, 'cd.feasible.conflict', { detail: problem })}</span>)}
                  </div>
                )}
              </Group>

              <Group title={tLabel('cd.section.feasibleSpecs')}>
                {overlaidChart.responses.map((response) => {
                  const spec = feasibleCfg.specs.find((entry) => entry.name === response.name) ?? { name: response.name, lsl: response.lsl, usl: response.usl, target: response.target };
                  return (
                    <div key={response.name} className="cd-spec" data-testid={`cd-spec-${response.name}`}>
                      <div className="cd-sublabel" style={{ color: response.color }}>{response.name}</div>
                      <div className="cd-pair">
                        <input
                          className="cd-input"
                          type="number"
                          placeholder="LSL"
                          aria-label={`${response.name} LSL`}
                          value={show(spec.lsl)}
                          onChange={(event) => setSpec(response.name, 'lsl', num(event.target.value))}
                        />
                        <input
                          className="cd-input"
                          type="number"
                          placeholder="USL"
                          aria-label={`${response.name} USL`}
                          value={show(spec.usl)}
                          onChange={(event) => setSpec(response.name, 'usl', num(event.target.value))}
                        />
                        <input
                          className="cd-input"
                          type="number"
                          placeholder="Target"
                          aria-label={`${response.name} Target`}
                          value={show(spec.target)}
                          onChange={(event) => setSpec(response.name, 'target', num(event.target.value))}
                        />
                      </div>
                    </div>
                  );
                })}
                <small className="cd-hint">{tLabel('cd.feasible.specHint')}</small>
              </Group>

              <Group title={tLabel('cd.section.feasibleBasis')}>
                <SelectField<FeasibleBasis>
                  label={tLabel('cd.feasible.basis')}
                  testId="cd-feasible-basis"
                  value={feasibleCfg.basis}
                  options={[
                    { value: 'mean', label: tLabel('cd.feasible.basis.mean') },
                    ...(intervalBlocked.length === 0 ? [
                      { value: 'confidence' as FeasibleBasis, label: tLabel('cd.feasible.basis.confidence') },
                      { value: 'prediction' as FeasibleBasis, label: tLabel('cd.feasible.basis.prediction') },
                    ] : []),
                  ]}
                  onChange={(value) => patch((config) => { config.feasible = { ...(config.feasible ?? {}), basis: value }; })}
                />
                {intervalBlocked.length > 0 && (
                  <div className="cd-warn" data-testid="cd-feasible-interval-blocked">
                    <b>{tLabel('cd.feasible.intervalDisabled')}</b>
                    <span>
                      {(overlaidChart?.feasible?.intervalBlockReasons?.length
                        ? overlaidChart.feasible.intervalBlockReasons.map((entry) => tLabel('cd.feasible.blockedReason')
                          .replace('{model}', entry.model)
                          .replace('{reasons}', entry.reasons.map((reason) => t(lang, reason)).join(', ')))
                        : [intervalBlocked.join(', ')]).join(' / ')}
                    </span>
                  </div>
                )}
                <small className="cd-hint">{tLabel('cd.feasible.pointwiseNote')}</small>
                <NumberField label={tLabel('cd.feasible.alpha')} value={feasibleCfg.alpha} min={0.001} max={0.5} step={0.005} onChange={(value) => patch((config) => { config.feasible = { ...(config.feasible ?? {}), alpha: value ?? 0.05 }; })} />
                <SelectField<ContourResolution>
                  label={tLabel('cd.resolution')}
                  testId="cd-feasible-resolution"
                  value={feasibleCfg.resolution}
                  options={[
                    { value: 'draft', label: tLabel('cd.res.draft') },
                    { value: 'standard', label: tLabel('cd.res.standard') },
                    { value: 'high', label: tLabel('cd.res.high') },
                    { value: 'ultra', label: tLabel('cd.res.ultra') },
                  ]}
                  onChange={(value) => patch((config) => { config.feasible = { ...(config.feasible ?? {}), resolution: value }; })}
                />
                <div className="cd-inline">
                  <Toggle label={tLabel('cd.feasible.showRegions')} checked={feasibleCfg.showResponseRegions} onChange={(value) => patch((config) => { config.feasible = { ...(config.feasible ?? {}), showResponseRegions: value }; })} />
                  <Toggle label={tLabel('cd.feasible.showSpecLines')} checked={feasibleCfg.showSpecLines} onChange={(value) => patch((config) => { config.feasible = { ...(config.feasible ?? {}), showSpecLines: value }; })} />
                  <Toggle label={tLabel('cd.feasible.showFeasible')} checked={feasibleCfg.showFeasible} onChange={(value) => patch((config) => { config.feasible = { ...(config.feasible ?? {}), showFeasible: value }; })} />
                  <Toggle label={tLabel('cd.feasible.hatch')} checked={feasibleCfg.hatchUnfeasible} onChange={(value) => patch((config) => { config.feasible = { ...(config.feasible ?? {}), hatchUnfeasible: value }; })} />
                  <Toggle label={tLabel('cd.surface.points')} checked={feasibleCfg.showPoints} onChange={(value) => patch((config) => { config.feasible = { ...(config.feasible ?? {}), showPoints: value }; })} />
                  <Toggle label={tLabel('cd.feasible.showRatio')} checked={feasibleCfg.showRatio} onChange={(value) => patch((config) => { config.feasible = { ...(config.feasible ?? {}), showRatio: value }; })} />
                </div>
              </Group>

              <Group title={tLabel('cd.section.feasibleResult')}>
                {overlaidChart.feasible?.error && (
                  <div className="cd-warn" data-testid="cd-feasible-error" data-code={overlaidChart.feasible.error.code}>
                    <b>{tLabel('cd.feasible.error')}</b>
                    <span>{t(lang, overlaidChart.feasible.error.code)}</span>
                    {Boolean(overlaidChart.feasible.error.blocked?.length) && (
                      <span>
                        {tLabel('cd.feasible.errorBlocked')}: {overlaidChart.feasible.error.blocked?.map((entry) => tLabel('cd.feasible.blockedReason')
                          .replace('{model}', entry.model)
                          .replace('{reasons}', entry.reasons.map((reason) => t(lang, reason)).join(', '))).join(' / ')}
                      </span>
                    )}
                  </div>
                )}
                <div className="cd-facts" data-testid="cd-feasible-facts">
                  <div><span>{tLabel('cd.feasible.areaRatio')}</span><b>{((overlaidChart.feasible?.areaRatio ?? 0) * 100).toFixed(1)}%</b></div>
                  <div><span>{tLabel('cd.feasible.nodeRatio')}</span><b>{((overlaidChart.feasible?.nodeRatio ?? 0) * 100).toFixed(1)}%</b></div>
                  <div><span>{tLabel('cd.feasible.nodes')}</span><b>{overlaidChart.feasible?.feasibleNodes ?? 0} / {overlaidChart.feasible?.totalNodes ?? 0}</b></div>
                  <div>
                    <span>{tLabel('cd.feasible.nodeConvergence')}</span>
                    <b data-testid="cd-feasible-node-convergence">
                      {((overlaidChart.feasible?.nodeConvergenceDelta ?? overlaidChart.feasible?.convergenceDelta ?? 0) * 100).toFixed(2)}%
                    </b>
                  </div>
                  <div>
                    <span>{tLabel('cd.feasible.areaConvergence')}</span>
                    <b data-testid="cd-feasible-area-convergence">
                      {((overlaidChart.feasible?.areaConvergenceDelta ?? 0) * 100).toFixed(2)}%
                    </b>
                  </div>
                  {Boolean(overlaidChart.feasible?.convergenceNeighborCount) && (
                    <div>
                      <span>{tLabel('cd.feasible.convergence')}</span>
                      <b data-testid="cd-feasible-convergence-pair">
                        {tLabel('cd.feasible.convergencePair')
                          .replace(/\{n\}/g, String(overlaidChart.feasible?.convergenceNeighborCount ?? ''))
                          .replace('{direction}', tLabel(overlaidChart.feasible?.convergenceDirection === 'coarsened' ? 'cd.feasible.coarsened' : 'cd.feasible.refined'))}
                      </b>
                    </div>
                  )}
                </div>
                <small className="cd-hint">{tLabel('cd.feasible.gridNote')}</small>
                <small className="cd-hint">{tLabel('cd.feasible.limitNote')}</small>
                {(overlaidChart.feasible?.feasibleNodes ?? 0) === 0 && (
                  <div className="cd-warn" data-testid="cd-feasible-narrow">{tLabel('cd.feasible.narrow')}</div>
                )}
                {overlaidChart.feasible?.rangeWarning && (
                  <div className="cd-warn" data-testid="cd-feasible-range-warning">
                    {(() => {
                      const code = overlaidChart.feasible?.rangeWarning ?? '';
                      const factor = code.split(':')[1] ?? '';
                      return tLabel('cd.feasible.rangeWarning').replace('{factor}', factor);
                    })()}
                  </div>
                )}
                {overlaidChart.extrapolated && (
                  <div className="cd-warn" data-testid="cd-feasible-extrapolated">
                    <b>{tLabel('cd.feasible.extrapolated')}</b>
                    {(overlaidChart.extrapolationDetails ?? []).map((entry, index) => (
                      <span key={`${entry.model}-${entry.factor}-${index}`}>
                        {tLabel('cd.feasible.extrapolatedItem')
                          .replace('{model}', entry.model)
                          .replace('{factor}', entry.factor)
                          .replace('{kind}', tLabel(entry.kind === 'holding' ? 'cd.feasible.extrapolatedHolding' : 'cd.feasible.extrapolatedAxis'))
                          .replace('{used}', entry.kind === 'holding'
                            ? String(entry.value ?? '')
                            : `${Number(entry.from ?? 0).toFixed(3)} … ${Number(entry.to ?? 0).toFixed(3)}`)
                          .replace('{bound}', `${entry.bound.min} … ${entry.bound.max}`)}
                      </span>
                    ))}
                  </div>
                )}
                {overlaidChart.responses.map((response) => (
                  <small key={response.name} className="cd-hint">
                    {response.name}: {(response.areaRatio * 100).toFixed(1)}%
                  </small>
                ))}
              </Group>
            </>
          )}

          {tab === 'export' && (
            <>
              <Group title={tLabel('cd.exportFormat')}>
                <div className="cd-subtabs">
                  {(['svg', 'png'] as const).map((format) => (
                    <button
                      key={format}
                      type="button"
                      className={`cd-chip${(exportCfg.format ?? 'svg') === format ? ' active' : ''}`}
                      onClick={() => updateExport((config) => { config.format = format; })}
                      data-testid={`cd-format-${format}`}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="cd-subtabs">
                  {EXPORT_DPI_PRESETS.map((dpi) => (
                    <button
                      key={dpi}
                      type="button"
                      className={`cd-chip${exportCfg.dpi === dpi ? ' active' : ''}`}
                      onClick={() => { updateExport((config) => { config.dpi = dpi; config.widthPx = 0; config.heightPx = 0; }); }}
                      data-testid={`cd-dpi-${dpi}`}
                    >
                      {dpi}
                    </button>
                  ))}
                  <input
                    className="cd-input cd-dpi-custom"
                    type="number"
                    min={72}
                    max={1200}
                    aria-label={tLabel('cd.exportDpiCustom')}
                    placeholder={tLabel('cd.exportDpiCustom')}
                    value={EXPORT_DPI_PRESETS.includes(exportCfg.dpi as 150 | 300 | 600) ? '' : exportCfg.dpi}
                    onChange={(event) => { updateExport((config) => { config.dpi = num(event.target.value) ?? 300; config.widthPx = 0; config.heightPx = 0; }); }}
                  />
                </div>
                <div className="cd-pair">
                  <span className="cd-pair-label">{tLabel('cd.exportPhysical')}</span>
                  <input
                    className="cd-input"
                    type="number"
                    aria-label={tLabel('cd.exportWidth')}
                    value={show(exportCfg.physicalWidth)}
                    onChange={(event) => editPhysical((config) => { config.physicalWidth = num(event.target.value) ?? 160; })}
                  />
                  <span className="cd-times">×</span>
                  <input
                    className="cd-input"
                    type="number"
                    aria-label={tLabel('cd.exportHeight')}
                    value={show(exportCfg.physicalHeight)}
                    onChange={(event) => editPhysical((config) => { config.physicalHeight = num(event.target.value) ?? 100; })}
                  />
                  <select
                    className="cd-input cd-unit"
                    aria-label={tLabel('cd.exportUnit')}
                    value={exportCfg.physicalUnit}
                    onChange={(event) => editPhysical((config) => { config.physicalUnit = event.target.value as 'mm' | 'in'; })}
                  >
                    <option value="mm">mm</option>
                    <option value="in">in</option>
                  </select>
                </div>
                <div className="cd-pair">
                  <span className="cd-pair-label">{tLabel('cd.exportPixels')}</span>
                  <input
                    className="cd-input"
                    type="number"
                    aria-label={tLabel('cd.exportWidth')}
                    value={exportSize.widthPx}
                    onChange={(event) => {
                      const value = num(event.target.value) ?? exportSize.widthPx;
                      updateExport((config) => { config.widthPx = value; config.heightPx = exportSize.heightPx; });
                    }}
                  />
                  <span className="cd-times">×</span>
                  <input
                    className="cd-input"
                    type="number"
                    aria-label={tLabel('cd.exportHeight')}
                    value={exportSize.heightPx}
                    onChange={(event) => {
                      const value = num(event.target.value) ?? exportSize.heightPx;
                      updateExport((config) => { config.widthPx = exportSize.widthPx; config.heightPx = value; });
                    }}
                  />
                  <span className="cd-times">px</span>
                </div>
                <small className="cd-hint" data-testid="cd-export-size">
                  {exportSize.widthPx} × {exportSize.heightPx} px · {exportSize.physicalWidth} × {exportSize.physicalHeight} {exportSize.physicalUnit} @ {exportSize.dpi} DPI
                </small>
              </Group>
              <Group title={tLabel('cd.exportBackground')}>
                <SelectField<ExportBackground>
                  label={tLabel('cd.exportBackground')}
                  value={exportCfg.background}
                  options={[
                    { value: 'transparent', label: tLabel('cd.bg.transparent') },
                    { value: 'white', label: tLabel('cd.bg.white') },
                    { value: 'current', label: tLabel('cd.bg.current') },
                  ]}
                  onChange={(value) => updateExport((config) => { config.background = value; })}
                />
                <Toggle label={tLabel('cd.exportIncludeTitle')} checked={exportCfg.includeTitle} onChange={(value) => updateExport((config) => { config.includeTitle = value; })} />
                <Toggle label={tLabel('cd.exportIncludeLegend')} checked={exportCfg.includeLegend} onChange={(value) => updateExport((config) => { config.includeLegend = value; })} />
                <small className="cd-hint">{tLabel('cd.exportHint')}</small>
              </Group>
              <Group title={tLabel('cd.exportDownload')}>
                <button type="button" className="btn primary cd-wide" onClick={() => onExport(draft, exportCfg.format ?? 'svg')} data-testid="cd-export-download">
                  {tLabel('cd.exportDownload')}
                </button>
                <button type="button" className="btn ghost cd-wide" onClick={() => onCopyPng(draft)} data-testid="cd-export-copy">
                  {tLabel('cd.exportCopy')}
                </button>
                <button type="button" className="btn ghost cd-wide" onClick={() => onBatchExport(draft, exportCfg.format ?? 'svg')} data-testid="cd-export-batch">
                  {tLabel('cd.exportBatch')}
                </button>
              </Group>
            </>
          )}
        </div>

        <footer className="cd-foot">
          <div className="cd-foot-tools">
            <button type="button" className="btn ghost" onClick={() => onCopyStyle(draft)} data-testid="cd-copy-style">{tLabel('cd.copyStyle')}</button>
            <button type="button" className="btn ghost" disabled={!styleClipboard} onClick={() => onPasteStyle(draft)} data-testid="cd-paste-style">{tLabel('cd.pasteStyle')}</button>
            <button type="button" className="btn ghost" onClick={() => onApplyAll(draft)} data-testid="cd-apply-all">{tLabel('cd.applyAll')}</button>
          </div>
          <div className="cd-foot-main">
            <button type="button" className="btn ghost" onClick={() => { const defaults = defaultChartConfig((draft.appearance?.preset as ChartStylePresetId) ?? 'engineering'); history.current.push(draft); setDraft(defaults); onReset(defaults); }} data-testid="cd-reset">{tLabel('cd.reset')}</button>
            <button type="button" className="btn ghost" onClick={onClose} data-testid="cd-cancel">{tLabel('cd.cancel')}</button>
            <button type="button" className="btn primary" onClick={() => onApply(draft)} data-testid="cd-apply">{tLabel('cd.apply')}</button>
          </div>
        </footer>
        <div className="cd-note">{tLabel('cd.previewNote')}</div>
      </aside>
    </div>
  );
}

/** Pixel size for a physical size, used when the drawer shows mm ↔ px. */
export function previewPixelSize(physicalWidth: number, physicalHeight: number, unit: 'mm' | 'in', dpi: number): { widthPx: number; heightPx: number } {
  return {
    widthPx: physicalToPixels(physicalWidth, unit, dpi),
    heightPx: physicalToPixels(physicalHeight, unit, dpi),
  };
}

/** The inverse, for the drawer's physical fields after a pixel edit. */
export function previewPhysicalSize(widthPx: number, heightPx: number, unit: 'mm' | 'in', dpi: number): { width: number; height: number } {
  return { width: pixelsToPhysical(widthPx, unit, dpi), height: pixelsToPhysical(heightPx, unit, dpi) };
}
