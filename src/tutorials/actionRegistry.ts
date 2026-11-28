/* ─────────────────────────────────────────────────────────────────────────
   Statelia — Tutorial action registry (WO-T02)

   The only way a tutorial may touch the application. Every action is declared
   here with the parameters it requires; the dispatcher validates the request
   and calls one method of the bridge. There is no eval, no dynamic import and
   no access to React state from this module, so a tutorial file cannot reach
   any code that is not on this list.
   ───────────────────────────────────────────────────────────────────────── */

import type { LocalizedText } from '../lib/localized';
import type { ActionResult, TutorialActionId, TutorialActionSpec, TutorialBridge } from './types';

export interface ActionParam {
  key: 'sampleId' | 'analysisId' | 'presetId' | 'helpId' | 'chart' | 'optimizer' | 'layout' | 'export';
  required: boolean;
}

export interface ActionDefinition {
  id: TutorialActionId;
  labelKey: string;
  description: LocalizedText;
  params: ActionParam[];
  /** Asks the reader before it runs (run-analysis: the analysis itself). */
  confirms?: boolean;
}

const P = (key: ActionParam['key'], required = true): ActionParam => ({ key, required });

export const TUTORIAL_ACTIONS: Record<TutorialActionId, ActionDefinition> = {
  'load-sample': {
    id: 'load-sample',
    labelKey: 'tut.action.load-sample',
    description: {
      en: 'Load a sample dataset into a new practice worksheet.',
      ko: '샘플 데이터셋을 새 실습 워크시트로 불러옵니다.',
    },
    params: [P('sampleId')],
  },
  'open-help': {
    id: 'open-help',
    labelKey: 'tut.action.open-help',
    description: {
      en: 'Open the related Help Center document and return to this step.',
      ko: '관련 도움말 문서를 열고 이 단계로 돌아옵니다.',
    },
    params: [P('helpId')],
  },
  'open-analysis': {
    id: 'open-analysis',
    labelKey: 'tut.action.open-analysis',
    description: {
      en: 'Open an analysis dialog, optionally with the tutorial preset filled in.',
      ko: '분석 대화상자를 열고 필요하면 튜토리얼 프리셋을 채웁니다.',
    },
    params: [P('analysisId'), P('presetId', false)],
  },
  'apply-preset': {
    id: 'apply-preset',
    labelKey: 'tut.action.apply-preset',
    description: {
      en: 'Fill the open analysis dialog with the tutorial preset; you may still edit every value.',
      ko: '열린 분석 대화상자에 튜토리얼 프리셋을 채웁니다. 모든 값은 수정할 수 있습니다.',
    },
    params: [P('analysisId'), P('presetId')],
  },
  'run-analysis': {
    id: 'run-analysis',
    labelKey: 'tut.action.run-analysis',
    description: {
      en: 'Run the configured analysis after you confirm it; the engine computes the result.',
      ko: '확인 후 설정된 분석을 실행합니다. 결과는 엔진이 계산합니다.',
    },
    params: [P('analysisId', false)],
    confirms: true,
  },
  'open-model-manager': {
    id: 'open-model-manager',
    labelKey: 'tut.action.open-model-manager',
    description: {
      en: 'Open the Model Manager on the stored models.',
      ko: '저장된 모형의 모형 관리자를 엽니다.',
    },
    params: [],
  },
  'open-chart': {
    id: 'open-chart',
    labelKey: 'tut.action.open-chart',
    description: {
      en: 'Build a contour, 3D surface or overlaid contour from the stored models.',
      ko: '저장된 모형으로 등고선, 3D 표면, 중첩 등고선을 만듭니다.',
    },
    params: [P('chart')],
  },
  'open-optimizer': {
    id: 'open-optimizer',
    labelKey: 'tut.action.open-optimizer',
    description: {
      en: 'Open the response optimizer with the tutorial goals and limits.',
      ko: '튜토리얼의 목표와 한계를 채운 반응 최적화 창을 엽니다.',
    },
    params: [P('optimizer', false)],
  },
  'open-profiler': {
    id: 'open-profiler',
    labelKey: 'tut.action.open-profiler',
    description: {
      en: 'Open the prediction profiler at the optimiser’s best condition.',
      ko: '최적화 최선 조건에서 예측 프로파일러를 엽니다.',
    },
    params: [],
  },
  'open-layout': {
    id: 'open-layout',
    labelKey: 'tut.action.open-layout',
    description: {
      en: 'Open the figure layout editor with the tutorial’s charts.',
      ko: '튜토리얼의 차트로 그림 배치 편집기를 엽니다.',
    },
    params: [P('layout', false)],
  },
  'export-project': {
    id: 'export-project',
    labelKey: 'tut.action.export-project',
    description: {
      en: 'Save the practice project and verify it reads back.',
      ko: '실습 프로젝트를 저장하고 다시 읽어 검증합니다.',
    },
    params: [P('export', false)],
  },
  'export-chart': {
    id: 'export-chart',
    labelKey: 'tut.action.export-chart',
    description: {
      en: 'Export the laid-out figure as PNG or SVG.',
      ko: '배치한 그림을 PNG 또는 SVG로 내보냅니다.',
    },
    params: [P('export', false)],
  },
  'validate-result': {
    id: 'validate-result',
    labelKey: 'tut.action.validate-result',
    description: {
      en: 'Re-check the workspace against this step’s completion rule.',
      ko: '워크스페이스 상태를 이 단계의 완료 규칙으로 다시 검사합니다.',
    },
    params: [],
  },
};

export const ACTION_IDS = Object.keys(TUTORIAL_ACTIONS) as TutorialActionId[];

/** Parameter problems that make a step definition unusable (registry QA). */
export function validateActionSpec(spec: TutorialActionSpec | undefined): string[] {
  if (!spec) return ['missing-action'];
  const def = TUTORIAL_ACTIONS[spec.action];
  if (!def) return [`unknown-action:${String(spec.action)}`];
  const problems: string[] = [];
  def.params.forEach((param) => {
    if (param.required && (spec as unknown as Record<string, unknown>)[param.key] === undefined) {
      problems.push(`missing-param:${spec.action}.${param.key}`);
    }
  });
  if (spec.action === 'open-chart' && spec.chart) {
    const kinds = ['contour', 'surface3d', 'overlaid', 'histogram', 'boxplot', 'scatter'];
    if (!kinds.includes(spec.chart.kind)) problems.push(`bad-chart-kind:${spec.chart.kind}`);
  }
  if (spec.action === 'open-optimizer' && spec.optimizer) {
    if (!Array.isArray(spec.optimizer.responses) || !spec.optimizer.responses.length) problems.push('optimizer-no-responses');
    spec.optimizer.responses?.forEach((response) => {
      if (!['maximize', 'minimize', 'range', 'target'].includes(response.goal)) problems.push(`bad-goal:${response.goal}`);
    });
  }
  return problems;
}

/** Run one declared action through the bridge. */
export function runTutorialAction(spec: TutorialActionSpec, bridge: TutorialBridge): ActionResult {
  const problems = validateActionSpec(spec);
  if (problems.length) {
    return { ok: false, code: 'invalid-action', message: problems.join(', ') };
  }
  try {
    switch (spec.action) {
      case 'load-sample':
        return bridge.loadSample(spec.sampleId as string);
      case 'open-help':
        return bridge.openHelp(spec.helpId as string);
      case 'open-analysis':
        return bridge.openAnalysis(spec.analysisId as string, spec.presetId);
      case 'apply-preset':
        return bridge.applyPreset(spec.analysisId as string, spec.presetId as string);
      case 'run-analysis':
        return bridge.runAnalysis();
      case 'open-model-manager':
        return bridge.openModelManager();
      case 'open-chart':
        return bridge.openChart(spec.chart as NonNullable<TutorialActionSpec['chart']>);
      case 'open-optimizer':
        return bridge.openOptimizer(spec.optimizer);
      case 'open-profiler':
        return bridge.openProfiler();
      case 'open-layout':
        return bridge.openLayout();
      case 'export-project':
        return bridge.exportProject();
      case 'export-chart':
        return bridge.exportChart();
      case 'validate-result':
        return bridge.validateResult();
      default:
        return { ok: false, code: 'unknown-action', message: String(spec.action) };
    }
  } catch (error) {
    return {
      ok: false,
      code: 'action-threw',
      message: error instanceof Error ? error.message : 'unknown error',
    };
  }
}
