/* ─────────────────────────────────────────────────────────────────────────
   Statelia — worksheet construction helpers

   Kept apart from the sample registry so that sample data, the DOE engine and
   the project importer can build a sheet without importing each other.
   ───────────────────────────────────────────────────────────────────────── */

import type { Column, Worksheet } from '../types';

let counter = 0;

export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** A worksheet whose columns are numbered C1, C2, … as Minitab does. */
export function makeWorksheet(name: string, columns: Omit<Column, 'id'>[]): Worksheet {
  return {
    id: uid('ws'),
    name,
    columns: columns.map((col, index) => ({ ...col, id: `C${index + 1}` })),
  };
}

export function emptyWorksheet(index = 1): Worksheet {
  return makeWorksheet(`Worksheet ${index}`, [
    { name: '', type: 'numeric', values: new Array(30).fill(null) },
    { name: '', type: 'text', values: new Array(30).fill(null) },
    { name: '', type: 'date', values: new Array(30).fill(null) },
  ]);
}
