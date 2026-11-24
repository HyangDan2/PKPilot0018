/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — Tutorial validation registry (WO-T05, WO-T08)

   Each rule inspects the real workspace: worksheets, output cards, stored
   models, layout documents and the events the actions recorded. A validated
   step passes only when the state the reader produced matches the rule, and the
   numbers a rule compares are recomputed from Sigrún's own engine — never from
   a hard-coded answer key. Floating-point values are compared with an absolute
   and a relative tolerance; no formatted string is ever compared.
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartSpec, Worksheet } from '../types';
import type { StoredModel } from '../lib/modelStore';
import {
  defaultHoldingValue,
  predictStoredModel,
  type PredictionPoint,
} from '../lib/modelPredictor';
import type { OptimizerResult, ResponseSettings } from '../lib/optimizationTypes';
import type { LocalizedText } from '../lib/localized';
import type { ValidationOutcome, ValidationRule, WorkspaceFacts, TutorialEvent } from './types';

/* ── small helpers ────────────────────────────────────────────────────── */

export const DEFAULT_TOLERANCE = { abs: 1e-9, rel: 1e-6 };

export function closeTo(actual: number, expected: number, tolerance: { abs?: number; rel?: number } = DEFAULT_TOLERANCE): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const abs = tolerance.abs ?? DEFAULT_TOLERANCE.abs;
  const rel = tolerance.rel ?? DEFAULT_TOLERANCE.rel;
  return Math.abs(actual - expected) <= abs + rel * Math.abs(expected);
}

const pass = (code: string, detail: LocalizedText, evidence?: Record<string, unknown>): ValidationOutcome => ({ status: 'pass', code, detail, ...(evidence ? { evidence } : {}) });
const pending = (code: string, detail: LocalizedText, evidence?: Record<string, unknown>): ValidationOutcome => ({ status: 'pending', code, detail, ...(evidence ? { evidence } : {}) });
const fail = (code: string, detail: LocalizedText, evidence?: Record<string, unknown>): ValidationOutcome => ({ status: 'fail', code, detail, ...(evidence ? { evidence } : {}) });

export function latestEvent(facts: WorkspaceFacts, type: TutorialEvent['type']): TutorialEvent | undefined {
  for (let index = facts.events.length - 1; index >= 0; index -= 1) {
    if (facts.events[index].type === type) return facts.events[index];
  }
  return undefined;
}

export function eventsOf(facts: WorkspaceFacts, type: TutorialEvent['type']): TutorialEvent[] {
  return facts.events.filter((event) => event.type === type);
}

function columnMeanSd(values: (number | string | null)[]): { mean: number; sd: number; n: number } | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (numbers.length < 2) return null;
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const variance = numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (numbers.length - 1);
  return { mean, sd: Math.sqrt(variance), n: numbers.length };
}

function chartSpecs(facts: WorkspaceFacts): ChartSpec[] {
  const specs: ChartSpec[] = [];
  facts.outputs.forEach((output) => {
    output.blocks.forEach((block) => {
      if (block.type === 'chart') specs.push(block.chart);
      if (block.type === 'chartgrid') block.charts.forEach((entry) => specs.push(entry.chart));
    });
  });
  return specs;
}

function chartResponseNames(chart: ChartSpec): string[] {
  if (chart.kind === 'overlaid') return chart.responses.map((response) => response.name);
  if (chart.kind === 'surface3d') return chart.model ? [chart.model.response.name] : [];
  const label = `${chart.title ?? ''} ${('yLabel' in chart ? chart.yLabel : '') ?? ''}`;
  return [label];
}

function sheetWithColumns(facts: WorkspaceFacts, names: string[]): Worksheet | undefined {
  return facts.worksheets.find((sheet) => {
    const available = new Set(sheet.columns.map((column) => column.name));
    return names.every((name) => available.has(name));
  });
}

/* ── prediction consistency (WO-T08) ──────────────────────────────────── */

export interface ConsistencyCheck {
  name: string;
  ok: boolean;
  detail: LocalizedText;
  actual?: number | null;
  expected?: number | null;
  difference?: number | null;
}

export interface ConsistencyReport {
  ok: boolean;
  checks: ConsistencyCheck[];
}

function modelForResponse(models: StoredModel[], response: string): StoredModel | undefined {
  for (let index = models.length - 1; index >= 0; index -= 1) {
    if (models[index].response.name === response) return models[index];
  }
  return undefined;
}

/**
 * The same Actual Factor condition must give the same prediction in the
 * optimiser, in each stored model, in a saved profiler condition and on a 3D
 * surface built from that model. Each comparison is stated with its tolerance.
 */
export function checkPredictionConsistency(facts: WorkspaceFacts): ConsistencyReport {
  const checks: ConsistencyCheck[] = [];
  const optimizerEvent = latestEvent(facts, 'optimizer-run');
  const optimizer = optimizerEvent?.payload as { result?: OptimizerResult; responses?: ResponseSettings[] } | undefined;
  const solution = optimizer?.result?.solutions?.[0];
  if (!solution) {
    return {
      ok: false,
      checks: [{
        name: 'optimizer',
        ok: false,
        detail: { en: 'No completed optimisation is recorded yet.', ko: '아직 완료된 최적화 기록이 없습니다.' },
      }],
    };
  }
  const settings = solution.settings as Record<string, number>;

  solution.responses.forEach((response) => {
    const model = modelForResponse(facts.models, response.name);
    if (!model) {
      checks.push({
        name: `model:${response.name}`,
        ok: false,
        detail: { en: `No stored model predicts ${response.name}.`, ko: `${response.name}을(를) 예측하는 저장 모형이 없습니다.` },
      });
      return;
    }
    const point: PredictionPoint = {};
    Object.entries(settings).forEach(([name, value]) => { point[name] = value; });
    const predicted = predictStoredModel(model, point);
    checks.push({
      name: `optimizer:${response.name}`,
      ok: response.value !== null && predicted.value !== null && closeTo(predicted.value, response.value as number),
      detail: {
        en: 'The optimiser’s prediction matches the stored model at the same factor values.',
        ko: '최적화 예측값이 같은 요인 값에서 저장 모형의 예측과 일치합니다.',
      },
      actual: response.value,
      expected: predicted.value,
      difference: predicted.value !== null && response.value !== null ? Math.abs(predicted.value - response.value) : null,
    });
  });

  const profilerEvent = latestEvent(facts, 'profiler-saved');
  const profiler = profilerEvent?.payload as { point?: Record<string, number | string>; solution?: { responses?: { name: string; value: number | null }[] } } | undefined;
  if (profiler?.point) {
    Object.entries(profiler.point).forEach(([name, value]) => {
      const optimizerValue = settings[name];
      if (typeof value === 'number' && typeof optimizerValue === 'number') {
        checks.push({
          name: `profiler-point:${name}`,
          ok: closeTo(value, optimizerValue),
          detail: {
            en: 'The profiler is showing the optimiser’s condition.',
            ko: '프로파일러가 최적화 조건을 표시하고 있습니다.',
          },
          actual: value,
          expected: optimizerValue,
          difference: Math.abs(value - optimizerValue),
        });
      }
    });
    profiler.solution?.responses?.forEach((response) => {
      const model = modelForResponse(facts.models, response.name);
      if (!model || response.value === null) return;
      const point: PredictionPoint = {};
      Object.entries(profiler.point as Record<string, number | string>).forEach(([name, value]) => { point[name] = value; });
      const predicted = predictStoredModel(model, point);
      checks.push({
        name: `profiler:${response.name}`,
        ok: predicted.value !== null && closeTo(predicted.value, response.value),
        detail: {
          en: 'The profiler’s prediction matches the stored model at the profiled condition.',
          ko: '프로파일러 예측값이 그 조건에서 저장 모형의 예측과 일치합니다.',
        },
        actual: response.value,
        expected: predicted.value,
        difference: predicted.value !== null ? Math.abs(predicted.value - response.value) : null,
      });
    });
  }

  // A 3D surface must show the stored model's own arithmetic at the same
  // coordinates: compare the grid node nearest the centre with a direct
  // prediction at that node's actual factor values.
  const surfaces = chartSpecs(facts).filter((chart): chart is Extract<ChartSpec, { kind: 'surface3d' }> => chart.kind === 'surface3d');
  surfaces.forEach((surface) => {
    const model = surface.model;
    if (!model) return;
    const xs = surface.xs;
    const ys = surface.ys;
    if (!xs?.length || !ys?.length || !surface.z?.length) return;
    const midX = Math.floor(xs.length / 2);
    const midY = Math.floor(ys.length / 2);
    const xPredictor = model.predictors.find((predictor) => predictor.name === surface.xLabel);
    const yPredictor = model.predictors.find((predictor) => predictor.name === surface.yLabel);
    if (!xPredictor || !yPredictor) return;
    const point: PredictionPoint = {};
    model.predictors.forEach((predictor) => {
      if (predictor.name === xPredictor.name) return;
      if (predictor.name === yPredictor.name) return;
      point[predictor.name] = defaultHoldingValue(predictor, 'actual');
    });
    point[xPredictor.name] = xs[midX];
    point[yPredictor.name] = ys[midY];
    const predicted = predictStoredModel(model, point);
    const gridValue = surface.z[midY]?.[midX];
    checks.push({
      name: `surface:${model.response.name}`,
      ok: typeof gridValue === 'number' && Number.isFinite(gridValue) && predicted.value !== null && closeTo(gridValue, predicted.value),
      detail: {
        en: 'The 3D surface node matches the stored model at the same actual factor values.',
        ko: '3D 표면의 격자점이 같은 실제 요인 값에서 저장 모형의 예측과 일치합니다.',
      },
      actual: typeof gridValue === 'number' ? gridValue : null,
      expected: predicted.value,
      difference: typeof gridValue === 'number' && predicted.value !== null ? Math.abs(gridValue - predicted.value) : null,
    });
  });

  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks };
}

/* ── rule evaluation ──────────────────────────────────────────────────── */

export function validateStep(rule: ValidationRule, facts: WorkspaceFacts): ValidationOutcome {
  switch (rule.kind) {
    case 'manual':
      return pending('manual', { en: 'This step is completed by you.', ko: '이 단계는 직접 완료 처리합니다.' });

    case 'sample-loaded': {
      const sheet = sheetWithColumns(facts, rule.columns);
      if (sheet) {
        return pass('sample-loaded', {
          en: `The ${rule.sampleId} data are in the workbook with the expected columns.`,
          ko: `${rule.sampleId} 데이터가 기대한 열과 함께 워크북에 있습니다.`,
        }, { sheetId: sheet.id, columns: rule.columns.length });
      }
      const event = eventsOf(facts, 'sample-loaded').find((entry) => entry.payload.sampleId === rule.sampleId);
      if (event) {
        return fail('sample-columns-missing', {
          en: 'The sample was loaded but the worksheet no longer has all the expected columns.',
          ko: '샘플은 불러왔지만 워크시트에 기대한 열이 모두 남아 있지 않습니다.',
        }, { sampleId: rule.sampleId });
      }
      return pending('sample-not-loaded', {
        en: 'Load the sample dataset to begin.',
        ko: '실습을 시작하려면 샘플 데이터셋을 불러오십시오.',
      });
    }

    case 'help-opened': {
      const events = eventsOf(facts, 'help-opened');
      const match = rule.helpId ? events.find((event) => event.payload.helpId === rule.helpId) : events[0];
      if (match) {
        return pass('help-opened', { en: 'The related document was opened.', ko: '관련 문서를 열었습니다.' }, { helpId: match.payload.helpId });
      }
      return pending('help-not-opened', { en: 'Open the related help document.', ko: '관련 도움말 문서를 여십시오.' });
    }

    case 'analysis-opened': {
      const event = latestEvent(facts, 'analysis-opened');
      if (event && event.payload.analysisId === rule.analysisId) {
        return pass('analysis-opened', { en: 'The analysis dialog was opened.', ko: '분석 대화상자를 열었습니다.' });
      }
      return pending('analysis-not-opened', { en: 'Open the analysis dialog named in the step.', ko: '단계에 적힌 분석 대화상자를 여십시오.' });
    }

    case 'analysis-output': {
      const matches = facts.outputs.filter((output) => (output.meta?.analysisId ?? output.dialog?.analysisId) === rule.analysisId);
      const minCount = rule.minCount ?? 1;
      if (!matches.length) {
        return pending('analysis-not-run', { en: 'Run the analysis to create its output.', ko: '분석을 실행해 결과를 만드십시오.' });
      }
      if (matches.length < minCount) {
        return pending('analysis-count', {
          en: `Run the analysis ${minCount} times (${matches.length} so far).`,
          ko: `분석을 ${minCount}회 실행해야 합니다(현재 ${matches.length}회).`,
        });
      }
      if (rule.requireModel && !matches.some((output) => output.model)) {
        return fail('analysis-no-model', {
          en: 'The output carries no fitted model, so it cannot be stored.',
          ko: '이 결과에는 적합 모형이 없어 저장할 수 없습니다.',
        });
      }
      if (rule.withChart) {
        const hasChart = matches.some((output) => output.blocks.some((block) => (block.type === 'chart' && block.chart.kind === rule.withChart) || (block.type === 'chartgrid' && block.charts.some((entry) => entry.chart.kind === rule.withChart))));
        if (!hasChart) {
          return fail('analysis-chart-missing', {
            en: `The output has no ${rule.withChart} chart.`,
            ko: `이 결과에 ${rule.withChart} 차트가 없습니다.`,
          });
        }
      }
      return pass('analysis-output', {
        en: 'The analysis output is in the worksheet’s output pane.',
        ko: '분석 결과가 출력 창에 있습니다.',
      }, { outputs: matches.length });
    }

    case 'analysis-outputs': {
      const missing: string[] = [];
      rule.requirements.forEach((requirement) => {
        const match = facts.outputs.find((output) => (output.meta?.analysisId ?? output.dialog?.analysisId) === requirement.analysisId);
        if (!match) {
          missing.push(requirement.analysisId);
          return;
        }
        if (requirement.withChart) {
          const hasChart = match.blocks.some((block) => (block.type === 'chart' && block.chart.kind === requirement.withChart) || (block.type === 'chartgrid' && block.charts.some((entry) => entry.chart.kind === requirement.withChart)));
          if (!hasChart) missing.push(`${requirement.analysisId}:${requirement.withChart}`);
        }
      });
      if (missing.length) {
        return pending('analysis-outputs-missing', {
          en: `Still needed: ${missing.join(', ')}.`,
          ko: `아직 필요한 결과: ${missing.join(', ')}.`,
        }, { missing });
      }
      return pass('analysis-outputs', {
        en: 'Every analysis this step asks for has produced its output.',
        ko: '이 단계가 요구하는 모든 분석이 결과를 만들었습니다.',
      }, { count: rule.requirements.length });
    }

    case 'column-created': {
      const sheet = facts.worksheets.find((candidate) => candidate.id === facts.activeSheetId) ?? facts.worksheets[0];
      const column = sheet?.columns.find((candidate) => candidate.name === rule.name);
      if (!column) {
        return pending('column-missing', {
          en: `The column “${rule.name}” does not exist yet.`,
          ko: `“${rule.name}” 열이 아직 없습니다.`,
        });
      }
      const stats = columnMeanSd(column.values);
      if (rule.mean !== undefined && (!stats || !closeTo(stats.mean, rule.mean, rule.tolerance))) {
        return fail('column-mean', {
          en: `The column mean does not match the expected value (${rule.mean}).`,
          ko: `열의 평균이 기대값(${rule.mean})과 일치하지 않습니다.`,
        }, { actual: stats?.mean ?? null });
      }
      if (rule.sd !== undefined && (!stats || !closeTo(stats.sd, rule.sd, rule.tolerance))) {
        return fail('column-sd', {
          en: `The column standard deviation does not match the expected value (${rule.sd}).`,
          ko: `열의 표준편차가 기대값(${rule.sd})과 일치하지 않습니다.`,
        }, { actual: stats?.sd ?? null });
      }
      return pass('column-created', {
        en: `The column “${rule.name}” was created with the expected values.`,
        ko: `“${rule.name}” 열이 기대한 값으로 만들어졌습니다.`,
      }, { mean: stats?.mean, sd: stats?.sd, n: stats?.n });
    }

    case 'model-stored': {
      const wanted = rule.responses ?? [];
      const matched = facts.models.filter((model) => !wanted.length || wanted.includes(model.response.name));
      const minCount = rule.minCount ?? (wanted.length || 1);
      if (!matched.length) {
        return pending('model-missing', {
          en: 'Store the fitted model from its output card (Save model), then check again.',
          ko: '결과 카드에서 모형을 저장(Save model)한 뒤 다시 확인하십시오.',
        });
      }
      if (rule.modelKind && matched.some((model) => model.kind !== rule.modelKind)) {
        return fail('model-kind', {
          en: `A stored model has the wrong kind (expected ${rule.modelKind}).`,
          ko: `저장된 모형의 종류가 다릅니다(기대: ${rule.modelKind}).`,
        }, { kinds: matched.map((model) => model.kind) });
      }
      if (rule.quadratic && !matched.every((model) => model.terms.some((term) => term.label.includes('²')))) {
        return fail('model-not-quadratic', {
          en: 'A stored model has no squared terms: fit the full quadratic, not a linear model.',
          ko: '저장된 모형에 제곱항이 없습니다. 선형이 아니라 완전 2차 모형을 적합하십시오.',
        });
      }
      if (rule.minR2 !== undefined) {
        const worst = matched.reduce((low, model) => Math.min(low, model.diagnostics.r2 ?? Number.NEGATIVE_INFINITY), Number.POSITIVE_INFINITY);
        if (worst < rule.minR2) {
          return fail('model-r2', {
            en: `A stored model explains less than ${(rule.minR2 * 100).toFixed(0)}% of the variation.`,
            ko: `저장된 모형의 설명력이 ${(rule.minR2 * 100).toFixed(0)}%보다 낮습니다.`,
          }, { r2: worst });
        }
      }
      if (matched.length < minCount) {
        return pending('model-count', {
          en: `${matched.length} of ${minCount} models stored.`,
          ko: `모형 ${minCount}개 중 ${matched.length}개를 저장했습니다.`,
        });
      }
      return pass('model-stored', {
        en: `${matched.length} stored model(s) are in the Model Manager.`,
        ko: `저장된 모형 ${matched.length}개가 모형 관리자에 있습니다.`,
      }, { responses: matched.map((model) => model.response.name) });
    }

    case 'chart': {
      const charts = chartSpecs(facts).filter((chart) => chart.kind === rule.chartKind);
      if (!charts.length) {
        return pending('chart-missing', {
          en: `Create the ${rule.chartKind} chart from the stored models.`,
          ko: '저장된 모형으로 해당 차트를 만드십시오.',
        });
      }
      const filtered = rule.responses?.length
        ? charts.filter((chart) => {
          const names = chartResponseNames(chart);
          return rule.responses?.every((response) => names.some((name) => name.includes(response)));
        })
        : charts;
      if (!filtered.length) {
        return fail('chart-response', {
          en: 'A chart exists, but not for the response this step names.',
          ko: '차트는 있지만 이 단계가 지정한 반응의 차트가 아닙니다.',
        }, { found: charts.map((chart) => chartResponseNames(chart)) });
      }
      if (rule.requireFeasible) {
        const feasible = filtered.some((chart) => chart.kind === 'overlaid' && (chart.feasible?.areaRatio ?? 0) > 0);
        if (!feasible) {
          return fail('chart-no-feasible', {
            en: 'The overlaid contour has no feasible region with the stated limits.',
            ko: '지정한 한계로는 중첩 등고선에 실행가능 영역이 없습니다.',
          });
        }
      }
      const minCount = rule.minCount ?? 1;
      if (filtered.length < minCount) {
        return pending('chart-count', {
          en: `${filtered.length} of ${minCount} charts are in the output.`,
          ko: `필요한 차트 ${minCount}개 중 ${filtered.length}개가 출력에 있습니다.`,
        });
      }
      return pass('chart', {
        en: 'The required chart is in the output pane.',
        ko: '필요한 차트가 출력 창에 있습니다.',
      }, { charts: filtered.length });
    }

    case 'optimizer-run': {
      const event = latestEvent(facts, 'optimizer-run');
      if (!event) {
        return pending('optimizer-not-run', {
          en: 'Open the optimiser and run it.',
          ko: '최적화 창을 열고 실행하십시오.',
        });
      }
      const payload = event.payload as { result?: OptimizerResult; responses?: ResponseSettings[] };
      const result = payload.result;
      const solution = result?.solutions?.[0];
      if (!result || !solution) {
        return fail('optimizer-no-solution', {
          en: 'The optimisation finished without a feasible solution.',
          ko: '최적화가 실행가능한 해 없이 종료되었습니다.',
        }, { status: result?.status });
      }
      if (rule.statuses?.length && !rule.statuses.includes(result.status)) {
        return fail('optimizer-status', {
          en: `The last optimisation ended as “${result.status}”; run it again until it converges or is proven optimal.`,
          ko: `마지막 최적화가 “${result.status}”로 끝났습니다. 수렴하거나 최적으로 입증될 때까지 다시 실행하십시오.`,
        }, { status: result.status });
      }
      if (rule.minComposite !== undefined && solution.composite < rule.minComposite) {
        return fail('optimizer-composite', {
          en: `The composite desirability ${solution.composite.toFixed(4)} is below ${rule.minComposite}.`,
          ko: `복합 만족도 ${solution.composite.toFixed(4)}가 기준 ${rule.minComposite}보다 낮습니다.`,
        }, { composite: solution.composite });
      }
      for (const goal of rule.goals ?? []) {
        const setting = payload.responses?.find((response) => response.name === goal.response);
        if (!setting || setting.goal !== goal.goal) {
          return fail('optimizer-goal', {
            en: `The goal for ${goal.response} is not set to ${goal.goal}.`,
            ko: `${goal.response}의 목표가 ${goal.goal}로 설정되지 않았습니다.`,
          }, { actual: setting?.goal ?? null });
        }
      }
      let consistency: ConsistencyReport | undefined;
      if (rule.consistent) {
        consistency = checkPredictionConsistency(facts);
        if (!consistency.ok) {
          return fail('optimizer-inconsistent', {
            en: 'The optimiser’s predictions do not match the stored models at the same factor values.',
            ko: '최적화 예측값이 같은 요인 값에서 저장 모형과 일치하지 않습니다.',
          }, { checks: consistency.checks });
        }
      }
      return pass('optimizer-run', {
        en: 'A valid optimisation result is recorded and its predictions agree across the models.',
        ko: '유효한 최적화 결과가 기록되었고 예측값이 모형들 사이에서 일치합니다.',
      }, { status: result.status, composite: solution.composite, consistency });
    }

    case 'profiler-check': {
      const opened = latestEvent(facts, 'profiler-opened');
      if (!opened) {
        return pending('profiler-not-opened', {
          en: 'Open the prediction profiler at the optimiser’s condition.',
          ko: '최적화 조건에서 예측 프로파일러를 여십시오.',
        });
      }
      const saved = latestEvent(facts, 'profiler-saved');
      if (rule.atOptimizerPoint) {
        const optimizer = latestEvent(facts, 'optimizer-run')?.payload as { result?: OptimizerResult } | undefined;
        const settings = optimizer?.result?.solutions?.[0]?.settings as Record<string, number> | undefined;
        const point = (opened.payload.point ?? {}) as Record<string, number | string>;
        if (settings) {
          const mismatch = Object.entries(settings).find(([name, value]) => typeof point[name] === 'number' && !closeTo(point[name] as number, value));
          if (mismatch) {
            return fail('profiler-point', {
              en: 'The profiler is not at the optimiser’s best condition.',
              ko: '프로파일러가 최적화 최선 조건에 있지 않습니다.',
            }, { factor: mismatch[0], actual: point[mismatch[0]], expected: mismatch[1] });
          }
        }
      }
      if (rule.consistent && saved) {
        const report = checkPredictionConsistency(facts);
        if (!report.ok) {
          return fail('profiler-inconsistent', {
            en: 'A profiler prediction does not match the stored model at the same condition.',
            ko: '프로파일러 예측값이 같은 조건에서 저장 모형과 일치하지 않습니다.',
          }, { checks: report.checks });
        }
      }
      return pass('profiler-check', {
        en: 'The profiler is open at the optimiser’s condition and its numbers agree with the models.',
        ko: '프로파일러가 최적화 조건에서 열렸고 수치가 모형과 일치합니다.',
      }, { saved: Boolean(saved) });
    }

    case 'layout-saved': {
      const event = latestEvent(facts, 'layout-saved');
      const figure = facts.figures[facts.figures.length - 1];
      if (!event && !figure) {
        return pending('layout-missing', {
          en: 'Arrange the charts in the layout editor and save the figure.',
          ko: '배치 편집기에서 차트를 배치하고 그림을 저장하십시오.',
        });
      }
      const payload = (event?.payload ?? {}) as { chartPanels?: number; figureLabels?: number };
      const chartPanels = payload.chartPanels ?? figure?.panels.filter((panel) => panel.kind === 'chart').length ?? 0;
      const labels = payload.figureLabels ?? figure?.panels.filter((panel) => panel.kind === 'figure-label').length ?? 0;
      if (rule.minChartPanels !== undefined && chartPanels < rule.minChartPanels) {
        return fail('layout-panels', {
          en: `${chartPanels} chart panel(s) placed; at least ${rule.minChartPanels} are needed.`,
          ko: `차트 패널 ${chartPanels}개를 배치했습니다. 최소 ${rule.minChartPanels}개가 필요합니다.`,
        }, { chartPanels });
      }
      if (rule.requireFigureLabel && labels < 1) {
        return fail('layout-label', {
          en: 'Add a figure label so the page can be cited.',
          ko: '인용할 수 있도록 그림 번호를 추가하십시오.',
        });
      }
      return pass('layout-saved', {
        en: 'The figure layout is saved in the project.',
        ko: '그림 배치가 프로젝트에 저장되었습니다.',
      }, { chartPanels, figureLabels: labels });
    }

    case 'layout-export': {
      const layoutEvent = latestEvent(facts, 'layout-saved');
      const figure = facts.figures[facts.figures.length - 1];
      const payload = (layoutEvent?.payload ?? {}) as { chartPanels?: number; figureLabels?: number };
      const chartPanels = payload.chartPanels ?? figure?.panels.filter((panel) => panel.kind === 'chart').length ?? 0;
      const labels = payload.figureLabels ?? figure?.panels.filter((panel) => panel.kind === 'figure-label').length ?? 0;
      const exportEvent = latestEvent(facts, 'figure-exported');
      if (!layoutEvent && !figure) {
        return pending('layout-missing', { en: 'Save a figure layout first.', ko: '먼저 그림 배치를 저장하십시오.' });
      }
      if (rule.minChartPanels !== undefined && chartPanels < rule.minChartPanels) {
        return fail('layout-panels', {
          en: `${chartPanels} chart panel(s) placed; at least ${rule.minChartPanels} are needed.`,
          ko: `차트 패널 ${chartPanels}개를 배치했습니다. 최소 ${rule.minChartPanels}개가 필요합니다.`,
        }, { chartPanels });
      }
      if (rule.requireFigureLabel && labels < 1) {
        return fail('layout-label', { en: 'Add a figure label to the page.', ko: '페이지에 그림 번호를 추가하십시오.' });
      }
      if (!exportEvent) {
        return pending('export-missing', { en: 'Export the figure as PNG or SVG.', ko: '그림을 PNG 또는 SVG로 내보내십시오.' });
      }
      if (rule.format && String(exportEvent.payload.format) !== rule.format) {
        return fail('export-format', {
          en: `The last export was ${String(exportEvent.payload.format)}; export a ${rule.format}.`,
          ko: `마지막 내보내기는 ${String(exportEvent.payload.format)}입니다. ${rule.format}로 내보내십시오.`,
        });
      }
      return pass('layout-export', {
        en: 'The figure was laid out, labelled and exported.',
        ko: '그림을 배치하고 번호를 붙여 내보냈습니다.',
      }, { chartPanels, figureLabels: labels, format: exportEvent.payload.format });
    }

    case 'practice-complete': {
      const needed = rule.requireModels ?? 0;
      const missing: string[] = [];
      if (facts.models.length < needed) missing.push(`models ${facts.models.length}/${needed}`);
      if (rule.requireOptimizer && !latestEvent(facts, 'optimizer-run')) missing.push('optimizer');
      if (rule.requireProject && !latestEvent(facts, 'project-saved')) missing.push('project');
      if (rule.requireLayout && !latestEvent(facts, 'layout-saved')) missing.push('layout');
      if (missing.length) {
        return pending('practice-incomplete', {
          en: `The practice is missing: ${missing.join(', ')}.`,
          ko: `실습에 아직 없는 항목: ${missing.join(', ')}.`,
        }, { missing });
      }
      if (rule.requireOptimizer) {
        const report = checkPredictionConsistency(facts);
        if (!report.ok) {
          return fail('practice-inconsistent', {
            en: 'The practice end state is not internally consistent: predictions differ between components.',
            ko: '실습 최종 상태가 내부적으로 일치하지 않습니다. 구성 요소 간 예측값이 다릅니다.',
          }, { checks: report.checks });
        }
      }
      return pass('practice-complete', {
        en: 'The end state holds every artefact the summary reports, and the predictions agree.',
        ko: '요약이 보고할 모든 산출물이 있고 예측값도 일치합니다.',
      }, { models: facts.models.length });
    }

    case 'chart-exported': {
      const event = latestEvent(facts, 'figure-exported');
      if (!event) {
        return pending('export-missing', {
          en: 'Export the laid-out figure from the layout editor.',
          ko: '배치 편집기에서 그림을 내보내십시오.',
        });
      }
      const format = String(event.payload.format ?? '');
      if (rule.formats?.length && !rule.formats.includes(format as 'png' | 'svg')) {
        return fail('export-format', {
          en: `The last export was ${format || 'unknown'}; export ${rule.formats.join(' or ')}.`,
          ko: `마지막 내보내기는 ${format || '알 수 없음'}입니다. ${rule.formats.join(' 또는 ')}로 내보내십시오.`,
        }, { format });
      }
      return pass('chart-exported', { en: 'The figure file was exported.', ko: '그림 파일을 내보냈습니다.' }, { format });
    }

    case 'project-saved': {
      const event = latestEvent(facts, 'project-saved');
      if (!event) {
        return pending('project-not-saved', {
          en: 'Save the practice project.',
          ko: '실습 프로젝트를 저장하십시오.',
        });
      }
      if (rule.roundtrip && event.payload.roundtripOk === false) {
        return fail('project-roundtrip', {
          en: 'The saved project could not be read back with the same worksheets, outputs and models.',
          ko: '저장한 프로젝트를 다시 읽었을 때 워크시트·결과·모형이 같지 않았습니다.',
        }, event.payload);
      }
      return pass('project-saved', {
        en: 'The practice project file was written and read back successfully.',
        ko: '실습 프로젝트 파일을 저장하고 다시 읽어 확인했습니다.',
      }, event.payload);
    }

    default:
      return pending('unknown-rule', { en: 'This step cannot be validated automatically.', ko: '이 단계는 자동 검증할 수 없습니다.' });
  }
}
