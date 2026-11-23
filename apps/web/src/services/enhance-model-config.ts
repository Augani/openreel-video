import { setEnhanceModelSource, setSileroWasmPaths } from "@openreel/core";

/**
 * Where Enhance Speech finds its on-device model (public/models/deepfilternet3) and the onnxruntime-web WASM it runs on
 * (served under ort/ by vite-plugins/ort-runtime), resolved against the page so it follows the app's base path (web root,
 * the desktop app:// protocol). Everything is fetched lazily, on first use, by the enhancement worker; importing this
 * module only records the URLs.
 */
const base = typeof document !== "undefined" ? document.baseURI : undefined;
if (base) {
  setEnhanceModelSource({
    baseUrl: new URL("models/deepfilternet3/", base).toString(),
    wasmPaths: new URL("ort/", base).toString(),
  });
  setSileroWasmPaths(new URL("ort/", base).toString());
}
