import { expect, test, type Request } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One onnxruntime-web WASM runtime, loaded from ort/, for every ONNX feature, in real Chrome:
 *  - the whisper worker (transformers.js, real whisper-tiny weights) transcribes real speech and its onnxruntime wasm request
 *    is ort/ort-wasm-simd-threaded.jsep.wasm on this origin, never the jsdelivr default transformers.js falls back to;
 *  - Silero VAD (main-thread onnxruntime-web, real silero_vad.onnx) runs on the same speech with the same ort/ directory.
 * Both download a model (whisper-tiny ~100 MB, silero ~2 MB), so they run only with OPENREEL_E2E_ONNX_NETWORK=1. Enhance Speech
 * (DeepFilterNet3, the third ONNX user, models served locally) is covered by enhance-speech.spec.ts. The whisper test drives the worker of a
 * production build (OPENREEL_E2E_DIST); Silero needs the dev server (it imports the core source by path).
 */
const NETWORK = process.env.OPENREEL_E2E_ONNX_NETWORK === "1";
const here = dirname(fileURLToPath(import.meta.url));
const SPEECH = join(here, "../../../packages/core/src/audio/enhance/fixtures/speech-16k.wav");
const CORE_SILERO = join(here, "../../../packages/core/src/multicam/silero-vad.ts");

function readWavF32(path: string): number[] {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      const out: number[] = [];
      for (let i = 0; i < size / 2; i++) out.push(view.getInt16(offset + 8 + i * 2, true) / 32768);
      return out;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

function isOnnxWasm(request: Request): boolean {
  return /\.wasm(\?|$)/.test(request.url()) && /ort-wasm/.test(request.url());
}

test.describe("onnxruntime runtime", () => {
  test.skip(!NETWORK, "set OPENREEL_E2E_ONNX_NETWORK=1 (downloads whisper-tiny and silero models)");
  test.setTimeout(300_000);

  test("whisper worker transcribes speech on the shipped ort/ runtime", async ({ page }) => {
    // The dev server re-optimises dependencies (and reloads the page) the first time the worker imports them.
    test.skip(!process.env.OPENREEL_E2E_DIST, "drives the worker of a production build: set OPENREEL_E2E_DIST");
    const wasmRequests: string[] = [];
    const cdnRequests: string[] = [];
    page.context().on("request", (request) => {
      if (isOnnxWasm(request)) wasmRequests.push(request.url());
      if (/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers/.test(request.url())) cdnRequests.push(request.url());
    });
    // The production model mirror is not guaranteed to be up for a CI run: the same model files come from the public hub when it is not.
    await page.context().route("https://media.openreel.video/models/**", async (route) => {
      await route.continue({ url: route.request().url().replace("https://media.openreel.video/models/", "https://huggingface.co/") });
    });
    await page.goto("/");
    const dist = process.env.OPENREEL_E2E_DIST;
    const workerUrl = dist
      ? `/assets/${readdirSync(join(dist, "assets")).find((name) => /^whisper-worker-.*\.js$/.test(name))}`
      : "/src/workers/whisper-worker.ts";
    if (dist) expect(existsSync(join(dist, "ort/ort-wasm-simd-threaded.jsep.wasm"))).toBe(true);
    const audio = readWavF32(SPEECH);
    const result = await page.evaluate(
      async ({ url, samples }) => {
        const worker = new Worker(url, { type: "module" });
        return await new Promise<{ type: string; text?: string; message?: string }>((resolve) => {
          worker.onmessage = (event: MessageEvent<{ type: string; text?: string; message?: string }>) => {
            if (event.data.type === "result" || event.data.type === "error") resolve(event.data);
          };
          const audioData = Float32Array.from(samples);
          worker.postMessage({ requestId: "onnx-e2e", type: "transcribe", audio: audioData, model: "fast" }, [audioData.buffer]);
        });
      },
      { url: workerUrl, samples: audio },
    );
    console.log(`[onnx] whisper: ${JSON.stringify(result).slice(0, 160)}; wasm requests: ${JSON.stringify(wasmRequests)}`);
    expect(result.type).toBe("result");
    expect((result.text ?? "").trim().length).toBeGreaterThan(20);
    expect(wasmRequests.length).toBeGreaterThan(0);
    for (const url of wasmRequests) expect(url).toMatch(/\/ort\/ort-wasm-simd-threaded\.jsep\.wasm$/);
    expect(cdnRequests).toEqual([]);
  });

  test("silero VAD runs on the shipped ort/ runtime", async ({ page }) => {
    test.skip(!!process.env.OPENREEL_E2E_DIST, "imports the core source by path: dev server only");
    const wasmRequests: string[] = [];
    page.context().on("request", (request) => {
      if (isOnnxWasm(request)) wasmRequests.push(request.url());
    });
    page.on("console", (message) => console.log(`[onnx][console] ${message.text().slice(0, 300)}`));
    page.on("pageerror", (error) => console.log(`[onnx][pageerror] ${error.message.slice(0, 300)}`));
    await page.goto("/");
    const audio = readWavF32(SPEECH);
    const probabilities = await page.evaluate(
      async ({ silero, samples }) => {
        const mod = (await import(/* @vite-ignore */ `/@fs${silero}`)) as {
          setSileroWasmPaths(paths: string): void;
          analyzeSileroVad(samples: Float32Array, rate: number): Promise<Record<string, unknown>>;
        };
        mod.setSileroWasmPaths(new URL("ort/", document.baseURI).toString());
        const track = await mod.analyzeSileroVad(Float32Array.from(samples), 16000);
        return JSON.stringify(track).slice(0, 300);
      },
      { silero: CORE_SILERO, samples: audio },
    );
    console.log(`[onnx] silero: ${probabilities}; wasm requests: ${JSON.stringify(wasmRequests)}`);
    expect(probabilities.length).toBeGreaterThan(10);
    expect(wasmRequests.length).toBeGreaterThan(0);
    for (const url of wasmRequests) expect(url).toMatch(/\/ort\/ort-wasm-simd-threaded\.jsep\.wasm$/);
  });
});
