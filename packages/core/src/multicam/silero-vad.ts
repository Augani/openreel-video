import type { MulticamVadTrack } from "./automatic-edit";

const SILERO_VAD_SAMPLE_RATE = 16_000;
export const SILERO_VAD_CHUNK_SAMPLES = 512;
export const SILERO_VAD_CONTEXT_SAMPLES = 64;
const DEFAULT_SILERO_VAD_MODEL_URL =
  "https://cdn.jsdelivr.net/gh/snakers4/silero-vad@v6.2.1/src/silero_vad/data/silero_vad.onnx";

interface VadTensorLike {
  data: ArrayLike<number | bigint>;
}

interface VadSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, VadTensorLike>>;
}

interface VadRuntimeLike {
  Tensor: new (
    type: "float32" | "int64",
    data: Float32Array | BigInt64Array,
    dimensions: readonly number[],
  ) => unknown;
  InferenceSession: {
    create(
      model: string | ArrayBuffer | Uint8Array,
      options?: Record<string, unknown>,
    ): Promise<VadSessionLike>;
  };
}

interface SileroVadOptions {
  model?: string | ArrayBuffer | Uint8Array;
  runtime?: VadRuntimeLike;
  session?: VadSessionLike;
  onProgress?: (completed: number, total: number) => void;
}

let defaultSessionPromise: Promise<{
  runtime: VadRuntimeLike;
  session: VadSessionLike;
}> | undefined;

async function loadDefaultSession(
  model: string | ArrayBuffer | Uint8Array,
): Promise<{ runtime: VadRuntimeLike; session: VadSessionLike }> {
  if (!defaultSessionPromise) {
    defaultSessionPromise = (async () => {
      // @ts-expect-error onnxruntime-web 1.21 ships types but omits them from its
      // package exports map; Vite still resolves and bundles the ESM entry.
      const runtime = (await import("onnxruntime-web")) as unknown as VadRuntimeLike;
      const session = await runtime.InferenceSession.create(model, {
        executionProviders: ["wasm"],
      });
      return { runtime, session };
    })();
    defaultSessionPromise.catch(() => {
      defaultSessionPromise = undefined;
    });
  }
  return defaultSessionPromise;
}

function resampleMono(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (sourceSampleRate === targetSampleRate) return samples;
  const targetLength = Math.max(
    0,
    Math.round((samples.length * targetSampleRate) / sourceSampleRate),
  );
  const output = new Float32Array(targetLength);
  for (let index = 0; index < targetLength; index++) {
    const position = (index * sourceSampleRate) / targetSampleRate;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    output[index] =
      (samples[left] ?? 0) * (1 - fraction) +
      (samples[right] ?? 0) * fraction;
  }
  return output;
}

/**
 * Runs the pinned Silero VAD ONNX model in 32 ms frames. The runtime is loaded
 * lazily so projects that do not use multicam do not download ONNX/WASM code.
 */
export async function analyzeSileroVad(
  samples: Float32Array,
  sampleRate: number,
  options: SileroVadOptions = {},
): Promise<MulticamVadTrack> {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("Silero VAD requires a positive audio sample rate");
  }
  const loaded = options.runtime
    ? { runtime: options.runtime, session: options.session }
    : await loadDefaultSession(options.model ?? DEFAULT_SILERO_VAD_MODEL_URL);
  const runtime = loaded.runtime;
  const session = options.session ?? loaded.session;
  if (!session) throw new Error("Silero VAD session is unavailable");
  const audio = resampleMono(samples, sampleRate, SILERO_VAD_SAMPLE_RATE);
  const frameCount = Math.ceil(audio.length / SILERO_VAD_CHUNK_SAMPLES);
  const probabilities = new Float32Array(frameCount);
  let context = new Float32Array(SILERO_VAD_CONTEXT_SAMPLES);
  let state = new Float32Array(2 * 1 * 128);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const chunk = new Float32Array(SILERO_VAD_CHUNK_SAMPLES);
    chunk.set(
      audio.subarray(
        frameIndex * SILERO_VAD_CHUNK_SAMPLES,
        (frameIndex + 1) * SILERO_VAD_CHUNK_SAMPLES,
      ),
    );
    const input = new Float32Array(
      SILERO_VAD_CONTEXT_SAMPLES + SILERO_VAD_CHUNK_SAMPLES,
    );
    input.set(context);
    input.set(chunk, SILERO_VAD_CONTEXT_SAMPLES);
    const result = await session.run({
      input: new runtime.Tensor("float32", input, [1, input.length]),
      state: new runtime.Tensor("float32", state, [2, 1, 128]),
      sr: new runtime.Tensor(
        "int64",
        BigInt64Array.from([BigInt(SILERO_VAD_SAMPLE_RATE)]),
        [1],
      ),
    });
    const output = result.output ?? Object.values(result)[0];
    const nextState = result.stateN ?? result.state;
    probabilities[frameIndex] = Math.max(
      0,
      Math.min(1, Number(output?.data[0] ?? 0)),
    );
    if (nextState?.data) {
      state = Float32Array.from(nextState.data, Number);
    }
    context = chunk.slice(-SILERO_VAD_CONTEXT_SAMPLES);
    options.onProgress?.(frameIndex + 1, frameCount);
  }

  return {
    windowMs: (SILERO_VAD_CHUNK_SAMPLES / SILERO_VAD_SAMPLE_RATE) * 1_000,
    probabilities,
  };
}
