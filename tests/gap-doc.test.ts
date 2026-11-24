import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* The gap document is the audit the whole chart programme is measured
   against. It has drifted before: the summary said 31 SUPPORTED while the
   section tables already carried 34. This test reads the document and proves
   the tallies, the vocabulary and every cited code symbol. */

const DOC = readFileSync('docs/CHART_FEATURE_GAP.md', 'utf8');
const CLASSES = ['SUPPORTED', 'PARTIAL', 'MISSING', 'DIFFERENT', 'UNKNOWN'];
const PRIORITIES = ['P0', 'P1', 'P2'];
const COSTS = ['S', 'M', 'L'];

interface Row {
  area: string;
  item: string;
  classification: string;
  basis: string;
  priority: string;
  cost: string;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function sectionTables(): { area: string; rows: Row[] }[] {
  const out: { area: string; rows: Row[] }[] = [];
  let area: string | null = null;
  let rows: Row[] = [];
  const flush = () => {
    if (area && rows.length) out.push({ area, rows });
    rows = [];
  };
  DOC.split('\n').forEach((line) => {
    if (line.startsWith('## ')) {
      flush();
      // Only the seven option matrices carry classifications.
      area = /^## [2-9]\./.test(line) ? line.slice(3).trim() : null;
      return;
    }
    if (!area || !line.startsWith('|')) return;
    const parts = cells(line);
    if (parts.length < 7) return;
    if (parts[3] && CLASSES.includes(parts[3])) {
      rows.push({
        area,
        item: parts[0],
        classification: parts[3],
        basis: parts[4],
        priority: parts[6],
        cost: parts[7] ?? '',
      });
    }
  });
  flush();
  return out;
}

interface SummaryRow { area: string; total: number; counts: Record<string, number> }

function summaryTable(): SummaryRow[] {
  const lines = DOC.split('\n');
  const start = lines.findIndex((line) => line.startsWith('## 1.'));
  const out: SummaryRow[] = [];
  for (let i = start; i < lines.length && !lines[i].startsWith('## 2.'); i += 1) {
    const line = lines[i];
    if (!line.startsWith('|')) continue;
    const parts = cells(line);
    if (parts.length < 8) continue;
    const numeric = (value: string) => /^\*{0,2}\d+\*{0,2}$/.test(value.replace(/\s/g, ''));
    if (!numeric(parts[1]) || !numeric(parts[2]) || !numeric(parts[3])) continue;
    out.push({
      area: parts[0],
      total: Number(parts[1].replace(/\*/g, '')),
      counts: {
        SUPPORTED: Number(parts[2].replace(/\*/g, '')),
        PARTIAL: Number(parts[3].replace(/\*/g, '')),
        MISSING: Number(parts[4].replace(/\*/g, '')),
        DIFFERENT: Number(parts[5].replace(/\*/g, '')),
      },
    });
  }
  return out;
}

const SOURCES = (() => {
  const files: string[] = [];
  const walk = (dir: string) => {
    readdirSync(dir).forEach((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    });
  };
  walk('src');
  return files.map((path) => ({ path, text: readFileSync(path, 'utf8') }));
})();

function basisSymbols(basis: string): string[] {
  return [...basis.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim()).filter(Boolean);
}

describe('chart gap document stays true to the code (WO-01/1)', () => {
  const tables = sectionTables();
  const summary = summaryTable();

  it('has one section table per audited area', () => {
    expect(tables).toHaveLength(7);
    expect(summary).toHaveLength(8); // seven areas plus the total row
  });

  it('reports, per area, exactly the tallies its own rows carry', () => {
    tables.forEach((table) => {
      const name = table.area.replace(/^[\d.]+\s*/, '');
      const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((word) => word.length > 1);
      const wanted = new Set(words(name));
      const row = summary
        .slice(0, -1)
        .map((entry) => ({ entry, overlap: words(entry.area).filter((word) => wanted.has(word)).length }))
        .sort((a, b) => b.overlap - a.overlap)[0]?.entry;
      expect(row, `no summary row for ${table.area}`).toBeDefined();
      const counts = CLASSES.reduce<Record<string, number>>((acc, cls) => {
        acc[cls] = table.rows.filter((entry) => entry.classification === cls).length;
        return acc;
      }, {});
      CLASSES.forEach((cls) => {
        expect(counts[cls], `${table.area} ${cls}`).toBe(row?.counts[cls] ?? 0);
      });
      expect(table.rows.length, `${table.area} total`).toBe(row?.total);
    });
  });

  it('adds up to the stated total', () => {
    const total = summary[summary.length - 1];
    expect(total.area).toBe('**합계**');
    const sum = summary.slice(0, -1);
    expect(total.total).toBe(sum.reduce((acc, row) => acc + row.total, 0));
    ['SUPPORTED', 'PARTIAL', 'MISSING', 'DIFFERENT'].forEach((cls) => {
      expect(total.counts[cls]).toBe(sum.reduce((acc, row) => acc + (row.counts[cls] ?? 0), 0));
    });
  });

  it('uses only the documented vocabulary', () => {
    tables.forEach((table) => table.rows.forEach((row) => {
      expect(CLASSES, `${row.item}`).toContain(row.classification);
      expect(PRIORITIES, `${row.item} priority`).toContain(row.priority);
      expect(COSTS, `${row.item} cost`).toContain(row.cost);
    }));
  });

  it('cites a real symbol for every implemented or partial row', () => {
    const missingSymbols: string[] = [];
    tables.forEach((table) => table.rows.forEach((row) => {
      if (row.classification === 'MISSING') {
        expect(row.basis.replace(/`/g, ''), `${row.item} has no gap note`).not.toBe('');
        return;
      }
      const symbols = basisSymbols(row.basis);
      expect(symbols.length, `${row.item} cites no code`).toBeGreaterThan(0);
      symbols.forEach((symbol) => {
        const file = /^[\w./-]+\.(tsx?|css|md)$/.exec(symbol);
        if (file) {
          const found = SOURCES.some((source) => source.path.endsWith(`/${symbol}`) || source.path.endsWith(symbol));
          if (!found) missingSymbols.push(`${row.item}: file ${symbol}`);
          return;
        }
        const head = symbol.split(/[([{]/)[0].trim();
        const identifier = head.split('.').pop() ?? head;
        const clean = identifier.replace(/[()[\]]/g, '').trim();
        if (!clean || /^(없음|—)$/.test(clean)) return;
        const found = SOURCES.some((source) => source.text.includes(clean));
        if (!found) missingSymbols.push(`${row.item}: ${clean}`);
      });
    }));
    expect(missingSymbols).toEqual([]);
  });

  it('keeps the reproduction commands the report claims', () => {
    ['npx tsc --noEmit', 'npm test', 'npm run qa:stats', 'npm run build'].forEach((command) => {
      expect(DOC).toContain(command);
    });
  });
});
