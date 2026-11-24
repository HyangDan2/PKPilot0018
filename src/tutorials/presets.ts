/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — analysis presets used by tutorials

   A preset fills an analysis dialog from column *names* in a named sample, so
   a tutorial never hard-codes a column id and the same preset works whichever
   worksheet copy of the sample is active. The reader can change every value
   the preset filled before running.
   ───────────────────────────────────────────────────────────────────────── */

import type { Worksheet } from '../types';
import { findAnalysis, type SlotDef } from '../lib/analyses';
import { findSample } from '../samples/registry';

export interface PresetSlot {
  /** Column names (resolved to ids on the active sheet). */
  columns?: string[];
  /** A literal dialog value. */
  value?: string | number | boolean;
}

export interface AnalysisPreset {
  id: string;
  analysisId: string;
  sampleId: string;
  slots: Record<string, PresetSlot>;
}

const cols = (...names: string[]): PresetSlot => ({ columns: names });
const value = (v: string | number | boolean): PresetSlot => ({ value: v });

const DISPLAY_FACTORS = ['LED Current (coded)', 'Optical Distance (coded)', 'Diffuser Haze (coded)'];

export const PRESETS: AnalysisPreset[] = [
  {
    id: 'preset-desc-thickness',
    analysisId: 'desc',
    sampleId: 'process',
    slots: { variables: cols('Thickness (mm)'), by: cols('Line') },
  },
  {
    id: 'preset-histogram-thickness',
    analysisId: 'histogram',
    sampleId: 'process',
    slots: { variable: cols('Thickness (mm)'), lsl: value('9.6'), usl: value('10.8'), target: value('10.2'), normal: value(true) },
  },
  {
    id: 'preset-standardize-hardness',
    analysisId: 'standardize',
    sampleId: 'comparison',
    slots: { column: cols('Hardness'), storeIn: value('zHardness') },
  },
  {
    id: 'preset-sort-hardness',
    analysisId: 'sort',
    sampleId: 'comparison',
    slots: { column: cols('Hardness'), descending: value(false) },
  },
  {
    id: 'preset-normality-thickness',
    analysisId: 'normality',
    sampleId: 'process',
    slots: { variable: cols('Thickness (mm)') },
  },
  {
    id: 'preset-normality-hardness',
    analysisId: 'normality',
    sampleId: 'comparison',
    slots: { variable: cols('Hardness') },
  },
  {
    id: 'preset-t1-hardness',
    analysisId: 't1',
    sampleId: 'comparison',
    slots: { variable: cols('Hardness'), hypMean: value(60), confidence: value(95), alternative: value('not-equal') },
  },
  {
    id: 'preset-paired-before-after',
    analysisId: 'paired',
    sampleId: 'comparison',
    slots: { first: cols('Before'), second: cols('After'), testDiff: value(0), confidence: value(95), alternative: value('not-equal') },
  },
  {
    id: 'preset-anova-thickness-line',
    analysisId: 'anova',
    sampleId: 'process',
    slots: { response: cols('Thickness (mm)'), factor: cols('Line'), confidence: value(95) },
  },
  {
    id: 'preset-anova-hardness-group',
    analysisId: 'anova',
    sampleId: 'comparison',
    slots: { response: cols('Hardness'), factor: cols('Group'), confidence: value(95) },
  },
  {
    id: 'preset-histogram-hardness',
    analysisId: 'histogram',
    sampleId: 'comparison',
    slots: { variable: cols('Hardness'), normal: value(true) },
  },
  {
    id: 'preset-glm-hardness',
    analysisId: 'glm',
    sampleId: 'comparison',
    slots: { response: cols('Hardness'), factors: cols('Group', 'Operator'), interactions: value(true), confidence: value(95) },
  },
  {
    id: 'preset-regression-yield',
    analysisId: 'regression',
    sampleId: 'regression',
    slots: { response: cols('Yield (%)'), predictors: cols('Temperature (C)', 'Pressure (bar)', 'Speed (rpm)'), fourInOne: value(true) },
  },
  {
    id: 'preset-imr-thickness',
    analysisId: 'imr',
    sampleId: 'process',
    slots: { variable: cols('Thickness (mm)') },
  },
  {
    id: 'preset-xbarr-thickness',
    analysisId: 'xbarr',
    sampleId: 'process',
    slots: { variable: cols('Thickness (mm)'), subgroup: value(5) },
  },
  {
    id: 'preset-capability-thickness',
    analysisId: 'capability',
    sampleId: 'process',
    slots: { variable: cols('Thickness (mm)'), lsl: value('9.6'), usl: value('10.8'), target: value('10.2'), subgroup: value(5), sigmaMethod: value('z_bench_shift') },
  },
  {
    id: 'preset-sixpack-thickness',
    analysisId: 'sixpack',
    sampleId: 'process',
    slots: { variable: cols('Thickness (mm)'), lsl: value('9.6'), usl: value('10.8'), target: value('10.2'), subgroup: value(5), sigmaMethod: value('z_bench_shift') },
  },
  {
    id: 'preset-pareto-defect',
    analysisId: 'pareto',
    sampleId: 'process',
    slots: { category: cols('Defect') },
  },
  {
    id: 'preset-gagerr-crossed',
    analysisId: 'gagerr',
    sampleId: 'gagerr',
    slots: {
      part: cols('Part'),
      operator: cols('Operator'),
      measurement: cols('Measurement'),
      type: value('crossed'),
      studyVar: value(6),
      poolInteraction: value(false),
      confidence: value(95),
      tolerance: value(''),
    },
  },
  {
    id: 'preset-weibull-life',
    analysisId: 'weibull',
    sampleId: 'weibull',
    slots: { time: cols('Time'), censor: cols('Censored'), censorCode: value('1=censored'), confidence: value(95) },
  },
  {
    id: 'preset-doeanalyze-twolevel',
    analysisId: 'doeanalyze',
    sampleId: 'doe',
    slots: { response: cols('Y'), factors: cols('A', 'B', 'C'), order: value('2') },
  },
  {
    id: 'preset-rsmanalyze-sample',
    analysisId: 'rsmanalyze',
    sampleId: 'rsm',
    slots: { response: cols('Y'), factors: cols('A', 'B') },
  },
  {
    id: 'preset-desc-display-responses',
    analysisId: 'desc',
    sampleId: 'display-optical-doe',
    slots: {
      variables: cols('Luminance (cd/m2)', 'Power Consumption (W)', 'Uniformity (%)', 'Temperature (C)'),
    },
  },
  {
    id: 'preset-scatter-luminance-current',
    analysisId: 'scatter',
    sampleId: 'display-optical-doe',
    slots: {
      y: cols('Luminance (cd/m2)'),
      x: cols('LED Current (coded)'),
      mode: value('each'),
      layout: value('individual'),
      fit: value(true),
      stats: value(true),
    },
  },
  ...(['Luminance (cd/m2)', 'Power Consumption (W)', 'Uniformity (%)', 'Temperature (C)'] as const).map((response, index) => ({
    id: `preset-rsm-${['luminance', 'power', 'uniformity', 'temperature'][index]}`,
    analysisId: 'rsmanalyze',
    sampleId: 'display-optical-doe',
    slots: { response: cols(response), factors: cols(...DISPLAY_FACTORS) },
  })),
];

export function findPreset(id: string): AnalysisPreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

export interface ResolvedPreset {
  values: Record<string, unknown>;
  /** Column names the preset names that the sheet does not have. */
  missing: string[];
}

/**
 * Turn a preset into dialog values for one worksheet. A column name becomes
 * that sheet's column id; a name the sheet lacks is reported instead of being
 * silently dropped.
 */
export function resolvePreset(preset: AnalysisPreset, sheet: Worksheet): ResolvedPreset {
  const byName = new Map(sheet.columns.map((column) => [column.name, column.id]));
  const def = findAnalysis(preset.analysisId);
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const [slotKey, slot] of Object.entries(preset.slots)) {
    if (slot.columns) {
      const ids = slot.columns.map((name) => {
        const id = byName.get(name);
        if (!id) missing.push(name);
        return id ?? '';
      }).filter(Boolean);
      if (!ids.length) continue;
      // A single-column slot takes one id; a multi-variable slot takes the list.
      const kind = def?.slots.find((candidate) => candidate.key === slotKey)?.kind;
      values[slotKey] = kind === 'col' ? ids[0] : ids;
    } else if (slot.value !== undefined) {
      values[slotKey] = slot.value;
    }
  }
  return { values, missing };
}

/** The slot kind a preset fills, so QA can refuse a mismatch. */
export function slotKindOf(analysisId: string, slotKey: string): SlotDef['kind'] | null {
  const def = findAnalysis(analysisId);
  return def?.slots.find((slot) => slot.key === slotKey)?.kind ?? null;
}

/** Columns a preset expects on its sample, for the registry QA. */
export function presetColumns(preset: AnalysisPreset): string[] {
  const names = new Set<string>();
  Object.values(preset.slots).forEach((slot) => slot.columns?.forEach((name) => names.add(name)));
  return [...names];
}

/** The sample a preset was written for, for a pre-flight check. */
export function presetSample(preset: AnalysisPreset) {
  return findSample(preset.sampleId);
}

/** A short label for a preset button: the response (or first column) it fills. */
export function presetShortLabel(preset: AnalysisPreset): string {
  const response = preset.slots.response?.columns?.[0] ?? preset.slots.variable?.columns?.[0];
  if (response) return response;
  const first = Object.values(preset.slots).find((slot) => slot.columns?.length);
  return first?.columns?.[0] ?? preset.analysisId;
}
