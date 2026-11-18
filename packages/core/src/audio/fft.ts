export class FFT {
  private readonly size: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly reverseTable: Uint32Array;

  constructor(size: number) {
    if (size <= 0 || (size & (size - 1)) !== 0) {
      throw new Error("FFT size must be a power of 2");
    }

    this.size = size;
    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);
    this.reverseTable = new Uint32Array(size);

    for (let i = 0; i < size / 2; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }

    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let reversed = 0;
      for (let j = 0; j < bits; j++) {
        reversed = (reversed << 1) | ((i >> j) & 1);
      }
      this.reverseTable[i] = reversed;
    }
  }

  getSize(): number {
    return this.size;
  }

  forward(input: Float32Array): { real: Float32Array; imag: Float32Array } {
    const n = this.size;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      real[this.reverseTable[i]] = input[i] || 0;
    }

    for (let len = 2; len <= n; len *= 2) {
      const halfLen = len / 2;
      const tableStep = n / len;

      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < halfLen; j++) {
          const tIdx = j * tableStep;
          const cos = this.cosTable[tIdx];
          const sin = this.sinTable[tIdx];

          const evenIdx = i + j;
          const oddIdx = i + j + halfLen;

          const tReal = real[oddIdx] * cos - imag[oddIdx] * sin;
          const tImag = real[oddIdx] * sin + imag[oddIdx] * cos;

          real[oddIdx] = real[evenIdx] - tReal;
          imag[oddIdx] = imag[evenIdx] - tImag;
          real[evenIdx] = real[evenIdx] + tReal;
          imag[evenIdx] = imag[evenIdx] + tImag;
        }
      }
    }

    return { real, imag };
  }

  inverse(real: Float32Array, imag: Float32Array): Float32Array {
    const n = this.size;
    const outReal = new Float32Array(n);
    const outImag = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      outReal[this.reverseTable[i]] = real[i];
      outImag[this.reverseTable[i]] = -imag[i];
    }

    for (let len = 2; len <= n; len *= 2) {
      const halfLen = len / 2;
      const tableStep = n / len;

      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < halfLen; j++) {
          const tIdx = j * tableStep;
          const cos = this.cosTable[tIdx];
          const sin = this.sinTable[tIdx];

          const evenIdx = i + j;
          const oddIdx = i + j + halfLen;

          const tReal = outReal[oddIdx] * cos - outImag[oddIdx] * sin;
          const tImag = outReal[oddIdx] * sin + outImag[oddIdx] * cos;

          outReal[oddIdx] = outReal[evenIdx] - tReal;
          outImag[oddIdx] = outImag[evenIdx] - tImag;
          outReal[evenIdx] = outReal[evenIdx] + tReal;
          outImag[evenIdx] = outImag[evenIdx] + tImag;
        }
      }
    }

    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = outReal[i] / n;
    }

    return result;
  }

  getMagnitude(real: Float32Array, imag: Float32Array): Float32Array {
    const halfSize = this.size / 2;
    const magnitude = new Float32Array(halfSize);

    for (let i = 0; i < halfSize; i++) {
      magnitude[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }

    return magnitude;
  }

  getPower(real: Float32Array, imag: Float32Array): Float32Array {
    const halfSize = this.size / 2;
    const power = new Float32Array(halfSize);

    for (let i = 0; i < halfSize; i++) {
      power[i] = real[i] * real[i] + imag[i] * imag[i];
    }

    return power;
  }

  getMagnitudeAndPhase(
    real: Float32Array,
    imag: Float32Array,
  ): { magnitudes: Float32Array; phases: Float32Array } {
    const halfSize = this.size / 2;
    const magnitudes = new Float32Array(halfSize);
    const phases = new Float32Array(halfSize);

    for (let i = 0; i < halfSize; i++) {
      magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
      phases[i] = Math.atan2(imag[i], real[i]);
    }

    return { magnitudes, phases };
  }

  fromMagnitudeAndPhase(
    magnitudes: Float32Array,
    phases: Float32Array,
  ): { real: Float32Array; imag: Float32Array } {
    const n = this.size;
    const halfSize = magnitudes.length;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    for (let i = 0; i < halfSize; i++) {
      real[i] = magnitudes[i] * Math.cos(phases[i]);
      imag[i] = magnitudes[i] * Math.sin(phases[i]);
    }

    for (let i = 1; i < halfSize; i++) {
      real[n - i] = real[i];
      imag[n - i] = -imag[i];
    }

    return { real, imag };
  }

  applyHannWindow(data: Float32Array): Float32Array {
    const windowed = new Float32Array(data.length);
    const n = data.length;

    for (let i = 0; i < n; i++) {
      const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
      windowed[i] = data[i] * window;
    }

    return windowed;
  }

  applySynthesisWindow(data: Float32Array): Float32Array {
    const windowed = new Float32Array(data.length);
    const n = data.length;

    for (let i = 0; i < n; i++) {
      const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
      windowed[i] = data[i] * window;
    }

    return windowed;
  }
}
