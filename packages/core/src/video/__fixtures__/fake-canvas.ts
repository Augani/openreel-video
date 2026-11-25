/**
 * A tiny software 2D canvas for unit tests (node has no canvas): straight-alpha RGBA pixels, integer translate / scale
 * only, source-over drawImage honouring globalAlpha and the active clip rectangle. putImageData deliberately IGNORES the
 * clip, like a real canvas, so tests can prove a blend never writes outside it.
 */
export interface FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface State {
  globalAlpha: number;
  globalCompositeOperation: string;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  clip: { x0: number; y0: number; x1: number; y1: number };
}

export class FakeCanvas {
  readonly data: Uint8ClampedArray;
  private readonly context: FakeContext;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
    this.context = new FakeContext(this);
  }
  getContext(): FakeContext {
    return this.context;
  }
  fill(r: number, g: number, b: number, a = 255): void {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = a;
    }
  }
}

export class FakeContext {
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  filter = "none";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  /** Operations seen, for assertions. */
  readonly log: string[] = [];
  private tx = 0;
  private ty = 0;
  private sx = 1;
  private sy = 1;
  private clipRect: State["clip"];
  private pendingRect: State["clip"] | null = null;
  private readonly stack: State[] = [];

  constructor(readonly canvas: FakeCanvas) {
    this.clipRect = { x0: 0, y0: 0, x1: canvas.width, y1: canvas.height };
  }

  save(): void {
    this.stack.push({
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      tx: this.tx,
      ty: this.ty,
      sx: this.sx,
      sy: this.sy,
      clip: { ...this.clipRect },
    });
  }
  restore(): void {
    const state = this.stack.pop();
    if (!state) return;
    this.globalAlpha = state.globalAlpha;
    this.globalCompositeOperation = state.globalCompositeOperation;
    this.tx = state.tx;
    this.ty = state.ty;
    this.sx = state.sx;
    this.sy = state.sy;
    this.clipRect = state.clip;
  }
  setTransform(a: number, _b: number, _c: number, d: number, e: number, f: number): void {
    this.sx = a;
    this.sy = d;
    this.tx = e;
    this.ty = f;
  }
  translate(x: number, y: number): void {
    this.tx += x * this.sx;
    this.ty += y * this.sy;
  }
  scale(x: number, y: number): void {
    this.sx *= x;
    this.sy *= y;
  }
  rotate(): void {
    /* identity only */
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.pendingRect = { x0: x, y0: y, x1: x + w, y1: y + h };
  }
  clip(): void {
    if (!this.pendingRect) return;
    const r = this.pendingRect;
    this.clipRect = {
      x0: Math.max(this.clipRect.x0, r.x0),
      y0: Math.max(this.clipRect.y0, r.y0),
      x1: Math.min(this.clipRect.x1, r.x1),
      y1: Math.min(this.clipRect.y1, r.y1),
    };
    this.pendingRect = null;
  }
  beginPath(): void {
    this.pendingRect = null;
  }
  getImageData(x: number, y: number, w: number, h: number): FakeImageData {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      const from = ((y + row) * this.canvas.width + x) * 4;
      out.set(this.canvas.data.subarray(from, from + w * 4), row * w * 4);
    }
    return { data: out, width: w, height: h };
  }
  putImageData(image: FakeImageData, x: number, y: number): void {
    this.log.push("putImageData");
    for (let row = 0; row < image.height; row++) {
      const to = ((y + row) * this.canvas.width + x) * 4;
      this.canvas.data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), to);
    }
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.log.push("clearRect");
    this.forEachDevicePixel(x, y, w, h, (i) => {
      this.canvas.data[i] = this.canvas.data[i + 1] = this.canvas.data[i + 2] = this.canvas.data[i + 3] = 0;
    });
  }
  drawImage(image: FakeCanvas | { width: number; height: number }, dx = 0, dy = 0, dw?: number, dh?: number): void {
    this.log.push("drawImage");
    const source = image instanceof FakeCanvas ? image : null;
    if (!source) return;
    const w = dw ?? source.width;
    const h = dh ?? source.height;
    this.forEachDevicePixel(dx, dy, w, h, (i, px, py) => {
      // Integer 1:1 mapping (scale 1), the only geometry these tests use.
      const sx = Math.round((px - (this.tx + dx * this.sx)) / this.sx);
      const sy = Math.round((py - (this.ty + dy * this.sy)) / this.sy);
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) return;
      const s = (sy * source.width + sx) * 4;
      const sa = (source.data[s + 3] / 255) * this.globalAlpha;
      if (sa <= 0) return;
      const ba = this.canvas.data[i + 3] / 255;
      const oa = sa + ba * (1 - sa);
      for (let k = 0; k < 3; k++) {
        const value = (source.data[s + k] * sa + this.canvas.data[i + k] * ba * (1 - sa)) / oa;
        this.canvas.data[i + k] = Math.round(value);
      }
      this.canvas.data[i + 3] = Math.round(oa * 255);
    });
  }

  private forEachDevicePixel(x: number, y: number, w: number, h: number, fn: (index: number, px: number, py: number) => void): void {
    const x0 = Math.max(this.clipRect.x0, Math.round(this.tx + x * this.sx));
    const y0 = Math.max(this.clipRect.y0, Math.round(this.ty + y * this.sy));
    const x1 = Math.min(this.clipRect.x1, Math.round(this.tx + (x + w) * this.sx), this.canvas.width);
    const y1 = Math.min(this.clipRect.y1, Math.round(this.ty + (y + h) * this.sy), this.canvas.height);
    for (let py = Math.max(0, y0); py < y1; py++) {
      for (let px = Math.max(0, x0); px < x1; px++) fn((py * this.canvas.width + px) * 4, px, py);
    }
  }
}
