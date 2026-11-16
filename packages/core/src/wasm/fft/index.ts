import { FFT as JsFFT } from "../../audio/fft";

/** Raw AssemblyScript exports use managed-array pointers, never JavaScript arrays. */
type WasmFFTExports = {
  init(size: number): void;
  getSize(): number;
  forward(input: number, real: number, imag: number): void;
  inverse(real: number, imag: number, output: number): void;
  getMagnitude(real: number, imag: number, magnitude: number): void;
  getMagnitudeAndPhase(
    real: number,
    imag: number,
    magnitudes: number,
    phases: number,
  ): void;
  fromMagnitudeAndPhase(
    magnitudes: number,
    phases: number,
    real: number,
    imag: number,
  ): void;
  applyHannWindow(input: number, output: number): void;
  allocateF32(length: number): number;
  memory: WebAssembly.Memory;
};
let compiledModule: WebAssembly.Module | null = null;
let loadPromise: Promise<WebAssembly.Module | null> | null = null;
async function loadWasmModule(): Promise<WebAssembly.Module | null> {
  if (typeof WebAssembly === "undefined") return null;
  try {
    const response = await fetch(new URL("./build/fft.wasm", import.meta.url));
    if (!response.ok) return null;
    return await WebAssembly.compile(await response.arrayBuffer());
  } catch {
    return null;
  }
}
export async function initWasmFFT(): Promise<boolean> {
  if (compiledModule) return true;
  loadPromise ??= loadWasmModule();
  compiledModule = await loadPromise;
  return compiledModule !== null;
}
class WasmFFTBackend {
  readonly raw: WasmFFTExports;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  private buffer: ArrayBufferLike | null = null;
  private views = new Map<number, Float32Array>();
  constructor(
    module: WebAssembly.Module,
    readonly size: number,
  ) {
    this.raw = new WebAssembly.Instance(module, {
      env: {
        abort: () => {
          throw new Error("FFT WebAssembly aborted");
        },
      },
    }).exports as WasmFFTExports;
    this.raw.init(size);
    if (this.raw.getSize() !== size)
      throw new Error("FFT WebAssembly size mismatch");
    this.a = this.raw.allocateF32(size);
    this.b = this.raw.allocateF32(size);
    this.c = this.raw.allocateF32(size);
    this.d = this.raw.allocateF32(size / 2);
    this.e = this.raw.allocateF32(size / 2);
    for (const [pointer, length] of [
      [this.a, size],
      [this.b, size],
      [this.c, size],
      [this.d, size / 2],
      [this.e, size / 2],
    ])
      this.view(pointer, length);
  }
  /** AssemblyScript TypedArray: buffer pointer, dataStart, byteLength (three u32 fields). */
  view(pointer: number, length: number): Float32Array {
    // Reacquire views after calls: growing a WebAssembly memory detaches old views.
    const memory = this.raw.memory.buffer;
    if (memory !== this.buffer) {
      this.views.clear();
      this.buffer = memory;
    }
    const cached = this.views.get(pointer);
    if (cached?.length === length) return cached;
    const header = new DataView(memory);
    const start = header.getUint32(pointer + 4, true),
      bytes = header.getUint32(pointer + 8, true);
    if (bytes !== length * 4 || start + bytes > memory.byteLength)
      throw new Error("FFT WebAssembly array layout mismatch");
    const view = new Float32Array(memory, start, length);
    this.views.set(pointer, view);
    return view;
  }
  write(pointer: number, source: Float32Array, length = this.size): void {
    const target = this.view(pointer, length);
    if (source.length < length) target.fill(0);
    target.set(source.subarray(0, length));
  }
}

export class WasmFFT {
  private readonly jsFFT: JsFFT;
  private backend: WasmFFTBackend | null = null;
  constructor(private readonly size: number) {
    this.jsFFT = new JsFFT(size);
    this.attach();
  }
  private attach(): void {
    if (this.backend || !compiledModule) return;
    try {
      this.backend = new WasmFFTBackend(compiledModule, this.size);
    } catch {
      this.backend = null;
    }
  }
  async ensureWasm(): Promise<boolean> {
    if (this.backend) return true;
    if (await initWasmFFT()) this.attach();
    return this.backend !== null;
  }
  getSize(): number {
    return this.size;
  }
  getWasmMemoryBytes(): number {
    return this.backend?.raw.memory.buffer.byteLength ?? 0;
  }
  forward(input: Float32Array): { real: Float32Array; imag: Float32Array } {
    const w = this.backend;
    if (!w) return this.jsFFT.forward(input);
    w.write(w.a, input);
    w.raw.forward(w.a, w.b, w.c);
    return {
      real: w.view(w.b, this.size).slice(),
      imag: w.view(w.c, this.size).slice(),
    };
  }
  inverse(real: Float32Array, imag: Float32Array): Float32Array {
    const w = this.backend;
    if (!w) return this.jsFFT.inverse(real, imag);
    w.write(w.a, real);
    w.write(w.b, imag);
    w.raw.inverse(w.a, w.b, w.c);
    return w.view(w.c, this.size).slice();
  }
  getMagnitude(real: Float32Array, imag: Float32Array): Float32Array {
    const w = this.backend;
    if (!w) return this.jsFFT.getMagnitude(real, imag);
    w.write(w.a, real);
    w.write(w.b, imag);
    w.raw.getMagnitude(w.a, w.b, w.d);
    return w.view(w.d, this.size / 2).slice();
  }
  getPower(real: Float32Array, imag: Float32Array): Float32Array {
    return this.jsFFT.getPower(real, imag);
  }
  getMagnitudeAndPhase(
    real: Float32Array,
    imag: Float32Array,
  ): { magnitudes: Float32Array; phases: Float32Array } {
    const w = this.backend;
    if (!w) return this.jsFFT.getMagnitudeAndPhase(real, imag);
    w.write(w.a, real);
    w.write(w.b, imag);
    w.raw.getMagnitudeAndPhase(w.a, w.b, w.d, w.e);
    return {
      magnitudes: w.view(w.d, this.size / 2).slice(),
      phases: w.view(w.e, this.size / 2).slice(),
    };
  }
  fromMagnitudeAndPhase(
    magnitudes: Float32Array,
    phases: Float32Array,
  ): { real: Float32Array; imag: Float32Array } {
    const w = this.backend;
    if (
      !w ||
      magnitudes.length !== this.size / 2 ||
      phases.length !== this.size / 2
    )
      return this.jsFFT.fromMagnitudeAndPhase(magnitudes, phases);
    w.write(w.d, magnitudes, this.size / 2);
    w.write(w.e, phases, this.size / 2);
    w.view(w.a, this.size).fill(0);
    w.view(w.b, this.size).fill(0);
    w.raw.fromMagnitudeAndPhase(w.d, w.e, w.a, w.b);
    return {
      real: w.view(w.a, this.size).slice(),
      imag: w.view(w.b, this.size).slice(),
    };
  }
  applyHannWindow(data: Float32Array): Float32Array {
    const w = this.backend;
    if (!w || data.length !== this.size)
      return this.jsFFT.applyHannWindow(data);
    w.write(w.a, data);
    w.raw.applyHannWindow(w.a, w.b);
    return w.view(w.b, this.size).slice();
  }
  applySynthesisWindow(data: Float32Array): Float32Array {
    return this.applyHannWindow(data);
  }
}

const cachedWasmFFTs = new Map<number, WasmFFT>();
const MAX_CACHED_FFT_SIZES = 8;
export function getWasmFFT(size: number): WasmFFT {
  let fft = cachedWasmFFTs.get(size);
  if (fft) cachedWasmFFTs.delete(size);
  else fft = new WasmFFT(size);
  cachedWasmFFTs.set(size, fft);
  while (cachedWasmFFTs.size > MAX_CACHED_FFT_SIZES)
    cachedWasmFFTs.delete(cachedWasmFFTs.keys().next().value!);
  return fft;
}
