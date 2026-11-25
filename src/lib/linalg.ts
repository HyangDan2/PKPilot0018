/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — shared linear algebra (Householder QR with column pivoting)

   Extracted from glm.ts so both GLM/DOE and ordinary multiple regression
   (stats.ts) share one numerically stable, scale-invariant QR solver without
   forming X'X (whose condition number squares κ(X)) and without circular
   dependencies.
   ───────────────────────────────────────────────────────────────────────── */

export interface LstsqResult {
  beta: number[];
  rank: number;
  aliased: number[];
  xtxInv: number[][];
}

function invertUpper(R: number[][]): number[][] | null {
  const m = R.length;
  const inv: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    const diag = R[i][i];
    if (Math.abs(diag) < 1e-300) return null;
    inv[i][i] = 1 / diag;
    for (let j = i + 1; j < m; j += 1) {
      let sum = 0;
      for (let k = i + 1; k <= j; k += 1) sum += R[i][k] * inv[k][j];
      inv[i][j] = -sum / diag;
    }
  }
  return inv;
}

/**
 * Least squares by Householder QR with column scaling and column pivoting.
 *
 * Returns:
 *   · β from R z = Q'y (aliased columns set to 0),
 *   · rank and the aliased column list,
 *   · (X'X)⁻¹ on the estimable columns as D⁻¹ R⁻¹ R⁻ᵀ D⁻¹, zeros elsewhere.
 */
export function lstsq(X: number[][], y: number[]): LstsqResult {
  const n = X.length;
  const p = n ? X[0].length : 0;
  if (!n || !p) return { beta: new Array(p).fill(0), rank: 0, aliased: [], xtxInv: [] };
  // Column scaling keeps the pivoting decision scale-free.
  const scale = new Array(p).fill(1);
  for (let j = 0; j < p; j += 1) {
    let norm = 0;
    for (let i = 0; i < n; i += 1) norm += X[i][j] * X[i][j];
    norm = Math.sqrt(norm);
    scale[j] = norm > 0 ? norm : 1;
  }
  const A: number[][] = X.map((row) => row.map((v, j) => v / scale[j]));
  const b: number[] = [...y];
  const perm = Array.from({ length: p }, (_, i) => i);
  const minDim = Math.min(n, p);
  const tol = 1e-10;
  let rank = 0;
  for (let k = 0; k < minDim; k += 1) {
    let best = -1;
    let bestNorm = 0;
    for (let j = k; j < p; j += 1) {
      let norm = 0;
      for (let i = k; i < n; i += 1) norm += A[i][j] * A[i][j];
      norm = Math.sqrt(norm);
      if (norm > bestNorm) { bestNorm = norm; best = j; }
    }
    if (best < 0 || bestNorm <= tol) break;
    if (best !== k) {
      for (let i = 0; i < n; i += 1) {
        const tmp = A[i][k];
        A[i][k] = A[i][best];
        A[i][best] = tmp;
      }
      const tmp = perm[k];
      perm[k] = perm[best];
      perm[best] = tmp;
    }
    // Householder reflection zeroing A[k+1.., k].
    const v = new Array<number>(n).fill(0);
    let vtv = 0;
    for (let i = k; i < n; i += 1) { v[i] = A[i][k]; vtv += v[i] * v[i]; }
    const alpha = A[k][k] >= 0 ? -Math.sqrt(vtv) : Math.sqrt(vtv);
    v[k] -= alpha;
    vtv = 0;
    for (let i = k; i < n; i += 1) vtv += v[i] * v[i];
    if (vtv > 0) {
      for (let j = k; j < p; j += 1) {
        let s = 0;
        for (let i = k; i < n; i += 1) s += v[i] * A[i][j];
        const f = (2 * s) / vtv;
        if (f === 0) continue;
        for (let i = k; i < n; i += 1) A[i][j] -= f * v[i];
      }
      let sb = 0;
      for (let i = k; i < n; i += 1) sb += v[i] * b[i];
      const fb = (2 * sb) / vtv;
      if (fb !== 0) for (let i = k; i < n; i += 1) b[i] -= fb * v[i];
    }
    A[k][k] = alpha;
    for (let i = k + 1; i < n; i += 1) A[i][k] = 0;
    rank += 1;
  }
  const beta = new Array(p).fill(0);
  const xtxInv = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  if (!rank) {
    return { beta, rank: 0, aliased: Array.from({ length: p }, (_, i) => i), xtxInv };
  }
  const R = Array.from({ length: rank }, (_, i) => Array.from({ length: rank }, (_, j) => (j >= i ? A[i][j] : 0)));
  const z = new Array<number>(rank).fill(0);
  for (let i = rank - 1; i >= 0; i -= 1) {
    let sum = b[i];
    for (let j = i + 1; j < rank; j += 1) sum -= R[i][j] * z[j];
    z[i] = Math.abs(R[i][i]) > 1e-300 ? sum / R[i][i] : 0;
  }
  for (let i = 0; i < rank; i += 1) beta[perm[i]] = z[i] / scale[perm[i]];
  const rInv = invertUpper(R);
  if (rInv) {
    for (let i = 0; i < rank; i += 1) {
      for (let j = 0; j < rank; j += 1) {
        let sum = 0;
        for (let k = 0; k < rank; k += 1) sum += rInv[i][k] * rInv[j][k];
        xtxInv[perm[i]][perm[j]] = sum / (scale[perm[i]] * scale[perm[j]]);
      }
    }
  }
  const retained = perm.slice(0, rank).sort((a, b2) => a - b2);
  const aliased = Array.from({ length: p }, (_, i) => i).filter((i) => !retained.includes(i));
  return { beta, rank, aliased, xtxInv };
}
