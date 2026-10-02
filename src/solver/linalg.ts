/** Small dense linear algebra for the network adjustment. */

export function zeros(n: number, m: number): number[][] {
  return Array.from({ length: n }, () => Array<number>(m).fill(0));
}

export function matVec(a: number[][], x: number[]): number[] {
  return a.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

export function transpose(a: number[][]): number[][] {
  const n = a.length;
  const m = a[0]?.length ?? 0;
  const t = zeros(m, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) t[j][i] = a[i][j];
  }
  return t;
}

/** Cholesky L of a symmetric positive-definite matrix, or null if it is not. */
export function cholesky(a: number[][]): number[][] | null {
  const n = a.length;
  const L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(sum > 1e-18)) return null;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

function forward(L: number[][], b: number[]): number[] {
  const n = L.length;
  const y = Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i][k] * y[k];
    y[i] = sum / L[i][i];
  }
  return y;
}

function back(L: number[][], y: number[]): number[] {
  const n = L.length;
  const x = Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
    x[i] = sum / L[i][i];
  }
  return x;
}

/** Solve A x = b for symmetric positive-definite A. */
export function solveSpd(a: number[][], b: number[]): number[] | null {
  const L = cholesky(a);
  if (!L) return null;
  return back(L, forward(L, b));
}

export interface Eigen {
  /** Eigenvalues, not ordered. */
  values: number[];
  /** vectors[row][col], column k belongs to values[k]. */
  vectors: number[][];
}

/** Cyclic Jacobi eigen-decomposition of a real symmetric matrix. */
export function jacobiEigen(matrix: number[][]): Eigen {
  const n = matrix.length;
  const a = matrix.map((row) => row.slice());
  const v = zeros(n, n);
  for (let i = 0; i < n; i++) v[i][i] = 1;

  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    }
    if (off < 1e-28 * n) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-18) continue;
        const app = a[p][p];
        const aqq = a[q][q];
        const tau = (aqq - app) / (2 * apq);
        const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        a[p][p] = app - t * apq;
        a[q][q] = aqq + t * apq;
        a[p][q] = 0;
        a[q][p] = 0;
        for (let k = 0; k < n; k++) {
          if (k === p || k === q) continue;
          const aik = a[k][p];
          const akq = a[k][q];
          const np = c * aik - s * akq;
          const nq = s * aik + c * akq;
          a[k][p] = np;
          a[p][k] = np;
          a[k][q] = nq;
          a[q][k] = nq;
        }
        for (let k = 0; k < n; k++) {
          const vip = v[k][p];
          const viq = v[k][q];
          v[k][p] = c * vip - s * viq;
          v[k][q] = s * vip + c * viq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v };
}

/**
 * Diagonal equilibration. A datum tape at 1e-8 m and a 0.1° bearing put
 * diagonals many orders apart; Jacobi and a global eigenvalue test then
 * call a healthy network singular. Scale each unknown by 1/√Nᵢᵢ first.
 */
export function equilibrate(matrix: number[][]): { scaled: number[][]; scale: number[] } {
  const n = matrix.length;
  const scale = Array<number>(n).fill(1);
  for (let i = 0; i < n; i++) {
    const d = matrix[i][i];
    if (d > 0) scale[i] = 1 / Math.sqrt(d);
  }
  const scaled = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) scaled[i][j] = matrix[i][j] * scale[i] * scale[j];
  }
  return { scaled, scale };
}

/**
 * Eigenvalues of the equilibrated matrix. Eigenvector column k, multiplied
 * by the scale, is the corresponding direction in the original unknowns:
 * N (D v) = 0 when the scaled matrix has a null vector v.
 */
export function scaledEigen(matrix: number[][]): Eigen {
  const { scaled, scale } = equilibrate(matrix);
  const eigen = jacobiEigen(scaled);
  return {
    values: eigen.values,
    vectors: eigen.vectors.map((row, i) => row.map((v) => scale[i] * v)),
  };
}

/** Solve A x = b after equilibration, for a symmetric positive-definite A. */
export function solveEquilibrated(a: number[][], b: number[]): number[] | null {
  const { scaled, scale } = equilibrate(a);
  const y = solveSpd(
    scaled,
    b.map((v, i) => v * scale[i]),
  );
  if (!y) return null;
  return y.map((v, i) => v * scale[i]);
}

/**
 * Inverse of a symmetric positive-definite matrix, or null if the
 * equilibrated matrix is numerically singular (scaled eigenvalue ≤ relTol
 * times the largest). A large but finite ellipse stays invertible.
 */
export function invertSpd(matrix: number[][], relTol = 1e-10): number[][] | null {
  if (matrix.length === 0) return [];
  const { scaled, scale } = equilibrate(matrix);
  const { values, vectors } = jacobiEigen(scaled);
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 0);
  if (!(maxAbs > 0)) return null;
  const invS = zeros(matrix.length, matrix.length);
  for (let k = 0; k < values.length; k++) {
    if (values[k] <= relTol * maxAbs) return null;
    const w = 1 / values[k];
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < values.length; j++) invS[i][j] += vectors[i][k] * w * vectors[j][k];
    }
  }
  const inv = zeros(matrix.length, matrix.length);
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix.length; j++) inv[i][j] = scale[i] * invS[i][j] * scale[j];
  }
  return inv;
}

/** 2×2 symmetric eigenvalues, largest first. */
export function eigen2(a: number, b: number, c: number): [number, number] {
  const tr = a + c;
  const det = a * c - b * b;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  return [tr / 2 + disc, tr / 2 - disc];
}
