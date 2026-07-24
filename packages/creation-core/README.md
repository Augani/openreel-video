# @openreel/creation-core

Phase 0 native engine scaffold for the agent-native creation engine.

This package holds the **C++20 native core** and its **C ABI boundary**
(`include/creation_core.h`). The deterministic CPU reference implementation of
every kernel lives in the TypeScript package
[`@openreel/core/creation`](../core/src/creation) (geometry, sdf, rig, sim,
render, material). The native build must produce results that match that
reference for the golden tests.

## Layout

- `include/creation_core.h` — stable C ABI exposed to the host.
- `src/creation_core.cpp` — native implementation (mirrors the TS reference).
- `CMakeLists.txt` — native (desktop shared library) and WASM (emscripten) builds.

## Build

Native (requires CMake + a C++20 toolchain):

```bash
pnpm --filter @openreel/creation-core build:native
```

WASM (requires emscripten):

```bash
pnpm --filter @openreel/creation-core build:wasm
```

## Loading

[`@openreel/creation-bindings`](../creation-bindings) loads the compiled native
addon / WASM module through this ABI and **falls back to the CPU reference**
(`@openreel/core/creation`) when no native build is present — so the desktop app
works on every platform and CI without the native toolchain.

## Golden preview regression

The desktop Aurora test suite keeps a committed preview golden at
[`apps/desktop/test/goldens/aurora-preview-box.json`](../../apps/desktop/test/goldens/aurora-preview-box.json)
and verifies the current renderer against it in
[`apps/desktop/test/aurora-golden.test.ts`](../../apps/desktop/test/aurora-golden.test.ts).

Refresh that baseline intentionally with:

```bash
cd apps/desktop
UPDATE_AURORA_GOLDENS=1 ./node_modules/.bin/vitest run test/aurora-golden.test.ts
```
