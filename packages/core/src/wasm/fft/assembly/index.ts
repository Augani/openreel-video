let size: i32 = 0;
let cosTable: Float32Array | null = null;
let sinTable: Float32Array | null = null;
let reverseTable: Uint32Array | null = null;
let inverseReal: Float32Array | null = null;
let inverseImag: Float32Array | null = null;

export function init(fftSize: i32): void {
  if (fftSize <= 0 || (fftSize & (fftSize - 1)) !== 0) {
    return;
  }

  size = fftSize;
  const halfSize = size >> 1;

  const cosTab = new Float32Array(halfSize);
  const sinTab = new Float32Array(halfSize);
  const revTab = new Uint32Array(size);

  const twoPi: f32 = 6.283185307179586;
  for (let i = 0; i < halfSize; i++) {
    const angle: f32 = (-twoPi * <f32>i) / <f32>size;
    unchecked((cosTab[i] = Mathf.cos(angle)));
    unchecked((sinTab[i] = Mathf.sin(angle)));
  }

  const bits = <i32>Math.log2(<f64>size);
  for (let i = 0; i < size; i++) {
    let reversed: u32 = 0;
    for (let j = 0; j < bits; j++) {
      reversed = (reversed << 1) | ((<u32>i >> j) & 1);
    }
    unchecked((revTab[i] = reversed));
  }

  cosTable = cosTab;
  sinTable = sinTab;
  reverseTable = revTab;
  inverseReal = new Float32Array(size);
  inverseImag = new Float32Array(size);
}

export function getSize(): i32 {
  return size;
}

export function forward(input: Float32Array, real: Float32Array, imag: Float32Array): void {
  if (!reverseTable || !cosTable || !sinTable) return;
  const revTable = reverseTable!;
  const cosTab = cosTable!;
  const sinTab = sinTable!;
  const n = size;

  for (let i = 0; i < n; i++) {
    const rev = unchecked(revTable[i]);
    unchecked((real[rev] = input[i]));
    unchecked((imag[rev] = 0));
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const tableStep = n / len;

    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < halfLen; j++) {
        const tIdx = j * tableStep;
        const cos = unchecked(cosTab[tIdx]);
        const sin = unchecked(sinTab[tIdx]);

        const evenIdx = i + j;
        const oddIdx = i + j + halfLen;

        const oddReal = unchecked(real[oddIdx]);
        const oddImag = unchecked(imag[oddIdx]);

        const tReal = oddReal * cos - oddImag * sin;
        const tImag = oddReal * sin + oddImag * cos;

        const evenReal = unchecked(real[evenIdx]);
        const evenImag = unchecked(imag[evenIdx]);

        unchecked((real[oddIdx] = evenReal - tReal));
        unchecked((imag[oddIdx] = evenImag - tImag));
        unchecked((real[evenIdx] = evenReal + tReal));
        unchecked((imag[evenIdx] = evenImag + tImag));
      }
    }
  }
}

export function inverse(real: Float32Array, imag: Float32Array, output: Float32Array): void {
  if (!reverseTable || !cosTable || !sinTable) return;
  const revTable = reverseTable!;
  const cosTab = cosTable!;
  const sinTab = sinTable!;
  const n = size;
  if (!inverseReal || !inverseImag) return;
  const outReal = inverseReal!;
  const outImag = inverseImag!;

  for (let i = 0; i < n; i++) {
    const rev = unchecked(revTable[i]);
    unchecked((outReal[rev] = real[i]));
    unchecked((outImag[rev] = -imag[i]));
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const tableStep = n / len;

    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < halfLen; j++) {
        const tIdx = j * tableStep;
        const cos = unchecked(cosTab[tIdx]);
        const sin = unchecked(sinTab[tIdx]);

        const evenIdx = i + j;
        const oddIdx = i + j + halfLen;

        const oddReal = unchecked(outReal[oddIdx]);
        const oddImag = unchecked(outImag[oddIdx]);

        const tReal = oddReal * cos - oddImag * sin;
        const tImag = oddReal * sin + oddImag * cos;

        const evenReal = unchecked(outReal[evenIdx]);
        const evenImag = unchecked(outImag[evenIdx]);

        unchecked((outReal[oddIdx] = evenReal - tReal));
        unchecked((outImag[oddIdx] = evenImag - tImag));
        unchecked((outReal[evenIdx] = evenReal + tReal));
        unchecked((outImag[evenIdx] = evenImag + tImag));
      }
    }
  }

  const invN: f32 = 1.0 / <f32>n;
  for (let i = 0; i < n; i++) {
    unchecked((output[i] = outReal[i] * invN));
  }
}

export function getMagnitude(real: Float32Array, imag: Float32Array, magnitude: Float32Array): void {
  const halfSize = size >> 1;
  for (let i = 0; i < halfSize; i++) {
    const r = unchecked(real[i]);
    const im = unchecked(imag[i]);
    unchecked((magnitude[i] = Mathf.sqrt(r * r + im * im)));
  }
}

export function getMagnitudeAndPhase(
  real: Float32Array,
  imag: Float32Array,
  magnitudes: Float32Array,
  phases: Float32Array,
): void {
  const halfSize = size >> 1;
  for (let i = 0; i < halfSize; i++) {
    const r = unchecked(real[i]);
    const im = unchecked(imag[i]);
    unchecked((magnitudes[i] = Mathf.sqrt(r * r + im * im)));
    unchecked((phases[i] = Mathf.atan2(im, r)));
  }
}

export function fromMagnitudeAndPhase(
  magnitudes: Float32Array,
  phases: Float32Array,
  real: Float32Array,
  imag: Float32Array,
): void {
  const n = size;
  const halfSize = magnitudes.length;

  for (let i = 0; i < halfSize; i++) {
    const mag = unchecked(magnitudes[i]);
    const phase = unchecked(phases[i]);
    unchecked((real[i] = mag * Mathf.cos(phase)));
    unchecked((imag[i] = mag * Mathf.sin(phase)));
  }

  for (let i = 1; i < halfSize; i++) {
    unchecked((real[n - i] = real[i]));
    unchecked((imag[n - i] = -imag[i]));
  }
}

export function applyHannWindow(input: Float32Array, output: Float32Array): void {
  const n = input.length;
  const twoPi: f32 = 6.283185307179586;
  const nMinus1: f32 = <f32>(n - 1);

  for (let i = 0; i < n; i++) {
    const windowVal: f32 = 0.5 * (1.0 - Mathf.cos((twoPi * <f32>i) / nMinus1));
    unchecked((output[i] = input[i] * windowVal));
  }
}

export function allocateF32(length: i32): Float32Array {
  return new Float32Array(length);
}

export function allocateU32(length: i32): Uint32Array {
  return new Uint32Array(length);
}
