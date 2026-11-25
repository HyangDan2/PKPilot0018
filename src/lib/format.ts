/* Sigrún — number formatting */

export function fmt(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined) return '*';
  if (!isFinite(x)) return x > 0 ? '∞' : x < 0 ? '-∞' : '*';
  const abs = Math.abs(x);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e7)) return x.toExponential(3);
  if (Number.isInteger(x) && abs < 1e7) return x.toLocaleString('en-US');
  const d = abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 3 : digits;
  return x.toFixed(d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function fmtP(p: number): string {
  if (!isFinite(p)) return '*';
  if (p < 0.0005) return '<0.001';
  return p.toFixed(3);
}

export function fmtInt(x: number): string {
  return Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '*';
}

/**
 * A ratio shown as a percentage. A ratio the fit cannot define (R²(adj) of a
 * saturated model, R²(pred) without PRESS) is a dash — never "NaN%".
 */
export function fmtPct(x: number, digits = 2): string {
  return Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : '—';
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${fmtTime(ts)}`;
}
