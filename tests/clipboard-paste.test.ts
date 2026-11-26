import { describe, expect, it } from 'vitest';
import { parseClipboardGrid, parseNumberCell } from '../src/lib/project';

describe('parseClipboardGrid (Excel / Sheets / HTML paste)', () => {
  it('parses multi-column Excel TSV with trailing CRLF', () => {
    const tsv = 'Temp\tPress\tYield\r\n100\t20\t85.2\r\n110\t25\t91.4\r\n';
    expect(parseClipboardGrid(tsv)).toEqual([
      ['Temp', 'Press', 'Yield'],
      ['100', '20', '85.2'],
      ['110', '25', '91.4'],
    ]);
  });

  it('preserves comma-formatted numbers inside TSV cells', () => {
    const tsv = 'Item\tCost\r\nA\t1,200\r\nB\t3,450.5\r\n';
    const rows = parseClipboardGrid(tsv);
    expect(rows).toEqual([
      ['Item', 'Cost'],
      ['A', '1,200'],
      ['B', '3,450.5'],
    ]);
    expect(parseNumberCell(rows[1][1])).toBe(1200);
    expect(parseNumberCell(rows[2][1])).toBe(3450.5);
  });

  it('keeps a single column of comma-formatted Excel numbers as 1 column', () => {
    const singleCol = '1,200\r\n2,350.5\r\n-4,100\r\n';
    const rows = parseClipboardGrid(singleCol);
    expect(rows).toEqual([['1,200'], ['2,350.5'], ['-4,100']]);
    expect(rows.map((r) => parseNumberCell(r[0]))).toEqual([1200, 2350.5, -4100]);
  });

  it('handles quoted multi-line cells inside TSV', () => {
    const tsv = '"Line 1\nLine 2"\t42\r\nNext\t99\r\n';
    expect(parseClipboardGrid(tsv)).toEqual([
      ['Line 1\nLine 2', '42'],
      ['Next', '99'],
    ]);
  });

  it('falls back to HTML table extraction when text/plain is empty', () => {
    const html = '<html><body><table><tr><th>X</th><th>Y</th></tr><tr><td>10</td><td>20.5</td></tr></table></body></html>';
    expect(parseClipboardGrid('', html)).toEqual([
      ['X', 'Y'],
      ['10', '20.5'],
    ]);
  });
});
