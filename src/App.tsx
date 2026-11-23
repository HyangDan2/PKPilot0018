import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisMeta, Column, Lang, OutputDoc, Settings, Theme, Worksheet } from './types';
import { Brand, HeaderActions } from './components/Header';
import { MenuBar, type MenuAction } from './components/MenuBar';
import { FloatPanel } from './components/FloatPanel';
import { Toolbar } from './components/Toolbar';
import { Navigator } from './components/Navigator';
import { OutputPanel } from './components/OutputPanel';
import { WorksheetGrid, type GridCell, type GridRange } from './components/WorksheetGrid';
import { AnalysisDialog } from './components/AnalysisDialog';
import { HelpModal } from './components/HelpModal';
import { ImportDialog, type PreviewSheet } from './components/ImportDialog';
import { ANALYSES, defaultValues as defaultDialogValues, findAnalysis, type AnalysisDef, type RunResult } from './lib/analyses';
import { DATASETS, emptyWorksheet } from './lib/datasets';
import { loadAutosave, saveAutosave } from './lib/db';
import { fmtInt } from './lib/format';
import { t } from './lib/i18n';
import {
  DEFAULT_FLOAT_SIZES,
  DEFAULT_NAV,
  DEFAULT_OUTPUT,
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
import { IconDetach } from './components/Icons';
import {
  PROJECT_ACCEPT,
  csvToWorksheet,
  downloadBlob,
  downloadFile,
  looksLikeMinitabBinary,
  makeOutputId,
  newColumnId,
  parseCsv,
  parseNumberCell,
  parseProject,
  pickFile,
  projectFileName,
  serializeProject,
  worksheetToCsv,
} from './lib/project';
import { XLSX_ACCEPT, readXlsxRows, workbookToWorksheets, writeXlsx, xlsxFileName } from './lib/xlsx';

const SETTINGS_KEY = 'sigrun.settings.v1';
const FLOAT_SIZES_KEY = 'sigrun.floatSizes.v1';
const ENGINE_VERSION = 'sigrun-1.2';

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
  const [selection, setSelection] = useState<GridCell>({ row: 0, col: 0 });
  const [range, setRange] = useState<GridRange>({ r0: 0, c0: 0, r1: 0, c1: 0 });
  const [focusedOutput, setFocusedOutput] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [navW, setNavW] = useState(DEFAULT_NAV);
  const [outputH, setOutputH] = useState(DEFAULT_OUTPUT);
  const [navHidden, setNavHidden] = useState(false);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPresetId>('balanced');
  const [detached, setDetached] = useState<Record<PanelId, FloatRect | null>>({ navigator: null, output: null, worksheet: null });
  const [floatSizes, setFloatSizes] = useState<FloatSizes>(readFloatSizes);
  const [mobileTab, setMobileTab] = useState<'output' | 'worksheet'>('output');
  const [navOpen, setNavOpen] = useState(false);
  const [autosave, setAutosave] = useState<'saved' | 'saving'>('saved');
  const [hydrated, setHydrated] = useState(false);
  const [, forceHistory] = useState(0);

  const past = useRef<HistorySnapshot[]>([]);
  const future = useRef<HistorySnapshot[]>([]);
  const sheet = worksheets.find((w) => w.id === activeSheetId) ?? worksheets[0];
  const lang = settings.lang;

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
        if (cancelled || !saved || !Array.isArray(saved.worksheets) || !saved.worksheets.length) return;
        setWorksheets(saved.worksheets);
        setActiveSheetId(saved.activeSheetId || saved.worksheets[0].id);
        if (Array.isArray(saved.outputs)) setOutputs(saved.outputs);
        if (saved.settings) setSettings({ theme: saved.settings.theme === 'dark' ? 'dark' : 'light', lang: saved.settings.lang === 'ko' ? 'ko' : 'en' });
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

  useEffect(() => {
    try {
      localStorage.setItem(FLOAT_SIZES_KEY, JSON.stringify(floatSizes));
    } catch {
      /* ignore */
    }
  }, [floatSizes]);

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

  useEffect(() => {
    if (!hydrated) return;
    setAutosave('saving');
    const timer = setTimeout(() => {
      saveAutosave({ worksheets, activeSheetId, outputs, settings, savedAt: new Date().toISOString() })
        .then(() => setAutosave('saved'))
        .catch(() => setAutosave('saved'));
    }, 700);
    return () => clearTimeout(timer);
  }, [worksheets, activeSheetId, outputs, settings, hydrated]);

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
    setSelection({ row: 0, col: 0 });
    setRange({ r0: 0, c0: 0, r1: 0, c1: 0 });
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

  const addColumn = () => {
    mutateActiveSheet((ws) => {
      const rows = Math.max(30, ...ws.columns.map((c) => c.values.length));
      const id = newColumnId(ws);
      return { ...ws, columns: [...ws.columns, { id, name: '', type: 'numeric' as const, values: Array.from({ length: rows }, () => null) }] };
    });
    toast(t(lang, 'toast.columnAdded'));
  };

  const clearRange = (target: GridRange) => {
    const r0 = Math.min(target.r0, target.r1);
    const r1 = Math.max(target.r0, target.r1);
    const c0 = Math.min(target.c0, target.c1);
    const c1 = Math.max(target.c0, target.c1);
    mutateActiveSheet((ws) => ({
      ...ws,
      columns: ws.columns.map((c, index) => {
        if (index < c0 || index > c1) return c;
        const values = pad(c.values, r1 + 1);
        for (let r = r0; r <= r1; r += 1) values[r] = null;
        return { ...c, values };
      }),
    }));
    toast(t(lang, 'toast.cleared'));
  };

  /**
   * Paste through the RFC-4180 parser, so quoted commas ("1,200"), quoted line
   * breaks and tab/semicolon separated blocks all land in the right cells.
   */
  const pasteCells = (row: number, col: number, text: string) => {
    const rows = parseCsv(text);
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.length));
    mutateActiveSheet((ws) => {
      const columns = ws.columns.map((c) => ({ ...c, values: [...c.values] }));
      const needed = col + width - columns.length;
      for (let i = 0; i < needed; i += 1) {
        const nextIndex = columns.length - col;
        const probe = rows.map((r) => (r[nextIndex] ?? '').trim()).filter((v) => v !== '');
        const numeric = probe.length > 0 && probe.every((v) => parseNumberCell(v) !== null);
        columns.push({ id: newColumnId({ ...ws, columns }), name: '', type: numeric ? 'numeric' : 'text', values: [] });
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
      return { ...ws, columns };
    });
    toast(t(lang, 'toast.pasted'));
  };

  const copyRange = async () => {
    const r0 = Math.min(range.r0, range.r1);
    const r1 = Math.max(range.r0, range.r1);
    const c0 = Math.min(range.c0, range.c1);
    const c1 = Math.max(range.c0, range.c1);
    const lines: string[] = [];
    for (let r = r0; r <= r1; r += 1) {
      const cells: string[] = [];
      for (let c = c0; c <= c1; c += 1) {
        const value = sheet.columns[c]?.values[r];
        cells.push(value === null || value === undefined ? '' : String(value));
      }
      lines.push(cells.join('\t'));
    }
    const text = lines.join('\n');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unsupported');
      await navigator.clipboard.writeText(text);
      toast(t(lang, 'toast.copied'));
    } catch {
      // Report the real outcome: a silent failure must not look like success.
      toast(t(lang, legacyCopy(text) ? 'toast.copied' : 'toast.copyFailed'));
    }
  };

  const insertRow = () => {
    mutateActiveSheet((ws) => ({
      ...ws,
      columns: ws.columns.map((c) => {
        const values = pad(c.values, selection.row + 1);
        values.splice(selection.row, 0, null);
        return { ...c, values };
      }),
    }));
    toast(t(lang, 'toast.rowInserted'));
  };

  const deleteRow = () => {
    mutateActiveSheet((ws) => ({
      ...ws,
      columns: ws.columns.map((c) => {
        const values = pad(c.values, Math.max(30, selection.row + 1)).slice();
        values.splice(selection.row, 1);
        return { ...c, values };
      }),
    }));
    toast(t(lang, 'toast.rowDeleted'));
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
    setSelection({ row: 0, col: 0 });
    setRange({ r0: 0, c0: 0, r1: 0, c1: 0 });
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
      setSelection({ row: 0, col: 0 });
      setRange({ r0: 0, c0: 0, r1: 0, c1: 0 });
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

  const focusDoc = (doc: OutputDoc) => {
    setOutputs((prev) => [...prev, doc]);
    setFocusedOutput(doc.id);
    if (window.matchMedia('(max-width: 1023px)').matches) setMobileTab('output');
    setTimeout(() => document.getElementById(`card-${doc.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  };

  const errorText = (error: unknown): string => {
    const message = error instanceof Error ? error.message : 'dlg.error';
    return message.includes('.') ? t(lang, message) : message;
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
      const doc = makeDoc(def, result, buildMeta(def, values, sheet));
      focusDoc(doc);
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
      const doc = makeDoc(def, result, { ...meta, ranAt: Date.now() });
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
  };

  const rerun = useCallback(() => {
    if (!lastDialog) return;
    const def = findAnalysis(lastDialog.analysisId);
    if (!def) return;
    setDialog({ def, initial: { ...lastDialog.values } });
  }, [lastDialog]);

  const loadSample = (id: string) => {
    const def = DATASETS.find((ds) => ds.id === id);
    if (!def) return;
    addSheet(def.build());
  };

  /* ── files ─────────────────────────────────────────────────────────── */

  const saveProject = () => {
    downloadFile(
      projectFileName(),
      serializeProject({ worksheets, activeSheetId, settings, outputs }),
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
      past.current = [];
      future.current = [];
      toast(t(lang, 'file.loaded'));
    } catch {
      toast(t(lang, 'file.error'));
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
      setSelection({ row: 0, col: 0 });
      setRange({ r0: 0, c0: 0, r1: 0, c1: 0 });
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
    setOutputs((prev) => prev.map((o) => (o.id === id ? { ...o, blocks } : o)));
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

  const beginNavDrag = (event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).focus();
    event.preventDefault();
    const startX = event.clientX;
    const startW = navW;
    const move = (e: PointerEvent) => setNavW(Math.min(430, Math.max(180, startW + e.clientX - startX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
  };

  const beginOutputDrag = (event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).focus();
    event.preventDefault();
    const container = (event.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      setOutputH(Math.min(82, Math.max(18, pct)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'row-resize';
  };

  /* ── layout presets & detached panels ─────────────────────────────── */

  const applyLayout = (id: LayoutPresetId) => {
    const preset = findPreset(id);
    setNavW(clampNav(preset.navWidth));
    setOutputH(clampOutput(preset.outputHeight));
    setNavHidden(preset.navHidden);
    setLayoutPreset(preset.id);
    toast(t(lang, 'toast.layout', { name: t(lang, preset.labelKey) }));
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
      case 'copy': void copyRange(); break;
      case 'paste': void navigator.clipboard?.readText?.().then((text) => text && pasteCells(selection.row, selection.col, text)).catch(() => toast(t(lang, 'toast.pasteFailed'))); break;
      case 'clear': clearRange(range); break;
      case 'insertRow': insertRow(); break;
      case 'deleteRow': deleteRow(); break;
      case 'addColumn': addColumn(); break;
      case 'newSheet': addSheet(); break;
      case 'renameSheet': setRenameTarget({ id: sheet.id, draft: sheet.name }); break;
      case 'deleteSheet': deleteSheet(activeSheetId); break;
      case 'help': setHelp('help'); break;
      case 'about': setHelp('about'); break;
      case 'theme': setSettings((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' })); break;
      case 'langKo': setSettings((prev) => ({ ...prev, lang: 'ko' })); break;
      case 'langEn': setSettings((prev) => ({ ...prev, lang: 'en' })); break;
      case 'resetLayout': applyLayout('balanced'); break;
      case 'toggleNav': setNavHidden((value) => !value); break;
      case 'layoutBalanced': applyLayout('balanced'); break;
      case 'layoutSheet': applyLayout('sheet'); break;
      case 'layoutResults': applyLayout('results'); break;
      case 'layoutFocus': applyLayout('focus'); break;
      default: break;
    }
  };

  const setTheme = (theme: Theme) => setSettings((prev) => ({ ...prev, theme }));
  const setLang = (next: Lang) => setSettings((prev) => ({ ...prev, lang: next }));

  const lastTitle = lastDialog ? t(lang, (ANALYSES.find((a) => a.id === lastDialog.analysisId)?.titleKey ?? 'status.none')) : t(lang, 'status.none');
  const cellLabel = `${sheet.columns[selection.col]?.id ?? '—'}:${selection.row + 1}`;

  const commitRename = () => {
    if (!renameTarget) return;
    if (renameSheet(renameTarget.id, renameTarget.draft)) setRenameTarget(null);
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
      onSelectSheet={(id) => { setActiveSheetId(id); setSelection({ row: 0, col: 0 }); setRange({ r0: 0, c0: 0, r1: 0, c1: 0 }); setMobileTab('worksheet'); setNavOpen(false); }}
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
        onToast={toast}
        onRerun={rerunWithOptions}
        onReproduce={reproduce}
        onUpdateBlocks={updateOutputBlocks}
      />
    </section>
  );

  const worksheetNode = (floating: boolean) => (
    <section className={`panel worksheet-panel${floating ? ' floating' : ''}`} data-hidden={floating ? false : mobileTab !== 'worksheet'}>
      <div className="panel-head">
        {!floating && <span className="panel-title">{t(lang, 'panel.worksheet')}</span>}
        <span className="panel-count">
          {fmtInt(rowCount(sheet))} × {sheet.columns.length}
        </span>
        <span className="spacer" />
        <span className="grid-hint">{t(lang, 'hint.grid')}</span>
        {!floating && (
          <button type="button" className="detach-btn" onClick={() => detachPanel('worksheet')} title={t(lang, 'panel.detach')} aria-label={t(lang, 'panel.detach')} data-testid="detach-worksheet">
            <IconDetach size={14} />
          </button>
        )}
      </div>
      <WorksheetGrid
        lang={lang}
        sheet={sheet}
        selection={selection}
        range={range}
        onSelect={(cell, extend) => {
          setSelection(cell);
          setRange((prev) => (extend ? { ...prev, r1: cell.row, c1: cell.col } : { r0: cell.row, c0: cell.col, r1: cell.row, c1: cell.col }));
        }}
        onEdit={editCell}
        onPaste={pasteCells}
        onCopy={() => void copyRange()}
        onClear={clearRange}
        onAddColumn={addColumn}
        onRenameColumn={renameColumn}
      />
      <div className="ws-tabs">
        {worksheets.map((ws) => (
          <button
            key={ws.id}
            type="button"
            className={`ws-tab${ws.id === sheet.id ? ' current' : ''}`}
            onClick={() => setActiveSheetId(ws.id)}
            onDoubleClick={() => setRenameTarget({ id: ws.id, draft: ws.name })}
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

  return (
    <div className="app">
      <MenuBar
        lang={lang}
        canUndo={past.current.length > 0}
        canRedo={future.current.length > 0}
        navVisible={!navHidden}
        layoutPreset={layoutPreset}
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
        onSample={loadSample}
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

      <div className="workspace" style={{ '--nav-w': `${navW}px` } as React.CSSProperties}>
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
            aria-valuenow={Math.round(navW)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') { event.preventDefault(); setNavW((w) => clampNav(w - 24)); }
              if (event.key === 'ArrowRight') { event.preventDefault(); setNavW((w) => clampNav(w + 24)); }
            }}
          />
        )}

        <div className="main-panels" style={{ '--output-h': `${outputH}%` } as React.CSSProperties} data-testid="main-panels">
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
              aria-valuenow={Math.round(outputH)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp') { event.preventDefault(); setOutputH((h) => clampOutput(h + 4)); }
                if (event.key === 'ArrowDown') { event.preventDefault(); setOutputH((h) => clampOutput(h - 4)); }
              }}
            />
          )}

          {detached.worksheet
            ? <DetachSlot className="worksheet-slot" lang={lang} label={t(lang, 'panel.worksheetDetached')} onDock={() => dockPanel('worksheet')} testId="dock-slot-worksheet" />
            : worksheetNode(false)}
        </div>
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
        <span>{t(lang, 'status.cell')} <b>{cellLabel}</b></span>
        <span>{t(lang, 'status.cols', { n: sheet.columns.length })}</span>
        <span>{t(lang, 'status.last')} <b>{lastTitle}</b></span>
        <span className="spacer" />
        <span><i className="dot" />{autosave === 'saving' ? t(lang, 'status.saving') : t(lang, 'status.autosave')}</span>
        <span>HD2LAB · SIGRÚN · PHASE 1</span>
      </footer>

      {dialog && (
        <AnalysisDialog
          def={dialog.def}
          lang={lang}
          sheet={sheet}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onRun={(values) => execute(dialog.def, values)}
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

      {help && <HelpModal lang={lang} initial={help} onClose={() => setHelp(null)} />}

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

      <div className="toast-wrap">
        {toasts.map((item) => <div className="toast" key={item.id}>{item.text}</div>)}
      </div>
    </div>
  );
}
