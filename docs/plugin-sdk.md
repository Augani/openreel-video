# OpenReel effect plugin SDK

OpenReel hosts third-party image effects the way Premiere and Resolve host OFX
image effects, but with a portable package that runs unchanged in the web app
and the desktop app. Native OpenFX binaries cannot load in a browser, so a
plugin is a small folder of text files:

| File           | Purpose                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `plugin.json`  | Manifest: identity, parameters (types, ranges, defaults), entry files    |
| `shader.wgsl`  | GPU implementation: one WGSL function, `fn effect(...)`                  |
| `cpu.js`       | Optional CPU implementation / fallback: one JavaScript `process(...)`    |

A plugin needs a shader, a CPU file, or both. Package the folder as a zip with
the extension `.orplugin` (`cd my-plugin && zip -r ../my-plugin.orplugin .`),
or install the folder directly.

Three complete examples live in `examples/effect-plugins/`:

* `film-grain`: WGSL **and** CPU fallback, animated (time driven), bool parameter
* `chromatic-aberration-prism`: WGSL only, angle / point / choice parameters
* `duotone-map`: CPU only (runs in a sandboxed Worker), colour / choice parameters

## Installing

* **Web:** Effects > Manage plugins... > Install from file (or from folder).
  Plugins are stored in the browser's IndexedDB.
* **Desktop:** Effects > Manage Plugins... (native menu). Plugins are installed
  into `<user data>/plugins/<id>/`; "Open plugins folder" reveals it. Every
  package is validated again by the main process before it touches disk, and
  every folder is validated again each time the list is read.

Installing a plugin with the same `id` replaces it (an upgrade). Installed
plugins appear in the Effects panel (in their category, in "All", and under the
"Plugins" filter) with an auto-generated parameter UI in the inspector.

## plugin.json

```json
{
  "apiVersion": 1,
  "id": "film-grain",
  "name": "Film Grain Pro",
  "version": "1.0.0",
  "category": "Stylize",
  "author": "OpenReel",
  "description": "Animated film grain.",
  "timeDriven": true,
  "parameters": [
    { "key": "amount", "label": "Amount", "type": "float", "min": 0, "max": 1, "step": 0.01, "default": 0.35 },
    { "key": "colored", "label": "Coloured grain", "type": "bool", "default": false }
  ],
  "shader": { "file": "shader.wgsl" },
  "cpu": { "file": "cpu.js", "timeoutMs": 2000 }
}
```

| Field         | Rules                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `apiVersion`  | Must be `1`.                                                                                   |
| `id`          | `[a-z0-9][a-z0-9_-]{0,47}`. Stable forever: projects reference it.                             |
| `version`     | Semantic version. Saved with every effect that uses the plugin.                                |
| `category`    | `Stylize`, `Creative`, `Blur`, `Color`, `Keying`, `Distort` or `Generate`.                     |
| `timeDriven`  | `true` when the look changes every frame with constant parameters (grain, flicker).            |
| `shader.file` / `cpu.file` | Plain file names in the package (no folders). At least one of the two is required. |
| `cpu.timeoutMs` | Per-frame CPU budget, 50 to 10000 ms (default 2000).                                         |

### Parameters

Up to 32 per plugin. `key` is `[A-Za-z][A-Za-z0-9]{0,31}`, unique, not a WGSL
keyword and not starting with `or` followed by a capital (reserved for the host).

| `type`   | Stored in the project as | `default` / extras                              | In WGSL (`params.key`) | In JS (`params.key`)  | Keyframable                  |
| -------- | ------------------------ | ----------------------------------------------- | ---------------------- | --------------------- | ---------------------------- |
| `float`  | number                   | `min`, `max`, `step`, `unit`                    | `f32`                  | number                | yes                          |
| `int`    | integer                  | `min`, `max`, `step`                            | `i32`                  | number                | yes (rounded after sampling) |
| `angle`  | degrees                  | `min`/`max` (default -360..360)                 | `f32` **radians**      | number, **degrees**   | yes                          |
| `bool`   | boolean                  | `true`/`false`                                  | `u32` (0 or 1)         | boolean               | no                           |
| `choice` | the choice `value`       | `choices: [{value,label}]`, `default` is a value| `i32` index in `choices` | the `value` string  | no                           |
| `color`  | `"#rrggbb"`              | `"#rrggbb"`                                     | `vec4<f32>` (sRGB 0..1, a = 1) | `{r,g,b}` 0..1 | yes, per channel `r`,`g`,`b` |
| `point`  | `{x, y}` 0..1            | `{ "x": 0.5, "y": 0.5 }`                        | `vec2<f32>`            | `{x, y}`              | yes, `x` and `y`             |

`keyframable` defaults to `true` for every type that supports it; set `false`
to hide a parameter from the Keyframes panel. Values outside `min`/`max` (hand
edited projects, old versions) are clamped at render time.

## WGSL shader contract

Write one function. The host adds the bindings, the generated `OrParams`
struct, a full-screen vertex stage and the fragment entry point:

```wgsl
fn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(1.0 - src.rgb, src.a);
}
```

* `uv` is `(0,0)` at the top-left and `(1,1)` at the bottom-right of the frame.
* `src` is the input pixel, **straight (non-premultiplied)** RGBA, 0..1.
* The return value is straight RGBA.

Available to your code:

| Name               | Meaning                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `params.<key>`     | Your manifest parameters, typed as in the table above                |
| `host.resolution`  | `vec2<f32>` frame size in pixels                                     |
| `host.time`        | clip-local time in seconds                                           |
| `host.frame`       | clip-local frame index at 30 fps (`f32`)                             |
| `orSample(uv)`     | bilinear, edge-clamped sample of the input frame                     |
| `orHash21(p)`      | deterministic hash `vec2<f32> -> f32` in [0,1)                       |

Rules enforced when the package is installed: no `@group`/`@binding`
declarations, no `@vertex`/`@fragment`/`@compute` entry points, no `enable`
extensions, nothing named `orVs`, `orFs`, `OrParams`, `OrHost`, `OrVsOut`,
max 128 KB. The shader is then compiled on the user's GPU
(`getCompilationInfo`); errors are shown in the install dialog with line
numbers **of your file**. A shader-only plugin whose shader does not compile is
refused; a plugin with a CPU fallback installs with the error as a warning.

Make output a pure function of `(uv, params, host.time/frame)`. Grain, noise
and flicker must derive from `host.frame` / `orHash21`, never from a running
counter, otherwise preview and export would differ.

## CPU contract

```js
function process(frame, params, host) {
  // frame.width, frame.height, frame.data (Uint8ClampedArray, straight RGBA)
  // params: resolved manifest parameters (colours are {r,g,b} in 0..1)
  // host:   { time, frame }
  for (var i = 0; i < frame.data.length; i += 4) {
    frame.data[i] = 255 - frame.data[i];
  }
  // Edit frame.data in place, or return a Uint8ClampedArray of the same length.
}
```

The CPU file is used when WebGPU is unavailable, when the WGSL path failed, or
as the only implementation. It runs in a dedicated Worker and is a scripting
sandbox, so:

* **No DOM, no network, no storage.** `fetch`, `XMLHttpRequest`, `WebSocket`,
  `EventSource`, `importScripts`, `Worker`, `indexedDB`, `caches`, `navigator`,
  `WebAssembly`, `SharedArrayBuffer`, `crypto`, `performance` and Node globals
  are deleted from the Worker's global scope before your code runs.
* **No dynamic code.** The `Function`, `AsyncFunction` and `GeneratorFunction`
  constructors are disabled and `eval` is removed.
* **Install-time lint.** Source mentioning `import`, `eval`, `Function`,
  `.constructor`, `__proto__`, `fetch`, `XMLHttpRequest`, `WebSocket`,
  `postMessage`, `self`, `globalThis`, `window`, `require(` and similar is
  refused, with the offending name in the error.
* **A hard per-frame timeout** (`cpu.timeoutMs`, default 2 s). On timeout the
  Worker is terminated and respawned; the frame is bypassed.
* **Size limits.** 256 KB source, 1 MB per package file, 4 MB per package, at
  most 64 files, zip bombs rejected from the central directory.

Honest limits: this is defence in depth for effect code, not a proof of
isolation. The lint is textual, the Worker shares the process with the page, and
a plugin can still burn CPU up to its timeout. Only install plugins you trust.
`Math.random` and `Date` work; avoid them (see determinism above).

## What the host guarantees

A plugin can never crash a render.

1. WGSL is compiled and validated before use; errors are surfaced, not thrown at render time.
2. Per frame, the GPU path runs under a 5 s budget; the CPU path under `cpu.timeoutMs`.
3. If the GPU path fails and a CPU fallback exists, the CPU file renders instead and the plugin is shown as *degraded* with the shader error.
4. If nothing works, the effect is **bypassed**: the frame passes through unchanged.
5. After 3 consecutive failed frames the plugin is bypassed without being run (so a broken plugin does not cost a timeout on every frame of an export) until you press **Retry** in Manage Plugins / the inspector, or reinstall it.

Preview, playback, transitions and export all render effects through the same
`VideoEffectsEngine` call, which dispatches plugin effects to the same host, so
a frame is identical in preview and export (same plugin, same parameters, same
sampled keyframes, same backend).

## In projects

A plugin effect is a normal clip effect with `type: "plugin:<id>"` and the
parameter values as `params`, plus `params.__pluginVersion` (the version it was
authored with). Adding, editing, toggling, reordering and removing it all go
through the undoable action system (`effect/add`, `effect/update`, ...).

* **Keyframes** use the ordinary clip keyframes with the property
  `effect.plugin:<id>.<key>` (and `.x`/`.y` for points, `.r`/`.g`/`.b` for
  colours). They are stored, undone, graphed and interpolated (all easings,
  Bezier handles) by the shared keyframe engine and appear in the Keyframes
  panel under "Plugins" for any plugin that has an effect on the clip. As with
  built-in effects, keyframes of a type drive the first effect of that type on a
  clip.
* **Missing plugin.** If a project is opened where the plugin is not installed,
  nothing is dropped: the effect, every parameter and every keyframe stay in
  the project, the inspector shows a placeholder ("plugin X v1.0.0 is not
  installed ... settings are kept"), and the effect is skipped at render time.
  Installing the plugin makes the same saved effect render again.
* **Version mismatch.** If the installed version differs from the saved one the
  installed plugin is used and the inspector notes both versions. Parameters
  the new version no longer declares are kept in the project but ignored; new
  parameters take their defaults.

## Testing your plugin

```sh
# manifest + package validation, sandbox behaviour, keyframes, save/load
pnpm --filter @openreel/core exec vitest run src/plugins
```

`packages/core/src/plugins/plugins.test.ts` shows how to load a plugin folder in
a test (`parsePluginPackage`) and run a CPU plugin in a real worker. The shipped
Playwright spec `apps/web/e2e/effect-plugins.spec.ts` installs a `.orplugin` from
a file, applies it, keyframes a parameter, exports and compares the exported
frame with the preview.
