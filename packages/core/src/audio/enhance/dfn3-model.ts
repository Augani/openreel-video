import { DFN3_DF_BINS, DFN3_DF_ORDER, DFN3_ERB_BANDS, type Dfn3Inference } from "./dfn3-dsp";

/**
 * Runtime for the DeepFilterNet3 ONNX graphs (encoder, ERB decoder, deep-filter decoder) on onnxruntime-web's WASM
 * backend, which runs in a worker, a browser tab and plain Node alike. Weights are fetched lazily the first time an
 * enhancement runs, so nothing here is in the entry bundle.
 *
 * Model: DeepFilterNet3 by Hendrik Schroeter, https://github.com/Rikorose/DeepFilterNet, MIT OR Apache-2.0,
 * enc.onnx 1.9 MB + erb_dec.onnx 3.3 MB + df_dec.onnx 3.3 MB.
 */

export { DFN3_MODEL_ID } from "./enhance-constants";
export const DFN3_MODEL_FILES = ["enc.onnx", "erb_dec.onnx", "df_dec.onnx"] as const;

interface TensorLike {
  readonly data: Float32Array | ArrayLike<number>;
  readonly dims: readonly number[];
}
interface SessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, TensorLike>>;
}
interface RuntimeLike {
  readonly env: { wasm: Record<string, unknown> };
  readonly Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => unknown;
  readonly InferenceSession: { create(model: Uint8Array, options?: Record<string, unknown>): Promise<SessionLike> };
}

export interface Dfn3ModelSource {
  /** Base URL (absolute, ending in "/") the three .onnx files are served from. */
  readonly baseUrl?: string;
  /** Alternatively the raw file bytes, keyed by file name (tests, desktop main process). */
  readonly bytes?: Readonly<Record<string, Uint8Array>>;
  readonly runtime?: unknown;
  readonly numThreads?: number;
  /** Execution providers for the injected runtime (default ["wasm"]; a native runtime wants ["cpu"]). */
  readonly executionProviders?: readonly string[];
  /** Where onnxruntime-web finds its .wasm and its loader script: a directory URL, or the two files (the bundler gives them hashed names). */
  readonly wasmPaths?: string | { readonly mjs?: string; readonly wasm?: string };
}

async function loadBytes(source: Dfn3ModelSource, file: string): Promise<Uint8Array> {
  const given = source.bytes?.[file];
  if (given) return given;
  if (!source.baseUrl) throw new Error(`Speech model file ${file} has no source`);
  const response = await fetch(new URL(file, source.baseUrl).toString());
  if (!response.ok) throw new Error(`Could not load the speech model (${file}: ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Loads the three graphs and returns the network as a {@link Dfn3Inference}. */
export async function createDfn3Inference(source: Dfn3ModelSource): Promise<Dfn3Inference> {
  const runtime = (source.runtime ??
    // The one runtime the app ships (the JSEP build every ONNX feature shares); its CPU "wasm" provider runs these graphs.
    // @ts-expect-error onnxruntime-web ships types but omits them from its package exports map.
    (await import("onnxruntime-web"))) as RuntimeLike;
  runtime.env.wasm.numThreads = source.numThreads ?? 1;
  if (source.wasmPaths) runtime.env.wasm.wasmPaths = source.wasmPaths;
  const options = { executionProviders: [...(source.executionProviders ?? ["wasm"])], graphOptimizationLevel: "all" };
  const [enc, erbDec, dfDec] = await Promise.all(
    DFN3_MODEL_FILES.map(async (file) => runtime.InferenceSession.create(await loadBytes(source, file), options)),
  );
  const tensor = (data: Float32Array, dims: number[]) => new runtime.Tensor("float32", data, dims);
  return async (erb, spec, frames) => {
    const encoded = await enc.run({
      feat_erb: tensor(erb, [1, 1, frames, DFN3_ERB_BANDS]),
      feat_spec: tensor(spec, [1, 2, frames, DFN3_DF_BINS]),
    });
    const [mask, coefs] = await Promise.all([
      erbDec.run({ emb: encoded.emb, e3: encoded.e3, e2: encoded.e2, e1: encoded.e1, e0: encoded.e0 }),
      dfDec.run({ emb: encoded.emb, c0: encoded.c0 }),
    ]);
    // df_dec's "coefs" is [1, frames, 96, 5 taps * 2] with (re, im) interleaved per tap: already [frame][bin][tap][re, im].
    if (coefs.coefs.dims[3] !== DFN3_DF_ORDER * 2) throw new Error("Unexpected deep-filter output shape");
    return { mask: mask.m.data as Float32Array, coefs: coefs.coefs.data as Float32Array };
  };
}
