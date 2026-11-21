import { describe, expect, it } from 'vitest';
import {
  PROJECT_ACCEPT,
  buildProject,
  csvToWorksheet,
  detectDelimiter,
  looksLikeMinitabBinary,
  parseCsv,
  parseNumberCell,
  parseProject,
  projectFileName,
  serializeProject,
  worksheetToCsv,
} from '../src/lib/project';
import { DATASETS } from '../src/lib/datasets';
import type { OutputDoc } from '../src/types';

const settings = { theme: 'light' as const, lang: 'en' as const };

describe('project files', () => {
  it('round-trips worksheets, outputs and settings through .sigrun.json', () => {
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
    expect(() => parseProject(JSON.stringify({ format: 'sigrun-project', worksheets: [] }))).toThrow('file.error');
  });

  it('builds a dated project envelope', () => {
    const sheet = DATASETS[1].build();
    const project = buildProject({ worksheets: [sheet], activeSheetId: sheet.id, settings, outputs: [] });
    expect(project.format).toBe('sigrun-project');
    expect(project.version).toBe(1);
    expect(project.app).toContain('Sigrún');
    expect(Number.isNaN(Date.parse(project.savedAt))).toBe(false);
  });

  it('names saved projects with the dedicated .sigrun.json extension', () => {
    expect(projectFileName(new Date('2026-11-22T05:00:00Z'))).toBe('sigrun-2026-11-22.sigrun.json');
    expect(projectFileName(new Date('2026-01-02T05:00:00Z')).endsWith('.sigrun.json')).toBe(true);
  });

  it('still offers legacy .mpx.json files in the picker next to the new extension', () => {
    const accept = PROJECT_ACCEPT.split(',');
    expect(accept).toContain('.sigrun.json');
    expect(accept).toContain('.mpx.json');
    expect(accept).toContain('.mpx');
  });

  it('reads a legacy .mpx.json project that predates the outputs/settings fields', () => {
    const sheet = DATASETS[0].build();
    const legacy = JSON.stringify({
      format: 'sigrun-project',
      version: 1,
      app: 'HD2Lab Sigrún',
      worksheets: [sheet],
      activeSheetId: sheet.id,
    });
    const restored = parseProject(legacy);
    expect(restored.worksheets).toHaveLength(1);
    expect(restored.activeSheetId).toBe(sheet.id);
    expect(restored.outputs).toEqual([]);
    expect(restored.settings).toEqual({ theme: 'light', lang: 'en' });
  });

  it('falls back to the first worksheet when the saved active sheet is gone', () => {
    const sheet = DATASETS[0].build();
    const restored = parseProject(JSON.stringify({
      format: 'sigrun-project',
      worksheets: [sheet],
      activeSheetId: 'missing-id',
      settings: { theme: 'dark', lang: 'ko' },
      outputs: [],
    }));
    expect(restored.activeSheetId).toBe(sheet.id);
    expect(restored.settings).toEqual({ theme: 'dark', lang: 'ko' });
  });

  it('drops malformed worksheets instead of failing the whole project', () => {
    const sheet = DATASETS[0].build();
    const restored = parseProject(JSON.stringify({
      format: 'sigrun-project',
      worksheets: [sheet, { id: 'bad', name: 'Bad' }],
    }));
    expect(restored.worksheets).toHaveLength(1);
    expect(restored.worksheets[0].id).toBe(sheet.id);
  });

  it('recognises Minitab native binaries so they can be refused with an explanation', () => {
    expect(looksLikeMinitabBinary('study.mpx', '')).toBe(true);
    expect(looksLikeMinitabBinary('STUDY.MPX', '')).toBe(true);
    expect(looksLikeMinitabBinary('study.mpx.json', '{"format":"sigrun-project"}')).toBe(false);
    expect(looksLikeMinitabBinary('file.dat', 'PK\u0003\u0004binary')).toBe(true);
    expect(looksLikeMinitabBinary('file.dat', '\u0000\u0000binary')).toBe(true);
    expect(looksLikeMinitabBinary('file.dat', 'MPX header')).toBe(true);
    expect(looksLikeMinitabBinary('project.sigrun.json', '{\n  "format"')).toBe(false);
  });
});

describe('CSV interchange', () => {
  it('escapes and parses quoted fields', () => {
    const rows = parseCsv('a,b\n"x, y","line ""quoted"""\n1,2');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'line "quoted"'], ['1', '2']]);
  });

  it('keeps quoted commas, quotes and newlines inside one cell', () => {
    const rows = parseCsv('Name,Note\n"Batch, A","first line\nsecond ""quoted"" line"\nB,plain');
    expect(rows).toEqual([
      ['Name', 'Note'],
      ['Batch, A', 'first line\nsecond "quoted" line'],
      ['B', 'plain'],
    ]);
    const ws = csvToWorksheet('Name,Note\n"Batch, A","first line\nsecond ""quoted"" line"\nB,plain');
    expect(ws.columns).toHaveLength(2);
    expect(ws.columns[0].values).toEqual(['Batch, A', 'B']);
    expect(ws.columns[1].values).toEqual(['first line\nsecond "quoted" line', 'plain']);
  });

  it('accepts CRLF line endings and a byte-order mark', () => {
    expect(parseCsv('\uFEFFa,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    const ws = csvToWorksheet('\uFEFFValue,Label\r\n1,x\r\n2,y\r\n');
    expect(ws.columns[0].values).toEqual([1, 2]);
    expect(ws.columns[1].values).toEqual(['x', 'y']);
  });

  it('keeps an interior blank row but drops trailing ones', () => {
    expect(parseCsv('a,b\n1,2\n,\n3,4\n,\n')).toEqual([['a', 'b'], ['1', '2'], ['', ''], ['3', '4']]);
  });

  it('quotes fields that contain separators and line breaks when writing CSV', () => {
    const sheet = DATASETS[0].build();
    const renamed = {
      ...sheet,
      columns: sheet.columns.map((c, i) => (i === 0 ? { ...c, name: 'Odd, "name"' } : c)),
    };
    const csv = worksheetToCsv(renamed);
    expect(csv.split('\r\n')[0].startsWith('"Odd, ""name"""')).toBe(true);
    const restored = csvToWorksheet(csv, 'Restored');
    expect(restored.columns[0].name).toBe('Odd, "name"');
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

  it('reads a headerless block and names the columns C1, C2', () => {
    const ws = csvToWorksheet('1,2\n3,4');
    expect(ws.columns.map((c) => c.name)).toEqual(['C1', 'C2']);
    expect(ws.columns[0].values).toEqual([1, 3]);
  });
});

describe('delimiter detection', () => {
  it('picks tab for TSV and semicolon for semicolon-separated text', () => {
    expect(detectDelimiter('A\tB\n1\t2')).toBe('\t');
    expect(detectDelimiter('A;B\n1;2')).toBe(';');
    expect(detectDelimiter('A,B\n1,2')).toBe(',');
  });

  it('compares separators over the whole first record, not only its first line', () => {
    // A quoted header may wrap onto a second physical line; the record still decides.
    expect(detectDelimiter('"A\nA";B;1\n1;2;3')).toBe(';');
    expect(parseCsv('"A\nA";B\n1;2')).toEqual([['A\nA', 'B'], ['1', '2']]);
  });

  it('does not mistake a comma inside a quoted first field for a comma delimiter', () => {
    expect(detectDelimiter('"Region, city";Value\nSeoul;1')).toBe(';');
    expect(parseCsv('"Region, city";Value\nSeoul;1')).toEqual([['Region, city', 'Value'], ['Seoul', '1']]);
  });
});

describe('numeric cell parsing', () => {
  it('accepts plain, signed, grouped and exponent numbers', () => {
    expect(parseNumberCell('42')).toBe(42);
    expect(parseNumberCell(' -3.5 ')).toBe(-3.5);
    expect(parseNumberCell('1,234')).toBe(1234);
    expect(parseNumberCell('1,234,567.89')).toBe(1234567.89);
    expect(parseNumberCell('+0.5')).toBe(0.5);
    expect(parseNumberCell('1.5e3')).toBe(1500);
    expect(parseNumberCell('2E-2')).toBe(0.02);
  });

  it('returns null for text, blanks and malformed grouping', () => {
    expect(parseNumberCell('')).toBeNull();
    expect(parseNumberCell('   ')).toBeNull();
    expect(parseNumberCell('abc')).toBeNull();
    expect(parseNumberCell('1,23')).toBeNull();
    expect(parseNumberCell('12,34,567')).toBeNull();
    expect(parseNumberCell('1.2.3')).toBeNull();
    expect(parseNumberCell('2026-01-02')).toBeNull();
    expect(parseNumberCell('NaN')).toBeNull();
  });
});
