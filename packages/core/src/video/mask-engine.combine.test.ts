import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MaskEngine,
  maskCombineCompositeOp,
  type Mask,
  type MaskCombineMode,
} from "./mask-engine";

const CELLS = 8;

/** One-row alpha-grid canvas implementing the Porter-Duff ops the engine uses. */
class GridCanvas {
  width: number;
  height: number;
  cells: number[];
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = new Array<number>(CELLS).fill(0);
  }
  getContext() {
    return new GridContext(this);
  }
}

class GridContext {
  globalCompositeOperation = "source-over";
  globalAlpha = 1;
  fillStyle = "white";
  filter = "none";
  private xs: number[] = [];
  constructor(private readonly canvas: GridCanvas) {}
  private blend(index: number, src: number): void {
    const d = this.canvas.cells[index];
    const s = src * this.globalAlpha;
    switch (this.globalCompositeOperation) {
      case "destination-out":
        this.canvas.cells[index] = d * (1 - s);
        break;
      case "destination-in":
        this.canvas.cells[index] = d * s;
        break;
      case "xor":
        this.canvas.cells[index] = s * (1 - d) + d * (1 - s);
        break;
      default:
        this.canvas.cells[index] = s + d * (1 - s);
    }
  }
  clearRect() {
    this.canvas.cells.fill(0);
  }
  beginPath() {
    this.xs = [];
  }
  moveTo(x: number) {
    this.xs.push(x);
  }
  bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number) {
    this.xs.push(x);
  }
  closePath() {}
  fill() {
    const lo = Math.min(...this.xs);
    const hi = Math.max(...this.xs);
    for (let i = 0; i < CELLS; i++) {
      const centre = (i + 0.5) * (this.canvas.width / CELLS);
      this.blend(i, centre >= lo && centre <= hi ? 1 : 0);
    }
  }
  fillRect() {
    for (let i = 0; i < CELLS; i++) this.blend(i, 1);
  }
  drawImage(source: { cells: number[] }) {
    for (let i = 0; i < CELLS; i++) this.blend(i, source.cells[i]);
  }
}

function bar(id: string, fromCell: number, toCell: number, combine?: MaskCombineMode): Mask {
  const x0 = fromCell / CELLS;
  const x1 = toCell / CELLS;
  return {
    id,
    clipId: "clip",
    type: "drawn",
    path: {
      closed: true,
      points: [
        { x: x0, y: 0 },
        { x: x1, y: 0 },
        { x: x1, y: 1 },
        { x: x0, y: 1 },
      ],
    },
    feathering: 0,
    inverted: false,
    expansion: 0,
    opacity: 1,
    keyframes: [],
    ...(combine ? { combine } : {}),
  };
}

async function run(masks: Mask[]): Promise<number[]> {
  const engine = new MaskEngine({ width: CELLS, height: 1 });
  engine.loadMasks(masks);
  const source = { cells: new Array<number>(CELLS).fill(1), width: CELLS, height: 1 };
  const { image } = await engine.applyMasks(source as unknown as ImageBitmap, masks);
  return (image as unknown as { cells: number[] }).cells.map((v) => Math.round(v * 100) / 100);
}

describe("MaskEngine.applyMasks combine modes", () => {
  beforeEach(() => {
    vi.stubGlobal("OffscreenCanvas", GridCanvas);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async (canvas: GridCanvas) => ({ cells: [...canvas.cells], width: CELLS, height: 1 })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps modes to composite operations", () => {
    expect(maskCombineCompositeOp("add")).toBe("source-over");
    expect(maskCombineCompositeOp("subtract")).toBe("destination-out");
    expect(maskCombineCompositeOp("intersect")).toBe("destination-in");
    expect(maskCombineCompositeOp("difference")).toBe("xor");
    expect(maskCombineCompositeOp(undefined)).toBe("destination-in");
  });

  it("adds masks as a union", async () => {
    expect(await run([bar("a", 0, 4), bar("b", 2, 6, "add")])).toEqual([1, 1, 1, 1, 1, 1, 0, 0]);
  });

  it("subtracts later masks from earlier ones", async () => {
    expect(await run([bar("a", 0, 6), bar("b", 2, 4, "subtract")])).toEqual([1, 1, 0, 0, 1, 1, 0, 0]);
  });

  it("intersects masks", async () => {
    expect(await run([bar("a", 0, 5), bar("b", 3, 8, "intersect")])).toEqual([0, 0, 0, 1, 1, 0, 0, 0]);
  });

  it("difference keeps the non-overlapping parts", async () => {
    expect(await run([bar("a", 0, 5), bar("b", 3, 8, "difference")])).toEqual([1, 1, 1, 0, 0, 1, 1, 1]);
  });

  it("defaults to intersect, matching the old sequential behaviour", async () => {
    expect(await run([bar("a", 0, 5), bar("b", 3, 8)])).toEqual([0, 0, 0, 1, 1, 0, 0, 0]);
  });

  it("ignores the combine mode of the first mask", async () => {
    expect(await run([bar("a", 2, 4, "subtract")])).toEqual([0, 0, 1, 1, 0, 0, 0, 0]);
  });
});
