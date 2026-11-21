import { describe, expect, it } from 'vitest';
import { buildProject, csvToWorksheet, parseCsv, parseProject, serializeProject, worksheetToCsv } from '../src/lib/project';
import { DATASETS } from '../src/lib/datasets';
import type { OutputDoc } from '../src/types';

const settings = { theme: 'light' as const, lang: 'en' as const };

describe('project files', () => {
  it('round-trips worksheets, outputs and settings through .mpx.json', () => {
    const sheet = DATASETS[0].build();
    const outputs: OutputDoc[] = [{
      id: 'out-1',
      titleKey: 'an.desc',
      subtitle: 'Thickness',
      createdAt: 1,
      collapsed: false,
      blocks: [{ type: 'table', headers: ['@th.mean'], rows: [[1.5]] }],
    }];
    const text = serializeProject({ worksheets: [sheet], activeSheetId: sheet.id, settings, outputs });
    const restored = parseProject(text);
    expect(restored.worksheets).toHaveLength(1);
    expect(restored.worksheets[0].columns[0].values.slice(0, 3)).toEqual(sheet.columns[0].values.slice(0, 3));
    expect(restored.worksheets[0].name).toBe(sheet.name);
    expect(restored.activeSheetId).toBe(sheet.id);
    expect(restored.outputs[0].titleKey).toBe('an.desc');
    expect(restored.settings).toEqual(settings);
  });

  it('rejects files that are not Sigrún projects', () => {
    expect(() => parseProject('not json')).toThrow('file.error');
    expect(() => parseProject(JSON.stringify({ format: 'other' }))).toThrow('file.error');
  });

  it('builds a dated project envelope', () => {
    const sheet = DATASETS[1].build();
    const project = buildProject({ worksheets: [sheet], activeSheetId: sheet.id, settings, outputs: [] });
    expect(project.format).toBe('sigrun-project');
    expect(project.version).toBe(1);
    expect(project.app).toContain('Sigrún');
    expect(Number.isNaN(Date.parse(project.savedAt))).toBe(false);
  });
});

describe('CSV interchange', () => {
  it('escapes and parses quoted fields', () => {
    const rows = parseCsv('a,b\n"x, y","line ""quoted"""\n1,2');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'line "quoted"'], ['1', '2']]);
  });

  it('round-trips a worksheet', () => {
    const sheet = DATASETS[0].build();
    const csv = worksheetToCsv(sheet);
    const restored = csvToWorksheet(csv, 'Restored');
    expect(restored.columns).toHaveLength(sheet.columns.length);
    expect(restored.name).toBe('Restored');
    expect(restored.columns[0].values.slice(0, 5)).toEqual(sheet.columns[0].values.slice(0, 5));
    expect(restored.columns[1].values[0]).toBe(sheet.columns[1].values[0]);
  });

  it('infers numeric, text and date columns', () => {
    const ws = csvToWorksheet('Value,Label,Date\n1,a,2026-01-02\n2,b,2026-01-03');
    expect(ws.columns[0].type).toBe('numeric');
    expect(ws.columns[0].values).toEqual([1, 2]);
    expect(ws.columns[1].type).toBe('text');
    expect(ws.columns[2].type).toBe('date');
  });

  it('keeps empty cells as missing values', () => {
    const ws = csvToWorksheet('A,B\n1,\n2,3');
    expect(ws.columns[0].values).toEqual([1, 2]);
    expect(ws.columns[1].values).toEqual([null, 3]);
  });
});
