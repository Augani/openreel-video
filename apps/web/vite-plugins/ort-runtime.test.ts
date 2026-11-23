import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ORT_RUNTIME_FILES, ortRuntimePlugin } from "./ort-runtime";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("ort-runtime plugin", () => {
  it("emits the WASM runtime under ort/ with fixed names and serves them in dev", () => {
    const plugin = ortRuntimePlugin() as unknown as {
      configResolved(config: { root: string }): void;
      generateBundle(this: { emitFile: (file: { type: string; fileName: string; source: Uint8Array }) => void }): void;
      configureServer(server: { middlewares: { use(handler: (req: { url: string }, res: Record<string, unknown>, next: () => void) => void): void } }): void;
    };
    plugin.configResolved({ root });
    const emitted: Array<{ fileName: string; size: number }> = [];
    plugin.generateBundle.call({ emitFile: (file) => emitted.push({ fileName: file.fileName, size: file.source.length }) });
    expect(emitted.map((file) => file.fileName)).toEqual(ORT_RUNTIME_FILES.map((name) => `ort/${name}`));
    expect(emitted[0].size).toBeGreaterThan(10_000_000); // the JSEP wasm binary (the one runtime every ONNX feature shares)
    expect(emitted[1].size).toBeGreaterThan(1000); // the loader script

    let handler: (req: { url: string }, res: Record<string, unknown>, next: () => void) => void = () => undefined;
    plugin.configureServer({ middlewares: { use: (h) => (handler = h) } });
    const headers: Record<string, string> = {};
    const end = vi.fn();
    handler({ url: "/ort/ort-wasm-simd-threaded.jsep.wasm?v=1" }, { setHeader: (k: string, v: string) => (headers[k] = v), end }, () => undefined);
    expect(headers["Content-Type"]).toBe("application/wasm");
    expect(end).toHaveBeenCalled();
    const next = vi.fn();
    handler({ url: "/ort/other.bin" }, { setHeader: () => undefined, end }, next);
    handler({ url: "/index.html" }, { setHeader: () => undefined, end }, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("ships the model files it documents", () => {
    for (const file of ["enc.onnx", "erb_dec.onnx", "df_dec.onnx", "LICENSE-MIT", "README.md"]) {
      expect(existsSync(join(root, "public", "models", "deepfilternet3", file)), file).toBe(true);
    }
  });
});

const webRequire = createRequire(join(root, "package.json"));
const coreRequire = createRequire(join(root, "../../packages/core/package.json"));

/** The dist directory of the onnxruntime-web install `from` resolves (the package exports map hides package.json). */
function ortDist(from: NodeJS.Require): string {
  return dirname(realpathSync(from.resolve("onnxruntime-web/wasm")));
}

describe("one onnxruntime-web", () => {
  it("core and transformers.js (whisper) resolve the very same onnxruntime-web install", () => {
    const transformers = createRequire(realpathSync(webRequire.resolve("@huggingface/transformers")));
    expect(ortDist(coreRequire)).toBe(ortDist(transformers));
  });

  it("serves files that exist in that install and are the real WebAssembly binary", () => {
    const dist = ortDist(coreRequire);
    for (const name of ORT_RUNTIME_FILES) expect(existsSync(join(dist, name)), name).toBe(true);
    expect([...readFileSync(join(dist, "ort-wasm-simd-threaded.jsep.wasm")).subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });
});
