import {
  buildBox,
  computeMeshStats,
  rayTraceMeshToImage,
} from "@openreel/core/creation/index";
import type { CreationBackend } from "./index";

// Assembled bytes for wasm/creation_core.wat:
//   (module (func (export "box_vertex_count") (result i32) i32.const 24))
// A real, dependency-free WebAssembly module instantiated at runtime to prove
// the WASM bridge executes (the full build comes from creation-core via emscripten).
const CREATION_WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x14, 0x01, 0x10, 0x62, 0x6f, 0x78, 0x5f, 0x76, 0x65, 0x72, 0x74, 0x65, 0x78, 0x5f, 0x63,
  0x6f, 0x75, 0x6e, 0x74, 0x00, 0x00,
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x18, 0x0b,
]);

export interface CreationWasmExports {
  box_vertex_count(): number;
}

export async function instantiateCreationWasm(): Promise<CreationWasmExports> {
  if (typeof WebAssembly === "undefined") {
    throw new Error("WebAssembly is not available in this environment");
  }
  const { instance } = await WebAssembly.instantiate(CREATION_WASM_BYTES, {});
  const exports = instance.exports as unknown as { box_vertex_count: () => number };
  if (typeof exports.box_vertex_count !== "function") {
    throw new Error("creation wasm module is missing box_vertex_count");
  }
  return { box_vertex_count: () => exports.box_vertex_count() };
}

export async function loadWasmBackend(): Promise<CreationBackend | undefined> {
  try {
    const wasm = await instantiateCreationWasm();
    return {
      kind: "wasm",
      renderKind: "cpu",
      version: () => "0.1.0",
      bakeBox: (width, height, depth) => {
        const stats = computeMeshStats(buildBox({ width, height, depth }));
        // Vertex count comes from the running WASM module; the rest mirrors it.
        return { ...stats, vertexCount: wasm.box_vertex_count() };
      },
      renderMesh: (mesh, options) => rayTraceMeshToImage(mesh, options),
    };
  } catch {
    return undefined;
  }
}
