import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lang, OutputDoc, Settings, Theme, Worksheet } from './types';
import { Header } from './components/Header';
import { MenuBar, type MenuAction } from './components/MenuBar';
import { Toolbar } from './components/Toolbar';
import { Navigator } from './components/Navigator';
import { OutputPanel } from './components/OutputPanel';
import { WorksheetGrid, type GridCell, type GridRange } from './components/WorksheetGrid';
import { AnalysisDialog } from './components/AnalysisDialog';
import { HelpModal } from './components/HelpModal';
import { ANALYSES, findAnalysis, type AnalysisDef } from './lib/analyses';
import { DATASETS, emptyWorksheet } from './lib/datasets';
import { loadAutosave, saveAutosave } from './lib/db';
import { fmtInt } from './lib/format';
import { t } from './lib/i18n';
import { csvToWorksheet, downloadFile, makeOutputId, newColumnId, parseProject, pickFile, serializeProject, worksheetToCsv } from './lib/project';

const SETTINGS_KEY = 'sigrun.settings.v1';
const DEFAULT_NAV = 254;
const DEFAULT_OUTPUT = 52;

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
  const [selection, setSelection] = useState<GridCell>({ row: 0, col: 0 });
  const [range, setRange] = useState<GridRange>({ r0: 0, c0: 0, r1: 0, c1: 0 });
  const [focusedOutput, setFocusedOutput] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [navW, setNavW] = useState(DEFAULT_NAV);
  const [outputH, setOutputH] = useState(DEFAULT_OUTPUT);
  const [mobileTab, setMobileTab] = useState<'output' | 'worksheet'>('output');
  const [navOpen, setNavOpen] = useState(false);
  const [autosave, setAutosave] = useState<'saved' | 'saving'>('saved');
  const [hydrated, setHydrated] = useState(false);
  const [, forceHistory] = useState(0);

  const past = useRef<Worksheet[][]>([]);
  const future = useRef<Worksheet[][]>([]);
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
    if (!hydrated) return;
    setAutosave('saving');
    const timer = setTimeout(() => {
      saveAutosave({ worksheets, activeSheetId, outputs, settings, savedAt: new Date().toISOString() })
        .then(() => setAutosave('saved'))
        .catch(() => setAutosave('saved'));
    }, 700);
    return () => clearTimeout(timer);
  }, [worksheets, activeSheetId, outputs, settings, hydrated]);

  /* ── worksheet mutations ───────────────────────────────────────────── */

  const applySheets = useCallback((fn: (list: Worksheet[]) => Worksheet[], record = true) => {
    const next = fn(worksheets);
    if (next === worksheets) return;
    if (record) {
      past.current = [...past.current.slice(-49), worksheets];
      future.current = [];
    }
    setWorksheets(next);
    forceHistory((v) => v + 1);
  }, [worksheets]);

  const mutateActiveSheet = useCallback((fn: (ws: Worksheet) => Worksheet, record = true) => {
    applySheets((list) => list.map((ws) => (ws.id === activeSheetId ? fn(ws) : ws)), record);
  }, [applySheets, activeSheetId]);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) {
      toast(t(lang, 'toast.nothingToUndo'));
      return;
    }
    future.current = [worksheets, ...future.current].slice(0, 50);
    setWorksheets(previous);
    forceHistory((v) => v + 1);
  }, [worksheets, toast, lang]);

  const redo = useCallback(() => {
    const next = future.current.shift();
    if (!next) {
      toast(t(lang, 'toast.nothingToRedo'));
      return;
    }
    past.current = [...past.current.slice(-49), worksheets];
    setWorksheets(next);
    forceHistory((v) => v + 1);
  }, [worksheets, toast, lang]);

  function pad(values: (number | string | null)[], length: number): (number | string | null)[] {
    return Array.from({ length: Math.max(values.length, length) }, (_, i) => values[i] ?? null);
  }

  const editCell = (row: number, col: number, raw: string) => {
    const column = sheet.columns[col];
    if (!column) return;
    const trimmed = raw.trim();
    const value: number | string | null = trimmed === '' ? null : column.type === 'numeric' && isFinite(Number(trimmed)) ? Number(trimmed) : raw;
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

  const renameColumn = (col: number, name: string) => {
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

  const pasteCells = (row: number, col: number, text: string) => {
    const lines = text.replace(/\r/g, '').split('\n').filter((line, index, all) => line.length > 0 || index < all.length - 1);
    const rows = lines.map((line) => line.split('\t').length > 1 ? line.split('\t') : line.split(','));
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.length));
    mutateActiveSheet((ws) => {
      const columns = ws.columns.map((c) => ({ ...c }));
      const needed = col + width - columns.length;
      for (let i = 0; i < needed; i += 1) {
        const id = `C${columns.length + 1}`;
        const probe = rows.map((r) => (r[columns.length - col] ?? '').trim()).filter((v) => v !== '');
        const numeric = probe.length > 0 && probe.every((v) => isFinite(Number(v)));
        columns.push({ id, name: '', type: numeric ? 'numeric' : 'text', values: [] });
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
          target.values[row + r] = target.type !== 'text' && isFinite(Number(trimmed)) ? Number(trimmed) : cell;
        });
      });
      return { ...ws, columns };
    });
    toast(t(lang, 'toast.pasted'));
  };

  const copyRange = () => {
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
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast(t(lang, 'toast.copied'))).catch(() => toast(t(lang, 'toast.copied')));
    else toast(t(lang, 'toast.copied'));
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

  const addSheet = (ws?: Worksheet) => {
    setWorksheets((prev) => {
      const base = ws ?? emptyWorksheet(prev.length + 1);
      const names = new Set(prev.map((w) => w.name));
      let name = base.name;
      let i = 2;
      while (names.has(name)) {
        name = `${base.name} (${i})`;
        i += 1;
      }
      const created = { ...base, name };
      setTimeout(() => setActiveSheetId(created.id), 0);
      return [...prev, created];
    });
    toast(t(lang, 'toast.sheetAdded'));
  };

  const renameSheet = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setWorksheets((prev) => prev.map((ws) => (ws.id === id ? { ...ws, name: trimmed } : ws)));
  };

  const deleteSheet = (id: string) => {
    setWorksheets((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((ws) => ws.id !== id);
      if (activeSheetId === id) setActiveSheetId(next[0].id);
      return next;
    });
    toast(t(lang, 'toast.sheetDeleted'));
  };

  /* ── analyses ──────────────────────────────────────────────────────── */

  const execute = (def: AnalysisDef, values: Record<string, unknown>): string | null => {
    try {
      const result = def.run({ lang, sheet, values });
      if (result.sheetPatch) {
        const patch = result.sheetPatch;
        applySheets((list) => list.map((ws) => (ws.id === sheet.id ? patch : ws)));
      }
      if (result.newSheet) {
        const created = result.newSheet;
        setWorksheets((prev) => [...prev, created]);
        setActiveSheetId(created.id);
      }
      const doc: OutputDoc = {
        id: makeOutputId(),
        titleKey: def.titleKey,
        subtitle: result.subtitle,
        createdAt: Date.now(),
        collapsed: false,
        blocks: result.blocks,
        dialog: { analysisId: def.id, values },
        sheetId: sheet.id,
      };
      setOutputs((prev) => [...prev, doc]);
      setLastDialog({ analysisId: def.id, values });
      setFocusedOutput(doc.id);
      setDialog(null);
      if (result.toastKey) toast(t(lang, result.toastKey, result.toastVars));
      if (window.matchMedia('(max-width: 1023px)').matches) setMobileTab('output');
      setTimeout(() => document.getElementById(`card-${doc.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'dlg.error';
      return message.includes('.') ? t(lang, message) : message;
    }
  };

  const openAnalysis = (id: string) => {
    const def = findAnalysis(id);
    if (!def) return;
    setDialog({ def });
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
      `sigrun-${new Date().toISOString().slice(0, 10)}.mpx.json`,
      serializeProject({ worksheets, activeSheetId, settings, outputs }),
      'application/json',
    );
    toast(t(lang, 'file.saved'));
  };

  const openProject = async () => {
    const file = await pickFile('.json,.mpx,.mpx.json,application/json');
    if (!file) return;
    try {
      const text = await file.text();
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
      const ws = csvToWorksheet(text, file.name.replace(/\.[^.]+$/, ''));
      addSheet(ws);
    } catch {
      toast(t(lang, 'file.error'));
    }
  };

  const exportCsv = () => {
    downloadFile(`${sheet.name.replace(/\s+/g, '-')}.csv`, worksheetToCsv(sheet), 'text/csv;charset=utf-8');
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerun, undo, redo, lang, worksheets, activeSheetId, outputs, settings]);

  /* ── drag splitters ────────────────────────────────────────────────── */

  const beginNavDrag = (event: React.PointerEvent) => {
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

  /* ── menu actions ──────────────────────────────────────────────────── */

  const onAction = (action: MenuAction) => {
    switch (action) {
      case 'new': newProject(); break;
      case 'save': saveProject(); break;
      case 'open': void openProject(); break;
      case 'importCsv': void importCsv(); break;
      case 'exportCsv': exportCsv(); break;
      case 'print': window.print(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'copy': copyRange(); break;
      case 'paste': void navigator.clipboard?.readText?.().then((text) => text && pasteCells(selection.row, selection.col, text)).catch(() => toast(t(lang, 'file.error'))); break;
      case 'clear': clearRange(range); break;
      case 'insertRow': insertRow(); break;
      case 'deleteRow': deleteRow(); break;
      case 'addColumn': addColumn(); break;
      case 'newSheet': addSheet(); break;
      case 'renameSheet': toast(t(lang, 'nav.rename') + ': ' + sheet.name); break;
      case 'deleteSheet': deleteSheet(activeSheetId); break;
      case 'help': setHelp('help'); break;
      case 'about': setHelp('about'); break;
      case 'theme': setSettings((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' })); break;
      case 'langKo': setSettings((prev) => ({ ...prev, lang: 'ko' })); break;
      case 'langEn': setSettings((prev) => ({ ...prev, lang: 'en' })); break;
      case 'resetLayout': setNavW(DEFAULT_NAV); setOutputH(DEFAULT_OUTPUT); break;
      default: break;
    }
  };

  const setTheme = (theme: Theme) => setSettings((prev) => ({ ...prev, theme }));
  const setLang = (next: Lang) => setSettings((prev) => ({ ...prev, lang: next }));

  const lastTitle = lastDialog ? t(lang, (ANALYSES.find((a) => a.id === lastDialog.analysisId)?.titleKey ?? 'status.none')) : t(lang, 'status.none');
  const cellLabel = `${sheet.columns[selection.col]?.id ?? '—'}:${selection.row + 1}`;

  return (
    <div className="app">
      <Header
        settings={settings}
        onToggleTheme={() => setTheme(settings.theme === 'dark' ? 'light' : 'dark')}
        onLang={setLang}
        onHelp={() => setHelp('help')}
        onSaveProject={saveProject}
        onOpenProject={() => void openProject()}
        onNewSheet={() => addSheet()}
        onResetLayout={() => onAction('resetLayout')}
      />

      <MenuBar
        lang={lang}
        canUndo={past.current.length > 0}
        canRedo={future.current.length > 0}
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
        <Navigator
          lang={lang}
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
          onClose={() => setNavOpen(false)}
        />
        {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
        <div className="splitter" onPointerDown={beginNavDrag} role="separator" aria-orientation="vertical" />

        <div className="main-panels" style={{ '--output-h': `${outputH}%` } as React.CSSProperties}>
          <section className="panel output-panel" data-hidden={mobileTab !== 'output'}>
            <div className="panel-head">
              <span className="panel-title">{t(lang, 'panel.output')}</span>
              <span className="panel-count">{outputs.length}</span>
              <span className="spacer" />
              <span className="mono-note">{t(lang, 'status.last')} · {lastTitle}</span>
            </div>
            <OutputPanel
              lang={lang}
              outputs={outputs}
              focusedOutput={focusedOutput}
              onFocus={setFocusedOutput}
              onDelete={(id) => { setOutputs((prev) => prev.filter((o) => o.id !== id)); toast(t(lang, 'toast.outputDeleted')); }}
              onToggleCollapse={(id) => setOutputs((prev) => prev.map((o) => (o.id === id ? { ...o, collapsed: !o.collapsed } : o)))}
              onToast={toast}
            />
          </section>

          <div className="splitter horizontal" onPointerDown={beginOutputDrag} role="separator" aria-orientation="horizontal" />

          <section className="panel worksheet-panel" data-hidden={mobileTab !== 'worksheet'}>
            <div className="panel-head">
              <span className="panel-title">{t(lang, 'panel.worksheet')}</span>
              <span className="panel-count">
                {fmtInt(Math.max(0, ...sheet.columns.map((c) => c.values.length)))} × {sheet.columns.length}
              </span>
              <span className="spacer" />
              <span className="grid-hint">{t(lang, 'hint.grid')}</span>
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
              onCopy={copyRange}
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
                {t(lang, 'status.rows', { n: fmtInt(Math.max(0, ...sheet.columns.map((c) => c.values.length))) })} · {t(lang, 'status.cols', { n: sheet.columns.length })}
              </span>
            </div>
          </section>
        </div>
      </div>

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

      {help && <HelpModal lang={lang} initial={help} onClose={() => setHelp(null)} />}

      <div className="toast-wrap">
        {toasts.map((item) => <div className="toast" key={item.id}>{item.text}</div>)}
      </div>
    </div>
  );
}
