/* ─────────────────────────────────────────────────────────────────────────
   Statelia — Guided Tutorial System types (WO-3E-11 / WO-T01)

   A tutorial is declarative: metadata, seven-part teaching text, and a list of
   steps. A step names one allow-listed action, the sample/help/analysis it
   touches, and how completion is decided (manual or validated). No tutorial
   carries data or theory — those live in `src/samples` and `src/help` and are
   reached by id.
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartSpec } from '../types';
import type { LocalizedText } from '../lib/localized';
import type { LayoutDoc } from '../lib/graphLayout';
import type { StoredModel } from '../lib/modelStore';
import type { OutputDoc, Worksheet } from '../types';

export type TutorialCategory =
  | 'getting-started'
  | 'data-management'
  | 'basic-statistics'
  | 'regression'
  | 'anova-glm'
  | 'quality-spc'
  | 'msa'
  | 'reliability'
  | 'doe-rsm'
  | 'optimization'
  | 'visualization';

export type TutorialDifficulty = 'intro' | 'beginner' | 'intermediate' | 'advanced';

/** The thirteen actions a tutorial may invoke. Nothing else can be called. */
export type TutorialActionId =
  | 'load-sample'
  | 'open-help'
  | 'open-analysis'
  | 'apply-preset'
  | 'run-analysis'
  | 'open-model-manager'
  | 'open-chart'
  | 'open-optimizer'
  | 'open-profiler'
  | 'open-layout'
  | 'export-project'
  | 'export-chart'
  | 'validate-result';

export type CompletionMode = 'manual' | 'validated';

/** Step state (WO-T05). */
export type StepStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'FAILED';

export type ChartKind = ChartSpec['kind'];

export interface TutorialChartSpec {
  kind: 'contour' | 'surface3d' | 'overlaid' | 'histogram' | 'boxplot' | 'scatter';
  /** Response names the chart(s) must show (stored model response names). */
  responses?: string[];
  /** Restrict the models handed to the chart (stored model names). */
  modelNames?: string[];
  /** Specification limits for an overlaid contour, per response. */
  specs?: { response: string; lsl?: number | null; usl?: number | null; target?: number | null }[];
}

export interface TutorialOptimizerResponseSpec {
  response: string;
  goal: 'maximize' | 'minimize' | 'range' | 'target';
  lower?: number;
  upper?: number;
  target?: number;
}

export interface TutorialOptimizerSpec {
  responses: TutorialOptimizerResponseSpec[];
}

export interface TutorialActionSpec {
  action: TutorialActionId;
  sampleId?: string;
  analysisId?: string;
  presetId?: string;
  /** Further presets of the same analysis offered beside the primary action. */
  presetIds?: string[];
  helpId?: string;
  chart?: TutorialChartSpec;
  optimizer?: TutorialOptimizerSpec;
  layout?: { minChartPanels?: number };
  export?: { format?: 'project' | 'figure' };
}

/* ── validation ───────────────────────────────────────────────────────── */

export interface ComparisonTolerance {
  /** Absolute tolerance; default 1e-9. */
  abs?: number;
  /** Relative tolerance; default 1e-6. */
  rel?: number;
}

export type ValidationRule =
  | { kind: 'sample-loaded'; sampleId: string; columns: string[] }
  | { kind: 'help-opened'; helpId?: string }
  | { kind: 'analysis-opened'; analysisId: string }
  | {
    kind: 'analysis-output';
    analysisId: string;
    minCount?: number;
    requireModel?: boolean;
    withChart?: ChartKind;
    /** Column names the run must have consumed (input verification). */
    columns?: string[];
    /** Dialog parameters the run must have used (parameter verification). */
    params?: Record<string, string | number | boolean>;
    /** Preset whose filled slots state the expected columns and parameters. */
    presetId?: string;
  }
  | { kind: 'analysis-outputs'; requirements: { analysisId: string; withChart?: ChartKind }[] }
  | { kind: 'column-created'; name: string; mean?: number; sd?: number; tolerance?: ComparisonTolerance }
  | { kind: 'model-stored'; responses?: string[]; minCount?: number; minR2?: number; modelKind?: StoredModel['kind']; quadratic?: boolean }
  | { kind: 'chart'; chartKind: ChartKind; minCount?: number; responses?: string[]; requireFeasible?: boolean }
  | { kind: 'optimizer-run'; goals?: { response: string; goal: string }[]; minComposite?: number; statuses?: string[]; consistent?: boolean }
  | {
    kind: 'profiler-check';
    consistent?: boolean;
    atOptimizerPoint?: boolean;
    /** The condition must have been saved, not only viewed. */
    requireSaved?: boolean;
    /** Responses the profiler must show a prediction for. */
    responses?: string[];
  }
  | { kind: 'layout-saved'; minChartPanels?: number; requireFigureLabel?: boolean }
  | { kind: 'layout-export'; minChartPanels?: number; requireFigureLabel?: boolean; format?: 'png' | 'svg' }
  | { kind: 'practice-complete'; requireModels?: number; requireOptimizer?: boolean; requireProject?: boolean; requireLayout?: boolean }
  | { kind: 'chart-exported'; formats?: ('png' | 'svg')[] }
  | { kind: 'project-saved'; roundtrip?: boolean }
  | { kind: 'manual' };

export interface TutorialStep {
  id: string;
  titleKey: string;
  instructionKey: string;
  /** What the reader should see when the step is done. */
  expectedKey: string;
  hintKey?: string;
  action: TutorialActionSpec;
  helpId?: string;
  completion: CompletionMode;
  optional?: boolean;
  validation: ValidationRule;
}

/** The seven-part teaching structure every tutorial follows (WO-T07). */
export interface TutorialStructure {
  learnKey: string;
  dataKey: string;
  analysisKey: string;
  inputsKey: string;
  checkKey: string;
  interpretKey: string;
  conclusionKey: string;
}

export interface Tutorial {
  id: string;
  schemaVersion: 1;
  /** Content version; a stored progress record from another version is not resumed blindly. */
  version: number;
  titleKey: string;
  descriptionKey: string;
  category: TutorialCategory;
  difficulty: TutorialDifficulty;
  estimatedMinutes: number;
  /** Learning objectives, each a localization key. */
  objectiveKeys: string[];
  /** Tutorial ids that should be completed first. */
  prerequisites: string[];
  sampleIds: string[];
  helpIds: string[];
  /** Analyses the tutorial actually opens or runs. */
  analysisIds: string[];
  structure: TutorialStructure;
  steps: TutorialStep[];
  nextTutorialId?: string;
  /** The flagship tutorial: every step is validated. */
  flagship?: boolean;
}

/* ── runtime workspace facts handed to validators ─────────────────────── */

export type TutorialEventType =
  | 'sample-loaded'
  | 'help-opened'
  | 'analysis-opened'
  | 'analysis-run'
  | 'model-saved'
  | 'chart-created'
  | 'optimizer-run'
  | 'profiler-opened'
  | 'profiler-saved'
  | 'layout-saved'
  | 'figure-exported'
  | 'project-saved'
  | 'action-failed';

export interface TutorialEvent {
  id: string;
  type: TutorialEventType;
  at: number;
  /** Step that caused the event, when an action caused it. */
  stepId?: string;
  payload: Record<string, unknown>;
}

export interface PracticeProjectInfo {
  id: string;
  /** 'isolated' — a fresh practice project; 'current' — the reader's own project. */
  mode: 'isolated' | 'current';
  tutorialId: string;
  sampleIds: string[];
  /** The tutorial session this practice belongs to (WO-TQA-12). */
  sessionId?: string;
}

/** One practice project kept for later, keyed by tutorial and session (WO-TQA-07). */
export interface PracticeSlot {
  slotId: string;
  tutorialId: string;
  tutorialVersion: number;
  sessionId: string;
  projectId: string;
  savedAt: string;
  /** The practice project file, as it was written. */
  json: string;
  /** The evidence the validators read, so a resumed lesson is re-judged (WO-TQA-08). */
  events: TutorialEvent[];
  /** The progress record of that session, kept beside its project. */
  progress?: TutorialProgress | null;
  /** The original project this practice was opened from. */
  originalProjectId: string | null;
}

/** The reader's own project, saved before a practice isolates it (WO-TQA-01). */
export interface OriginalProjectSlot {
  projectId: string;
  tutorialId: string | null;
  sessionId: string | null;
  savedAt: string;
  json: string;
  /** Fingerprint of what was written; the read-back must match it. */
  fingerprint: string;
}

export interface WorkspaceFacts {
  worksheets: Worksheet[];
  activeSheetId: string;
  outputs: OutputDoc[];
  models: StoredModel[];
  figures: LayoutDoc[];
  events: TutorialEvent[];
  practice: PracticeProjectInfo | null;
}

export interface ValidationOutcome {
  /** pass = the step is done; pending = nothing to judge yet; fail = the state contradicts the rule. */
  status: 'pass' | 'pending' | 'fail';
  code: string;
  detail: LocalizedText;
  evidence?: Record<string, unknown>;
}

/* ── action bridge ────────────────────────────────────────────────────── */

export interface ActionResult {
  ok: boolean;
  /** A localization key or finished sentence shown to the reader. */
  message?: string;
  /** Machine code for the log: ok, needs-sample, not-implemented, failed. */
  code?: string;
}

export interface BridgeState {
  activeSheetId: string;
  sheetName: string;
  hasDialog: boolean;
  dialogAnalysisId: string | null;
  modelCount: number;
  outputCount: number;
  practiceActive: boolean;
}

/**
 * What a tutorial action may do to the application. Implemented by App.tsx; the
 * action registry never reaches into React state itself, so the allow-list is
 * the only path from a tutorial to the application.
 */
export interface TutorialBridge {
  loadSample(sampleId: string): ActionResult;
  openHelp(helpId: string): ActionResult;
  openAnalysis(analysisId: string, presetId?: string): ActionResult;
  applyPreset(analysisId: string, presetId: string): ActionResult;
  runAnalysis(): ActionResult;
  openModelManager(): ActionResult;
  openChart(spec: TutorialChartSpec): ActionResult;
  openOptimizer(spec?: TutorialOptimizerSpec): ActionResult;
  openProfiler(): ActionResult;
  openLayout(): ActionResult;
  exportProject(): ActionResult;
  exportChart(): ActionResult;
  validateResult(): ActionResult;
  state(): BridgeState;
}

/* ── progress (WO-T05) ────────────────────────────────────────────────── */

export interface StepProgress {
  status: StepStatus;
  mode: CompletionMode;
  /** Set when a validated step last passed. */
  validatedAt?: number;
  updatedAt?: number;
  /** Why the last validation failed, for the panel. */
  code?: string;
  detail?: LocalizedText;
}

export interface TutorialProgress {
  schemaVersion: 1;
  tutorialId: string;
  tutorialVersion: number;
  sessionId: string;
  practiceProjectId: string | null;
  currentStepId: string;
  steps: Record<string, StepProgress>;
  startedAt: string;
  updatedAt: string;
  /** 'in-progress' until every required step is COMPLETED or SKIPPED. */
  status: 'in-progress' | 'completed';
}

export interface ProgressStoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
