type WasmWavExports = {
  encodeWav16Mono(
    samples: Float32Array,
    output: Uint8Array,
    dataOffset: number,
  ): void;
  encodeWav16Stereo(
    left: Float32Array,
    right: Float32Array,
    output: Uint8Array,
    dataOffset: number,
  ): void;
  encodeWav24Stereo(
    left: Float32Array,
    right: Float32Array,
    output: Uint8Array,
    dataOffset: number,
  ): void;
  writeWavHeader(
    output: Uint8Array,
    numChannels: number,
    sampleRate: number,
    bitsPerSample: number,
    numSamples: number,
  ): void;
  allocateU8(length: number): Uint8Array;
  allocateF32(length: number): Float32Array;
  memory: WebAssembly.Memory;
};

let wasmModule: WasmWavExports | null = null;
let loadPromise: Promise<WasmWavExports | null> | null = null;

async function loadWasmModule(): Promise<WasmWavExports | null> {
  if (typeof WebAssembly === "undefined") {
    return null;
  }

  try {
    const wasmUrl = new URL("./build/wav.wasm", import.meta.url);
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      return null;
    }

    const wasmBytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(wasmBytes, {
      env: {
        abort: () => {
          throw new Error("WASM abort");
        },
      },
    });

    return instance.exports as unknown as WasmWavExports;
  } catch {
    return null;
  }
}

async function initWasmWav(): Promise<boolean> {
  if (wasmModule) {
    return true;
  }

  if (!loadPromise) {
    loadPromise = loadWasmModule();
  }

  wasmModule = await loadPromise;
  return wasmModule !== null;
}

function jsEncodeWav16Mono(
  samples: Float32Array,
  output: Uint8Array,
  dataOffset: number,
): void {
  for (let i = 0; i < samples.length; i++) {
    let sample = samples[i];
    sample = Math.max(-1, Math.min(1, sample));
    const intSample = Math.round(sample * 32767);
    const offset = dataOffset + i * 2;
    output[offset] = intSample & 0xff;
    output[offset + 1] = (intSample >> 8) & 0xff;
  }
}

function jsEncodeWav16Stereo(
  left: Float32Array,
  right: Float32Array,
  output: Uint8Array,
  dataOffset: number,
): void {
  for (let i = 0; i < left.length; i++) {
    let leftSample = Math.max(-1, Math.min(1, left[i]));
    let rightSample = Math.max(-1, Math.min(1, right[i]));

    const leftInt = Math.round(leftSample * 32767);
    const rightInt = Math.round(rightSample * 32767);
    const offset = dataOffset + i * 4;

    output[offset] = leftInt & 0xff;
    output[offset + 1] = (leftInt >> 8) & 0xff;
    output[offset + 2] = rightInt & 0xff;
    output[offset + 3] = (rightInt >> 8) & 0xff;
  }
}

function jsEncodeWav24Stereo(
  left: Float32Array,
  right: Float32Array,
  output: Uint8Array,
  dataOffset: number,
): void {
  const maxVal = 8388607;
  for (let i = 0; i < left.length; i++) {
    let leftSample = Math.max(-1, Math.min(1, left[i]));
    let rightSample = Math.max(-1, Math.min(1, right[i]));

    const leftInt = Math.round(leftSample * maxVal);
    const rightInt = Math.round(rightSample * maxVal);
    const offset = dataOffset + i * 6;

    output[offset] = leftInt & 0xff;
    output[offset + 1] = (leftInt >> 8) & 0xff;
    output[offset + 2] = (leftInt >> 16) & 0xff;
    output[offset + 3] = rightInt & 0xff;
    output[offset + 4] = (rightInt >> 8) & 0xff;
    output[offset + 5] = (rightInt >> 16) & 0xff;
  }
}

function jsWriteWavHeader(
  output: Uint8Array,
  numChannels: number,
  sampleRate: number,
  bitsPerSample: number,
  numSamples: number,
): void {
  const bytesPerSample = bitsPerSample >> 3;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const fileSize = 36 + dataSize;

  output[0] = 0x52;
  output[1] = 0x49;
  output[2] = 0x46;
  output[3] = 0x46;

  output[4] = fileSize & 0xff;
  output[5] = (fileSize >> 8) & 0xff;
  output[6] = (fileSize >> 16) & 0xff;
  output[7] = (fileSize >> 24) & 0xff;

  output[8] = 0x57;
  output[9] = 0x41;
  output[10] = 0x56;
  output[11] = 0x45;

  output[12] = 0x66;
  output[13] = 0x6d;
  output[14] = 0x74;
  output[15] = 0x20;

  output[16] = 16;
  output[17] = 0;
  output[18] = 0;
  output[19] = 0;

  output[20] = 1;
  output[21] = 0;

  output[22] = numChannels & 0xff;
  output[23] = (numChannels >> 8) & 0xff;

  output[24] = sampleRate & 0xff;
  output[25] = (sampleRate >> 8) & 0xff;
  output[26] = (sampleRate >> 16) & 0xff;
  output[27] = (sampleRate >> 24) & 0xff;

  output[28] = byteRate & 0xff;
  output[29] = (byteRate >> 8) & 0xff;
  output[30] = (byteRate >> 16) & 0xff;
  output[31] = (byteRate >> 24) & 0xff;

  output[32] = blockAlign & 0xff;
  output[33] = (blockAlign >> 8) & 0xff;

  output[34] = bitsPerSample & 0xff;
  output[35] = (bitsPerSample >> 8) & 0xff;

  output[36] = 0x64;
  output[37] = 0x61;
  output[38] = 0x74;
  output[39] = 0x61;

  output[40] = dataSize & 0xff;
  output[41] = (dataSize >> 8) & 0xff;
  output[42] = (dataSize >> 16) & 0xff;
  output[43] = (dataSize >> 24) & 0xff;
}

class WavEncoder {
  private useWasm: boolean;

  constructor() {
    this.useWasm = wasmModule !== null;
  }

  async ensureWasm(): Promise<boolean> {
    if (this.useWasm) {
      return true;
    }

    const available = await initWasmWav();
    if (available) {
      this.useWasm = true;
    }
    return this.useWasm;
  }

  encodeWav16Mono(
    samples: Float32Array,
    output: Uint8Array,
    dataOffset: number,
  ): void {
    if (this.useWasm && wasmModule) {
      wasmModule.encodeWav16Mono(samples, output, dataOffset);
    } else {
      jsEncodeWav16Mono(samples, output, dataOffset);
    }
  }

  encodeWav16Stereo(
    left: Float32Array,
    right: Float32Array,
    output: Uint8Array,
    dataOffset: number,
  ): void {
    if (this.useWasm && wasmModule) {
      wasmModule.encodeWav16Stereo(left, right, output, dataOffset);
    } else {
      jsEncodeWav16Stereo(left, right, output, dataOffset);
    }
  }

  encodeWav24Stereo(
    left: Float32Array,
    right: Float32Array,
    output: Uint8Array,
    dataOffset: number,
  ): void {
    if (this.useWasm && wasmModule) {
      wasmModule.encodeWav24Stereo(left, right, output, dataOffset);
    } else {
      jsEncodeWav24Stereo(left, right, output, dataOffset);
    }
  }

  writeWavHeader(
    output: Uint8Array,
    numChannels: number,
    sampleRate: number,
    bitsPerSample: number,
    numSamples: number,
  ): void {
    if (this.useWasm && wasmModule) {
      wasmModule.writeWavHeader(
        output,
        numChannels,
        sampleRate,
        bitsPerSample,
        numSamples,
      );
    } else {
      jsWriteWavHeader(output, numChannels, sampleRate, bitsPerSample, numSamples);
    }
  }

  encodeFullWav(
    samples: Float32Array[],
    sampleRate: number,
    bitsPerSample: 16 | 24 = 16,
  ): Uint8Array {
    const numChannels = samples.length;
    const numSamples = samples[0].length;
    const bytesPerSample = bitsPerSample >> 3;
    const dataSize = numSamples * numChannels * bytesPerSample;
    const output = new Uint8Array(44 + dataSize);

    this.writeWavHeader(output, numChannels, sampleRate, bitsPerSample, numSamples);

    if (numChannels === 1 && bitsPerSample === 16) {
      this.encodeWav16Mono(samples[0], output, 44);
    } else if (numChannels === 1 && bitsPerSample === 24) {
      this.encodeWav24Mono(samples[0], output, 44);
    } else if (bitsPerSample === 16) {
      this.encodeWav16Stereo(samples[0], samples[1], output, 44);
    } else {
      this.encodeWav24Stereo(samples[0], samples[1], output, 44);
    }

    return output;
  }

  private encodeWav24Mono(
    samples: Float32Array,
    output: Uint8Array,
    dataOffset: number,
  ): void {
    const maxVal = 8388607;
    for (let i = 0; i < samples.length; i++) {
      let sample = Math.max(-1, Math.min(1, samples[i]));
      const intSample = Math.round(sample * maxVal);
      const offset = dataOffset + i * 3;
      output[offset] = intSample & 0xff;
      output[offset + 1] = (intSample >> 8) & 0xff;
      output[offset + 2] = (intSample >> 16) & 0xff;
    }
  }
}

let cachedEncoder: WavEncoder | null = null;

export function getWavEncoder(): WavEncoder {
  if (!cachedEncoder) {
    cachedEncoder = new WavEncoder();
  }
  return cachedEncoder;
}
