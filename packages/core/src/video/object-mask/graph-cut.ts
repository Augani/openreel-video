/**
 * Minimum cut on an 8-connected pixel grid (Dinic's algorithm on an implicit graph).
 * Source side = object. Terminal capacities are per pixel; neighbour capacities are symmetric.
 */
export const GRID_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];
const OPP = [1, 0, 3, 2, 5, 4, 7, 6] as const;
const EPS = 1e-9;

export class GridGraphCut {
  readonly width: number;
  readonly height: number;
  /** Residual capacity source -> pixel and pixel -> sink. */
  readonly source: Float64Array;
  readonly sink: Float64Array;
  /** Residual capacity pixel -> neighbour k (see GRID_DIRS). */
  readonly edges: Float64Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.source = new Float64Array(n);
    this.sink = new Float64Array(n);
    this.edges = new Float64Array(n * 8);
  }

  /** Undirected edge of capacity `w` between pixel i and its neighbour in direction k (set from one side only). */
  setLink(i: number, k: number, w: number): void {
    const x = i % this.width;
    const y = (i / this.width) | 0;
    const nx = x + GRID_DIRS[k][0];
    const ny = y + GRID_DIRS[k][1];
    if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) return;
    this.edges[i * 8 + k] = w;
    this.edges[(ny * this.width + nx) * 8 + OPP[k]] = w;
  }

  private neighbour(i: number, k: number): number {
    const x = i % this.width;
    const y = (i / this.width) | 0;
    const nx = x + GRID_DIRS[k][0];
    const ny = y + GRID_DIRS[k][1];
    return nx < 0 || ny < 0 || nx >= this.width || ny >= this.height ? -1 : ny * this.width + nx;
  }

  /** Runs max-flow and returns 1 for pixels on the source (object) side. */
  solve(): Uint8Array {
    const n = this.width * this.height;
    const level = new Int32Array(n);
    const arc = new Uint8Array(n);
    const queue = new Int32Array(n);
    const nbr = new Int32Array(n * 8);
    for (let i = 0; i < n; i++) for (let k = 0; k < 8; k++) nbr[i * 8 + k] = this.neighbour(i, k);
    const { source, sink, edges } = this;

    const bfs = (): boolean => {
      level.fill(-1);
      let head = 0;
      let tail = 0;
      for (let i = 0; i < n; i++) {
        if (source[i] > EPS) {
          level[i] = 0;
          queue[tail++] = i;
        }
      }
      let reachedSink = false;
      while (head < tail) {
        const u = queue[head++];
        if (sink[u] > EPS) reachedSink = true;
        for (let k = 0; k < 8; k++) {
          const v = nbr[u * 8 + k];
          if (v >= 0 && level[v] < 0 && edges[u * 8 + k] > EPS) {
            level[v] = level[u] + 1;
            queue[tail++] = v;
          }
        }
      }
      return reachedSink;
    };

    const pathNodes: number[] = [];
    const pathDirs: number[] = [];
    let guard = 0;
    while (bfs() && guard++ < 10_000) {
      arc.fill(0);
      for (let s = 0; s < n; s++) {
        if (level[s] !== 0) continue;
        pathNodes.length = 0;
        pathDirs.length = 0;
        pathNodes.push(s);
        while (pathNodes.length) {
          if (source[s] <= EPS) break;
          const u = pathNodes[pathNodes.length - 1];
          if (sink[u] > EPS) {
            let f = Math.min(source[s], sink[u]);
            for (let p = 0; p < pathDirs.length; p++) f = Math.min(f, edges[pathNodes[p] * 8 + pathDirs[p]]);
            source[s] -= f;
            sink[u] -= f;
            for (let p = 0; p < pathDirs.length; p++) {
              const a = pathNodes[p];
              const k = pathDirs[p];
              edges[a * 8 + k] -= f;
              edges[pathNodes[p + 1] * 8 + OPP[k]] += f;
            }
            pathNodes.length = 1;
            pathDirs.length = 0;
            continue;
          }
          let advanced = false;
          while (arc[u] < 8) {
            const k = arc[u];
            const v = nbr[u * 8 + k];
            if (v >= 0 && edges[u * 8 + k] > EPS && level[v] === level[u] + 1) {
              pathNodes.push(v);
              pathDirs.push(k);
              advanced = true;
              break;
            }
            arc[u]++;
          }
          if (!advanced) {
            level[u] = -2;
            pathNodes.pop();
            pathDirs.pop();
            if (pathNodes.length) arc[pathNodes[pathNodes.length - 1]]++;
          }
        }
      }
    }

    // Source side = reachable from the source in the residual graph.
    const side = new Uint8Array(n);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < n; i++) {
      if (source[i] > EPS) {
        side[i] = 1;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const u = queue[head++];
      for (let k = 0; k < 8; k++) {
        const v = nbr[u * 8 + k];
        if (v >= 0 && !side[v] && edges[u * 8 + k] > EPS) {
          side[v] = 1;
          queue[tail++] = v;
        }
      }
    }
    return side;
  }
}
