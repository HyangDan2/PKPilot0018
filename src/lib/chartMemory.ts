/* ─────────────────────────────────────────────────────────────────────────
   Statelia — chart configuration memory across re-runs (WO-01/3, WO-01/4)

   A reader styles a chart (axis range, RSM factor pair, colours) and then
   re-runs the analysis with new data. The numbers must refresh, the styling
   must not: that is what "re-run" means in Minitab too.

   Two defects are possible without care, and both were real here:

   · Loss — the new output carries the analysis's default config, so every
     re-run throws the reader's edits away.
   · Bleed — a slot is matched by position only, so inserting a chart (the
     factor-pair grid, a four-in-one residual set) shifts every later config
     onto its neighbour; and a stored config object handed to two cards lets an
     edit in one appear in the other.

   Slots are therefore keyed by *chart identity* (kind + the caption the block
   was published with) and fall back to position only within the same kind, no
   slot is ever used twice, and every restore hands out a deep copy.
   ───────────────────────────────────────────────────────────────────────── */

import type { Block, ChartSpec } from '../types';
import type { ChartConfig } from './chartConfig';

export interface ChartSlot {
  /** Stable identity: kind + caption text (never a translated label). */
  key: string;
  kind: string;
  /** Position in the output, used only as a tie-breaker inside one kind. */
  index: number;
  config?: ChartConfig;
}

export interface ChartSlotLocation extends ChartSlot {
  blockIndex: number;
  chartIndex: number;
}

/** The caption a chart was published with; i18n keys stay untranslated. */
export function chartLabel(block: Block, chartIndex: number): string {
  if (block.type === 'chart') return block.caption ?? '';
  if (block.type === 'chartgrid') return block.charts[chartIndex]?.title ?? '';
  return '';
}

function cloneConfig(config: ChartConfig | undefined): ChartConfig | undefined {
  if (!config) return undefined;
  return JSON.parse(JSON.stringify(config)) as ChartConfig;
}

/** Every chart in an output, with the identity key its config is remembered by. */
export function collectChartSlots(blocks: Block[]): ChartSlotLocation[] {
  const out: ChartSlotLocation[] = [];
  const seen = new Map<string, number>();
  blocks.forEach((block, blockIndex) => {
    const charts: ChartSpec[] = block.type === 'chart'
      ? [block.chart]
      : block.type === 'chartgrid'
        ? block.charts.map((item) => item.chart)
        : [];
    charts.forEach((chart, chartIndex) => {
      const label = chartLabel(block, chartIndex);
      const base = `${chart.kind}::${label || chart.title || ''}`;
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      out.push({
        key: `${base}#${occurrence}`,
        kind: chart.kind,
        index: out.length,
        config: cloneConfig(chart.config),
        blockIndex,
        chartIndex,
      });
    });
  });
  return out;
}

export interface RestoreResult {
  blocks: Block[];
  /** Charts that received a remembered config, by key. */
  applied: string[];
  /** Charts the saved set had nothing for. */
  unmatched: string[];
}

/**
 * Re-apply remembered chart configurations to a freshly produced output.
 *
 * Matching order: the same identity key, then the same kind at the same
 * position, then the same kind anywhere. Each remembered slot is consumed once,
 * so two charts never share one stored object.
 */
export function restoreChartConfigs(blocks: Block[], saved: ChartSlot[] | undefined): RestoreResult {
  const targets = collectChartSlots(blocks);
  if (!saved?.length) return { blocks, applied: [], unmatched: targets.map((slot) => slot.key) };
  const pool = saved.map((slot, index) => ({ ...slot, index: slot.index ?? index, config: cloneConfig(slot.config), taken: false }));
  const chosen = new Map<string, ChartConfig>();

  const take = (predicate: (slot: (typeof pool)[number]) => boolean): typeof pool[number] | undefined => {
    const found = pool.find((slot) => !slot.taken && predicate(slot));
    if (found) found.taken = true;
    return found;
  };

  // Pass 1 — the same chart (kind + caption).
  const pending: ChartSlotLocation[] = [];
  targets.forEach((target) => {
    const exact = take((slot) => slot.key === target.key && Boolean(slot.config));
    if (exact?.config) chosen.set(target.key, exact.config);
    else pending.push(target);
  });
  // Pass 2 — the same kind at the same position (a caption that changed).
  const stillPending: ChartSlotLocation[] = [];
  pending.forEach((target) => {
    const samePosition = take((slot) => slot.kind === target.kind && slot.index === target.index && Boolean(slot.config));
    if (samePosition?.config) chosen.set(target.key, samePosition.config);
    else stillPending.push(target);
  });
  // Pass 3 — the same kind anywhere left over.
  stillPending.forEach((target) => {
    const sameKind = take((slot) => slot.kind === target.kind && Boolean(slot.config));
    if (sameKind?.config) chosen.set(target.key, sameKind.config);
  });

  let cursor = 0;
  const nextBlocks = blocks.map((block) => {
    if (block.type === 'chart') {
      const slot = targets[cursor];
      cursor += 1;
      const config = slot ? chosen.get(slot.key) : undefined;
      return config ? { ...block, chart: { ...block.chart, config: cloneConfig(config) } } : block;
    }
    if (block.type === 'chartgrid') {
      return {
        ...block,
        charts: block.charts.map((item) => {
          const slot = targets[cursor];
          cursor += 1;
          const config = slot ? chosen.get(slot.key) : undefined;
          return config ? { ...item, chart: { ...item.chart, config: cloneConfig(config) } } : item;
        }),
      };
    }
    return block;
  });
  return {
    blocks: nextBlocks,
    applied: [...chosen.keys()],
    unmatched: targets.filter((slot) => !chosen.has(slot.key)).map((slot) => slot.key),
  };
}

/**
 * The session memory: one remembered slot list per analysis id.
 *
 * It is keyed by analysis (not by output card) on purpose — a reader who styled
 * "Capability Analysis" expects the next Capability Analysis to look the same —
 * and every value in and out is a copy, so two cards never alias one object.
 */
export class ChartConfigMemory {
  private readonly slots = new Map<string, ChartSlot[]>();

  remember(analysisId: string | undefined, blocks: Block[]): void {
    if (!analysisId) return;
    this.slots.set(analysisId, collectChartSlots(blocks).map(({ key, kind, index, config }) => ({ key, kind, index, config: cloneConfig(config) })));
  }

  get(analysisId: string | undefined): ChartSlot[] | undefined {
    if (!analysisId) return undefined;
    const found = this.slots.get(analysisId);
    return found ? found.map((slot) => ({ ...slot, config: cloneConfig(slot.config) })) : undefined;
  }

  restore(analysisId: string | undefined, blocks: Block[]): Block[] {
    return restoreChartConfigs(blocks, this.get(analysisId)).blocks;
  }

  clear(): void {
    this.slots.clear();
  }

  get size(): number {
    return this.slots.size;
  }
}

/** Does this output hold a chart of the given kind? (Drawer routing helper.) */
export function hasChartKind(blocks: Block[], kind: ChartSpec['kind']): boolean {
  return blocks.some((block) => (block.type === 'chart' && block.chart.kind === kind)
    || (block.type === 'chartgrid' && block.charts.some((item) => item.chart.kind === kind)));
}
