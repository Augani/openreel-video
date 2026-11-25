/** A small RGB Gaussian mixture used as the colour model of GrabCut (full covariances, deterministic fit). */
interface Component {
  weight: number;
  mean: [number, number, number];
  /** Inverse covariance, row major 3x3 (symmetric). */
  inv: [number, number, number, number, number, number];
  logNorm: number;
}

const REGULARISE = 6;

export class Gmm {
  private comps: Component[] = [];

  /** `samples` is interleaved r,g,b in 0..255. */
  fit(samples: Float32Array, k: number): void {
    const n = samples.length / 3;
    this.comps = [];
    if (n === 0) return;
    let clusters: number[][] = [Array.from({ length: n }, (_, i) => i)];
    const variance = (idx: number[]): { total: number; axis: number; mean: number } => {
      const m = [0, 0, 0];
      for (const i of idx) for (let c = 0; c < 3; c++) m[c] += samples[i * 3 + c];
      for (let c = 0; c < 3; c++) m[c] /= idx.length;
      const v = [0, 0, 0];
      for (const i of idx) for (let c = 0; c < 3; c++) v[c] += (samples[i * 3 + c] - m[c]) ** 2;
      const axis = v[0] >= v[1] && v[0] >= v[2] ? 0 : v[1] >= v[2] ? 1 : 2;
      return { total: v[0] + v[1] + v[2], axis, mean: m[axis] };
    };
    while (clusters.length < k) {
      let best = -1;
      let bestVar = 0;
      for (let c = 0; c < clusters.length; c++) {
        if (clusters[c].length < 4) continue;
        const { total } = variance(clusters[c]);
        if (total > bestVar) (bestVar = total), (best = c);
      }
      if (best < 0 || bestVar < 1) break;
      const { axis, mean } = variance(clusters[best]);
      const lo: number[] = [];
      const hi: number[] = [];
      for (const i of clusters[best]) (samples[i * 3 + axis] <= mean ? lo : hi).push(i);
      if (!lo.length || !hi.length) break;
      clusters.splice(best, 1, lo, hi);
    }
    // A few k-means refinements from the split seeds.
    let centers = clusters.map((idx) => {
      const m = [0, 0, 0];
      for (const i of idx) for (let c = 0; c < 3; c++) m[c] += samples[i * 3 + c];
      return m.map((v) => v / idx.length);
    });
    for (let iter = 0; iter < 4 && centers.length > 1; iter++) {
      const next: number[][] = centers.map(() => []);
      for (let i = 0; i < n; i++) {
        let best = 0;
        let bd = Infinity;
        for (let c = 0; c < centers.length; c++) {
          const d = (samples[i * 3] - centers[c][0]) ** 2 + (samples[i * 3 + 1] - centers[c][1]) ** 2 + (samples[i * 3 + 2] - centers[c][2]) ** 2;
          if (d < bd) (bd = d), (best = c);
        }
        next[best].push(i);
      }
      clusters = next.filter((c) => c.length > 0);
      centers = clusters.map((idx) => {
        const m = [0, 0, 0];
        for (const i of idx) for (let c = 0; c < 3; c++) m[c] += samples[i * 3 + c];
        return m.map((v) => v / idx.length);
      });
    }
    for (let c = 0; c < clusters.length; c++) {
      const idx = clusters[c];
      if (idx.length < 2) continue;
      const m = centers[c];
      const cov = [0, 0, 0, 0, 0, 0]; // rr rg rb gg gb bb
      for (const i of idx) {
        const dr = samples[i * 3] - m[0];
        const dg = samples[i * 3 + 1] - m[1];
        const db = samples[i * 3 + 2] - m[2];
        cov[0] += dr * dr;
        cov[1] += dr * dg;
        cov[2] += dr * db;
        cov[3] += dg * dg;
        cov[4] += dg * db;
        cov[5] += db * db;
      }
      for (let q = 0; q < 6; q++) cov[q] /= idx.length;
      cov[0] += REGULARISE;
      cov[3] += REGULARISE;
      cov[5] += REGULARISE;
      const [a, b, cc, d, e, f] = cov;
      const det = a * (d * f - e * e) - b * (b * f - e * cc) + cc * (b * e - d * cc);
      if (!(det > 1e-9)) continue;
      const inv: Component["inv"] = [
        (d * f - e * e) / det,
        (cc * e - b * f) / det,
        (b * e - cc * d) / det,
        (a * f - cc * cc) / det,
        (b * cc - a * e) / det,
        (a * d - b * b) / det,
      ];
      this.comps.push({
        weight: idx.length / n,
        mean: [m[0], m[1], m[2]],
        inv,
        logNorm: Math.log(idx.length / n) - 0.5 * Math.log(det) - 1.5 * Math.log(2 * Math.PI),
      });
    }
  }

  /** -log p(x): the cost of explaining the colour with this model. */
  cost(r: number, g: number, b: number): number {
    if (!this.comps.length) return 20;
    let sum = 0;
    for (const c of this.comps) {
      const dr = r - c.mean[0];
      const dg = g - c.mean[1];
      const db = b - c.mean[2];
      const q = dr * (c.inv[0] * dr + c.inv[1] * dg + c.inv[2] * db) + dg * (c.inv[1] * dr + c.inv[3] * dg + c.inv[4] * db) + db * (c.inv[2] * dr + c.inv[4] * dg + c.inv[5] * db);
      sum += Math.exp(c.logNorm - 0.5 * q);
    }
    return -Math.log(sum + 1e-30);
  }
}
