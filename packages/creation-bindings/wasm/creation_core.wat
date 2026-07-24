;; WebAssembly proof-of-concept for the @openreel/creation-core C ABI.
;;
;; The full WASM build is produced from packages/creation-core via emscripten
;; (see ../../creation-core/CMakeLists.txt, the EMSCRIPTEN target). This hand-
;; written module is a minimal, dependency-free proof of concept that the WASM
;; bridge in ../src/wasm.ts instantiates and calls at runtime, matching the CPU
;; reference (a box has 24 vertices). The assembled bytes live in ../src/wasm.ts.
(module
  (func (export "box_vertex_count") (result i32)
    i32.const 24))
