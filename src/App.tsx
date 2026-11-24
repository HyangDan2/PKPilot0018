import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisMeta, ChartSource, Column, Lang, OutputDoc, Settings, Theme, Worksheet } from './types';
import type { LayoutDoc } from './lib/graphLayout';
import { Brand, HeaderActions } from './components/Header';
import { MenuBar, type MenuAction } from './components/MenuBar';
import { FloatPanel } from './components/FloatPanel';
import { Toolbar } from './components/Toolbar';
import { Navigator } from './components/Navigator';
import { OutputPanel } from './components/OutputPanel';
import { WorksheetGrid, type GridContextTarget } from './components/WorksheetGrid';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { FindReplacePanel } from './components/FindReplacePanel';
import { AnalysisDialog } from './components/AnalysisDialog';
import { HelpModal } from './components/HelpModal';
import { HelpCenter } from './components/HelpCenter';
import { SampleLibrary } from './components/SampleLibrary';
import { TutorialLibrary } from './components/tutorial/TutorialLibrary';
import { TutorialRunner } from './components/tutorial/TutorialRunner';
import { ModelManager } from './components/ModelManager';
import { ResponseOptimizer } from './components/ResponseOptimizer';
import { PredictionProfiler } from './components/PredictionProfiler';
import type { FactorSettings, OptimizerResult, ResponseSettings } from './lib/optimizationTypes';
import { ImportDialog, type PreviewSheet } from './components/ImportDialog';
import { GraphLayoutEditor } from './components/GraphLayoutEditor';
import { selectedRowsCsv } from './lib/chartInteraction';
import { ANALYSES, defaultValues as defaultDialogValues, findAnalysis, type AnalysisDef, type RunResult } from './lib/analyses';
import { ChartConfigMemory } from './lib/chartMemory';
import { loadCustomStyles, saveCustomStyle, writeCustomStyles } from './lib/chartStyles';
import {
  createStoredModel,
  defaultModelName,
  deleteStoredModel,
  duplicateStoredModel,
  mergeStoredModels,
  parseStoredModels,
  refitStoredModel,
  renameStoredModel,
  uniqueModelName,
  type StoredModel,
} from './lib/modelStore';
import { modelSurface, toActualValue } from './lib/modelPredictor';
import { buildModelSurface, buildOverlaidChart, numericFactors } from './lib/chartConfigOps';
import { commonNumericFactors, OVERLAY_COLORS, OVERLAY_DASHES } from './lib/feasible';
import { surfaceResolutionPoints } from './lib/surface3d';
import { DATASETS, emptyWorksheet } from './lib/datasets';
import { findSample } from './samples/registry';
import { findTutorial } from './tutorials/registry';
import { tutorialText } from './tutorials/localize';
import { lt } from './lib/localized';
import { findPreset as findTutorialPreset, resolvePreset as resolveTutorialPreset } from './tutorials/presets';
import { runTutorialAction } from './tutorials/actionRegistry';
import {
  ProgressStorageError,
  TutorialProgressStore,
  browserProgressStorage,
  createProgress,
  practiceSlotId,
  practiceSlotIssue,
} from './tutorials/progressStore';
import {
  evaluateSession,
  isTutorialComplete,
  markManualStep,
  reopenStep,
  restartSession,
  setCurrentStep,
  skipStep,
  tutorialSummary,
} from './tutorials/tutorialEngine';
import type {
  ActionResult,
  BridgeState,
  PracticeProjectInfo,
  TutorialActionSpec,
  TutorialBridge,
  TutorialChartSpec,
  TutorialEvent,
  TutorialOptimizerSpec,
  TutorialProgress,
  ValidationOutcome,
  WorkspaceFacts,
} from './tutorials/types';
import { AUTOSAVE_STORAGE_KEY, loadAutosave, saveAutosave, type AutosaveSaveResult } from './lib/db';
import { PRODUCT } from './config/product';
import { STORAGE_KEY, namespacedKey } from './config/storageNamespace';
import { statusBarLabel } from './lib/appInfo';
import { compareProjects, projectFingerprint } from './lib/projectCompare';
import { fmt, fmtInt } from './lib/format';
import { t } from './lib/i18n';
import {
  DEFAULT_FLOAT_SIZES,
  clampFloatSize,
  clampNav,
  clampOutput,
  findPreset,
  fitFloatRect,
  floatRect,
  type FloatRect,
  type LayoutPresetId,
  type PanelId,
} from './lib/layout';
import {
  applyPresetToWorkspace,
  clampDrawerW,
  clampOutputW,
  dragNav,
  dragOutput,
  resolveWorkspace,
  setWorkspaceLayout,
  triWidths,
  writeWorkspace,
  readWorkspace,
  type WorkspaceLayout,
  type WorkspaceState,
} from './lib/workspace';
import { IconDetach, IconRerun, IconX } from './components/Icons';
import {
  PROJECT_ACCEPT,
  csvToWorksheet,
  downloadBlob,
  downloadFile,
  looksLikeMinitabBinary,
  makeOutputId,
  migrateWorksheet,
  columnSequence,
  newColumnId,
  parseCsv,
  parseNumberCell,
  parseProject,
  pickFile,
  projectFileName,
  serializeProject,
  worksheetToCsv,
} from './lib/project';
import {
  clampSelection,
  coversCell,
  createSelection,
  describeSelection,
  extendTo,
  gridSize as computeGridSize,
  normalizeRange,
  pasteRange,
  selectAll,
  selectColumn,
  selectRow,
  selectedColumns,
  selectedRows,
  selectionToText,
  type Cell,
  type Range,
  type SelectionState,
} from './lib/selection';
import {
  deleteCellsShiftUp,
  deleteColumns,
  deleteRows as deleteRowsAt,
  duplicateColumn,
  insertCellsShiftDown,
  insertColumn,
  insertRows,
  replaceAll as replaceAllInSheet,
  replaceOne as replaceOneInSheet,
  setColumnDescription as setColumnDescriptionAt,
  setColumnType as setColumnTypeAt,
  sortByColumn,
  findMatches,
  type FindMatch,
  type FindOptions,
} from './lib/sheetOps';
import { XLSX_ACCEPT, readXlsxRows, workbookToWorksheets, writeXlsx, xlsxFileName } from './lib/xlsx';

const SETTINGS_KEY = namespacedKey(STORAGE_KEY.settings);
const FLOAT_SIZES_KEY = namespacedKey(STORAGE_KEY.floatSizes);
const ENGINE_VERSION = 'sigrun-1.2';
/* Tutorial progress survives a reload; the practice workspace does not, which is
   why a resumed lesson re-validates every step against what is actually open. */
const TUTORIAL_STORE = new TutorialProgressStore(browserProgressStorage());

type FloatSizes = Record<PanelId, { w: number; h: number }>;

/** Remember the size each panel was last resized to, so a re-detached or
 *  reloaded window opens at a familiar size instead of the factory default. */
function readFloatSizes(): FloatSizes {
  const sizes: FloatSizes = {
    navigator: { ...DEFAULT_FLOAT_SIZES.navigator },
    output: { ...DEFAULT_FLOAT_SIZES.output },
    worksheet: { ...DEFAULT_FLOAT_SIZES.worksheet },
  };
  try {
    const raw = JSON.parse(localStorage.getItem(FLOAT_SIZES_KEY) || 'null') as Partial<Record<PanelId, Partial<{ w: number; h: number }>>> | null;
    for (const id of Object.keys(sizes) as PanelId[]) {
      const stored = raw?.[id];
      if (!stored || !Number.isFinite(stored.w) || !Number.isFinite(stored.h)) continue;
      sizes[id] = clampFloatSize(id, Number(stored.w), Number(stored.h), 0, 0, 4096, 4096);
    }
  } catch {
    /* a broken or blocked storage keeps the defaults */
  }
  return sizes;
}

function readSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') as Partial<Settings> | null;
    return {
      theme: raw?.theme === 'dark' ? 'dark' : 'light',
      lang: raw?.lang === 'ko' ? 'ko' : 'en',
    };
  } catch {
    return { theme: 'light', lang: 'en' };
  }
}

interface Toast { id: number; text: string }

interface StoredState {
  worksheets: Worksheet[];
  activeSheetId: string;
  outputs: OutputDoc[];
  settings: Settings;
  /** Stored fitted models (WO-02). */
  models?: unknown;
  /** Stage 3 figures (WO-01 F-REL-09). */
  figures?: unknown;
  /** Custom chart styles (WO-01 F-REL-09). */
  customChartStyles?: unknown;
}

type AutosaveUi = 'saving' | 'saved' | 'failed' | 'unavailable' | 'quota';

function autosaveUiFor(result: AutosaveSaveResult): AutosaveUi {
  if (result.status === 'SAVED') return 'saved';
  if (result.status === 'QUOTA_EXCEEDED') return 'quota';
  if (result.status === 'STORAGE_UNAVAILABLE') return 'unavailable';
  return 'failed';
}

interface HistorySnapshot { worksheets: Worksheet[]; activeSheetId: string }

function rowCount(sheet: Worksheet): number {
  return Math.max(0, ...sheet.columns.map((c) => c.values.length));
}

/** Column ids referenced anywhere in the dialog values (single refs and lists). */
function referencedColumns(sheet: Worksheet, values: Record<string, unknown>): Column[] {
  const ids = new Set(sheet.columns.map((c) => c.id));
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      if (ids.has(value)) found.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(walk);
  };
  walk(values);
  return sheet.columns.filter((c) => found.has(c.id));
}

function copyColumn(column: Column): Column {
  return { id: column.id, name: column.name, type: column.type, values: [...column.values] };
}

/** Hidden textarea fallback used when the async Clipboard API is unavailable. */
function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** The empty dock a detached panel leaves behind, with its way back. */
function DetachSlot({ lang, label, onDock, testId, className }: { lang: Lang; label: string; onDock: () => void; testId: string; className?: string }) {
  return (
    <div className={`detach-slot ${className ?? ''}`.trim()} data-testid={testId}>
      <span className="mono-note">{label}</span>
      <button type="button" className="btn ghost" onClick={onDock}>{t(lang, 'panel.dock')}</button>
    </div>
  );
}

export default function App() {
  const boot = useRef<{ worksheets: Worksheet[]; activeSheetId: string } | null>(null);
  if (!boot.current) {
    const ws = emptyWorksheet(1);
    boot.current = { worksheets: [ws], activeSheetId: ws.id };
  }

  const [worksheets, setWorksheets] = useState<Worksheet[]>(boot.current.worksheets);
  const [activeSheetId, setActiveSheetId] = useState<string>(boot.current.activeSheetId);
  const [outputs, setOutputs] = useState<OutputDoc[]>([]);
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [dialog, setDialog] = useState<{ def: AnalysisDef; initial?: Record<string, unknown> } | null>(null);
  const [lastDialog, setLastDialog] = useState<{ analysisId: string; values: Record<string, unknown> } | null>(null);
  const [help, setHelp] = useState<'help' | 'about' | null>(null);
  const [pendingImport, setPendingImport] = useState<null | {
    kind: 'csv' | 'xlsx';
    fileName: string;
    name: string;
    text?: string;
    sheets: PreviewSheet[];
    autoHeader: boolean;
  }>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; draft: string } | null>(null);
  const [sel, setSel] = useState<SelectionState>(() => createSelection({ row: 0, col: 0 }));
  const [cutMark, setCutMark] = useState<{ text: string; ranges: Range[] } | null>(null);
  const [ctx, setCtx] = useState<null | { x: number; y: number; target: GridContextTarget; sheetId?: string }>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findSeed, setFindSeed] = useState('');
  const [colDialog, setColDialog] = useState<null | { index: number; kind: 'name' | 'description'; draft: string }>(null);
  const [focusedOutput, setFocusedOutput] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ws, setWs] = useState<WorkspaceState>(readWorkspace);
  const [navHidden, setNavHidden] = useState(false);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPresetId>('balanced');
  const [detached, setDetached] = useState<Record<PanelId, FloatRect | null>>({ navigator: null, output: null, worksheet: null });
  const [floatSizes, setFloatSizes] = useState<FloatSizes>(readFloatSizes);
  const [mobileTab, setMobileTab] = useState<'output' | 'worksheet'>('output');
  const [navOpen, setNavOpen] = useState(false);
  const [autosave, setAutosave] = useState<AutosaveUi>('saved');
  /** WO-01 F-REL-02: a failed write keeps the session open until the reader retries or exports. */
  const [autosavePrompt, setAutosavePrompt] = useState(false);
  const [storageConflict, setStorageConflict] = useState(false);
  const autosaveSeq = useRef(0);
  const [hydrated, setHydrated] = useState(false);
  const [, forceHistory] = useState(0);
  const [viewportW, setViewportW] = useState<number>(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  const [storedModels, setStoredModels] = useState<StoredModel[]>([]);
  /** Rows a chart selection points at, shared by the output and the worksheet. */
  const [chartSelection, setChartSelection] = useState<{ rows: number[]; source?: ChartSource } | null>(null);
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [figures, setFigures] = useState<LayoutDoc[]>([]);
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  /** Stage 3C: the response optimiser works on the models the manager hands over. */
  const [optimizerModels, setOptimizerModels] = useState<StoredModel[] | null>(null);
  const [profilerState, setProfilerState] = useState<{
    models: StoredModel[];
    responses: ResponseSettings[];
    factors: FactorSettings[];
    point: Record<string, number | string> | null;
  } | null>(null);

  /* ── Guided tutorials (WO-3E-11) ───────────────────────────────────── */
  const [progressMap, setProgressMap] = useState<Record<string, TutorialProgress>>(() => TUTORIAL_STORE.loadAll());
  const [tutorialSession, setTutorialSession] = useState<TutorialProgress | null>(null);
  const [tutorialOutcomes, setTutorialOutcomes] = useState<Record<string, ValidationOutcome>>({});
  const [tutorialEvents, setTutorialEvents] = useState<TutorialEvent[]>([]);
  const [tutorialPanel, setTutorialPanel] = useState<'open' | 'collapsed' | 'closed'>('closed');
  const [tutorialBusy, setTutorialBusy] = useState(false);
  const [reviewingTutorial, setReviewingTutorial] = useState(false);
  const [tutorialMessage, setTutorialMessage] = useState<string | null>(null);
  const [tutorialStorageWarning, setTutorialStorageWarning] = useState<string | null>(null);
  const [practice, setPractice] = useState<PracticeProjectInfo | null>(null);
  const [practiceSavedAt, setPracticeSavedAt] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sampleLibraryOpen, setSampleLibraryOpen] = useState(false);
  const [sampleLibraryInitial, setSampleLibraryInitial] = useState<string | null>(null);
  const [helpCenter, setHelpCenter] = useState<{ helpId?: string } | null>(null);
  const [startPrompt, setStartPrompt] = useState<{ tutorialId: string } | null>(null);
  /** WO-TQA-01: the practice is waiting for an explicit backup the reader makes. */
  const [backupPrompt, setBackupPrompt] = useState<{ tutorialId: string; useCurrent: boolean; json: string; resumeSessionId?: string } | null>(null);
  const [exitPrompt, setExitPrompt] = useState(false);
  /** WO-01 F-REL-01: the practice could not be written; the session stays open. */
  const [practiceSaveFailure, setPracticeSaveFailure] = useState<string | null>(null);
  const [optimizerTutorial, setOptimizerTutorial] = useState<TutorialOptimizerSpec | null>(null);
  const [dialogNonce, setDialogNonce] = useState(0);
  const practiceSnapshot = useRef<{
    worksheets: Worksheet[];
    activeSheetId: string;
    outputs: OutputDoc[];
    storedModels: StoredModel[];
    figures: LayoutDoc[];
    settings: Settings;
    customStyles: ReturnType<typeof loadCustomStyles>;
    past: HistorySnapshot[];
    future: HistorySnapshot[];
  } | null>(null);
  /** The guarded copy of the reader's project that this practice replaced. */
  const practiceOriginalId = useRef<string | null>(null);
  const dialogValues = useRef<Record<string, unknown> | null>(null);
  const lastOptimizer = useRef<{ result: OptimizerResult; responses: ResponseSettings[]; factors: FactorSettings[]; models: StoredModel[] } | null>(null);

  const past = useRef<HistorySnapshot[]>([]);
  const future = useRef<HistorySnapshot[]>([]);
  const sheet = worksheets.find((w) => w.id === activeSheetId) ?? worksheets[0];
  const lang = settings.lang;
  /* Stage 3 workspace: what is stored, and what this viewport can actually paint. */
  const effectiveLayout = resolveWorkspace(ws.layout, viewportW);
  const triCols = triWidths(viewportW, ws.navW, ws.outputW);
  const selection = sel.activeCell;
  const grid = computeGridSize(sheet);
  const selectionText = sel.mode === 'all' ? t(lang, 'sel.all') : describeSelection(sel, sheet);
  const selectCell = (cell: Cell) => setSel(createSelection(cell));

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), 2800);
  }, []);

  /* ── hydration ─────────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    loadAutosave<StoredState>()
      .then((saved) => {
        if (cancelled) return;
        const usable = Boolean(saved && Array.isArray(saved.worksheets) && saved.worksheets.length);
        if (!usable) {
          // WO-TQA-01: no autosave, but a practice may have been cut off by a
          // reload. The guarded copy of the reader's project is what comes back.
          const original = TUTORIAL_STORE.latestOriginalProject();
          if (original && loadProjectJson(original.json)) {
            setTutorialMessage(t(lang, 'tut.originalRestored'));
          }
          return;
        }
        const loaded = saved!;
        // A practice project in the autosave slot is not the reader's project: the
        // guarded copy wins (WO-TQA-01/T-02).
        const loadedPrint = projectFingerprint({
          worksheets: loaded.worksheets,
          activeSheetId: loaded.activeSheetId,
          outputs: loaded.outputs ?? [],
          models: loaded.models ? parseStoredModels(loaded.models) : [],
        });
        const original = TUTORIAL_STORE.latestOriginalProject();
        if (original && original.fingerprint !== loadedPrint && practiceSlotFingerprints().includes(loadedPrint)) {
          if (loadProjectJson(original.json)) {
            setTutorialMessage(t(lang, 'tut.originalRestored'));
            return;
          }
        }
        setWorksheets(loaded.worksheets);
        setActiveSheetId(loaded.activeSheetId || loaded.worksheets[0].id);
        if (Array.isArray(loaded.outputs)) setOutputs(loaded.outputs);
        if (loaded.models) setStoredModels(parseStoredModels(loaded.models));
        if (loaded.settings) setSettings({ theme: loaded.settings.theme === 'dark' ? 'dark' : 'light', lang: loaded.settings.lang === 'ko' ? 'ko' : 'en' });
        if (Array.isArray(loaded.figures)) setFigures(loaded.figures as unknown as LayoutDoc[]);
        if (Array.isArray(loaded.customChartStyles) && loaded.customChartStyles.length) {
          writeCustomStyles(loaded.customChartStyles as Parameters<typeof writeCustomStyles>[0]);
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  /* A column insert/delete changes the grid width: pull the selection back in. */
  useEffect(() => {
    setSel((prev) => clampSelection(prev, computeGridSize(sheet)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.columns.length]);

  /* A cut marker belongs to the sheet it was copied from. */
  useEffect(() => {
    setCutMark(null);
  }, [activeSheetId]);

  useEffect(() => {
    try {
      localStorage.setItem(FLOAT_SIZES_KEY, JSON.stringify(floatSizes));
    } catch {
      /* ignore */
    }
  }, [floatSizes]);

  /* ── Stage 3 workspace: viewport tracking and saved layout ─────────── */

  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    writeWorkspace(typeof localStorage === 'undefined' ? null : localStorage, ws);
  }, [ws]);

  /* A narrower window can leave the output column below its legal minimum. */
  useEffect(() => {
    setWs((prev) => {
      const outputW = clampOutputW(prev.outputW, viewportW, prev.navW);
      const drawerW = clampDrawerW(prev.drawerW, viewportW);
      return outputW === prev.outputW && drawerW === prev.drawerW ? prev : { ...prev, outputW, drawerW };
    });
  }, [viewportW]);

  /* A viewport resize pulls floating windows fully back on screen. */
  useEffect(() => {
    const fitPanels = () => {
      setDetached((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of Object.keys(prev) as PanelId[]) {
          const rect = prev[id];
          if (!rect) continue;
          const fitted = fitFloatRect(rect, window.innerWidth, window.innerHeight);
          if (fitted.x !== rect.x || fitted.y !== rect.y || fitted.w !== rect.w || fitted.h !== rect.h) {
            next[id] = fitted;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };
    window.addEventListener('resize', fitPanels);
    return () => window.removeEventListener('resize', fitPanels);
  }, []);

  const autosavePayload = useCallback((): StoredState => ({
    worksheets,
    activeSheetId,
    outputs,
    settings,
    models: storedModels,
    figures,
    customChartStyles: loadCustomStyles(),
  }), [worksheets, activeSheetId, outputs, settings, storedModels, figures]);

  /**
   * WO-01 F-REL-02: the status is whatever the stores actually reported. An
   * older request never overwrites the status of a newer one.
   */
  const runAutosave = useCallback(async (): Promise<AutosaveSaveResult> => {
    const seq = ++autosaveSeq.current;
    setAutosave('saving');
    const result = await saveAutosave<StoredState>(autosavePayload());
    if (seq === autosaveSeq.current) {
      setAutosave(autosaveUiFor(result));
      setAutosavePrompt(result.status !== 'SAVED');
    }
    return result;
  }, [autosavePayload]);

  useEffect(() => {
    // A practice session never writes to the reader's autosave: the original
    // project stays exactly as it was until the practice ends.
    if (!hydrated || practice) return;
    setAutosave('saving');
    const timer = setTimeout(() => {
      void runAutosave();
    }, 700);
    return () => clearTimeout(timer);
  }, [hydrated, practice, runAutosave]);

  /* WO-01: another tab writing the autosave is a conflict this tab must show. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== AUTOSAVE_STORAGE_KEY) return;
      setStorageConflict(true);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /* ── worksheet mutations & history ─────────────────────────────────── */

  /** Record the current sheets AND the active sheet, so sheet-level undo restores focus. */
  const recordHistory = useCallback(() => {
    past.current = [...past.current.slice(-49), { worksheets, activeSheetId }];
    future.current = [];
    forceHistory((v) => v + 1);
  }, [worksheets, activeSheetId]);

  const applySheets = useCallback((fn: (list: Worksheet[]) => Worksheet[], record = true) => {
    const next = fn(worksheets);
    if (next === worksheets) return;
    if (record) recordHistory();
    setWorksheets(next);
  }, [worksheets, recordHistory]);

  const mutateActiveSheet = useCallback((fn: (ws: Worksheet) => Worksheet, record = true) => {
    applySheets((list) => list.map((ws) => (ws.id === activeSheetId ? fn(ws) : ws)), record);
  }, [applySheets, activeSheetId]);

  const restore = (snapshot: HistorySnapshot) => {
    const nextSheets = snapshot.worksheets.length ? snapshot.worksheets : worksheets;
    setWorksheets(nextSheets);
    const nextActive = nextSheets.some((w) => w.id === snapshot.activeSheetId) ? snapshot.activeSheetId : nextSheets[0].id;
    setActiveSheetId(nextActive);
    setSel(createSelection({ row: 0, col: 0 }));
    setCutMark(null);
    forceHistory((v) => v + 1);
  };

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) {
      toast(t(lang, 'toast.nothingToUndo'));
      return;
    }
    future.current = [{ worksheets, activeSheetId }, ...future.current].slice(0, 50);
    restore(previous);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksheets, activeSheetId, toast, lang]);

  const redo = useCallback(() => {
    const next = future.current.shift();
    if (!next) {
      toast(t(lang, 'toast.nothingToRedo'));
      return;
    }
    past.current = [...past.current.slice(-49), { worksheets, activeSheetId }];
    restore(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksheets, activeSheetId, toast, lang]);

  function pad(values: (number | string | null)[], length: number): (number | string | null)[] {
    return Array.from({ length: Math.max(values.length, length) }, (_, i) => values[i] ?? null);
  }

  const editCell = (row: number, col: number, raw: string) => {
    const column = sheet.columns[col];
    if (!column) return;
    const trimmed = raw.trim();
    const numeric = column.type === 'numeric' ? parseNumberCell(trimmed) : null;
    const value: number | string | null = trimmed === '' ? null : numeric !== null ? numeric : raw;
    mutateActiveSheet((ws) => ({
      ...ws,
      columns: ws.columns.map((c, index) => {
        if (index !== col) return c;
        const values = pad(c.values, row + 1);
        values[row] = value;
        return { ...c, values };
      }),
    }));
  };

  // Column renaming records one history step per typing burst, not per keystroke.
  const renameBurst = useRef<number | null>(null);
  const renameColumn = (col: number, name: string) => {
    if (renameBurst.current === null) recordHistory();
    else window.clearTimeout(renameBurst.current);
    renameBurst.current = window.setTimeout(() => { renameBurst.current = null; }, 600);
    mutateActiveSheet((ws) => ({ ...ws, columns: ws.columns.map((c, i) => (i === col ? { ...c, name } : c)) }), false);
  };

  /* ── selection-driven worksheet edits ─────────────────────────────── */

  const primarySelection = (): Range => normalizeRange(sel.ranges[0] ?? { r0: selection.row, c0: selection.col, r1: selection.row, c1: selection.col });

  /** Runs of consecutive row numbers, bottom-first, so deletions never shift
   *  the rows that are still to be deleted. */
  const rowBlocks = (rows: number[]): [number, number][] => {
    const blocks: [number, number][] = [];
    for (const row of rows) {
      const last = blocks[blocks.length - 1];
      if (last && row === last[1] + 1) last[1] = row;
      else blocks.push([row, row]);
    }
    return blocks;
  };

  const addColumn = () => {
    const result = insertColumn(sheet, sheet.columns.length);
    applySheets((list) => list.map((ws) => (ws.id === sheet.id ? result.sheet : ws)));
    setSel(createSelection({ row: selection.row, col: result.index }));
    toast(t(lang, 'toast.columnAdded'));
  };

  const insertColumnAt = (at: number) => {
    const result = insertColumn(sheet, at);
    applySheets((list) => list.map((ws) => (ws.id === sheet.id ? result.sheet : ws)));
    setSel(createSelection({ row: selection.row, col: result.index }));
    toast(t(lang, 'toast.columnInserted'));
  };

  const deleteSelectedColumns = () => {
    const cols = selectedColumns(sel);
    if (!cols.length) return;
    if (cols.length >= sheet.columns.length) {
      toast(t(lang, 'toast.lastColumn'));
      return;
    }
    const blocks = rowBlocks(cols).reverse();
    mutateActiveSheet((ws) => blocks.reduce((next, [a, b]) => deleteColumns(next, a, b) ?? next, ws));
    setSel(createSelection({ row: selection.row, col: Math.max(0, Math.min(cols[0], sheet.columns.length - cols.length - 1)) }));
    toast(t(lang, 'toast.columnsDeleted', { n: cols.length }));
  };

  const duplicateColumnAt = (index: number) => {
    const result = duplicateColumn(sheet, index);
    if (!result) return;
    applySheets((list) => list.map((ws) => (ws.id === sheet.id ? result.sheet : ws)));
    setSel(createSelection({ row: selection.row, col: result.index }));
    toast(t(lang, 'toast.columnDuplicated'));
  };

  const sortColumnAt = (index: number, direction: 'asc' | 'desc') => {
    mutateActiveSheet((ws) => sortByColumn(ws, index, direction));
    toast(t(lang, 'toast.sorted', { column: sheet.columns[index]?.id ?? '' }));
  };

  const changeColumnType = (index: number, type: 'numeric' | 'text' | 'date') => {
    mutateActiveSheet((ws) => setColumnTypeAt(ws, index, type));
    toast(t(lang, 'toast.typeChanged', { column: sheet.columns[index]?.id ?? '' }));
  };

  const saveColumnDescription = (index: number, description: string) => {
    mutateActiveSheet((ws) => setColumnDescriptionAt(ws, index, description));
    toast(t(lang, 'toast.colDescSaved'));
  };

  const clearSelection = () => {
    const targets = sel.ranges.map(normalizeRange);
    mutateActiveSheet((ws) => ({
      ...ws,
      columns: ws.columns.map((c, index) => {
        const hits = targets.filter((r) => index >= r.c0 && index <= r.c1);
        if (!hits.length) return c;
        const values = pad(c.values, Math.max(...hits.map((r) => r.r1)) + 1);
        for (const r of hits) for (let row = r.r0; row <= r.r1; row += 1) values[row] = null;
        return { ...c, values };
      }),
    }));
    setCutMark(null);
    toast(t(lang, 'toast.cleared'));
  };

  /**
   * Paste through the RFC-4180 parser, so quoted commas ("1,200"), quoted line
   * breaks and tab/semicolon separated blocks all land in the right cells.
   * A multi-block selection has no single landing corner, so paste refuses and
   * explains instead of writing into the first block by surprise.
   */
  const pasteCells = (row: number, col: number, text: string) => {
    if (!pasteRange(sel)) {
      toast(t(lang, 'toast.pasteMulti'));
      return;
    }
    const rows = parseCsv(text);
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.length));
    const cutting = cutMark && cutMark.text.replace(/\r/g, '').trim() === text.replace(/\r/g, '').trim() ? cutMark : null;
    mutateActiveSheet((ws) => {
      const columns = ws.columns.map((c) => ({ ...c, values: [...c.values] }));
      const needed = col + width - columns.length;
      for (let i = 0; i < needed; i += 1) {
        const nextIndex = columns.length - col;
        const probe = rows.map((r) => (r[nextIndex] ?? '').trim()).filter((v) => v !== '');
        const numeric = probe.length > 0 && probe.every((v) => parseNumberCell(v) !== null);
        columns.push({ id: newColumnId({ ...ws, columns }), name: '', type: numeric ? 'numeric' : 'text', values: [] });
      }
      if (cutting) {
        for (const r of cutting.ranges) {
          columns.forEach((c, index) => {
            if (index < r.c0 || index > r.c1) return;
            const values = pad(c.values, r.r1 + 1);
            for (let row2 = r.r0; row2 <= r.r1; row2 += 1) values[row2] = null;
            c.values = values;
          });
        }
      }
      const targetRows = row + rows.length;
      columns.forEach((c) => { c.values = pad(c.values, targetRows); });
      rows.forEach((cells, r) => {
        cells.forEach((cell, c) => {
          const target = columns[col + c];
          if (!target) return;
          const trimmed = cell.trim();
          if (trimmed === '') {
            target.values[row + r] = null;
            return;
          }
          const numeric = target.type === 'text' ? null : parseNumberCell(trimmed);
          target.values[row + r] = numeric !== null ? numeric : cell;
        });
      });
      return { ...ws, columns, columnSeq: columnSequence({ ...ws, columns }) };
    });
    setCutMark(null);
    setSel(extendTo(createSelection({ row, col }), { row: row + rows.length - 1, col: col + width - 1 }));
    toast(t(lang, 'toast.pasted'));
  };

  const copySelection = async (cut = false) => {
    const text = selectionToText(sheet, sel, grid);
    if (!text) {
      toast(t(lang, 'toast.copyEmpty'));
      return;
    }
    let ok = false;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unsupported');
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = legacyCopy(text);
    }
    if (!ok) {
      // Report the real outcome: a silent failure must not look like success.
      setCutMark(null);
      toast(t(lang, 'toast.copyFailed'));
      return;
    }
    setCutMark(cut ? { text, ranges: sel.ranges.map(normalizeRange) } : null);
    toast(t(lang, cut ? 'toast.cut' : 'toast.copied'));
  };

  const copyRows = async () => {
    const primary = primarySelection();
    const range: Range = { r0: primary.r0, c0: 0, r1: primary.r1, c1: Math.max(0, sheet.columns.length - 1) };
    const text = selectionToText(sheet, { ...sel, ranges: [range], mode: 'row' }, grid);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unsupported');
      await navigator.clipboard.writeText(text);
      toast(t(lang, 'toast.copied'));
    } catch {
      toast(t(lang, legacyCopy(text) ? 'toast.copied' : 'toast.copyFailed'));
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { toast(t(lang, 'toast.pasteEmpty')); return; }
      pasteCells(selection.row, selection.col, text);
    } catch {
      toast(t(lang, 'toast.pasteFailed'));
    }
  };

  const insertRowsHere = (at: number) => {
    const primary = primarySelection();
    const count = primary.r1 - primary.r0 + 1;
    mutateActiveSheet((ws) => insertRows(ws, at, count));
    setSel(createSelection({ row: at, col: primary.c0 }));
    toast(t(lang, 'toast.rowsInserted', { n: count }));
  };

  const deleteSelectedRows = () => {
    const rows = selectedRows(sel);
    if (!rows.length) return;
    const blocks = rowBlocks(rows).reverse();
    mutateActiveSheet((ws) => blocks.reduce((next, [a, b]) => deleteRowsAt(next, a, b), ws));
    setSel(createSelection({ row: Math.min(rows[0], Math.max(0, grid.rows - blocks.reduce((n, [a, b]) => n + (b - a + 1), 0))), col: selection.col }));
    toast(t(lang, 'toast.rowsDeleted', { n: rows.length }));
  };

  const insertCellsHere = () => {
    const primary = primarySelection();
    mutateActiveSheet((ws) => insertCellsShiftDown(ws, primary));
    toast(t(lang, 'toast.cellsInserted'));
  };

  const deleteCellsHere = () => {
    const primary = primarySelection();
    mutateActiveSheet((ws) => deleteCellsShiftUp(ws, primary));
    toast(t(lang, 'toast.cellsDeleted'));
  };

  /* ── find & replace ───────────────────────────────────────────────── */

  const applyReplaceAll = (query: string, replacement: string, options: FindOptions): number => {
    const result = replaceAllInSheet(sheet, query, replacement, options);
    if (result.count) applySheets((list) => list.map((ws) => (ws.id === sheet.id ? result.sheet : ws)));
    toast(t(lang, result.count ? 'toast.replacedAll' : 'toast.findNoMatch', { n: result.count }));
    return result.count;
  };

  const applyReplaceOne = (match: FindMatch, query: string, replacement: string, options: FindOptions) => {
    const nextSheet = replaceOneInSheet(sheet, match, query, replacement, options);
    applySheets((list) => list.map((ws) => (ws.id === sheet.id ? nextSheet : ws)));
    toast(t(lang, 'toast.replacedOne'));
  };

  const openFindAt = (query: string) => {
    setFindSeed(query);
    setFindOpen(true);
    const first = findMatches(sheet, query)[0];
    if (first) selectCell(first);
  };

  /* ── context menu ─────────────────────────────────────────────────── */

  const openGridContext = (target: GridContextTarget, at: { x: number; y: number }) => {
    if (target.kind === 'cell') {
      if (!coversCell(sel, target.cell.row, target.cell.col, grid)) setSel(createSelection(target.cell));
    } else if (target.kind === 'row') {
      if (!(sel.mode === 'row' && coversCell(sel, target.cell.row, 0, grid))) setSel(selectRow(sel, target.cell.row, grid));
    } else if (target.kind === 'column') {
      if (!(sel.mode === 'column' && coversCell(sel, 0, target.cell.col, grid))) setSel(selectColumn(sel, target.cell.col, grid));
    } else {
      setSel(createSelection(target.cell));
    }
    setCtx({ x: at.x, y: at.y, target });
  };

  const contextItems = (): ContextMenuItem[] => {
    if (!ctx) return [];
    const target = ctx.target;
    const sep = (id: string): ContextMenuItem => ({ id, label: '', separator: true });
    if (ctx.sheetId) {
      return [
        { id: 'sheet-rename', label: t(lang, 'ctx.sheetRename'), onSelect: () => setRenameTarget({ id: ctx.sheetId as string, draft: worksheets.find((w) => w.id === ctx.sheetId)?.name ?? '' }) },
        { id: 'sheet-new', label: t(lang, 'ctx.sheetNew'), onSelect: () => addSheet() },
        { id: 'sheet-delete', label: t(lang, 'ctx.sheetDelete'), danger: true, disabled: worksheets.length <= 1, onSelect: () => deleteSheet(ctx.sheetId as string) },
      ];
    }
    if (target.kind === 'cell') {
      const primary = primarySelection();
      const column = sheet.columns[target.cell.col];
      return [
        { id: 'copy', label: t(lang, 'ctx.copy'), kbd: 'Ctrl+C', onSelect: () => void copySelection(false) },
        { id: 'cut', label: t(lang, 'ctx.cut'), kbd: 'Ctrl+X', onSelect: () => void copySelection(true) },
        { id: 'paste', label: t(lang, 'ctx.paste'), kbd: 'Ctrl+V', onSelect: () => void pasteFromClipboard() },
        { id: 'clear', label: t(lang, 'ctx.clear'), kbd: 'Del', onSelect: clearSelection },
        sep('s1'),
        { id: 'insert-cell', label: t(lang, 'ctx.insertCell'), onSelect: insertCellsHere },
        { id: 'delete-cell', label: t(lang, 'ctx.deleteCell'), onSelect: deleteCellsHere },
        sep('s2'),
        { id: 'row-above', label: t(lang, 'ctx.rowAbove'), onSelect: () => insertRowsHere(primary.r0) },
        { id: 'row-below', label: t(lang, 'ctx.rowBelow'), onSelect: () => insertRowsHere(primary.r1 + 1) },
        { id: 'row-delete', label: t(lang, 'ctx.rowDelete'), danger: true, onSelect: deleteSelectedRows },
        sep('s3'),
        { id: 'col-left', label: t(lang, 'ctx.colLeft'), onSelect: () => insertColumnAt(primary.c0) },
        { id: 'col-right', label: t(lang, 'ctx.colRight'), onSelect: () => insertColumnAt(primary.c1 + 1) },
        { id: 'col-delete', label: t(lang, 'ctx.colDelete'), danger: true, onSelect: deleteSelectedColumns },
        sep('s4'),
        { id: 'find', label: t(lang, 'ctx.find'), onSelect: () => openFindAt(column?.values[target.cell.row] !== null && column?.values[target.cell.row] !== undefined ? String(column.values[target.cell.row]) : '') },
      ];
    }
    if (target.kind === 'column') {
      const index = target.cell.col;
      const column = sheet.columns[index];
      if (!column) return [];
      const typeItem = (type: 'numeric' | 'text' | 'date', labelKey: string): ContextMenuItem => ({
        id: `type-${type}`,
        label: t(lang, labelKey),
        checked: column.type === type,
        onSelect: () => changeColumnType(index, type),
      });
      return [
        { id: 'rename-col', label: t(lang, 'ctx.renameCol'), onSelect: () => setColDialog({ index, kind: 'name', draft: column.name }) },
        sep('s1'),
        { id: 'insert-col-left', label: t(lang, 'ctx.colLeft'), onSelect: () => insertColumnAt(index) },
        { id: 'insert-col-right', label: t(lang, 'ctx.colRight'), onSelect: () => insertColumnAt(index + 1) },
        { id: 'duplicate-col', label: t(lang, 'ctx.duplicateCol'), onSelect: () => duplicateColumnAt(index) },
        { id: 'delete-col', label: t(lang, 'ctx.colDelete'), danger: true, onSelect: deleteSelectedColumns },
        sep('s2'),
        {
          id: 'col-type',
          label: t(lang, 'ctx.colType'),
          children: [typeItem('numeric', 'ctx.typeNumeric'), typeItem('text', 'ctx.typeText'), typeItem('date', 'ctx.typeDate')],
        },
        {
          id: 'col-sort',
          label: t(lang, 'ctx.sort'),
          children: [
            { id: 'sort-asc', label: t(lang, 'ctx.sortAsc'), onSelect: () => sortColumnAt(index, 'asc') },
            { id: 'sort-desc', label: t(lang, 'ctx.sortDesc'), onSelect: () => sortColumnAt(index, 'desc') },
          ],
        },
        { id: 'col-desc', label: t(lang, 'ctx.colDesc'), onSelect: () => setColDialog({ index, kind: 'description', draft: column.description ?? '' }) },
      ];
    }
    if (target.kind === 'row') {
      return [
        { id: 'row-insert-above', label: t(lang, 'ctx.rowAbove'), onSelect: () => insertRowsHere(target.cell.row) },
        { id: 'row-insert-below', label: t(lang, 'ctx.rowBelow'), onSelect: () => insertRowsHere(target.cell.row + 1) },
        { id: 'row-delete', label: t(lang, 'ctx.rowDelete'), danger: true, onSelect: deleteSelectedRows },
        sep('s1'),
        { id: 'row-copy', label: t(lang, 'ctx.rowCopy'), onSelect: () => void copyRows() },
        { id: 'row-extend', label: t(lang, 'ctx.rowExtend', { row: target.cell.row + 1 }), onSelect: () => setSel(selectRow(sel, target.cell.row, grid, true)) },
      ];
    }
    return [
      { id: 'empty-paste', label: t(lang, 'ctx.paste'), kbd: 'Ctrl+V', onSelect: () => void pasteFromClipboard() },
      sep('s1'),
      { id: 'empty-addcol', label: t(lang, 'ctx.addColumn'), onSelect: addColumn },
      { id: 'empty-row', label: t(lang, 'ctx.rowAtEnd'), onSelect: () => insertRowsHere(target.cell.row) },
      sep('s2'),
      { id: 'empty-selectall', label: t(lang, 'ctx.selectAll'), kbd: 'Ctrl+A', onSelect: () => setSel(selectAll(grid)) },
      { id: 'empty-find', label: t(lang, 'ctx.find'), onSelect: () => openFindAt('') },
    ];
  };

  /* ── sheets ────────────────────────────────────────────────────────── */

  const uniqueSheetName = (list: Worksheet[], base: string): string => {
    const names = new Set(list.map((w) => w.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} (${i})`)) i += 1;
    return `${base} (${i})`;
  };

  const addSheet = (ws?: Worksheet) => {
    const base = ws ?? emptyWorksheet(worksheets.length + 1);
    const created: Worksheet = { ...base, id: base.id, name: uniqueSheetName(worksheets, base.name) };
    applySheets((list) => [...list, created]);
    setActiveSheetId(created.id);
    setSel(createSelection({ row: 0, col: 0 }));
    toast(t(lang, 'toast.sheetAdded'));
  };

  const renameSheet = (id: string, name: string): boolean => {
    const trimmed = name.trim();
    const current = worksheets.find((w) => w.id === id);
    if (!current) return false;
    if (!trimmed) {
      toast(t(lang, 'toast.nameRequired'));
      return false;
    }
    if (worksheets.some((w) => w.id !== id && w.name.toLowerCase() === trimmed.toLowerCase())) {
      toast(t(lang, 'toast.nameTaken'));
      return false;
    }
    if (trimmed === current.name) return true;
    applySheets((list) => list.map((w) => (w.id === id ? { ...w, name: trimmed } : w)));
    return true;
  };

  const deleteSheet = (id: string) => {
    if (worksheets.length <= 1) {
      toast(t(lang, 'toast.lastSheet'));
      return;
    }
    const next = worksheets.filter((w) => w.id !== id);
    applySheets(() => next);
    if (activeSheetId === id) {
      setActiveSheetId(next[0].id);
      setSel(createSelection({ row: 0, col: 0 }));
    }
    toast(t(lang, 'toast.sheetDeleted'));
  };

  /* ── analyses ──────────────────────────────────────────────────────── */

  const buildMeta = (def: AnalysisDef, values: Record<string, unknown>, runSheet: Worksheet): AnalysisMeta => ({
    engine: ENGINE_VERSION,
    analysisId: def.id,
    values: { ...values },
    sheetId: runSheet.id,
    sheetName: runSheet.name,
    ranAt: Date.now(),
    rowCount: rowCount(runSheet),
    columns: referencedColumns(runSheet, values).map(copyColumn),
  });

  const makeDoc = (def: AnalysisDef, result: RunResult, meta: AnalysisMeta): OutputDoc => ({
    id: makeOutputId(),
    titleKey: def.titleKey,
    subtitle: result.subtitle,
    createdAt: Date.now(),
    collapsed: false,
    blocks: result.blocks,
    dialog: { analysisId: def.id, values: meta.values },
    sheetId: meta.sheetId,
    meta,
  });

  /*
   * Chart configurations belong to the reader, not to the run: a re-run keeps
   * the style, scale, axis range and RSM view the analysis already had, while
   * the numbers come fresh from the engine. `chartMemory.ts` owns the matching
   * rules (identity first, position inside one kind, one slot per chart) so a
   * chart inserted before another cannot push its config onto it.
   */
  const chartConfigMemory = useRef(new ChartConfigMemory());

  const rememberChartConfigs = (doc: OutputDoc) => {
    chartConfigMemory.current.remember(doc.meta?.analysisId ?? doc.dialog?.analysisId, doc.blocks);
  };

  const restoreChartConfigs = (doc: OutputDoc): OutputDoc => {
    const key = doc.meta?.analysisId ?? doc.dialog?.analysisId;
    const blocks = chartConfigMemory.current.restore(key, doc.blocks);
    return blocks === doc.blocks ? doc : { ...doc, blocks };
  };

  const focusDoc = (doc: OutputDoc) => {
    setOutputs((prev) => [...prev, doc]);
    setFocusedOutput(doc.id);
    if (window.matchMedia('(max-width: 1023px)').matches) setMobileTab('output');
    setTimeout(() => document.getElementById(`card-${doc.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  };

  /**
   * A run reports an interface message, or a message key that carries values:
   * `res.numericOnly|col=Speed` turns into "Speed is not a numeric column…".
   */
  const errorText = (error: unknown): string => {
    const message = error instanceof Error ? error.message : 'dlg.error';
    if (!message.includes('.')) return message;
    const [key, ...rest] = message.split('|');
    const vars: Record<string, string> = {};
    rest.forEach((part) => {
      const at = part.indexOf('=');
      if (at > 0) vars[part.slice(0, at)] = part.slice(at + 1);
    });
    return t(lang, key, Object.keys(vars).length ? vars : undefined);
  };

  const execute = (def: AnalysisDef, values: Record<string, unknown>): string | null => {
    try {
      const result = def.run({ lang, sheet, values });
      if (result.sheetPatch) {
        const patch = result.sheetPatch;
        applySheets((list) => list.map((ws) => (ws.id === sheet.id ? patch : ws)));
      }
      if (result.newSheet) {
        const created = result.newSheet;
        applySheets((list) => [...list, created]);
        setActiveSheetId(created.id);
      }
      const doc = restoreChartConfigs({ ...makeDoc(def, result, buildMeta(def, values, sheet)), ...(result.modelDraft ? { model: result.modelDraft } : {}) });
      rememberChartConfigs(doc);
      focusDoc(doc);
      pushTutorialEvent('analysis-run', { analysisId: def.id, outputId: doc.id, values: { ...values } });
      setLastDialog({ analysisId: def.id, values });
      setDialog(null);
      if (result.toastKey) toast(t(lang, result.toastKey, result.toastVars));
      return null;
    } catch (error) {
      return errorText(error);
    }
  };

  /** Re-run an existing card against the data snapshot stored with it. */
  const reproduce = (output: OutputDoc) => {
    const meta = output.meta;
    const def = findAnalysis(meta?.analysisId ?? output.dialog?.analysisId ?? '');
    if (!meta || !def) {
      toast(t(lang, 'toast.noSnapshot'));
      return;
    }
    const snapshotSheet: Worksheet = {
      id: `snapshot-${output.id}`,
      name: `${meta.sheetName} (${t(lang, 'card.snapshot')})`,
      columns: meta.columns.map(copyColumn),
    };
    try {
      const result = def.run({ lang, sheet: snapshotSheet, values: { ...meta.values } });
      // The snapshot is read-only: a transform's sheet patch is not applied here.
      const doc = restoreChartConfigs({ ...makeDoc(def, result, { ...meta, ranAt: Date.now() }), ...(result.modelDraft ? { model: result.modelDraft } : {}) });
      rememberChartConfigs(doc);
      focusDoc(doc);
    } catch (error) {
      toast(errorText(error));
    }
  };

  const rerunWithOptions = (output: OutputDoc) => {
    const meta = output.meta;
    const def = findAnalysis(meta?.analysisId ?? output.dialog?.analysisId ?? '');
    if (!meta || !def) {
      toast(t(lang, 'toast.noSnapshot'));
      return;
    }
    const target = worksheets.find((w) => w.id === meta.sheetId);
    if (target) setActiveSheetId(target.id);
    setDialog({ def, initial: { ...meta.values } });
  };

  const openAnalysis = (id: string, preset?: Record<string, unknown>) => {
    const def = findAnalysis(id);
    if (!def) return;
    setDialog(preset ? { def, initial: { ...defaultDialogValues(def), ...preset } } : { def });
    setDialogNonce((value) => value + 1);
    dialogValues.current = null as Record<string, unknown> | null;
    pushTutorialEvent('analysis-opened', { analysisId: id, values: preset ?? null });
  };

  const rerun = useCallback(() => {
    if (!lastDialog) return;
    const def = findAnalysis(lastDialog.analysisId);
    if (!def) return;
    setDialog({ def, initial: { ...lastDialog.values } });
  }, [lastDialog]);

  /** One-click rerun for the worksheet drawer: no dialog, the current sheet. */
  const rerunNow = () => {
    if (!lastDialog) {
      toast(t(lang, 'toast.noLastAnalysis'));
      return;
    }
    const def = findAnalysis(lastDialog.analysisId);
    if (!def) return;
    const error = execute(def, { ...lastDialog.values });
    toast(error ?? t(lang, 'toast.rerunDone'));
  };

  const loadSample = (id: string) => {
    const def = DATASETS.find((ds) => ds.id === id);
    if (!def) return;
    addSheet(def.build());
  };

  /* ── stored models (WO-02) ─────────────────────────────────────────── */

  /** Keep the fit an output card carries: named, dated and deduplicated. */
  const saveModelFromCard = (output: OutputDoc) => {
    const draft = output.model;
    if (!draft) {
      toast(t(lang, 'toast.modelNone'));
      return;
    }
    const base = defaultModelName(draft);
    const model = createStoredModel(draft, uniqueModelName(storedModels, base));
    setStoredModels((prev) => [...prev, model]);
    pushTutorialEvent('model-saved', { modelId: model.id, name: model.name, response: model.response.name });
    toast(t(lang, 'toast.modelSaved', { name: model.name }));
  };

  const renameModel = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setStoredModels((prev) => renameStoredModel(prev, id, trimmed));
    toast(t(lang, 'toast.modelRenamed'));
  };

  const duplicateModel = (id: string) => {
    setStoredModels((prev) => duplicateStoredModel(prev, id));
    toast(t(lang, 'toast.modelDuplicated'));
  };

  const removeModel = (id: string) => {
    const target = storedModels.find((model) => model.id === id);
    if (!target) return;
    if (!window.confirm(t(lang, 'model.deleteConfirm', { name: target.name }))) return;
    setStoredModels((prev) => deleteStoredModel(prev, id));
    toast(t(lang, 'toast.modelDeleted'));
  };

  const refitModel = (id: string) => {
    const target = storedModels.find((model) => model.id === id);
    if (!target) return;
    try {
      const refit = refitStoredModel(target, worksheets.find((ws) => ws.id === target.training?.sheetId) ?? sheet);
      setStoredModels((prev) => prev.map((model) => (model.id === id ? refit : model)));
      toast(t(lang, 'toast.modelRefit'));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'model.refitFailed';
      toast(t(lang, code));
    }
  };

  /** A stored model becomes a contour chart: the first follow-up entry point. */
  const contourFromModel = (model: StoredModel) => {
    const numeric = model.predictors.filter((predictor) => predictor.kind === 'numeric');
    if (numeric.length < 2) {
      toast(t(lang, 'toast.modelNoSurface'));
      return;
    }
    try {
      const surface = modelSurface(model, { xName: numeric[0].name, yName: numeric[1].name, resolution: 41 });
      if (surface.nonEstimable.length) {
        toast(t(lang, 'toast.modelNoSurface'));
        return;
      }
      const doc: OutputDoc = {
        id: makeOutputId(),
        titleKey: 'an.modelcontour',
        titleText: model.name,
        subtitle: `${model.name} · ${surface.xName} × ${surface.yName}`,
        createdAt: Date.now(),
        collapsed: false,
        blocks: [
          {
            type: 'text',
            lines: [t(lang, 'res.modelContourNote', { model: model.name })],
          },
          {
            type: 'chart',
            chart: {
              kind: 'contour',
              xs: surface.xs,
              ys: surface.ys,
              z: surface.z,
              xLabel: surface.xName,
              yLabel: surface.yName,
              xRange: surface.xRange,
              yRange: surface.yRange,
              title: `${model.response.name} = f(${surface.xName}, ${surface.yName})`,
              config: {
                contour: { resolution: 'standard', renderMode: 'filled-lines', levelCount: 10, showPoints: false },
              },
            },
            caption: '@chart.modelContour',
          },
        ],
        sheetId: sheet.id,
      };
      focusDoc(doc);
      setModelManagerOpen(false);
      if (surface.outOfRange) toast(t(lang, 'toast.modelExtrapolated'));
    } catch {
      toast(t(lang, 'toast.modelNoSurface'));
    }
  };

  /** A stored model becomes a 3D surface card (WO-03). */
  const surfaceFromModel = (model: StoredModel) => {
    if (numericFactors(model).length < 2) {
      toast(t(lang, 'toast.modelNoSurface'));
      return;
    }
    try {
      const surface = buildModelSurface(model, {
        xIndex: 0,
        yIndex: 1,
        unitMode: 'actual',
        resolution: surfaceResolutionPoints('standard'),
      });
      if (surface.nonEstimable.length) {
        toast(t(lang, 'toast.modelNoSurface'));
        return;
      }
      const doc: OutputDoc = {
        id: makeOutputId(),
        titleKey: 'an.modelsurface',
        titleText: model.name,
        subtitle: `${model.name} · ${surface.xName} × ${surface.yName}`,
        createdAt: Date.now(),
        collapsed: false,
        blocks: [
          { type: 'text', lines: [t(lang, 'res.modelSurfaceNote', { model: model.name })] },
          {
            type: 'chart',
            chart: {
              kind: 'surface3d',
              xs: surface.xs,
              ys: surface.ys,
              z: surface.z,
              xLabel: surface.xName,
              yLabel: surface.yName,
              zLabel: model.response.name,
              xRange: surface.xRange,
              yRange: surface.yRange,
              points: surface.points,
              model,
              extrapolated: surface.extrapolated,
              title: `${model.response.name} = f(${surface.xName}, ${surface.yName})`,
              config: {
                rsm: {
                  xFactorIndex: 0,
                  yFactorIndex: 1,
                  unitMode: 'actual',
                  showExperimentalPoints: true,
                  showStationaryPoint: true,
                  showOptimalPoint: false,
                },
                surface: { resolution: 'standard', renderMode: 'both' },
              },
            },
            caption: '@chart.modelSurface',
          },
        ],
        sheetId: sheet.id,
      };
      focusDoc(doc);
      setModelManagerOpen(false);
      if (surface.extrapolated) toast(t(lang, 'toast.modelExtrapolated'));
    } catch {
      toast(t(lang, 'toast.modelNoSurface'));
    }
  };

  /**
   * Several stored models become one overlaid contour (WO-04).
   *
   * Specification limits start from each response's observed range when the
   * model kept its runs, and stay empty otherwise: a limit nobody stated is not
   * invented, it is asked for in the Overlaid tab.
   */
  const overlaidFromModels = (models: StoredModel[], overrideSpecs?: { name: string; lsl: number | null; usl: number | null; target: number | null }[]) => {
    if (models.length < 2) return;
    const shared = commonNumericFactors(models);
    if (shared.factors.length < 2) {
      toast(t(lang, 'toast.overlaidNoCommon'));
      return;
    }
    try {
      const specs = overrideSpecs ?? models.map((model) => {
        const observed = (model.design?.points ?? []).map((point) => point.y).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
        if (!observed.length) return { name: model.response.name, lsl: null, usl: null, target: null };
        const min = Math.min(...observed);
        const max = Math.max(...observed);
        return { name: model.response.name, lsl: min, usl: max, target: Number(((min + max) / 2).toFixed(6)) };
      });
      const result = buildOverlaidChart(models, {
        xName: shared.factors[0].name,
        yName: shared.factors[1].name,
        unitMode: 'actual',
        resolution: surfaceResolutionPoints('standard'),
        basis: 'mean',
        alpha: 0.05,
        specs,
      });
      // Design levels are coded; the card is drawn in actual units, so every
      // dot is placed on the same physical coordinate as the surface.
      const predictX = models[0].predictors.find((predictor) => predictor.name === shared.factors[0].name);
      const predictY = models[0].predictors.find((predictor) => predictor.name === shared.factors[1].name);
      const points = (models[0].design?.points ?? []).slice(0, 400).map((point) => ({
        x: predictX ? toActualValue(predictX, point.levels[shared.factors[0].name] ?? Number.NaN, 'coded') : Number.NaN,
        y: predictY ? toActualValue(predictY, point.levels[shared.factors[1].name] ?? Number.NaN, 'coded') : Number.NaN,
        z: point.y ?? undefined,
        kind: 'design' as const,
      })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      const doc: OutputDoc = {
        id: makeOutputId(),
        titleKey: 'an.modeloverlaid',
        titleText: models.map((model) => model.name).join(' · '),
        subtitle: `${models.length} responses · ${shared.factors[0].name} × ${shared.factors[1].name}`,
        createdAt: Date.now(),
        collapsed: false,
        blocks: [
          { type: 'text', lines: [t(lang, 'res.modelOverlaidNote', { n: models.length })] },
          {
            type: 'chart',
            chart: {
              kind: 'overlaid',
              xs: result.xs,
              ys: result.ys,
              responses: result.responses.map((response, index) => ({
                ...response,
                color: OVERLAY_COLORS[index % OVERLAY_COLORS.length],
                dash: OVERLAY_DASHES[index % OVERLAY_DASHES.length],
              })),
              xLabel: result.xName,
              yLabel: result.yName,
              xRange: result.xRange,
              yRange: result.yRange,
              points,
              models,
              feasible: {
                mask: result.feasible,
                areaRatio: result.areaRatio,
                nodeRatio: result.nodeRatio,
                feasibleNodes: result.feasibleNodes,
                totalNodes: result.totalNodes,
                basis: 'mean',
                convergenceDelta: result.convergenceDelta,
                nodeConvergenceDelta: result.convergence.nodeDelta,
                areaConvergenceDelta: result.convergence.areaDelta,
                convergenceNeighborCount: result.convergence.neighborCount,
                convergenceDirection: result.convergence.direction,
                perResponse: result.responses.map((response) => ({
                  name: response.name,
                  areaRatio: response.areaRatio,
                  nodeRatio: response.nodeRatio,
                })),
                intervalBlocked: result.intervalBlocked,
                intervalBlockReasons: result.intervalBlockReasons,
                ...(result.rangeWarning ? { rangeWarning: result.rangeWarning } : {}),
              },
              extrapolated: result.extrapolated,
              extrapolationDetails: result.extrapolation.details,
              title: `${models.map((model) => model.response.name).join(' / ')}`,
              config: {
                rsm: { xFactorIndex: 0, yFactorIndex: 1, unitMode: 'actual' },
                feasible: {
                  basis: 'mean',
                  resolution: 'standard',
                  alpha: 0.05,
                  specs,
                  showFeasible: true,
                  showResponseRegions: true,
                  showSpecLines: true,
                },
              },
            },
            caption: '@chart.modelOverlaid',
          },
        ],
        sheetId: sheet.id,
      };
      focusDoc(doc);
      setModelManagerOpen(false);
      if (result.extrapolated) toast(t(lang, 'toast.modelExtrapolated'));
    } catch {
      toast(t(lang, 'toast.overlaidNoCommon'));
    }
  };

  /* ── Stage 3C: response optimizer and prediction profiler ─────────── */

  /** Open the optimiser on the models picked in the manager. */
  const openOptimizer = (models: StoredModel[]) => {
    if (!models.length) {
      toast(t(lang, 'toast.optimizerNoModel'));
      return;
    }
    setOptimizerModels(models);
    setModelManagerOpen(false);
  };

  /** The optimiser's answer becomes one output card: conditions, predictions, alternatives. */
  const insertOptimizerResult = (payload: {
    result: OptimizerResult;
    responses: ResponseSettings[];
    factors: FactorSettings[];
    models: StoredModel[];
  }) => {
    const { result, responses, factors } = payload;
    const best = result.solutions[0];
    if (!best) return;
    const blocks: OutputDoc['blocks'] = [
      {
        type: 'text',
        lines: [t(lang, 'res.responseOptimizerNote', {
          n: responses.length,
          composite: best.composite.toFixed(4),
          status: t(lang, `opt.status.${result.status}`),
        })],
      },
      {
        type: 'table',
        title: t(lang, 'opt.result.conditions'),
        headers: [t(lang, 'opt.col.factor'), t(lang, 'opt.result.value'), t(lang, 'opt.result.coded')],
        rows: factors.map((factor) => [
          factor.name,
          typeof best.settings[factor.name] === 'number' ? fmt(best.settings[factor.name] as number, 5) : String(best.settings[factor.name] ?? '—'),
          Number.isFinite(best.coded[factor.name]) ? fmt(best.coded[factor.name], 4) : '—',
        ]),
        align: ['l', 'r', 'r'],
      },
      {
        type: 'table',
        title: t(lang, 'opt.result.predictions'),
        headers: [
          t(lang, 'opt.col.response'),
          t(lang, 'opt.col.goal'),
          t(lang, 'opt.result.predicted'),
          t(lang, 'opt.result.se'),
          t(lang, 'opt.result.ci'),
          t(lang, 'opt.result.pi'),
          t(lang, 'opt.result.desirability'),
          t(lang, 'opt.result.spec'),
        ],
        rows: best.responses.map((response) => [
          response.name,
          t(lang, `opt.goal.${response.goal}`),
          response.value === null ? t(lang, 'opt.notEstimable') : fmt(response.value, 5),
          response.se === null ? '—' : fmt(response.se, 5),
          response.ci ? `${fmt(response.ci[0], 4)} … ${fmt(response.ci[1], 4)}` : '—',
          response.pi ? `${fmt(response.pi[0], 4)} … ${fmt(response.pi[1], 4)}` : '—',
          response.desirability.toFixed(4),
          response.compliant ? t(lang, 'opt.result.specOk') : t(lang, 'opt.result.specNo'),
        ]),
        align: ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'l'],
      },
    ];
    if (result.solutions.length > 1) {
      blocks.push({
        type: 'table',
        title: t(lang, 'opt.result.alternatives', { n: result.solutions.length }),
        headers: ['#', ...factors.map((factor) => factor.name), t(lang, 'opt.result.composite'), t(lang, 'opt.result.spec')],
        rows: result.solutions.map((solution, index) => [
          String(index + 1),
          ...factors.map((factor) => (typeof solution.settings[factor.name] === 'number'
            ? fmt(solution.settings[factor.name] as number, 4)
            : String(solution.settings[factor.name] ?? '—'))),
          solution.composite.toFixed(4),
          solution.compliantAll ? t(lang, 'opt.result.specOk') : t(lang, 'opt.result.specNo'),
        ]),
        align: ['l', ...factors.map(() => 'r' as const), 'r', 'l'],
      });
    }
    const doc: OutputDoc = {
      id: makeOutputId(),
      titleKey: 'an.responseOptimizer',
      titleText: responses.map((response) => response.name).join(' · '),
      subtitle: `${t(lang, `opt.method.${result.resolvedMethod}`)} · ${t(lang, `opt.status.${result.status}`)}`,
      createdAt: Date.now(),
      collapsed: false,
      blocks,
      sheetId: sheet.id,
    };
    focusDoc(doc);
    setOptimizerModels(null);
  };

  /** The profiler opens at the optimiser's best condition. */
  const openProfilerFromOptimizer = (payload: {
    result: OptimizerResult;
    responses: ResponseSettings[];
    factors: FactorSettings[];
    models: StoredModel[];
  }) => {
    lastOptimizer.current = payload;
    setOptimizerModels(null);
    setProfilerState({
      models: payload.models,
      responses: payload.responses,
      factors: payload.factors,
      point: payload.result.solutions[0]?.settings ?? null,
    });
    pushTutorialEvent('profiler-opened', {
      point: payload.result.solutions[0]?.settings ?? null,
      models: payload.models.map((model) => model.response.name),
    });
  };

  /** The profiler's current condition is worth keeping: it becomes an output card too. */
  const saveProfilerCondition = (payload: {
    point: Record<string, number | string>;
    solution: { composite: number; responses: { name: string; goal: string; value: number | null; se: number | null; ci: [number, number] | null; pi: [number, number] | null; desirability: number; compliant: boolean }[] } | null;
    responses: ResponseSettings[];
    factors: FactorSettings[];
  }) => {
    const { point, solution, factors } = payload;
    const blocks: OutputDoc['blocks'] = [
      { type: 'text', lines: [t(lang, 'res.profilerNote', { composite: solution ? solution.composite.toFixed(4) : '0.0000' })] },
      {
        type: 'table',
        title: t(lang, 'opt.result.conditions'),
        headers: [t(lang, 'opt.col.factor'), t(lang, 'opt.result.value')],
        rows: factors.map((factor) => [
          factor.name,
          typeof point[factor.name] === 'number' ? fmt(point[factor.name] as number, 6) : String(point[factor.name] ?? '—'),
        ]),
        align: ['l', 'r'],
      },
    ];
    if (solution) {
      blocks.push({
        type: 'table',
        title: t(lang, 'opt.result.predictions'),
        headers: [
          t(lang, 'opt.col.response'),
          t(lang, 'opt.result.predicted'),
          t(lang, 'opt.result.se'),
          t(lang, 'opt.result.ci'),
          t(lang, 'opt.result.pi'),
          t(lang, 'opt.result.desirability'),
          t(lang, 'opt.result.spec'),
        ],
        rows: solution.responses.map((response) => [
          response.name,
          response.value === null ? t(lang, 'opt.notEstimable') : fmt(response.value, 5),
          response.se === null ? '—' : fmt(response.se, 5),
          response.ci ? `${fmt(response.ci[0], 4)} … ${fmt(response.ci[1], 4)}` : '—',
          response.pi ? `${fmt(response.pi[0], 4)} … ${fmt(response.pi[1], 4)}` : '—',
          response.desirability.toFixed(4),
          response.compliant ? t(lang, 'opt.result.specOk') : t(lang, 'opt.result.specNo'),
        ]),
        align: ['l', 'r', 'r', 'r', 'r', 'r', 'l'],
      });
    }
    pushTutorialEvent('profiler-saved', {
      point: { ...point },
      solution: solution ? { composite: solution.composite, responses: solution.responses.map((response) => ({ name: response.name, value: response.value })) } : null,
    });
    const doc: OutputDoc = {
      id: makeOutputId(),
      titleKey: 'an.profilerConditions',
      titleText: solution ? solution.responses.map((response) => response.name).join(' · ') : undefined,
      subtitle: t(lang, 'prof.subtitle', { responses: solution?.responses.length ?? 0, factors: factors.length }),
      createdAt: Date.now(),
      collapsed: false,
      blocks,
      sheetId: sheet.id,
    };
    focusDoc(doc);
  };

  /* ── files ─────────────────────────────────────────────────────────── */

  const saveProject = () => {
    downloadFile(
      projectFileName(),
      serializeProject({
        worksheets,
        activeSheetId,
        settings,
        outputs,
        // The reader's saved chart styles travel with the project: a project
        // opened on another machine must not silently lose them.
        customChartStyles: loadCustomStyles(),
        models: storedModels,
        figures,
      }),
      'application/json',
    );
    toast(t(lang, 'file.saved'));
  };

  const openProject = async () => {
    const file = await pickFile(PROJECT_ACCEPT);
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.mpx')) {
      // Minitab's native project is a binary container, never our JSON.
      toast(t(lang, 'file.mpxUnsupported'));
      return;
    }
    try {
      const text = await file.text();
      if (looksLikeMinitabBinary(file.name, text.slice(0, 8))) {
        toast(t(lang, 'file.mpxUnsupported'));
        return;
      }
      const parsed = parseProject(text);
      setWorksheets(parsed.worksheets);
      setActiveSheetId(parsed.activeSheetId);
      setOutputs(parsed.outputs);
      setSettings(parsed.settings);
      // Styles and stored models are merged, never replaced: opening a project
      // must not delete what this machine already has.
      parsed.customChartStyles?.forEach((style) => saveCustomStyle(style));
      setStoredModels((prev) => mergeStoredModels(prev, parsed.models ?? []));
      if (parsed.figures?.length) setFigures(parsed.figures);
      past.current = [];
      future.current = [];
      toast(t(lang, 'file.loaded'));
    } catch (error) {
      // A refusal names its reason (a newer schema, a damaged sheet) so the
      // reader knows the file was not half-read.
      const code = error instanceof Error ? error.message : '';
      const known = [
        'file.versionNewer', 'file.versionInvalid', 'file.worksheetCorrupt', 'file.worksheetDuplicate',
        'file.modelCorrupt', 'file.modelDuplicate', 'file.outputCorrupt', 'file.outputDuplicate',
        'file.figureCorrupt', 'file.styleCorrupt', 'file.styleDuplicate',
      ];
      toast(t(lang, known.includes(code) ? code : 'file.error'));
    }
  };

  const importCsv = async () => {
    const file = await pickFile('.csv,.tsv,.txt,text/csv');
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        toast(t(lang, 'file.error'));
        return;
      }
      // Never guess silently: the dialog shows the rows and asks about row 1.
      setPendingImport({
        kind: 'csv',
        fileName: file.name,
        text,
        name: file.name.replace(/\.[^.]+$/, ''),
        sheets: [{ name: file.name.replace(/\.[^.]+$/, ''), rows }],
        autoHeader: rows[0].every((cell) => cell.trim() !== '' && !isFinite(Number(cell.replace(/,/g, '')))),
      });
    } catch {
      toast(t(lang, 'file.error'));
    }
  };

  const confirmImport = (header: boolean) => {
    const pending = pendingImport;
    if (!pending) return;
    setPendingImport(null);
    try {
      if (pending.kind === 'csv') {
        const ws = csvToWorksheet(pending.text ?? '', pending.name, { header });
        addSheet(ws);
        return;
      }
      const imported = workbookToWorksheets(pending.sheets.map((s) => ({ name: s.name, rows: s.rows as never })), { header });
      if (!imported.length) {
        toast(t(lang, 'file.error'));
        return;
      }
      const named = imported.map((ws) => ({ ...ws, name: uniqueSheetName(worksheets, ws.name) }));
      applySheets((list) => [...list, ...named]);
      setActiveSheetId(named[0].id);
      setSel(createSelection({ row: 0, col: 0 }));
      toast(t(lang, 'file.xlsxImported', { n: imported.length }));
    } catch {
      toast(t(lang, 'file.error'));
    }
  };

  const exportCsv = () => {
    downloadFile(`${sheet.name.replace(/\s+/g, '-')}.csv`, worksheetToCsv(sheet), 'text/csv;charset=utf-8');
  };

  /** Every sheet of the workbook becomes its own worksheet, in workbook order. */
  const importXlsx = async () => {
    const file = await pickFile(XLSX_ACCEPT);
    if (!file) return;
    try {
      const sheets = await readXlsxRows(file);
      if (!sheets.length) {
        toast(t(lang, 'file.error'));
        return;
      }
      const first = sheets[0].rows[0] ?? [];
      const headerLike = first.length > 0
        && first.every((cell) => (cell instanceof Date ? false : typeof cell === 'string' && cell.trim() !== ''));
      setPendingImport({
        kind: 'xlsx',
        fileName: file.name,
        name: file.name.replace(/\.[^.]+$/, ''),
        sheets: sheets as PreviewSheet[],
        autoHeader: headerLike,
      });
    } catch {
      toast(t(lang, 'file.error'));
    }
  };

  const exportXlsx = async (all: boolean) => {
    const target = all ? worksheets : [sheet];
    try {
      const blob = await writeXlsx(target);
      downloadBlob(xlsxFileName(target), blob);
      toast(t(lang, 'file.xlsxExported'));
    } catch {
      toast(t(lang, 'file.error'));
    }
  };

  const newProject = () => {
    if (!window.confirm(t(lang, 'file.new') + '?')) return;
    const ws = emptyWorksheet(1);
    setWorksheets([ws]);
    setActiveSheetId(ws.id);
    setOutputs([]);
    past.current = [];
    future.current = [];
    toast(t(lang, 'toast.sheetAdded'));
  };

  const updateOutputBlocks = (id: string, blocks: OutputDoc['blocks']) => {
    setOutputs((prev) => prev.map((o) => {
      if (o.id !== id) return o;
      const next = { ...o, blocks };
      rememberChartConfigs(next);
      return next;
    }));
  };


  /* ── Guided tutorial system (WO-3E-11) ────────────────────────────── */

  const pushTutorialEvent = (type: TutorialEvent['type'], payload: Record<string, unknown>, stepId?: string) => {
    setTutorialEvents((prev) => [...prev.slice(-299), {
      id: `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      at: Date.now(),
      ...(stepId ? { stepId } : {}),
      payload,
    }]);
  };

  const tutorialFacts = (): WorkspaceFacts => ({
    worksheets,
    activeSheetId,
    outputs,
    models: storedModels,
    figures,
    events: tutorialEvents,
    practice,
  });

  const persistProgress = (progress: TutorialProgress) => {
    // The panel keeps the progress whether or not the browser stored it (WO-TQA-11):
    // a blocked or full store must not make the lesson look unstarted.
    setProgressMap((prev) => ({ ...prev, [progress.tutorialId]: progress }));
    try {
      TUTORIAL_STORE.save(progress);
      setTutorialStorageWarning(null);
    } catch (error) {
      const quota = error instanceof ProgressStorageError ? error.code === 'quota' : false;
      setTutorialStorageWarning(t(lang, quota ? 'tut.storageQuota' : 'tut.storageBlocked'));
    }
  };

  /* Every change to the workspace re-checks the open lesson: a validated step
     is only complete while the state that satisfied it still exists. */
  useEffect(() => {
    if (!tutorialSession) return;
    const tutorial = findTutorial(tutorialSession.tutorialId);
    if (!tutorial) return;
    const result = evaluateSession(tutorial, tutorialSession, tutorialFacts());
    setTutorialOutcomes(result.outcomes);
    if (result.changed) {
      setTutorialSession(result.progress);
      persistProgress(result.progress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksheets, activeSheetId, outputs, storedModels, figures, tutorialEvents, tutorialSession]);

  const requestStartTutorial = (tutorialId: string) => {
    if (!findTutorial(tutorialId)) return;
    if (practice) {
      setTutorialMessage(t(lang, 'tut.finishFirst'));
      setTutorialPanel('open');
      setLibraryOpen(false);
      return;
    }
    setStartPrompt({ tutorialId });
    setLibraryOpen(false);
    setSampleLibraryOpen(false);
    setHelpCenter(null);
  };

  /** Everything a practice replaces, captured together so it can be put back. */
  const captureWorkspace = () => ({
    worksheets,
    activeSheetId,
    outputs,
    storedModels,
    figures,
    settings,
    customStyles: loadCustomStyles(),
    past: [...past.current],
    future: [...future.current],
  });

  /** The reader's project as a file, for the guard and for an explicit backup. */
  const workspaceProjectJson = (): string => serializeProject({
    worksheets,
    activeSheetId,
    settings,
    outputs,
    customChartStyles: loadCustomStyles(),
    models: storedModels,
    figures,
  });

  const workspaceFingerprint = (): string => projectFingerprint({
    worksheets,
    activeSheetId,
    settings,
    outputs,
    models: storedModels,
    figures,
    customChartStyles: loadCustomStyles(),
  });

  /**
   * WO-TQA-01 — the reader's own project is written to permanent storage and read
   * back before a practice may replace it. What is returned is what the browser
   * actually kept, not what was intended.
   */
  const guardOriginalProject = (tutorialId: string, sessionId: string): { projectId: string; json: string; kept: boolean } => {
    const projectId = `original-${Date.now().toString(36)}`;
    const json = workspaceProjectJson();
    const fingerprint = workspaceFingerprint();
    const written = TUTORIAL_STORE.saveOriginalProject({ projectId, tutorialId, sessionId, json, fingerprint });
    const readBack = written.ok ? TUTORIAL_STORE.loadOriginalProject(projectId) : null;
    const kept = Boolean(readBack) && readBack?.fingerprint === fingerprint && readBack?.json === json;
    return { projectId, json, kept };
  };

  const beginTutorial = async (tutorialId: string, useCurrent: boolean, backupAcknowledged = false) => {
    const tutorial = findTutorial(tutorialId);
    if (!tutorial) return;
    const projectId = `practice-${Date.now().toString(36)}`;
    const progress = createProgress(tutorial, projectId);
    const original = guardOriginalProject(tutorialId, progress.sessionId);
    if (!original.kept && !backupAcknowledged) {
      // The original cannot be kept in the browser: the practice stops here and
      // the reader decides with the file in hand (WO-TQA-01).
      setBackupPrompt({ tutorialId, useCurrent, json: original.json });
      setStartPrompt(null);
      setTutorialMessage(null);
      return;
    }
    if (!original.kept) {
      setTutorialStorageWarning(t(lang, 'tut.backupOnly'));
    }
    // A save still owed by the autosave is finished before the workspace changes,
    // so the stored autosave and the guarded original are the same project
    // (WO-FINAL-001 · F-REL-03 step 4). The guard above already protects the data
    // if this write fails, so the practice may still start.
    const pending = await runAutosave();
    if (pending.status !== 'SAVED') setTutorialStorageWarning(t(lang, 'tut.backupOnly'));
    practiceSnapshot.current = captureWorkspace();
    practiceOriginalId.current = original.kept ? original.projectId : null;
    if (!useCurrent) {
      const base = emptyWorksheet(1);
      const sheetTitle = tutorialText(lang, tutorial.titleKey);
      const practiceSheet: Worksheet = { ...base, name: `Practice · ${sheetTitle}`.slice(0, 44) };
      setWorksheets([practiceSheet]);
      setActiveSheetId(practiceSheet.id);
      setOutputs([]);
      setStoredModels([]);
      setFigures([]);
      past.current = [];
      future.current = [];
      setSel(createSelection({ row: 0, col: 0 }));
    }
    setPractice({ id: projectId, mode: useCurrent ? 'current' : 'isolated', tutorialId, sampleIds: [...tutorial.sampleIds], sessionId: progress.sessionId });
    setTutorialEvents([]);
    setTutorialOutcomes({});
    setTutorialSession(progress);
    persistProgress(progress);
    setTutorialPanel('open');
    setTutorialBusy(false);
    setReviewingTutorial(false);
    setTutorialMessage(null);
    setPracticeSavedAt(null);
    setStartPrompt(null);
    setBackupPrompt(null);
    setExitPrompt(false);
    toast(t(lang, 'tut.startedToast'));
  };

  /** Load a project file into the workspace without touching the guard. */
  const loadProjectJson = (json: string): boolean => {
    try {
      const parsed = parseProject(json);
      setWorksheets(parsed.worksheets);
      setActiveSheetId(parsed.activeSheetId || parsed.worksheets[0]?.id || '');
      setOutputs(parsed.outputs);
      setSettings(parsed.settings);
      setStoredModels(parsed.models ?? []);
      setFigures((parsed.figures ?? []) as unknown as LayoutDoc[]);
      return true;
    } catch {
      return false;
    }
  };

  /** Fingerprints of every kept practice project, to tell one from the reader's own. */
  const practiceSlotFingerprints = (): string[] => TUTORIAL_STORE.listPracticeSlots().flatMap((slot) => {
    try {
      const parsed = parseProject(slot.json);
      return [projectFingerprint({
        worksheets: parsed.worksheets,
        activeSheetId: parsed.activeSheetId,
        settings: parsed.settings,
        outputs: parsed.outputs,
        models: parsed.models ?? [],
        figures: parsed.figures ?? [],
      })];
    } catch {
      return [];
    }
  });

  const restorePracticeSnapshot = (): boolean => {
    const snapshot = practiceSnapshot.current;
    if (!snapshot) return false;
    setWorksheets(snapshot.worksheets);
    setActiveSheetId(snapshot.activeSheetId);
    setOutputs(snapshot.outputs);
    setStoredModels(snapshot.storedModels);
    setFigures(snapshot.figures);
    setSettings(snapshot.settings);
    writeCustomStyles(snapshot.customStyles);
    past.current = snapshot.past;
    future.current = snapshot.future;
    setSel(createSelection({ row: 0, col: 0 }));
    practiceSnapshot.current = null;
    return true;
  };

  /**
   * Put the reader's project back: from this window's snapshot when there is one,
   * otherwise from the guarded copy a reload left behind (WO-TQA-01).
   */
  const restoreOriginalProject = (projectId: string | null): boolean => {
    if (restorePracticeSnapshot()) return true;
    if (!projectId) return false;
    const slot = TUTORIAL_STORE.loadOriginalProject(projectId);
    if (!slot) return false;
    if (!loadProjectJson(slot.json)) return false;
    past.current = [];
    future.current = [];
    setSel(createSelection({ row: 0, col: 0 }));
    return true;
  };

  const practiceProjectJson = (): string => workspaceProjectJson();

  type WorkspaceSnapshot = NonNullable<typeof practiceSnapshot.current>;

  const snapshotFingerprint = (snapshot: WorkspaceSnapshot): string => projectFingerprint({
    worksheets: snapshot.worksheets,
    activeSheetId: snapshot.activeSheetId,
    settings: snapshot.settings,
    outputs: snapshot.outputs,
    models: snapshot.storedModels,
    figures: snapshot.figures,
    customChartStyles: snapshot.customStyles,
  });

  /**
   * WO-01 F-REL-03: a restore counts only when what came back matches the guarded
   * copy. `verified` is the only outcome that may remove the backup.
   */
  const restoreOriginalVerified = (projectId: string | null): 'verified' | 'unverified' | 'missing' => {
    const expected = projectId ? TUTORIAL_STORE.loadOriginalProject(projectId) : null;
    const snapshot = practiceSnapshot.current;
    const restored = restoreOriginalProject(projectId);
    if (!restored) return 'missing';
    if (!expected) return 'verified'; // the practice began with a file backup only
    let actual: string | null = null;
    if (snapshot) {
      actual = snapshotFingerprint(snapshot);
    } else {
      try {
        const parsed = parseProject(expected.json);
        actual = projectFingerprint({
          worksheets: parsed.worksheets,
          activeSheetId: parsed.activeSheetId,
          settings: parsed.settings,
          outputs: parsed.outputs,
          models: parsed.models ?? [],
          figures: parsed.figures ?? [],
          customChartStyles: parsed.customChartStyles ?? [],
        });
      } catch {
        actual = null;
      }
    }
    return actual === expected.fingerprint ? 'verified' : 'unverified';
  };

  /**
   * WO-TQA-09 — the round trip is checked against the records themselves, not
   * against how many there are.
   */
  const verifyPracticeJson = (json: string): { ok: boolean; mismatches: { kind: string; where: string; detail: string }[] } => {
    try {
      const parsed = parseProject(json);
      const comparison = compareProjects(
        // A sheet that predates the current schema is compared as the loader
        // will hand it back, so a derived migration value is not a difference.
        { worksheets: worksheets.map(migrateWorksheet), activeSheetId, settings, outputs, models: storedModels, figures, customChartStyles: loadCustomStyles() },
        {
          worksheets: parsed.worksheets,
          activeSheetId: parsed.activeSheetId,
          settings: parsed.settings,
          outputs: parsed.outputs,
          models: parsed.models ?? [],
          figures: parsed.figures ?? [],
          customChartStyles: parsed.customChartStyles ?? [],
        },
      );
      return { ok: comparison.ok, mismatches: comparison.mismatches };
    } catch (error) {
      return { ok: false, mismatches: [{ kind: 'worksheets', where: 'file', detail: error instanceof Error ? error.message : 'unreadable project' }] };
    }
  };

  const savePracticeProject = (exportCsvToo = false): boolean => {
    try {
      const json = practiceProjectJson();
      const roundtrip = verifyPracticeJson(json);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadFile(`${PRODUCT.EXPORT_FILE_PREFIX}-practice-${practice?.tutorialId ?? 'lesson'}-${stamp}.sigrun.json`, json, 'application/json');
      if (exportCsvToo) downloadFile(`${PRODUCT.EXPORT_FILE_PREFIX}-practice-${sheet.name.replace(/\s+/g, '-')}.csv`, worksheetToCsv(sheet), 'text/csv;charset=utf-8');
      pushTutorialEvent('project-saved', {
        roundtripOk: roundtrip.ok,
        mismatches: roundtrip.mismatches.slice(0, 5),
        worksheets: worksheets.length,
        outputs: outputs.length,
        models: storedModels.length,
        figures: figures.length,
        exported: exportCsvToo ? 'project+csv' : 'project',
        projectId: practice?.id ?? null,
        sessionId: practice?.sessionId ?? null,
      });
      setPracticeSavedAt(new Date().toISOString());
      toast(t(lang, roundtrip.ok ? 'tut.savedVerified' : 'tut.savedUnverified'));
      return roundtrip.ok;
    } catch {
      toast(t(lang, 'file.error'));
      return false;
    }
  };

  const endPracticeSession = () => {
    setPractice(null);
    setTutorialSession(null);
    setTutorialOutcomes({});
    setTutorialEvents([]);
    setTutorialPanel('closed');
    setExitPrompt(false);
    setTutorialMessage(null);
    setOptimizerTutorial(null);
    setBackupPrompt(null);
    setPracticeSaveFailure(null);
  };

  /**
   * WO-01 F-REL-01: the practice project is written and read back. A failure is
   * reported as a failure and the session stays open; nothing is discarded
   * without the reader's explicit choice.
   */
  const writePracticeSlot = (): string | null => {
    if (!practice || practice.mode !== 'isolated') return null;
    try {
      const tutorial = findTutorial(practice.tutorialId);
      const sessionId = practice.sessionId ?? tutorialSession?.sessionId ?? practice.id;
      const json = practiceProjectJson();
      const slot = TUTORIAL_STORE.savePracticeSlot({
        tutorialId: practice.tutorialId,
        tutorialVersion: tutorial?.version ?? 1,
        sessionId,
        projectId: practice.id,
        savedAt: new Date().toISOString(),
        json,
        // The evidence and the progress travel with the project (WO-TQA-08).
        events: tutorialEvents,
        progress: tutorialSession,
        originalProjectId: practiceOriginalId.current,
      });
      if (!slot.ok) return slot.code === 'quota' ? 'quota' : 'blocked';
      const readBack = TUTORIAL_STORE.loadPracticeSlot(practice.tutorialId, sessionId);
      if (!readBack || readBack.json !== json) return 'unverified';
      return null;
    } catch {
      return 'blocked';
    }
  };

  /** End the practice and put the guarded original back, verifying the result first. */
  const restoreAfterPractice = (): void => {
    const isolated = practice?.mode !== 'current';
    const originalId = practiceOriginalId.current;
    endPracticeSession();
    practiceOriginalId.current = null;
    if (!isolated) return;
    const outcome = restoreOriginalVerified(originalId);
    if (outcome === 'verified') {
      if (originalId) TUTORIAL_STORE.removeOriginalProject(originalId);
    } else if (outcome === 'unverified') {
      setTutorialStorageWarning(t(lang, 'tut.originalUnverified'));
    } else {
      setTutorialStorageWarning(t(lang, 'tut.originalMissing'));
    }
  };

  const keepPractice = () => {
    if (!practice) return;
    const failure = writePracticeSlot();
    if (failure) {
      setPracticeSaveFailure(failure);
      return;
    }
    setPracticeSaveFailure(null);
    restoreAfterPractice();
    toast(t(lang, 'tut.practiceKept'));
  };

  /** The file is the kept copy: end only after a verified export. */
  const exportFailedPractice = () => {
    if (!savePracticeProject()) return;
    setPracticeSaveFailure(null);
    restoreAfterPractice();
    toast(t(lang, 'tut.practiceKeptUnsaved'));
  };

  const discardPractice = () => {
    if (!window.confirm(t(lang, 'tut.discardConfirm'))) return;
    const tutorialId = practice?.tutorialId;
    const sessionId = practice?.sessionId ?? tutorialSession?.sessionId;
    // Only this session's slot goes; another kept practice must survive (WO-TQA-07).
    if (tutorialId && sessionId) TUTORIAL_STORE.removePracticeSlot(practiceSlotId(tutorialId, sessionId));
    else TUTORIAL_STORE.clearPracticeProject();
    restoreAfterPractice();
    if (tutorialId) {
      TUTORIAL_STORE.remove(tutorialId);
      setProgressMap((prev) => {
        const next = { ...prev };
        delete next[tutorialId];
        return next;
      });
    }
    toast(t(lang, 'tut.discarded'));
  };

  const resumeTutorial = async (tutorialId: string, backupAcknowledged = false) => {
    const tutorial = findTutorial(tutorialId);
    const saved = progressMap[tutorialId];
    if (!tutorial || !saved) {
      requestStartTutorial(tutorialId);
      return;
    }
    if (saved.tutorialVersion !== tutorial.version) {
      requestStartTutorial(tutorialId);
      setTutorialMessage(t(lang, 'tut.slotVersionMismatch'));
      return;
    }
    if (practice) {
      if (practice.tutorialId !== tutorialId) {
        setTutorialMessage(t(lang, 'tut.finishFirst'));
        return;
      }
      setTutorialSession(saved);
      setTutorialPanel('open');
      setLibraryOpen(false);
      return;
    }
    // The exact session named is the only one that may be resumed (F-REL-09).
    const slot = TUTORIAL_STORE.loadPracticeSlot(tutorialId, saved.sessionId);
    if (slot && slot.tutorialId === tutorialId) {
      // Tutorial version and project identity must both still match (F-REL-03).
      const issue = practiceSlotIssue(slot, tutorial.version, saved.practiceProjectId ?? null);
      if (issue) {
        setStartPrompt({ tutorialId });
        setLibraryOpen(false);
        setTutorialMessage(t(lang, issue));
        return;
      }
      try {
        const parsed = parseProject(slot.json);
        // The workspace being replaced gets the same protection a fresh start
        // gets, under a new guard id — the previous session's guard is never
        // reused for this one (F-REL-03).
        const guard = guardOriginalProject(tutorialId, saved.sessionId);
        if (!guard.kept && !backupAcknowledged) {
          setBackupPrompt({ tutorialId, useCurrent: false, json: guard.json, resumeSessionId: saved.sessionId });
          setStartPrompt(null);
          setTutorialMessage(null);
          return;
        }
        if (!guard.kept) setTutorialStorageWarning(t(lang, 'tut.backupOnly'));
        // Any autosave still owed is settled before the workspace changes.
        const pending = await runAutosave();
        if (pending.status !== 'SAVED') setTutorialStorageWarning(t(lang, 'tut.backupOnly'));
        practiceSnapshot.current = captureWorkspace();
        practiceOriginalId.current = guard.kept ? guard.projectId : null;
        setWorksheets(parsed.worksheets);
        setActiveSheetId(parsed.activeSheetId);
        setOutputs(parsed.outputs);
        setSettings(parsed.settings);
        setStoredModels(parsed.models ?? []);
        setFigures((parsed.figures ?? []) as unknown as LayoutDoc[]);
        past.current = [];
        future.current = [];
        const resumed = slot.progress && slot.progress.tutorialId === tutorialId ? slot.progress : saved;
        setPractice({
          id: slot.projectId || saved.practiceProjectId || `practice-${Date.now().toString(36)}`,
          mode: 'isolated',
          tutorialId,
          sampleIds: [...tutorial.sampleIds],
          sessionId: resumed.sessionId,
        });
        setTutorialSession({ ...resumed, practiceProjectId: slot.projectId || saved.practiceProjectId });
        // Restoring the evidence is what makes the steps verifiable again (WO-TQA-08):
        // the engine re-runs every rule against the restored workspace and evidence.
        setTutorialEvents(slot.events ?? []);
        setTutorialPanel('open');
        setLibraryOpen(false);
        toast(t(lang, 'tut.resumed'));
        return;
      } catch {
        /* a damaged saved project falls through to a fresh start */
      }
    }
    // Progress without its practice data is not restored as completed.
    setStartPrompt({ tutorialId });
    setLibraryOpen(false);
    setTutorialMessage(t(lang, 'tut.practiceMissing'));
  };

  const restartCurrentTutorial = (tutorialId: string) => {
    const tutorial = findTutorial(tutorialId);
    if (!tutorial) return;
    if (!practice || practice.tutorialId !== tutorialId) {
      requestStartTutorial(tutorialId);
      return;
    }
    const progress = restartSession(tutorial, practice.id);
    setPractice({ ...practice, sessionId: progress.sessionId });
    setTutorialSession(progress);
    setTutorialOutcomes({});
    setTutorialEvents([]);
    setReviewingTutorial(false);
    persistProgress(progress);
    setTutorialPanel('open');
    setLibraryOpen(false);
    toast(t(lang, 'tut.restarted'));
  };

  /* ── action bridge: the only surface a tutorial can reach ─────────── */

  const tutorialFail = (code: string, message: string): ActionResult => ({ ok: false, code, message });

  const bridgeLoadSample = (sampleId: string): ActionResult => {
    const sample = findSample(sampleId);
    if (!sample) return tutorialFail('unknown-sample', t(lang, 'tut.unknownSample'));
    const created = sample.build();
    addSheet(created);
    pushTutorialEvent('sample-loaded', { sampleId, sheetId: created.id, columns: created.columns.map((column) => column.name) });
    setPractice((prev) => (prev && !prev.sampleIds.includes(sampleId) ? { ...prev, sampleIds: [...prev.sampleIds, sampleId] } : prev));
    return { ok: true, message: t(lang, 'tut.sampleLoaded', { name: lt(lang, sample.title) }) };
  };

  const bridgeOpenHelp = (helpId: string): ActionResult => {
    setHelpCenter({ helpId });
    pushTutorialEvent('help-opened', { helpId });
    return { ok: true, message: t(lang, 'tut.helpOpened') };
  };

  const bridgeOpenAnalysis = (analysisId: string, presetId?: string): ActionResult => {
    const def = findAnalysis(analysisId);
    if (!def) return tutorialFail('unknown-analysis', t(lang, 'tut.unknownAnalysis'));
    let values: Record<string, unknown> = {};
    if (presetId) {
      const preset = findTutorialPreset(presetId);
      if (!preset) return tutorialFail('unknown-preset', t(lang, 'tut.unknownPreset'));
      const resolved = resolveTutorialPreset(preset, sheet);
      if (resolved.missing.length) return tutorialFail('missing-columns', t(lang, 'tut.needSample', { columns: resolved.missing.join(', ') }));
      values = resolved.values;
    }
    setDialog({ def, initial: { ...defaultDialogValues(def), ...values } });
    setDialogNonce((value) => value + 1);
    dialogValues.current = null;
    pushTutorialEvent('analysis-opened', { analysisId, presetId, values });
    return { ok: true, message: t(lang, 'tut.dialogOpened', { name: t(lang, def.titleKey) }) };
  };

  const bridgeRunAnalysis = (): ActionResult => {
    if (!dialog) return tutorialFail('no-dialog', t(lang, 'tut.openDialogFirst'));
    if (!window.confirm(t(lang, 'tut.confirmRun', { name: t(lang, dialog.def.titleKey) }))) {
      return tutorialFail('cancelled', t(lang, 'tut.cancelled'));
    }
    const values = dialogValues.current ? { ...dialogValues.current } : { ...(dialog.initial ?? {}) };
    const error = execute(dialog.def, values);
    if (error) return tutorialFail('analysis-failed', error);
    return { ok: true, message: t(lang, 'tut.analysisRan') };
  };

  const bridgeOpenModelManager = (): ActionResult => {
    setModelManagerOpen(true);
    return { ok: true, message: t(lang, 'tut.managerOpened') };
  };

  const tutorialModelsFor = (spec: TutorialChartSpec): StoredModel[] => {
    let list = storedModels;
    if (spec.modelNames?.length) list = list.filter((model) => spec.modelNames?.includes(model.name));
    if (spec.responses?.length) list = list.filter((model) => spec.responses?.some((name) => model.response.name.includes(name)));
    return list;
  };

  const bridgeOpenChart = (spec: TutorialChartSpec): ActionResult => {
    if (spec.kind === 'histogram' || spec.kind === 'boxplot' || spec.kind === 'scatter') {
      return tutorialFail('chart-needs-analysis', t(lang, 'tut.chartUseAnalysis'));
    }
    const candidates = tutorialModelsFor(spec);
    if (!candidates.length) return tutorialFail('no-model', t(lang, 'tut.needModels'));
    if (spec.kind === 'contour') {
      const model = candidates.find((candidate) => candidate.predictors.filter((predictor) => predictor.kind === 'numeric').length >= 2);
      if (!model) return tutorialFail('no-surface', t(lang, 'tut.needModels'));
      contourFromModel(model);
      pushTutorialEvent('chart-created', { kind: 'contour', response: model.response.name, modelId: model.id });
      return { ok: true, message: t(lang, 'tut.chartCreated', { kind: 'contour', response: model.response.name }) };
    }
    if (spec.kind === 'surface3d') {
      const model = candidates.find((candidate) => numericFactors(candidate).length >= 2);
      if (!model) return tutorialFail('no-surface', t(lang, 'tut.needModels'));
      surfaceFromModel(model);
      pushTutorialEvent('chart-created', { kind: 'surface3d', response: model.response.name, modelId: model.id });
      return { ok: true, message: t(lang, 'tut.chartCreated', { kind: 'surface3d', response: model.response.name }) };
    }
    const shared = commonNumericFactors(candidates);
    if (candidates.length < 2 || shared.factors.length < 2) return tutorialFail('no-common-factors', t(lang, 'tut.needCommonFactors'));
    const specs = spec.specs?.map((entry) => ({
      name: entry.response,
      lsl: entry.lsl ?? null,
      usl: entry.usl ?? null,
      target: entry.target ?? null,
    }));
    overlaidFromModels(candidates, specs);
    pushTutorialEvent('chart-created', { kind: 'overlaid', responses: candidates.map((model) => model.response.name) });
    return { ok: true, message: t(lang, 'tut.chartCreated', { kind: 'overlaid', response: String(candidates.length) }) };
  };

  const bridgeOpenOptimizer = (spec?: TutorialOptimizerSpec): ActionResult => {
    let list = storedModels;
    if (spec?.responses.length) {
      const wanted = spec.responses.map((response) => response.response);
      list = storedModels.filter((model) => wanted.includes(model.response.name));
      const missing = wanted.filter((name) => !list.some((model) => model.response.name === name));
      if (missing.length) return tutorialFail('missing-models', t(lang, 'tut.needModelsNamed', { names: missing.join(', ') }));
    }
    if (!list.length) return tutorialFail('no-model', t(lang, 'tut.needModels'));
    setOptimizerTutorial(spec ?? null);
    setOptimizerModels(list);
    setModelManagerOpen(false);
    return { ok: true, message: t(lang, 'tut.optimizerOpened') };
  };

  const bridgeOpenProfiler = (): ActionResult => {
    const last = lastOptimizer.current;
    if (!last) return tutorialFail('no-optimizer', t(lang, 'tut.needOptimizer'));
    const point = last.result.solutions[0]?.settings ?? null;
    setProfilerState({ models: last.models, responses: last.responses, factors: last.factors, point });
    pushTutorialEvent('profiler-opened', { point, models: last.models.map((model) => model.response.name) });
    return { ok: true, message: t(lang, 'tut.profilerOpened') };
  };

  const bridgeOpenLayout = (): ActionResult => {
    setLayoutEditorOpen(true);
    return { ok: true, message: t(lang, 'tut.layoutOpened') };
  };

  const bridgeExportProject = (): ActionResult => {
    const ok = savePracticeProject(false);
    return ok
      ? { ok: true, message: t(lang, 'tut.savedVerified') }
      : tutorialFail('save-failed', t(lang, 'tut.savedUnverified'));
  };

  const bridgeExportChart = (): ActionResult => {
    setLayoutEditorOpen(true);
    return { ok: true, message: t(lang, 'tut.exportFromEditor') };
  };

  const bridgeValidateResult = (): ActionResult => {
    if (!tutorialSession) return tutorialFail('no-session', t(lang, 'tut.noSession'));
    const tutorial = findTutorial(tutorialSession.tutorialId);
    if (!tutorial) return tutorialFail('no-session', t(lang, 'tut.noSession'));
    const result = evaluateSession(tutorial, tutorialSession, tutorialFacts());
    setTutorialOutcomes(result.outcomes);
    setTutorialSession(result.progress);
    persistProgress(result.progress);
    const outcome = result.outcomes[tutorialSession.currentStepId];
    return {
      ok: outcome?.status !== 'fail',
      code: outcome?.code ?? 'checked',
      message: outcome ? lt(lang, outcome.detail) : t(lang, 'tut.checked'),
    };
  };

  const bridgeState = (): BridgeState => ({
    activeSheetId,
    sheetName: sheet.name,
    hasDialog: Boolean(dialog),
    dialogAnalysisId: dialog?.def.id ?? null,
    modelCount: storedModels.length,
    outputCount: outputs.length,
    practiceActive: Boolean(practice),
  });

  const tutorialBridge: TutorialBridge = {
    loadSample: bridgeLoadSample,
    openHelp: bridgeOpenHelp,
    openAnalysis: bridgeOpenAnalysis,
    applyPreset: bridgeOpenAnalysis,
    runAnalysis: bridgeRunAnalysis,
    openModelManager: bridgeOpenModelManager,
    openChart: bridgeOpenChart,
    openOptimizer: bridgeOpenOptimizer,
    openProfiler: bridgeOpenProfiler,
    openLayout: bridgeOpenLayout,
    exportProject: bridgeExportProject,
    exportChart: bridgeExportChart,
    validateResult: bridgeValidateResult,
    state: bridgeState,
  };

  const handleTutorialAction = (spec: TutorialActionSpec) => {
    if (!tutorialSession) return;
    setTutorialBusy(true);
    setTutorialMessage(null);
    const result = runTutorialAction(spec, tutorialBridge);
    setTutorialBusy(false);
    if (result.ok) {
      if (result.message) setTutorialMessage(result.message);
    } else {
      if (result.code !== 'cancelled') setTutorialMessage(result.message ?? t(lang, 'tut.actionFailed'));
      pushTutorialEvent('action-failed', { action: spec.action, code: result.code, message: result.message }, tutorialSession.currentStepId);
    }
  };

  const moveTutorialStep = (offset: number) => {
    if (!tutorialSession) return;
    const tutorial = findTutorial(tutorialSession.tutorialId);
    if (!tutorial) return;
    const index = tutorial.steps.findIndex((step) => step.id === tutorialSession.currentStepId);
    const target = tutorial.steps[Math.max(0, Math.min(tutorial.steps.length - 1, index + offset))];
    if (!target || target.id === tutorialSession.currentStepId) return;
    const next = setCurrentStep(tutorialSession, target.id);
    setTutorialSession(next);
    persistProgress(next);
  };

  const selectTutorialStep = (stepId: string) => {
    if (!tutorialSession) return;
    const next = setCurrentStep(tutorialSession, stepId);
    setTutorialSession(next);
    persistProgress(next);
  };

  const manualTutorialStep = (done: boolean) => {
    if (!tutorialSession) return;
    const tutorial = findTutorial(tutorialSession.tutorialId);
    if (!tutorial) return;
    const next = markManualStep(tutorial, tutorialSession, tutorialSession.currentStepId, done);
    setTutorialSession(next);
    persistProgress(next);
  };

  const skipTutorialStep = () => {
    if (!tutorialSession) return;
    const tutorial = findTutorial(tutorialSession.tutorialId);
    if (!tutorial) return;
    const next = skipStep(tutorial, tutorialSession, tutorialSession.currentStepId);
    setTutorialSession(next);
    persistProgress(next);
  };

  const reopenTutorialStep = () => {
    if (!tutorialSession) return;
    const tutorial = findTutorial(tutorialSession.tutorialId);
    if (!tutorial) return;
    const next = reopenStep(tutorial, tutorialSession, tutorialSession.currentStepId);
    setTutorialSession(next);
    persistProgress(next);
  };

  const reviewTutorial = () => {
    if (!tutorialSession) return;
    const tutorial = findTutorial(tutorialSession.tutorialId);
    if (!tutorial || !tutorial.steps.length) return;
    setReviewingTutorial(true);
    const next = setCurrentStep(tutorialSession, tutorial.steps[0].id);
    setTutorialSession(next);
    persistProgress(next);
  };

  const activeTutorial = tutorialSession ? findTutorial(tutorialSession.tutorialId) : undefined;
  const tutorialFinished = Boolean(activeTutorial && tutorialSession && !reviewingTutorial && isTutorialComplete(activeTutorial, tutorialSession));
  const tutorialSummaryData = activeTutorial && tutorialSession ? tutorialSummary(activeTutorial, tutorialSession, tutorialFacts()) : null;

  const onExitedTutorial = () => {
    const nextId = activeTutorial?.nextTutorialId;
    endPracticeSession();
    restorePracticeSnapshot();
    setLibraryOpen(true);
    if (nextId) setTutorialMessage(t(lang, 'tut.nextAfterExit'));
  };

  /* ── shortcuts ─────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        rerun();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveProject();
        return;
      }
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFindSeed('');
        setFindOpen(true);
        return;
      }
      if (mod && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        setLibraryOpen(true);
        return;
      }
      if (typing) return;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerun, undo, redo, lang, worksheets, activeSheetId, outputs, settings]);

  /* ── drag splitters ────────────────────────────────────────────────── */

  /** One pointer drag, shared by every splitter and the drawer edge. */
  const beginDrag = (
    event: React.PointerEvent,
    cursor: string,
    onMove: (dx: number, dy: number) => void,
  ) => {
    (event.currentTarget as HTMLElement).focus();
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (e: PointerEvent) => onMove(e.clientX - startX, e.clientY - startY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = cursor;
  };

  const beginNavDrag = (event: React.PointerEvent) => {
    const start = { navW: ws.navW, outputW: ws.outputW };
    beginDrag(event, 'col-resize', (dx) => {
      const rects = dragNav(viewportW, start.navW, start.outputW, dx);
      setWs((prev) => (prev.navW === rects.nav ? prev : { ...prev, navW: rects.nav }));
    });
  };

  /** Splitter between the output and worksheet columns (three-panel mode). */
  const beginOutputWidthDrag = (event: React.PointerEvent) => {
    const start = { navW: ws.navW, outputW: ws.outputW };
    beginDrag(event, 'col-resize', (dx) => {
      const rects = dragOutput(viewportW, start.navW, start.outputW, dx);
      setWs((prev) => (prev.outputW === rects.output ? prev : { ...prev, outputW: rects.output }));
    });
  };

  /** The left edge of the focus-mode worksheet drawer. */
  const beginDrawerDrag = (event: React.PointerEvent) => {
    const startW = ws.drawerW;
    beginDrag(event, 'col-resize', (dx) => {
      const next = clampDrawerW(startW - dx, viewportW);
      setWs((prev) => (prev.drawerW === next ? prev : { ...prev, drawerW: next }));
    });
  };

  /** The classic stacked splitter between output and worksheet. */
  const beginOutputDrag = (event: React.PointerEvent) => {
    const container = (event.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startY = event.clientY;
    beginDrag(event, 'row-resize', (_dx, dy) => {
      const pct = ((startY + dy - rect.top) / rect.height) * 100;
      setWs((prev) => {
        const next = clampOutput(pct);
        return prev.outputH === next ? prev : { ...prev, outputH: next };
      });
    });
  };

  /* ── layout presets & detached panels ─────────────────────────────── */

  const applyLayout = (id: LayoutPresetId) => {
    const preset = findPreset(id);
    setWs((prev) => applyPresetToWorkspace(prev, preset.id, viewportW));
    setLayoutPreset(preset.id);
    setNavHidden(preset.navHidden);
    toast(t(lang, 'toast.layout', { name: t(lang, preset.labelKey) }));
  };

  /** Stage 3: switch between the three desktop arrangements. */
  const applyWorkspaceLayout = (id: WorkspaceLayout) => {
    setWs((prev) => setWorkspaceLayout(prev, id, viewportW));
    toast(t(lang, 'toast.workspace', { name: t(lang, `ws.layout.${id}`) }));
  };

  const setDrawerOpen = (open: boolean) => {
    setWs((prev) => (prev.drawerOpen === open ? prev : { ...prev, drawerOpen: open }));
  };

  const detachPanel = (id: PanelId) => {
    setDetached((prev) => ({ ...prev, [id]: prev[id] ? null : floatRect(id, window.innerWidth, window.innerHeight, floatSizes[id]) }));
  };

  const dockPanel = (id: PanelId) => {
    setDetached((prev) => ({ ...prev, [id]: null }));
    toast(t(lang, 'panel.docked'));
  };

  const movePanel = (id: PanelId, next: { x: number; y: number }) => {
    setDetached((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id] as FloatRect, ...next } } : prev));
  };

  const resizePanel = (id: PanelId, next: FloatRect) => {
    setDetached((prev) => (prev[id] ? { ...prev, [id]: next } : prev));
    setFloatSizes((prev) => (prev[id].w === next.w && prev[id].h === next.h ? prev : { ...prev, [id]: { w: next.w, h: next.h } }));
  };

  /* ── menu actions ──────────────────────────────────────────────────── */

  const onAction = (action: MenuAction) => {
    switch (action) {
      case 'new': newProject(); break;
      case 'save': saveProject(); break;
      case 'open': void openProject(); break;
      case 'importCsv': void importCsv(); break;
      case 'exportCsv': exportCsv(); break;
      case 'importXlsx': void importXlsx(); break;
      case 'exportXlsx': void exportXlsx(true); break;
      case 'exportXlsxCurrent': void exportXlsx(false); break;
      case 'print': window.print(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'copy': void copySelection(false); break;
      case 'cut': void copySelection(true); break;
      case 'paste': void navigator.clipboard?.readText?.().then((text) => text && pasteCells(selection.row, selection.col, text)).catch(() => toast(t(lang, 'toast.pasteFailed'))); break;
      case 'clear': clearSelection(); break;
      case 'insertRow': insertRowsHere(primarySelection().r0); break;
      case 'deleteRow': deleteSelectedRows(); break;
      case 'insertColumn': insertColumnAt(primarySelection().c1 + 1); break;
      case 'deleteColumn': deleteSelectedColumns(); break;
      case 'addColumn': addColumn(); break;
      case 'findReplace': setFindSeed(''); setFindOpen(true); break;
      case 'newSheet': addSheet(); break;
      case 'renameSheet': setRenameTarget({ id: sheet.id, draft: sheet.name }); break;
      case 'deleteSheet': deleteSheet(activeSheetId); break;
      case 'help': setHelp('help'); break;
      case 'helpCenter': setHelpCenter({}); break;
      case 'tutorials': setLibraryOpen(true); break;
      case 'learn': setLibraryOpen(true); break;
      case 'sampleLibrary': setSampleLibraryInitial(null); setSampleLibraryOpen(true); break;
      case 'about': setHelp('about'); break;
      case 'theme': setSettings((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' })); break;
      case 'langKo': setSettings((prev) => ({ ...prev, lang: 'ko' })); break;
      case 'langEn': setSettings((prev) => ({ ...prev, lang: 'en' })); break;
      case 'resetLayout': setNavHidden(false); applyLayout('balanced'); break;
      case 'toggleNav': setNavHidden((value) => !value); break;
      case 'layoutBalanced': applyLayout('balanced'); break;
      case 'layoutSheet': applyLayout('sheet'); break;
      case 'layoutResults': applyLayout('results'); break;
      case 'layoutFocus': applyLayout('focus'); break;
      case 'wsTri': applyWorkspaceLayout('tri'); break;
      case 'wsFocus': applyWorkspaceLayout('focus'); break;
      case 'wsClassic': applyWorkspaceLayout('classic'); break;
      case 'toggleDrawer': setDrawerOpen(!ws.drawerOpen); break;
      case 'modelManager': setModelManagerOpen(true); break;
      case 'graphLayout': setLayoutEditorOpen(true); break;
      default: break;
    }
  };

  const setTheme = (theme: Theme) => setSettings((prev) => ({ ...prev, theme }));
  const setLang = (next: Lang) => setSettings((prev) => ({ ...prev, lang: next }));

  const lastTitle = lastDialog ? t(lang, (ANALYSES.find((a) => a.id === lastDialog.analysisId)?.titleKey ?? 'status.none')) : t(lang, 'status.none');
  const autosaveLabel = practice
    ? t(lang, 'tut.autosavePaused')
    : autosave === 'saving'
      ? t(lang, 'status.saving')
      : autosave === 'saved'
        ? t(lang, 'status.autosave')
        : autosave === 'failed'
          ? t(lang, 'status.saveFailed')
          : autosave === 'quota'
            ? t(lang, 'status.quotaFull')
            : t(lang, 'status.storageBlocked');
  const cellLabel = `${sheet.columns[selection.col]?.id ?? '—'}:${selection.row + 1}`;

  const commitRename = () => {
    if (!renameTarget) return;
    if (renameSheet(renameTarget.id, renameTarget.draft)) setRenameTarget(null);
  };

  const commitColDialog = () => {
    if (!colDialog) return;
    if (colDialog.kind === 'name') renameColumn(colDialog.index, colDialog.draft);
    else saveColumnDescription(colDialog.index, colDialog.draft.trim());
    setColDialog(null);
  };

  const navNode = (floating: boolean) => (
    <Navigator
      lang={lang}
      floating={floating}
      open={floating ? true : navOpen}
      outputs={outputs}
      worksheets={worksheets}
      activeSheetId={sheet.id}
      focusedOutput={focusedOutput}
      onSelectOutput={(id) => { setFocusedOutput(id); setMobileTab('output'); setNavOpen(false); setTimeout(() => document.getElementById(`card-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30); }}
      onDeleteOutput={(id) => { setOutputs((prev) => prev.filter((o) => o.id !== id)); toast(t(lang, 'toast.outputDeleted')); }}
      onSelectSheet={(id) => { setActiveSheetId(id); setSel(createSelection({ row: 0, col: 0 })); setMobileTab('worksheet'); setNavOpen(false); }}
      onAddSheet={() => addSheet()}
      onRenameSheet={renameSheet}
      onDeleteSheet={deleteSheet}
      onClose={floating ? undefined : () => setNavOpen(false)}
      onDetach={floating ? undefined : () => detachPanel('navigator')}
    />
  );

  const outputNode = (floating: boolean) => (
    <section className={`panel output-panel${floating ? ' floating' : ''}`} data-hidden={floating ? false : mobileTab !== 'output'}>
      <div className="panel-head">
        {!floating && <span className="panel-title">{t(lang, 'panel.output')}</span>}
        <span className="panel-count">{outputs.length}</span>
        <span className="spacer" />
        <span className="mono-note">{t(lang, 'status.last')} · {lastTitle}</span>
        {!floating && (
          <button type="button" className="detach-btn" onClick={() => detachPanel('output')} title={t(lang, 'panel.detach')} aria-label={t(lang, 'panel.detach')} data-testid="detach-output">
            <IconDetach size={14} />
          </button>
        )}
      </div>
      <OutputPanel
        lang={lang}
        outputs={outputs}
        focusedOutput={focusedOutput}
        onFocus={setFocusedOutput}
        onDelete={(id) => { setOutputs((prev) => prev.filter((o) => o.id !== id)); toast(t(lang, 'toast.outputDeleted')); }}
        onToggleCollapse={(id) => setOutputs((prev) => prev.map((o) => (o.id === id ? { ...o, collapsed: !o.collapsed } : o)))}
        onCollapseAll={(collapsed) => setOutputs((prev) => (prev.every((o) => Boolean(o.collapsed) === collapsed) ? prev : prev.map((o) => ({ ...o, collapsed }))))}
        onToast={toast}
        onRerun={rerunWithOptions}
        onReproduce={reproduce}
        onUpdateBlocks={updateOutputBlocks}
        onSaveModel={saveModelFromCard}
        selection={chartSelection}
        onSelectRows={(rows, additive, source) => setChartSelection((prev) => {
          void additive;
          const nextRows = rows;
          if (!nextRows.length) return null;
          return { rows: nextRows, source: source ?? prev?.source };
        })}
        onExportSelection={(rows) => {
          if (!rows.length) return;
          const csv = selectedRowsCsv(sheet.columns, rows);
          downloadFile(`${PRODUCT.EXPORT_FILE_PREFIX}-selection-${sheet.name || 'sheet'}.csv`, csv, 'text/csv;charset=utf-8');
          toast(t(lang, 'toast.selectionExported', { n: rows.length }));
        }}
      />
    </section>
  );

  const worksheetNode = (floating: boolean, variant: 'docked' | 'drawer' = 'docked') => (
    <section
      className={`panel worksheet-panel${floating ? ' floating' : ''}${variant === 'drawer' ? ' drawer-panel' : ''}`}
      data-hidden={floating || variant === 'drawer' ? false : mobileTab !== 'worksheet'}
    >
      <div className="panel-head">
        {!floating && <span className="panel-title">{t(lang, 'panel.worksheet')}</span>}
        <span className="panel-count">
          {fmtInt(rowCount(sheet))} × {sheet.columns.length}
        </span>
        <span className="spacer" />
        <span className="grid-hint">{t(lang, 'hint.grid')}</span>
        {variant === 'drawer' && (
          <button
            type="button"
            className="detach-btn drawer-rerun"
            onClick={rerunNow}
            disabled={!lastDialog}
            title={t(lang, 'drawer.rerun')}
            aria-label={t(lang, 'drawer.rerun')}
            data-testid="drawer-rerun"
          >
            <IconRerun size={14} />
          </button>
        )}
        {!floating && (
          <button type="button" className="detach-btn" onClick={() => detachPanel('worksheet')} title={t(lang, 'panel.detach')} aria-label={t(lang, 'panel.detach')} data-testid="detach-worksheet">
            <IconDetach size={14} />
          </button>
        )}
        {variant === 'drawer' && (
          <button type="button" className="detach-btn" onClick={() => setDrawerOpen(false)} title={t(lang, 'drawer.close')} aria-label={t(lang, 'drawer.close')} data-testid="drawer-close">
            <IconX size={14} />
          </button>
        )}
      </div>
      <WorksheetGrid
        lang={lang}
        sheet={sheet}
        selection={sel}
        onSelectionChange={setSel}
        onEdit={editCell}
        onPaste={pasteCells}
        onCopy={() => void copySelection(false)}
        onCut={() => void copySelection(true)}
        onClear={clearSelection}
        onAddColumn={addColumn}
        onRenameColumn={renameColumn}
        onContextMenu={openGridContext}
        cutRanges={cutMark?.ranges}
        highlightRows={chartSelection && (chartSelection.source?.sheetId ?? sheet.id) === sheet.id ? chartSelection.rows : undefined}
      />
      <div className="ws-tabs">
        {worksheets.map((ws) => (
          <button
            key={ws.id}
            type="button"
            className={`ws-tab${ws.id === sheet.id ? ' current' : ''}`}
            onClick={() => setActiveSheetId(ws.id)}
            onDoubleClick={() => setRenameTarget({ id: ws.id, draft: ws.name })}
            onContextMenu={(event) => {
              event.preventDefault();
              setActiveSheetId(ws.id);
              setSel(createSelection({ row: 0, col: 0 }));
              setCtx({ x: event.clientX, y: event.clientY, target: { kind: 'empty', cell: { row: 0, col: 0 } }, sheetId: ws.id });
            }}
            data-testid={`sheet-tab-${ws.id}`}
          >
            {ws.name}
            {worksheets.length > 1 && (
              <span
                className="x"
                role="button"
                tabIndex={-1}
                onClick={(event) => { event.stopPropagation(); deleteSheet(ws.id); }}
                aria-label={t(lang, 'nav.delete')}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button type="button" className="ws-addtab" onClick={() => addSheet()} aria-label={t(lang, 'nav.addSheet')} data-testid="add-sheet-tab">+</button>
        <span className="grid-hint">
          {t(lang, 'status.rows', { n: fmtInt(rowCount(sheet)) })} · {t(lang, 'status.cols', { n: sheet.columns.length })}
        </span>
      </div>
    </section>
  );

  /** Classic / phone shell: the output pane stacked over the worksheet. */
  const stackedPanels = () => (
    <div className="main-panels" style={{ '--output-h': `${ws.outputH}%` } as React.CSSProperties} data-testid="main-panels">
      {detached.output
        ? <DetachSlot className="output-slot" lang={lang} label={t(lang, 'panel.outputDetached')} onDock={() => dockPanel('output')} testId="dock-slot-output" />
        : outputNode(false)}

      {!detached.output && (
        <div
          className="splitter horizontal"
          onPointerDown={beginOutputDrag}
          role="separator"
          aria-orientation="horizontal"
          tabIndex={0}
          aria-label={t(lang, 'panel.output')}
          aria-valuenow={Math.round(ws.outputH)}
          data-testid="splitter-output-h"
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') { event.preventDefault(); setWs((prev) => ({ ...prev, outputH: clampOutput(prev.outputH + 4) })); }
            if (event.key === 'ArrowDown') { event.preventDefault(); setWs((prev) => ({ ...prev, outputH: clampOutput(prev.outputH - 4) })); }
          }}
        />
      )}

      {detached.worksheet
        ? <DetachSlot className="worksheet-slot" lang={lang} label={t(lang, 'panel.worksheetDetached')} onDock={() => dockPanel('worksheet')} testId="dock-slot-worksheet" />
        : worksheetNode(false)}
    </div>
  );

  return (
    <div className={`app${tutorialPanel === 'open' ? ' tutorial-open' : tutorialPanel === 'collapsed' ? ' tutorial-collapsed' : ''}`}>
      <MenuBar
        lang={lang}
        canUndo={past.current.length > 0}
        canRedo={future.current.length > 0}
        navVisible={!navHidden}
        layoutPreset={layoutPreset}
        workspaceLayout={ws.layout}
        brand={<Brand lang={lang} />}
        actions={(
          <HeaderActions
            settings={settings}
            onToggleTheme={() => setTheme(settings.theme === 'dark' ? 'light' : 'dark')}
            onLang={setLang}
            onHelp={() => setHelp('help')}
            onSaveProject={saveProject}
            onOpenProject={() => void openProject()}
            onNewSheet={() => addSheet()}
            onResetLayout={() => applyLayout('balanced')}
            onLayout={applyLayout}
            workspaceLayout={ws.layout}
            onWorkspaceLayout={applyWorkspaceLayout}
          />
        )}
        onAction={onAction}
        onAnalysis={openAnalysis}
        onSample={loadSample}
      />

      <Toolbar
        lang={lang}
        sheetName={sheet.name}
        sheetColumns={sheet.columns.length}
        canRerun={Boolean(lastDialog)}
        workspaceLayout={ws.layout}
        onWorkspaceLayout={applyWorkspaceLayout}
        onSample={loadSample}
        onSampleLibrary={() => { setSampleLibraryInitial(null); setSampleLibraryOpen(true); }}
        onLearn={() => setLibraryOpen(true)}
        onAnalysis={openAnalysis}
        onNewSheet={() => addSheet()}
        onRerun={rerun}
        onExportCsv={exportCsv}
      />

      <div className="mobile-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mobileTab === 'output'} onClick={() => setMobileTab('output')}>
          {t(lang, 'panel.output')} · {outputs.length}
        </button>
        <button type="button" role="tab" aria-selected={mobileTab === 'worksheet'} onClick={() => setMobileTab('worksheet')}>
          {t(lang, 'panel.worksheet')}
        </button>
        <button type="button" onClick={() => setNavOpen((v) => !v)} aria-label={t(lang, 'view.navigator')}>
          ☰
        </button>
      </div>

      <div
        className={`workspace ws-${effectiveLayout}`}
        data-layout={effectiveLayout}
        data-drawer={ws.drawerOpen ? 'open' : 'closed'}
        data-testid="workspace"
        style={{
          '--nav-w': `${ws.navW}px`,
          '--output-w': `${triCols.output}px`,
          '--drawer-w': `${ws.drawerW}px`,
          '--output-h': `${ws.outputH}%`,
        } as React.CSSProperties}
      >
        {!navHidden && !detached.navigator && navNode(false)}
        {!navHidden && detached.navigator && (
          <DetachSlot className="nav-slot" lang={lang} label={t(lang, 'panel.navigatorDetached')} onDock={() => dockPanel('navigator')} testId="dock-slot-navigator" />
        )}
        {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
        {!navHidden && !detached.navigator && (
          <div
            className="splitter"
            onPointerDown={beginNavDrag}
            role="separator"
            aria-orientation="vertical"
            tabIndex={0}
            aria-label={t(lang, 'view.navigator')}
            aria-valuenow={Math.round(ws.navW)}
            data-testid="splitter-nav"
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') { event.preventDefault(); setWs((prev) => ({ ...prev, navW: clampNav(prev.navW - 24) })); }
              if (event.key === 'ArrowRight') { event.preventDefault(); setWs((prev) => ({ ...prev, navW: clampNav(prev.navW + 24) })); }
            }}
          />
        )}

        {(effectiveLayout === 'classic' || effectiveLayout === 'mobile') && stackedPanels()}

        {effectiveLayout === 'tri' && (
          <>
            {detached.output
              ? <DetachSlot className="output-slot" lang={lang} label={t(lang, 'panel.outputDetached')} onDock={() => dockPanel('output')} testId="dock-slot-output" />
              : outputNode(false)}

            {!detached.output && (
              <div
                className="splitter"
                onPointerDown={beginOutputWidthDrag}
                role="separator"
                aria-orientation="vertical"
                tabIndex={0}
                aria-label={t(lang, 'panel.output')}
                aria-valuenow={triCols.output}
                data-testid="splitter-output"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') { event.preventDefault(); setWs((prev) => ({ ...prev, outputW: clampOutputW(prev.outputW - 32, viewportW, prev.navW) })); }
                  if (event.key === 'ArrowRight') { event.preventDefault(); setWs((prev) => ({ ...prev, outputW: clampOutputW(prev.outputW + 32, viewportW, prev.navW) })); }
                }}
              />
            )}

            {detached.worksheet
              ? <DetachSlot className="worksheet-slot" lang={lang} label={t(lang, 'panel.worksheetDetached')} onDock={() => dockPanel('worksheet')} testId="dock-slot-worksheet" />
              : worksheetNode(false)}
          </>
        )}

        {effectiveLayout === 'focus' && (
          <div className="focus-main" data-testid="focus-main">
            {detached.output
              ? <DetachSlot className="output-slot" lang={lang} label={t(lang, 'panel.outputDetached')} onDock={() => dockPanel('output')} testId="dock-slot-output" />
              : outputNode(false)}

            {ws.drawerOpen && (
              <aside className="ws-drawer" id="worksheet-drawer" style={{ width: ws.drawerW }} data-testid="worksheet-drawer" aria-label={t(lang, 'panel.worksheet')}>
                <div
                  className="drawer-rz"
                  role="separator"
                  aria-orientation="vertical"
                  tabIndex={0}
                  aria-label={t(lang, 'drawer.resize')}
                  aria-valuenow={Math.round(ws.drawerW)}
                  data-testid="drawer-resize"
                  onPointerDown={beginDrawerDrag}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft') { event.preventDefault(); setWs((prev) => ({ ...prev, drawerW: clampDrawerW(prev.drawerW + 24, viewportW) })); }
                    if (event.key === 'ArrowRight') { event.preventDefault(); setWs((prev) => ({ ...prev, drawerW: clampDrawerW(prev.drawerW - 24, viewportW) })); }
                  }}
                />
                {detached.worksheet
                  ? <DetachSlot className="worksheet-slot" lang={lang} label={t(lang, 'panel.worksheetDetached')} onDock={() => dockPanel('worksheet')} testId="dock-slot-worksheet" />
                  : worksheetNode(false, 'drawer')}
              </aside>
            )}

            <button
              type="button"
              className="drawer-tab"
              onClick={() => setDrawerOpen(!ws.drawerOpen)}
              aria-expanded={ws.drawerOpen}
              aria-controls="worksheet-drawer"
              title={ws.drawerOpen ? t(lang, 'drawer.close') : t(lang, 'drawer.open')}
              data-testid="drawer-toggle"
            >
              <span className="drawer-tab-label">{t(lang, 'panel.worksheet')}</span>
              <span className="drawer-tab-chevron" aria-hidden>{ws.drawerOpen ? '›' : '‹'}</span>
            </button>
          </div>
        )}
      </div>

      {detached.navigator && (
        <FloatPanel
          lang={lang}
          panelId="navigator"
          title={t(lang, 'panel.navigator')}
          testId="float-navigator"
          rect={detached.navigator}
          onRect={(next) => movePanel('navigator', next)}
          onResize={(next) => resizePanel('navigator', next)}
          onDock={() => dockPanel('navigator')}
        >
          {navNode(true)}
        </FloatPanel>
      )}

      {detached.output && (
        <FloatPanel
          lang={lang}
          panelId="output"
          title={t(lang, 'panel.output')}
          testId="float-output"
          rect={detached.output}
          onRect={(next) => movePanel('output', next)}
          onResize={(next) => resizePanel('output', next)}
          onDock={() => dockPanel('output')}
        >
          {outputNode(true)}
        </FloatPanel>
      )}

      {detached.worksheet && (
        <FloatPanel
          lang={lang}
          panelId="worksheet"
          title={t(lang, 'panel.worksheet')}
          testId="float-worksheet"
          rect={detached.worksheet}
          onRect={(next) => movePanel('worksheet', next)}
          onResize={(next) => resizePanel('worksheet', next)}
          onDock={() => dockPanel('worksheet')}
        >
          {worksheetNode(true)}
        </FloatPanel>
      )}

      <footer className="statusbar">
        <span><b>{sheet.name}</b></span>
        <span>{t(lang, 'status.cell')} <b>{selectionText || cellLabel}</b></span>
        <span>{t(lang, 'status.cols', { n: sheet.columns.length })}</span>
        <span>{t(lang, 'status.last')} <b>{lastTitle}</b></span>
        <span className="spacer" />
        <span><i className="dot" />{autosaveLabel}{storageConflict ? ` · ${t(lang, 'status.otherTab')}` : ''}</span>
        <span>{statusBarLabel()}</span>
      </footer>

      {dialog && (
        <AnalysisDialog
          key={`${dialog.def.id}-${dialogNonce}`}
          def={dialog.def}
          lang={lang}
          sheet={sheet}
          initial={dialog.initial}
          onClose={() => { setDialog(null); dialogValues.current = null; }}
          onRun={(values) => execute(dialog.def, values)}
          onValuesChange={(values) => { dialogValues.current = values; }}
        />
      )}

      {renameTarget && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameTarget(null); }}>
          <div className="modal rename-modal" role="dialog" aria-modal="true" aria-label={t(lang, 'data.renameSheet')} data-testid="rename-dialog">
            <div className="modal-head">
              <div>
                <h3>{t(lang, 'data.renameSheet')}</h3>
                <div className="modal-sub">{t(lang, 'rename.current')}: {worksheets.find((w) => w.id === renameTarget.id)?.name ?? ''}</div>
              </div>
            </div>
            <div className="modal-body">
              <div className="slot">
                <span className="slot-label">{t(lang, 'rename.newName')}</span>
                <input
                  className="text-input"
                  autoFocus
                  value={renameTarget.draft}
                  onChange={(event) => setRenameTarget({ ...renameTarget, draft: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); commitRename(); }
                    if (event.key === 'Escape') setRenameTarget(null);
                  }}
                  data-testid="rename-input"
                />
              </div>
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={() => setRenameTarget(null)}>{t(lang, 'dlg.cancel')}</button>
              <button type="button" className="btn primary" onClick={commitRename} data-testid="rename-ok">{t(lang, 'dlg.ok')}</button>
            </div>
          </div>
        </div>
      )}

      {help && (
        <HelpModal
          lang={lang}
          initial={help}
          onClose={() => setHelp(null)}
          onOpenCenter={() => { setHelp(null); setHelpCenter({}); }}
          onOpenTutorials={() => { setHelp(null); setLibraryOpen(true); }}
        />
      )}

      {layoutEditorOpen && (
        <GraphLayoutEditor
          lang={lang}
          outputs={outputs}
          initial={figures[figures.length - 1] ?? null}
          onClose={() => setLayoutEditorOpen(false)}
          onSave={(doc) => {
            setFigures((prev) => [...prev.filter((figure) => figure.page.preset !== doc.page.preset || figure.panels.length !== doc.panels.length), doc]);
            pushTutorialEvent('layout-saved', {
              chartPanels: doc.panels.filter((panel) => panel.kind === 'chart').length,
              figureLabels: doc.panels.filter((panel) => panel.kind === 'figure-label').length,
            });
          }}
          onToast={toast}
          onExported={(format, dpi) => pushTutorialEvent('figure-exported', { format, dpi: dpi ?? null })}
        />
      )}

      {modelManagerOpen && (
        <ModelManager
          lang={lang}
          models={storedModels}
          worksheets={worksheets}
          activeSheetId={activeSheetId}
          onClose={() => setModelManagerOpen(false)}
          onRename={renameModel}
          onDuplicate={duplicateModel}
          onDelete={removeModel}
          onRefit={refitModel}
          onContour={contourFromModel}
          onSurface={surfaceFromModel}
          onOverlaid={overlaidFromModels}
          onOptimize={openOptimizer}
        />
      )}

      {optimizerModels && (
        <ResponseOptimizer
          lang={lang}
          models={optimizerModels}
          initial={optimizerTutorial}
          onResult={(payload) => {
            lastOptimizer.current = payload;
            pushTutorialEvent('optimizer-run', {
              status: payload.result.status,
              composite: payload.result.solutions[0]?.composite ?? null,
              result: payload.result,
              responses: payload.responses,
              factors: payload.factors,
              models: payload.models.map((model) => model.response.name),
            });
          }}
          onClose={() => { setOptimizerModels(null); setOptimizerTutorial(null); }}
          onInsert={insertOptimizerResult}
          onProfiler={openProfilerFromOptimizer}
        />
      )}

      {profilerState && (
        <PredictionProfiler
          lang={lang}
          models={profilerState.models}
          responses={profilerState.responses}
          factors={profilerState.factors}
          initialPoint={profilerState.point}
          onClose={() => setProfilerState(null)}
          onSave={saveProfilerCondition}
        />
      )}

      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={contextItems()}
          onClose={() => setCtx(null)}
          label={t(lang, 'ctx.title')}
        />
      )}

      {findOpen && (
        <FindReplacePanel
          lang={lang}
          sheet={sheet}
          onSelect={(cell) => selectCell(cell)}
          onReplaceAll={applyReplaceAll}
          onReplaceOne={applyReplaceOne}
          onClose={() => setFindOpen(false)}
          initialQuery={findSeed}
        />
      )}

      {colDialog && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setColDialog(null); }}>
          <div className="modal rename-modal" role="dialog" aria-modal="true" aria-label={t(lang, colDialog.kind === 'name' ? 'ctx.renameCol' : 'ctx.colDesc')} data-testid="col-dialog">
            <div className="modal-head">
              <div>
                <h3>{t(lang, colDialog.kind === 'name' ? 'ctx.renameCol' : 'ctx.colDesc')}</h3>
                <div className="modal-sub">{sheet.columns[colDialog.index]?.id} · {colDialog.draft.trim() || sheet.columns[colDialog.index]?.id}</div>
              </div>
              <span className="spacer" />
            </div>
            <div className="modal-body">
              <div className="slot">
                {colDialog.kind === 'name' ? (
                  <input
                    className="text-input"
                    autoFocus
                    value={colDialog.draft}
                    placeholder={sheet.columns[colDialog.index]?.id}
                    onChange={(event) => setColDialog({ ...colDialog, draft: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); commitColDialog(); }
                      if (event.key === 'Escape') setColDialog(null);
                    }}
                    data-testid="col-dialog-input"
                  />
                ) : (
                  <textarea
                    className="text-input col-desc-input"
                    rows={4}
                    autoFocus
                    value={colDialog.draft}
                    placeholder={t(lang, 'col.descPlaceholder')}
                    onChange={(event) => setColDialog({ ...colDialog, draft: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setColDialog(null);
                    }}
                    data-testid="col-dialog-input"
                  />
                )}
              </div>
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={() => setColDialog(null)}>{t(lang, 'dlg.cancel')}</button>
              <button type="button" className="btn primary" onClick={commitColDialog} data-testid="col-dialog-ok">{t(lang, 'dlg.ok')}</button>
            </div>
          </div>
        </div>
      )}

      {pendingImport && (
        <ImportDialog
          lang={lang}
          kind={pendingImport.kind}
          fileName={pendingImport.fileName}
          sheets={pendingImport.sheets}
          autoHeader={pendingImport.autoHeader}
          onCancel={() => setPendingImport(null)}
          onConfirm={confirmImport}
        />
      )}

      {sampleLibraryOpen && (
        <SampleLibrary
          lang={lang}
          initialSampleId={sampleLibraryInitial ?? undefined}
          onClose={() => { setSampleLibraryOpen(false); setSampleLibraryInitial(null); }}
          onLoadSample={(sampleId) => { setSampleLibraryOpen(false); loadSample(sampleId); }}
          onStartTutorial={(tutorialId) => { setSampleLibraryOpen(false); requestStartTutorial(tutorialId); }}
        />
      )}

      {helpCenter && (
        <HelpCenter
          lang={lang}
          initialHelpId={helpCenter.helpId}
          onClose={() => setHelpCenter(null)}
          onStartTutorial={(tutorialId) => { setHelpCenter(null); requestStartTutorial(tutorialId); }}
          onLoadSample={(sampleId) => { setHelpCenter(null); loadSample(sampleId); }}
          onOpenTutorials={() => { setHelpCenter(null); setLibraryOpen(true); }}
        />
      )}

      {libraryOpen && (
        <TutorialLibrary
          lang={lang}
          progressMap={progressMap}
          activeTutorialId={tutorialSession?.tutorialId ?? null}
          onClose={() => setLibraryOpen(false)}
          onStart={(tutorialId) => requestStartTutorial(tutorialId)}
          onResume={(tutorialId) => resumeTutorial(tutorialId)}
          onRestart={(tutorialId) => {
            if (practice && practice.tutorialId === tutorialId) restartCurrentTutorial(tutorialId);
            else requestStartTutorial(tutorialId);
          }}
          onOpenSample={(sampleId) => { setLibraryOpen(false); setSampleLibraryInitial(sampleId); setSampleLibraryOpen(true); }}
        />
      )}

      {tutorialSession && tutorialPanel !== 'closed' && tutorialSummaryData && (
        <TutorialRunner
          lang={lang}
          tutorialId={tutorialSession.tutorialId}
          progress={tutorialSession}
          outcomes={tutorialOutcomes}
          summary={tutorialSummaryData}
          completed={tutorialFinished}
          reviewing={reviewingTutorial}
          onShowSummary={() => setReviewingTutorial(false)}
          busy={tutorialBusy}
          message={tutorialMessage}
          practiceMode={practice?.mode ?? null}
          practiceSaved={Boolean(practiceSavedAt)}
          collapsed={tutorialPanel === 'collapsed'}
          storageWarning={tutorialStorageWarning}
          onAction={handleTutorialAction}
          onHelp={(helpId) => { setHelpCenter({ helpId }); pushTutorialEvent('help-opened', { helpId }); }}
          onManual={manualTutorialStep}
          onSkip={skipTutorialStep}
          onReopen={reopenTutorialStep}
          onPrev={() => moveTutorialStep(-1)}
          onNext={() => moveTutorialStep(1)}
          onValidate={() => handleTutorialAction({ action: 'validate-result' })}
          onSelectStep={selectTutorialStep}
          onRestart={() => restartCurrentTutorial(tutorialSession.tutorialId)}
          onReview={reviewTutorial}
          onSavePractice={() => savePracticeProject(false)}
          onExportPractice={() => savePracticeProject(true)}
          onNextTutorial={(tutorialId) => {
            if (practice) {
              if (!window.confirm(t(lang, 'tut.switchConfirm'))) return;
              onExitedTutorial();
              setTutorialMessage(t(lang, 'tut.pickNext', { name: t(lang, 'tut.library') }));
              void tutorialId;
              return;
            }
            requestStartTutorial(tutorialId);
          }}
          onExitPractice={() => setExitPrompt(true)}
          onClosePanel={() => { setTutorialPanel('closed'); setTutorialMessage(null); }}
          onToggleCollapse={() => setTutorialPanel((prev) => (prev === 'open' ? 'collapsed' : 'open'))}
          onOpenLibrary={() => setLibraryOpen(true)}
        />
      )}

      {startPrompt && (() => {
        const tutorial = findTutorial(startPrompt.tutorialId);
        if (!tutorial) return null;
        return (
          <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setStartPrompt(null); }}>
            <div className="modal narrow" role="dialog" aria-modal="true" aria-label={t(lang, 'tut.startTitle')} data-testid="tutorial-start-dialog">
              <div className="modal-head">
                <div>
                  <h3>{t(lang, 'tut.startTitle')}</h3>
                  <div className="modal-sub">{tutorialText(lang, tutorial.titleKey)} · {tutorial.estimatedMinutes} {t(lang, 'tut.minutes')}</div>
                </div>
              </div>
              <div className="modal-body">
                <p className="tut-start-desc">{t(lang, 'tut.startSub')}</p>
                <div className="tut-start-option">
                  <h4>{t(lang, 'tut.startIsolated')}</h4>
                  <p>{t(lang, 'tut.startIsolatedNote')}</p>
                  <button type="button" className="btn primary" onClick={() => { void beginTutorial(tutorial.id, false); }} data-testid="tutorial-start-isolated">
                    {t(lang, 'tut.startIsolatedAction')}
                  </button>
                </div>
                <div className="tut-start-option warn">
                  <h4>{t(lang, 'tut.startCurrent')}</h4>
                  <p>{t(lang, 'tut.startCurrentNote')}</p>
                  <button
                    type="button"
                    className="btn"
                    data-testid="tutorial-start-current"
                    onClick={() => {
                      if (!window.confirm(t(lang, 'tut.useCurrentConfirm'))) return;
                      void beginTutorial(tutorial.id, true);
                    }}
                  >
                    {t(lang, 'tut.startCurrentAction')}
                  </button>
                </div>
                {tutorialMessage && <p className="tut-warning" role="status">{tutorialMessage}</p>}
              </div>
              <div className="modal-foot">
                <span className="spacer" />
                <button type="button" className="btn ghost" onClick={() => setStartPrompt(null)}>{t(lang, 'dlg.cancel')}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {backupPrompt && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setBackupPrompt(null); }}>
          <div className="modal narrow" role="dialog" aria-modal="true" aria-label={t(lang, 'tut.backupTitle')} data-testid="tutorial-backup-dialog">
            <div className="modal-head">
              <div>
                <h3>{t(lang, 'tut.backupTitle')}</h3>
                <div className="modal-sub">{t(lang, 'tut.backupSub')}</div>
              </div>
            </div>
            <div className="modal-body">
              <p className="tut-warning" data-testid="tutorial-backup-warning">{t(lang, 'tut.backupBody')}</p>
              <div className="tut-start-option">
                <h4>{t(lang, 'tut.backupDownload')}</h4>
                <p>{t(lang, 'tut.backupDownloadNote')}</p>
                <button
                  type="button"
                  className="btn primary"
                  data-testid="tutorial-backup-download"
                  onClick={() => {
                    const pending = backupPrompt;
                    downloadFile(projectFileName(), pending.json, 'application/json');
                    setBackupPrompt(null);
                    if (pending.resumeSessionId) void resumeTutorial(pending.tutorialId, true);
                    else void beginTutorial(pending.tutorialId, pending.useCurrent, true);
                  }}
                >
                  {t(lang, 'tut.backupDownloadAction')}
                </button>
              </div>
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={() => setBackupPrompt(null)} data-testid="tutorial-backup-cancel">{t(lang, 'dlg.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {autosavePrompt && !practice && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setAutosavePrompt(false); }}>
          <div className="modal narrow" role="dialog" aria-modal="true" aria-label={t(lang, 'status.autosaveFailedTitle')} data-testid="autosave-failed-dialog">
            <div className="modal-head">
              <div>
                <h3>{t(lang, 'status.autosaveFailedTitle')}</h3>
                <div className="modal-sub">{autosave === 'quota' ? t(lang, 'status.quotaFull') : autosave === 'unavailable' ? t(lang, 'status.storageBlocked') : t(lang, 'status.saveFailed')}</div>
              </div>
            </div>
            <div className="modal-body">
              <p className="tut-warning">{t(lang, 'status.autosaveFailedBody')}</p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => { void runAutosave(); }} data-testid="autosave-failed-retry">{t(lang, 'status.retry')}</button>
              <button type="button" className="btn" onClick={() => { saveProject(); setAutosavePrompt(false); }} data-testid="autosave-failed-export">{t(lang, 'tut.exportProject')}</button>
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={() => setAutosavePrompt(false)} data-testid="autosave-failed-dismiss">{t(lang, 'status.dismissSave')}</button>
            </div>
          </div>
        </div>
      )}

      {practiceSaveFailure && practice && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setPracticeSaveFailure(null); }}>
          <div className="modal narrow" role="dialog" aria-modal="true" aria-label={t(lang, 'tut.saveFailedTitle')} data-testid="practice-save-failed-dialog">
            <div className="modal-head">
              <div>
                <h3>{t(lang, 'tut.saveFailedTitle')}</h3>
                <div className="modal-sub">{t(lang, 'tut.saveFailedSub')}</div>
              </div>
            </div>
            <div className="modal-body">
              <p className="tut-warning">{t(lang, 'tut.saveFailedBody')}</p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn primary" onClick={keepPractice} data-testid="practice-save-retry">{t(lang, 'tut.retrySave')}</button>
              <button type="button" className="btn" onClick={exportFailedPractice} data-testid="practice-save-export">{t(lang, 'tut.exportPractice')}</button>
              <button type="button" className="btn ghost danger" onClick={discardPractice} data-testid="practice-save-discard">{t(lang, 'tut.discardPractice')}</button>
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={() => setPracticeSaveFailure(null)} data-testid="practice-save-cancel">{t(lang, 'dlg.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {exitPrompt && tutorialSession && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setExitPrompt(false); }}>
          <div className="modal narrow" role="dialog" aria-modal="true" aria-label={t(lang, 'tut.exitTitle')} data-testid="tutorial-exit-dialog">
            <div className="modal-head">
              <div>
                <h3>{t(lang, 'tut.exitTitle')}</h3>
                <div className="modal-sub">{t(lang, 'tut.exitSub')}</div>
              </div>
            </div>
            <div className="modal-body tut-exit-body">
              <div className="tut-start-option">
                <h4>{t(lang, 'tut.saveProject')}</h4>
                <p>{t(lang, 'tut.savePracticeNote')}</p>
                <button type="button" className="btn" onClick={() => savePracticeProject(false)} data-testid="tutorial-exit-save">{t(lang, 'tut.savePractice')}</button>
              </div>
              <div className="tut-start-option">
                <h4>{t(lang, 'tut.exportProject')}</h4>
                <p>{t(lang, 'tut.exportPracticeNote')}</p>
                <button type="button" className="btn" onClick={() => savePracticeProject(true)} data-testid="tutorial-exit-export">{t(lang, 'tut.exportPractice')}</button>
              </div>
              <div className="tut-start-option">
                <h4>{practice?.mode === 'current' ? t(lang, 'tut.keepCurrent') : t(lang, 'tut.keepPractice')}</h4>
                <p>{practice?.mode === 'current' ? t(lang, 'tut.keepCurrentNote') : t(lang, 'tut.keepPracticeNote')}</p>
                <button type="button" className="btn" onClick={keepPractice} data-testid="tutorial-exit-keep">{practice?.mode === 'current' ? t(lang, 'tut.keepCurrentAction') : t(lang, 'tut.keepPracticeAction')}</button>
              </div>
              <div className="tut-start-option warn">
                <h4>{t(lang, 'tut.discardPractice')}</h4>
                <p>{t(lang, 'tut.discardNote')}</p>
                <button type="button" className="btn" onClick={discardPractice} data-testid="tutorial-exit-discard">{t(lang, 'tut.discardAction')}</button>
              </div>
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={() => setExitPrompt(false)}>{t(lang, 'dlg.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-wrap">
        {toasts.map((item) => <div className="toast" key={item.id}>{item.text}</div>)}
      </div>
    </div>
  );
}
