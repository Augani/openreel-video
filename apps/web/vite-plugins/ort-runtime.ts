import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/**
 * Serves the ONE onnxruntime-web WASM runtime the app ships (the JSEP build, 21 MB, plus its loader script) under `ort/`.
 * Every ONNX user (Enhance Speech, Silero VAD, whisper via transformers.js) runs the same onnxruntime-web version, resolves the
 * "extern wasm" entry (vite.config resolve.conditions) which bundles no .wasm, and points `wasmPaths` at this directory. Naming
 * the files explicitly (instead of letting a bundler hash a copy per importer) keeps `wasmPaths` a plain directory URL that works
 * in the dev server, the production build and the desktop app:// protocol alike. Fetched only when a model first runs.
 */
export const ORT_RUNTIME_FILES = ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"] as const;

const MIME: Record<string, string> = { ".wasm": "application/wasm", ".mjs": "text/javascript" };

function runtimeDir(root: string): string {
  const require = createRequire(join(root, "..", "..", "packages", "core", "package.json"));
  return join(dirname(require.resolve("onnxruntime-web/wasm")), "");
}

export function ortRuntimePlugin(): Plugin {
  let dir = "";
  return {
    name: "openreel-ort-runtime",
    configResolved(config) {
      dir = runtimeDir(config.root);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? "").split("?")[0].replace(/^\/ort\//, "");
        if (!req.url?.startsWith("/ort/") || !(ORT_RUNTIME_FILES as readonly string[]).includes(name)) return next();
        res.setHeader("Content-Type", MIME[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.end(readFileSync(join(dir, name)));
      });
    },
    generateBundle() {
      for (const name of ORT_RUNTIME_FILES) this.emitFile({ type: "asset", fileName: `ort/${name}`, source: readFileSync(join(dir, name)) });
    },
  };
}
