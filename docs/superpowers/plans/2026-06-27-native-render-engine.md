# OpenReel Native Render Engine — Build Plan ("Aurora")

> Goal: a Blender-class 3D renderer **built into the OpenReel desktop app** (Electron, macOS-first, Windows next). Months-long, greenfield, native. Codename **Aurora** (placeholder).
>
> Canonical references to keep on the desk: *Physically Based Rendering* (Pharr/Jakob/Humphreys, pbrt), Blender **Cycles** (path tracer) and **EEVEE** (realtime) source, Intel **OIDN**, **OpenColorIO/ACES**, **OpenUSD/Hydra**.

---

## 0. Goal & scope

**What "Blender-class" means *for us*** (we are not cloning a full DCC):
- A **physically-based, path-traced final renderer** (Cycles-equivalent): global illumination, real area/HDRI lights, a Principled BSDF (metal/glass/SSS/clearcoat/emission), volumetrics, denoising, physical camera (DOF/motion blur), ACES color.
- A **real-time PBR viewport** (EEVEE-equivalent) for instant editor feedback that converges to the final look.
- Purpose-built for **OpenReel content**: cinematic product/sports/motion scenes assembled from our creation engine + imported assets.

**In scope:** rendering, scene/material/light/volume systems, geometry+acceleration, texture pipeline, color management, denoise, camera/lens, animation sampling, AOVs/compositor hooks, the Electron + cloud-GPU-worker integration, an asset/HDRI library.

**Out of scope (we already have it or don't need it):** modeling/sculpt/rig/UV **authoring UI** — the existing creation engine authors scenes; we *consume* creation-scene JSON + glTF/USD. No node editor reinvention beyond compiling our material graph.

**Success criteria (north star):** pick 3 OpenReel scenes (incl. the Ghana-vs-Croatia stadium), render each in Blender Cycles as reference, and match within a perceptual tolerance — real GI, soft shadows, glass/metal balls, volumetric floodlight god-rays, DOF + motion blur, OIDN-clean — at a usable time/frame on Apple Silicon at 1080p.

---

## 1. Strategic decisions (with rationale)

### 1.0 Build vs embed — **DECISION: embed Cycles** (settled 2026-06-27)
The fastest route to genuine Blender quality is to **embed an existing open renderer** rather than build a path tracer from scratch — and we are going with **Cycles** (quality + pace). Host language follows: **C++** (§1.1). A concrete Cycles-embedding integration plan (build, the C++ Scene/Session API, Metal device, the creation-scene→Cycles bridge, OIDN/AOVs/output, licensing/distribution) is being written from verified research; the from-scratch material below (§2 modules, §4 roadmap) is retained as the fallback / for the parts we still build ourselves (the bridge, the realtime preview viewport, the OpenReel + cloud-farm integration).
- **Embed Cycles — CHOSEN.** Cycles *is* Blender's renderer: **Apache-2.0** (commercially embeddable), C++, builds as a **standalone library**, has a **Metal GPU backend for Apple Silicon** (+ OptiX/CUDA/HIP/oneAPI), **OIDN** built in, the **Principled BSDF**, OSL, volumetrics. Embedding it collapses Phases 1–2 (and much of 4) into "**integrate Cycles + write the creation-scene→Cycles bridge + drive it from OpenReel**." Output is Blender-class *by definition*; months saved. **Trade-offs:** a large C++ dependency to build/sign/ship, less low-level control, tied to Cycles' GPU backends.
- Other embeddable open renderers if Cycles doesn't fit: **pbrt-v4** (reference; great to port/learn, not production-tuned), **LuxCore**, **Mitsuba 3** (research/differentiable), **Appleseed** (less active).
- **Build from scratch** only if you want full ownership / no Blender dependency / a unified realtime+final pipeline. Then §1.1 applies.

### 1.1 Language — **conditional**: C++ to embed/lean on the industry stack, Rust to write your own kernels
The right call follows from §1.0:
- **Embedded Cycles, or built-from-scratch leaning on the C++ industry stack → use C++.** The entire production stack is C++-native with first-class APIs (**Embree, OIDN, OpenColorIO, OpenImageIO, OpenSubdiv, OpenVDB, MaterialX, OptiX/CUDA, OpenUSD/Hydra**) and the reference code is C++ (**pbrt's book; Cycles**). This is the **pace winner** when the job is integrating the industry stack — no binding tax, full API surface, port reference code directly. Cost: heavier/uglier build & dependency management (CMake + vcpkg/conan; **USD is a notorious build**) and the usual memory-safety footguns.
- **Writing your own GPU kernels and minimizing third-party C++ deps → Rust + wgpu.** Memory safety (path tracers are pointer-heavy + massively concurrent), fearless parallelism (`rayon`), a more unified GPU layer (**wgpu** beats C++'s fragmented Dawn/raw-Vulkan/Metal-cpp/bgfx options), Cargo over CMake, and a clean Node bridge (**napi-rs**). Cost: the rendering-library ecosystem is thinner — binding crates lag or are incomplete, the FFI boundary is exactly where these C++ libs (and the safety risk) live, and **USD/Hydra in Rust is effectively a non-starter**.
- **Likely answer for us (pace + Blender-class priority): a hybrid** — **Cycles (or a C++ path tracer) for the final render + a separate realtime viewport** (Rust/wgpu, or keep Three.js short-term). Final and preview are different renderers anyway (Blender = Cycles + EEVEE). Hot kernels run on the GPU regardless, so "host language" mostly governs orchestration, BVH build, and CPU fallback.

### 1.2 GPU API — **wgpu** (portable) + native hardware-RT backends behind a trait
- **wgpu** abstracts **Metal** (Mac), **Vulkan** (Win/Linux), **DX12** (Win). Compute shaders run a **wavefront path tracer** in WGSL; a raster pipeline drives the viewport. Cross-platform from day one; Apple-Silicon unified memory is excellent for path tracing.
- Hardware ray tracing in wgpu is still immature, so define a `RayBackend` trait with three impls, shipped in order:
  1. **Portable compute BVH traversal** (custom BVH in compute shaders) — works everywhere, ship first.
  2. **Metal ray tracing** (Metal RT / `MPSRayIntersector`) on Apple Silicon — perf win on Mac.
  3. **Vulkan KHR ray tracing** on Win/Linux (NVIDIA/AMD) — perf win there.
- Why not keep rendering in the browser (Three.js/WebGPU)? The browser sandbox caps memory/threads/compute and exposes no HW-RT. Going native is the *entire* point.

### 1.3 Integration — **sidecar render process** (recommended), N-API addon later
- Spawn Aurora as a **separate native process** that Electron talks to over IPC. Rationale: long GPU renders must never block or crash the Electron main process; the process can be killed/retried; it can run N jobs; and **the same binary runs on the cloud GPU worker** (reuse the existing EC2 A10G pattern) for offload. (Cycles runs out-of-process for exactly these reasons.)
- A thin **napi-rs addon** is the option for tightly embedding a realtime viewport later (zero-copy texture share); start with the sidecar.
- **Protocol:** scene **delta** + camera + render settings → progressive **tiles/buckets** + AOVs streamed back, so the UI refines live. Zero-copy frame handoff via shared memory / **IOSurface** (Mac); fallback to multilayer EXR on disk.

### 1.4 Rollout — hybrid: keep Three.js for scrub-preview; Aurora = final + HQ preview
- Short term: the existing Three.js realtime stays for instant scrubbing. Aurora delivers (1) a **"Final Render"** path (path-traced frames → export pipeline) and (2) an optional **HQ progressive viewport**. Over time Aurora's EEVEE-class viewport replaces Three.js. We are never dark — value ships from Phase 1.

---

## 1.5 — Cycles embedding: the concrete integration plan (CHOSEN PATH)

*Every fact below was verified 2026-06-27 against the live `blender/cycles` source tree + LICENSE and adversarially checked (all 6 critical claims **confirmed** against primary sources).*

### What we pull in
- Clone the **dedicated `blender/cycles` repo** (`github.com/blender/cycles` ↔ `projects.blender.org/blender/cycles`) — **not** the full Blender repo (the same code is vendored at Blender's `intern/cycles`). **Pin a specific commit/tag.**
- Build **libcycles** via CMake: `make update && make` fetches platform-matched **precompiled deps** into `lib/darwin_arm64` / win (we do NOT hand-build OpenImageIO/TBB/Embree/OIDN), or call CMake directly in CI.
- Config: `WITH_CYCLES_STANDALONE_GUI=OFF` (headless render-to-frames), **Metal ON** (default on Apple Silicon), CUDA+OptiX & HIP for Windows, `WITH_CYCLES_HYDRA_RENDER_DELEGATE=OFF` (drive the C++ API, not Hydra), **`WITH_CYCLES_OSL=OFF`** to drop LLVM unless we need OSL shaders (big binary savings), `WITH_STRICT_BUILD_OPTIONS=ON` in CI. Required deps OpenImageIO + TBB; we keep Embree + OIDN + OpenColorIO — all permissive.

### Architecture — Cycles lives in the `aurora-host` helper process (§1.3)
Do **not** load libcycles in-process in Electron (heavy native lib, TBB threads, GPU contexts). A small C++ helper executable links libcycles, takes jobs over IPC, streams progressive frames/AOVs back; crashes are isolated/killable; **same binary on the cloud GPU worker.**

### The C++ render flow (the standalone app `src/app/cycles_standalone.cpp` + `cycles_xml.cpp` is the literal template)
1. `Device::available_devices()` → pick Metal (Apple Silicon) else CPU → `SessionParams{ device, background=true, samples }`.
2. `Session` → its `Scene` (`SceneParams`).
3. Geometry: `scene->create_node<Mesh>()` (push verts/triangles/normals/UVs). **Nodes use the typed factory `scene->create_node<T>()`, not raw `new`.**
4. Material: `create_node<Shader>()` + a `ShaderGraph` with a `PrincipledBsdfNode` (+ image/texture nodes); connect; assign.
5. `create_node<Object>()` (mesh + transform), `Camera`, `Background` (HDRI env), `Integrator`, `Light`.
6. Passes: `PASS_COMBINED` + guide passes `PASS_DENOISING_ALBEDO` + `PASS_DENOISING_NORMAL` (+ AOVs).
7. `DenoiseParams{ use=true, type=DENOISER_OPENIMAGEDENOISE }`.
8. `BufferParams{ width, height }`; `session->start()`; `session->wait()` (background) — a custom **`OutputDriver`** (like `OIIOOutputDriver`) hands float buckets back over IPC as they converge.

### The real work: the **creation-scene → Cycles Scene bridge**
A C++ translator from our serialized creation-scene (objects/transforms, the **material graph**, lights, camera, HDRI) → Cycles `Scene` nodes; our material graph → Cycles `ShaderGraph` (Principled params + image/texture nodes); animation = sample our keyframes per frame and update the Scene (Cycles supports incremental edits + motion-blur motion steps). **Wrap all of Cycles behind our own stable interface** (a thin C ABI / job schema) so OpenReel never touches Cycles' unstable C++ classes directly.

### GPU / Metal
- Metal is first-class, default-ON on Apple Silicon, works from the embedded build (`Device::type_from_string("METAL")`). **Apple-Silicon-only from Cycles 4.3+** (AMD/Intel Metal dropped) — fine for us; GPU-arch detection string-matches ~through M3, so newer chips may need a Cycles bump (pin + test).
- Metal kernels are **JIT-compiled from MSL at first render** (one-time per-machine) — warm + cache on launch; no robust built-in persistent pipeline cache, so manage warm-up UX. Windows: CUDA+OptiX (NVIDIA) / HIP (AMD); OptiX SDK needed at build (commercial use OK — header-only, runtime in driver).

### Color, denoise, output
- Cycles emits **scene-linear float**; **color management is host-side** — apply the OCIO view transform (Filmic/**AgX**) in our pipeline (this is where "the Blender look" lives; don't skip it). OIDN with albedo+normal guides = highest quality; on Apple Silicon OIDN can share the Metal queue (`oidnNewMetalDevice`). Output: pull the float buffer → multilayer **EXR** (beauty+AOVs) + tonemapped PNG → existing ffmpeg mux.

### License & distribution — verified commercially shippable
- **Cycles is Apache-2.0** (relicensed from GPL 2013; LICENSE is verbatim Apache-2.0). Full dep stack permissive — OIIO/OIDN/Embree/oneTBB/OpenVDB(v12+) Apache-2.0, OCIO/OSL/OpenEXR/Imath BSD-3 — **zero copyleft**. Ship inside closed-source OpenReel **without open-sourcing it.**
- **Boundaries:** only the Cycles *renderer library* is Apache — **never link a GPL Blender module** (bpy etc.); `WITH_CYCLES_OSL=OFF` avoids LLVM bloat; use **OpenVDB v12+** (Apache, not the older MPL-2.0); OptiX commercial use is fine.
- Ship: helper binary + GPU kernels + OIDN weights per platform, **signed/notarized** (Developer ID — already wired), via electron-builder `extraResources` or first-run download; same binary on the cloud GPU worker.

### Top risks (verified) & mitigations
- **No stable Cycles ABI** (#1) — the C++ API changes between releases → **pin a version**, wrap behind our stable interface, gate upgrades behind the golden-image suite.
- **Metal JIT warm-up** → warm + cache kernels on launch.
- **Build/dep weight + Windows GPU SDKs** (CUDA/OptiX not in the precompiled bundle) → pinned toolchains, `WITH_STRICT_BUILD_OPTIONS=ON` in CI.
- **Color is host-side** → get OCIO/AgX right or it won't read as Blender.
- **Binary size** (OSL/LLVM + kernels) → trim unused features.
- **Dead end to avoid:** **hdCycles/hdBlackbird is abandoned** — embed upstream `blender/cycles` directly; do **not** ship via the proof-of-concept XML loader or the USD/Hydra delegate (drags full pxr/USD, drops OSL/NanoVDB) unless we deliberately go USD-native later.

### Cycles-path roadmap (replaces the from-scratch §4 for the renderer core)
- **P0 (2–3 wk):** pin + build libcycles for macOS arm64; `aurora-host` links it and renders the bundled **monkey/XML scene** headless → PNG shown in the desktop app. De-risk Metal + codesigning + IPC frame handoff.
- **P1 (4–6 wk):** the **creation-scene→Cycles bridge** (mesh + transform + Principled material + camera + HDRI + lights) → render an OpenReel scene (the stadium) via the C++ API, OIDN + AgX, progressive buckets over IPC. **Exit: beats the current realtime, end-to-end.**
- **P2 (3–5 wk):** full material-graph→ShaderGraph mapping (glass/metal/SSS/emission/textures/UDIM), AOVs/EXR, motion blur + animation sampling.
- **P3 (4–6 wk):** OpenReel integration — "Final Render" → job → progressive → export/ffmpeg; **cloud render farm** (same binary on the GPU worker, R2, auth-broker, per-frame distribution); local-vs-cloud routing.
- **P4 (ongoing):** Windows (CUDA/OptiX/HIP), asset/HDRI library, perf (kernel cache, adaptive sampling), and the realtime preview viewport (keep Three.js short-term; a wgpu EEVEE-class viewport later). **Cycles is the *final* renderer, not the interactive one.**

> The §2 module list and §4 from-scratch roadmap below are retained as the fallback and for the parts we build regardless (the bridge, the realtime viewport, color management, the OpenReel + cloud-farm integration).

---

## 2. Architecture — the modules to build (one crate each)

1. **aurora-math** — vec/mat/quat, transforms, AABB/OBB, coordinate frames, SIMD (`glam`), RNG (PCG + Sobol/Owen-scrambled low-discrepancy sequences for clean sampling).
2. **aurora-scene** — retained scene graph: transforms, **instances**, cameras, lights, materials, volumes; a stable **scene-delta API** (add/update/remove) for incremental editor updates. Bridges: **creation-scene JSON → aurora-scene**, plus glTF/USD import.
3. **aurora-geo** — mesh/curve/point data, normals/tangents, UVs (incl. **UDIM**), **subdivision** (Catmull-Clark; OpenSubdiv or bespoke) + **displacement**, tessellation, **BVH** builder (binned SAH) or HW RTAS, two-level **TLAS/BLAS** instancing.
4. **aurora-tex** — texture system: load (OIIO/tinyexr/png/jpg/ktx2), **mipmaps**, **anisotropic** filtering, UDIM, a tile cache for huge maps, color-space tagging; **procedural** textures (noise/voronoi/musgrave/gradient/checker/wave) compiled into the material.
5. **aurora-mat** — the **Principled BSDF** (Disney/Blender-equivalent: base color, metallic, specular GGX, roughness, anisotropy, sheen, clearcoat, transmission + IOR glass, subsurface/SSS, emission, alpha) as **importance-sampleable closures**; a **node-graph compiler** lowering our creation material graph (and/or **MaterialX**) to a GPU material function. Binds the full PBR map set (albedo/normal/rough/metal/AO/displacement/transmission/emission).
6. **aurora-light** — area lights (quad/disc/sphere/cylinder), **sun + physical sky** (Hosek-Wilkie / Nishita), point/spot with physical falloff, **mesh emitters**, **HDRI environment** with importance sampling (2D CDF), and a **light tree / many-lights** sampler for scenes with thousands of emitters (a stadium of LEDs).
7. **aurora-pt** — the **path-tracing integrator**: camera ray gen (**thin-lens DOF**, physical exposure, **motion blur** via time samples, lens distortion/bokeh), **wavefront** kernels (raygen → intersect → shade → scatter with stream compaction), **MIS** (BSDF + light), **NEE**, **Russian roulette**, **volumetrics** (homogeneous + heterogeneous media — fog, god-rays, smoke), **adaptive sampling** (variance-driven), RGB (spectral optional). Emits AOVs (beauty/albedo/normal/depth/position/emission/**cryptomatte**/per-light).
8. **aurora-denoise** — integrate **Intel Open Image Denoise (OIDN)** (CPU+GPU; what Blender ships) driven by albedo+normal AOVs; optional **temporal** denoise for animation stability.
9. **aurora-rt-viewport** — the **EEVEE-class realtime** path: deferred PBR raster with cascaded shadow maps / RT shadows, **GTAO**, **SSR**, RT reflections, soft area-light approximation, volumetrics, **bloom**, **TAA**, DOF, motion blur, tonemap — for instant feedback, converging into a progressive path trace.
10. **aurora-color** — **OpenColorIO / ACES**: linear working space (**ACEScg**), per-texture input transforms, view/display transforms (**AgX**/Filmic like Blender 4.x), exposure, look transforms. *This is half of "the Blender look."*
11. **aurora-anim** — sample our keyframes (+ glTF/USD animation) to per-frame scene state; **sub-frame** sampling for motion blur; **skinning**/deformation for models.
12. **aurora-comp** — AOV compositor hooks + tonemap + output to **multilayer EXR**/PNG; cryptomatte; hand frames to the existing ffmpeg mux.
13. **aurora-host** — the **sidecar process**: job queue, IPC protocol, shared-memory/IOSurface frame handoff, device/backend selection (Metal/Vulkan/CPU), out-of-core for big scenes. *Same binary on the cloud GPU worker.*
14. **aurora-bridge (TypeScript)** — Electron/Node side: spawn + supervise the sidecar, the **creation-scene → engine-scene serializer**, progressive image display in the editor, render-settings UI, the **"Final Render"** button + export wiring, and **local-vs-cloud routing** (reuse the GPU-worker + R2 + auth-broker stack).

---

## 3. Build vs leverage (do **not** reinvent)

| Need | Leverage (use as-is) | Build ourselves (the secret sauce) |
|---|---|---|
| Denoising | **OIDN** | — |
| Color management | **OpenColorIO** + ACES/AgX configs | look presets |
| Image/EXR I/O | **OpenImageIO** / tinyexr / `image-rs` | — |
| CPU ray/BVH fallback | **Embree** (FFI) | the GPU BVH |
| Subdivision | **OpenSubdiv** (or bespoke) | displacement |
| GPU abstraction | **wgpu** | the kernels |
| Scene interchange | **OpenUSD** (later) | creation-scene bridge |
| Material interchange | **MaterialX** (optional) | Principled BSDF closures |
| Node↔native bridge | **napi-rs** | — |

**What we genuinely build:** the integrator (PT kernels, MIS/NEE/RR, volumetrics, adaptive sampling), the Principled BSDF closures + their sampling, light importance sampling + light tree, the realtime viewport, the scene/material bridge, and the OpenReel integration.

**Strategic option to evaluate in Phase 0:** build Aurora as a **USD Hydra render delegate** (like Karma / Cycles-via-Hydra / Storm). You'd inherit scene management, instancing, and DCC interchange "for free" and align with the industry — at the cost of adopting OpenUSD's build + the Hydra API. Likely outcome: adopt **USD as the interchange + Hydra as the integration boundary in Phase 4+**, but don't block Phase 1 on it.

---

## 4. Roadmap — phased, ~6–12 months, 1–2 focused engineers

> Each phase is **independently shippable**. We get a better-than-realtime renderer from Phase 1.
>
> **If you choose to embed Cycles (§1.0), this roadmap compresses hard:** Phases 1–2 (and much of 4's cinematic FX) become "**integrate + ship Cycles standalone + write the creation-scene→Cycles bridge**," and the engineering shifts to the bridge, the realtime viewport (Phase 3), and the OpenReel/cloud-farm integration (Phase 4). The from-scratch roadmap below applies if you build your own path tracer.

- **Phase 0 — Foundations & spike (3–4 wks).** Lock Rust + wgpu + sidecar. Stand up `aurora-host` + IPC + the creation-scene→aurora-scene bridge. Render one HDRI-lit triangle + sphere, path-traced, OIDN-denoised, displayed **progressively in the desktop app**. De-risk: Metal compute on Apple Silicon, IOSurface frame handoff, napi spawn, golden-image CI harness. **Exit:** a path-traced sphere beats the Three.js sphere, end-to-end.
- **Phase 1 — Offline path-tracer MVP (6–8 wks).** GPU wavefront PT: diffuse + GGX metal/dielectric, area + HDRI lights, SAH BVH + instancing, MIS+NEE+RR, thin-lens DOF, OIDN, ACEScg + AgX, AOVs (beauty/albedo/normal/depth), adaptive sampling + progressive buckets. **Exit:** the stadium rendered photoreal-ish (GI, soft shadows, glossy balls) clearly beating realtime.
- **Phase 2 — Full materials & textures (6–8 wks).** Complete Principled BSDF (transmission/glass + IOR, clearcoat, sheen, SSS, anisotropy, emission, alpha); texture pipeline (all maps, UDIM, mip/aniso, procedurals); the creation material-graph → closure compiler; physical sun+sky. **Exit:** real glass/metal/wet-grass/emissive-facade — material parity with Blender Principled.
- **Phase 3 — Realtime viewport (6–10 wks).** EEVEE-class deferred raster (CSM/RT shadows, GTAO, SSR, area-light, bloom, TAA, DOF, volumetrics), converging to progressive PT; replace Three.js for the HQ preview. **Exit:** interactive near-final viewport at editor framerates.
- **Phase 4 — Cinematic & OpenReel integration (6–8 wks).** Volumetrics (god-rays/fog/smoke), motion blur (sub-frame), lens (bokeh shapes/distortion/exposure), **light tree**; full wiring — timeline-driven animation sampling, the **Final Render** job → tiled/progressive → export/ffmpeg, the **cloud render farm on the GPU worker** (same binary, R2 frame storage, the auth-broker + job queue you already have), local-vs-cloud routing, per-frame distribution. **Exit:** export a finished animated cinematic from the timeline, local or cloud.
- **Phase 5 — Library, import, optimization, polish (ongoing).** glTF/USD/FBX import; an **asset + HDRI + material library** (the Tier-3 realism item); HW-RT backends (Metal RT / Vulkan RT); out-of-core for huge scenes; sampler/denoiser tuning; profiling.

**Cross-cutting every phase:** golden-image **visual-regression CI** (compare to reference renders within tolerance), per-kernel microbenchmarks, **deterministic seeded** renders for tests, crash/leak guards, signed per-platform binaries (Developer ID already wired), telemetry.

---

## 5. Desktop integration & distribution

- One native binary per platform (**mac arm64/x64 universal**, win x64), shipped via electron-builder `extraResources` (or downloaded on first use), **signed + notarized** (Developer ID — already in place). The **same binary is the cloud GPU-worker render service**.
- Runtime device/feature detection (Metal RT? Vulkan RT? VRAM?) → pick backend + sample budget; **Embree CPU fallback** when no capable GPU.
- Memory: **progressive + tiled** rendering so 4K fits; out-of-core textures.
- Reuse existing infra: **GPU worker** (EC2 A10G), **R2** (frame/asset storage), **auth-broker** (attestation→JWT), crash collection, the auto-updater/distribution (dl.openreel.video).

---

## 6. Risks & mitigations

- **Scope/time** — a true Cycles is multi-person-*years*. Mitigate: scope to OpenReel content, leverage OIDN/OCIO/Embree/wgpu, and ship every phase.
- **macOS GPU / RT parity** — no Vulkan/HW-RT on Mac. Mitigate: wgpu + Metal **compute** BVH first; Metal RT later.
- **Color/look fidelity** — get OCIO/ACES + AgX right in Phase 1, or nothing reads "Blender."
- **Maintenance burden** — Rust + a deliberately small surface (no DCC) keeps it tractable; FFI to mature C libs for the hard non-render bits.
- **Test determinism** — seeded RNG + golden images make a stochastic renderer testable.

---

## 7. Effort & team (honest)

- **1 strong graphics engineer:** ~9–12 months to Phase 4 (a usable cinematic engine). **2 engineers:** ~6 months + faster polish. Phasing means value ships from Phase 1.
- **Skill profile:** GPU/path-tracing experience (wgpu/Metal/Vulkan, pbrt/Cycles familiarity), comfortable with Rust + a bit of FFI.

---

## 8. Kickoff checklist

- [ ] Confirm **Rust + wgpu + sidecar** (vs C++ / N-API).
- [ ] Decide **USD/Hydra** adoption now vs Phase 4.
- [ ] Stand up the **Phase-0 spike** (a new `engine/` cargo workspace or a sibling repo) + the **golden-image CI** harness.
- [ ] Pick 3 reference scenes; render them in **Blender Cycles** as the visual north-star and acceptance bar.
- [ ] Reserve the realtime levers we already proved (bloom/GTAO/DOF post-FX, HDRI, CSM, full PBR maps) as the *interim* quality path while Aurora Phases 1–3 land.

---

## Progress

### Slice 1 — Native desktop Aurora preview path — LANDED 2026-06-27

The first end-to-end desktop engine slice now exists in the repo as a real, app-wired path rather than just a plan:

- `@openreel/creation-core` now exposes a **native mesh ray-trace ABI** (`orc_render_mesh_rgba`) alongside the existing geometry ABI, with C++ parity coverage.
- `@openreel/creation-bindings` now wraps that renderer, reports whether rendering is truly **native** vs CPU fallback, and keeps the addon discovery path robust for both workspace and packaged-app layouts.
- Desktop now ships an **Aurora host sidecar entry** (`apps/desktop/src/aurora-host`) plus a main-process client/IPC bridge (`openreel:aurora:renderPreview`) so rendering runs **out of process** from Electron main.
- The web renderer now uses Aurora on desktop for the **Creation stage fallback preview** when playback is idle: it draws the deterministic CPU preview immediately, then refines it with the Aurora render result once the sidecar responds.
- Verification landed across the native C++ test, bindings tests, desktop IPC tests, desktop preview-host test, desktop typecheck, web typecheck, and the desktop bundle build.

This is the shipped **P0/P1 vertical slice**: OpenReel can serialize a semantic creation scene, bake it, render it through the new native path, and surface the result inside the desktop app. The remaining roadmap items above still stand for Cycles-grade final rendering, richer material/light parity, progressive buckets/AOVs, and full Final Render/export/cloud integration.

### Slice 2 — Shared motion preview + export Aurora path — LANDED 2026-06-27

Aurora is now wired into the shared motion render stack instead of living only as a stage-only fallback overlay:

- `MotionRenderer` now supports an external `renderScene3D(...)` hook on the asset resolver, so a bound `scene3d` layer can render through Aurora before falling back to the existing Three.js renderer.
- Core now exposes a creation binding resolver plus a browser-side Aurora bridge that converts desktop `renderPreview` IPC results into `ImageBitmap`s for the shared renderer/export path.
- The web motion asset resolver now maps `motion-scene3d` creation bindings to Aurora renders, which means **desktop stage preview** and **frame export helpers** both use the same native path.
- `VideoEngine` now supplies that same Aurora-backed resolver during motion composition rendering, so the **shared export/render pipeline** can use native creation renders instead of only the web preview path.
- Focused coverage landed for creation binding resolution, the motion renderer’s native-before-Three behavior, the web Aurora scene resolver, and the video engine’s Aurora-backed export resolver.

This completes the current desktop-native integration loop for bound Creation scene layers: the editor preview, shared motion renderer, and export engine now all know how to route a `scene3d` layer into Aurora when a matching creation binding exists, while preserving the existing Three.js fallback when it does not.

### Slice 3 — Progressive Aurora preview sessions — LANDED 2026-06-27

Aurora now has a real preview-job lifecycle instead of only a one-shot preview RPC:

- Desktop IPC now exposes `startPreviewSession`, `cancelPreviewSession`, and streamed preview events alongside the existing `renderPreview` call.
- The `aurora-host` sidecar can now run **multi-pass progressive preview sessions** (`draft` → `refine` → `final`) and stream each pass back as it completes.
- The main-process Aurora client tracks per-session listeners, forwards streamed events back to the renderer, and cleans up active preview sessions when a renderer `WebContents` is destroyed.
- The motion stage fallback overlay now consumes those streamed events on desktop, so idle Creation previews can refine from the deterministic CPU fallback into progressively better Aurora frames before the main renderer’s full frame lands.

This shifts Aurora closer to the process model the long-range plan actually wants: a native render host that owns longer-lived jobs and can stream refinement, rather than a stateless single-frame helper.

### Slice 4 — Aurora golden-image regression harness — LANDED 2026-06-27

The repo now has an actual image-regression guardrail for Aurora preview output:

- Desktop tests gained a shared fixture scene plus a committed **golden preview** baseline (`apps/desktop/test/goldens/aurora-preview-box.json`).
- The new `aurora-golden.test.ts` renders the fixture through Aurora, decodes the PNG, and compares it against the committed golden with a bounded pixel-diff tolerance.
- The harness supports intentional baseline updates through `UPDATE_AURORA_GOLDENS=1`, so renderer changes can deliberately refresh the committed reference rather than silently drift.

This is the first real step toward the plan’s cross-cutting **golden-image visual-regression CI** promise: Aurora changes now have a deterministic rendered artifact that can fail loudly when visuals move unintentionally.

### Slice 5 — Native Aurora motion final-render path — LANDED 2026-06-27

Aurora now owns a real desktop **final render/export** path for the compatible Creation-backed motion case instead of stopping at preview-only integration:

- Desktop IPC now exposes **Aurora sequence sessions** (`startSequenceSession`, `cancelSequenceSession`, streamed `sequenceEvent`s) so the sidecar can render a whole frame sequence out of process and stream raw RGBA frames back to the renderer.
- The `aurora-host` preview renderer was refactored to expose reusable raw-frame output, and the new sequence-session runner now drives frame-by-frame Aurora renders across a composition duration with deterministic progress events.
- The web motion export helper now detects a **strictly compatible** bound `scene3d` composition (single visible full-frame scene layer, no extra compositing transforms/effects) and routes it through Aurora + the desktop native ffmpeg backend instead of the generic browser export loop.
- That native export branch now handles the save-path handshake, desktop audio chunking, Aurora frame streaming, bitmap conversion, native mux finalization, and preserves the existing generic export fallback for everything outside the narrow compatibility gate.
- Coverage landed for the new IPC contract/schema, the desktop sequence-session runner, and the web native-export branch, alongside fresh desktop/web typecheck passes.

This is the first shipped **native final-render vertical slice** for Aurora: for simple Creation-backed motion scenes, the desktop app now renders the frame sequence out of process and hands it directly into the native export backend while leaving the broader hybrid fallback path intact.

### Slice 6 — Native Aurora renderer executable + desktop packaging path — LANDED 2026-06-28

Aurora now has an actual **native renderer executable artifact** in the repo instead of only a Node-hosted addon path:

- `@openreel/creation-core` now builds a standalone `creation_aurora_renderer` executable next to `libcreation_core`, with a binary request/response format and a native self-test that round-trips a render through file I/O.
- The desktop Aurora host now prefers that executable for per-frame renders by serializing the baked mesh + camera/light request to a temp file, invoking the native renderer, and decoding the returned RGBA frame before falling back to the in-process creation backend.
- Existing preview, progressive preview-session, and sequence-session flows all benefit automatically because they already converge on `renderAuroraFrame(...)`; the orchestration remains in the JS sidecar for now, while the actual frame renderer has moved into a real native binary.
- Desktop build packaging now stages the renderer executable plus `libcreation_core` into `apps/desktop/resources/aurora`, and electron-builder now includes that directory as an app resource so packaged builds have a concrete landing zone for the native engine artifact.
- Verification landed across the native CMake/CTest path, desktop Vitest coverage, desktop typecheck, and the desktop tsup bundle build; the packaged executable now carries an `@executable_path` rpath so it can resolve the colocated native library.

This is the first concrete step from a **Node-hosted prototype** toward the plan’s intended **native render sidecar** architecture: Aurora’s frame renderer is now a standalone native executable that the desktop app can stage and call directly, which is the same seam we can later swap from the current mesh renderer to embedded Cycles.

### Slice 7 — Persistent native Aurora render service path — LANDED 2026-06-28

Aurora’s native executable is now usable as a **long-lived render service** instead of only a spawn-per-frame command:

- `creation_aurora_renderer` now supports a `serve` mode over **length-prefixed stdio messages**, so the same native process can handle repeated render requests without respawning for every frame.
- The native executable’s self-test now covers both the file-based round-trip and the in-memory served-request path, which gives the desktop bridge real verification on the new transport instead of only compile coverage.
- The desktop native-renderer bridge now maintains a **persistent child process** for the native renderer and serializes requests sequentially through it, while preserving the previous file-based request/response path as a fallback when the stdio service fails.
- Existing Aurora preview, progressive preview-session, and sequence-session flows automatically pick up the lower-overhead persistent path because they already funnel through the shared native-renderer bridge.
- Verification landed again across native CMake/CTest, desktop Vitest, desktop typecheck, and the desktop main-process bundle build.

This shifts Aurora another step toward the planned **real native sidecar**: the native renderer is no longer just an executable we can invoke, but a reusable service process with a stable transport boundary that the desktop app can keep hot across multiple renders.

### Decision 2026-06-28 — Cycles deferred; EEVEE-class realtime is the After-Effects quality track

After reviewing slices 1–7 against this plan, the verdict: the **integration spine is on-path and well-built** (out-of-process native host, length-prefixed stdio serve transport, preview/sequence sessions, golden harness, native export, electron-builder packaging), but the **renderer core is a Phase-0 placeholder** — `orc_render_mesh_rgba` / `rayTraceMeshToImage` is a brute-force **single-bounce CPU ray caster** (Lambert × base color + one hard shadow ray, no BVH). It delivers ~none of this plan's photoreal north star (no GI, no Principled BSDF, no area/HDRI lights, no AA, no ACES/AgX, no OIDN, no GPU/Metal, no Cycles).

The Cycles embedding (§1.0/§1.5) was scoped and started (pinned `blender/cycles` @ `a3df10e0` cloned to `~/.openreel/aurora/cycles`, standalone build template + `OIIOOutputDriver` reviewed). **It was then deliberately deferred**: Cycles is *not* needed for After-Effects-style work. AE work = 2D compositing + motion + lightweight 3D (extruded text/shapes, 3D layers, reflections) — none path-traced; even AE's own "Advanced/Cinema 4D" renderer is a realtime rasterizer. Cycles only earns its large cost (multi-GB deps, hours of build, a heavy signed native lib) for **photoreal cinematic 3D** (the stadium/product-viz north star), a separate capability. The libcycles `make update` download was **not** run (disk was at 96%).

**Shipped instead — EEVEE-class upgrades to the realtime renderer** `packages/core/src/motion/motion-three-renderer.ts` (the AE/motion `scene3d` path), all behind `MotionRenderQuality` with safe defaults, headless-safe, verified (8 TDD helper tests + 369 core + 13 web motion tests, plus a real-browser render: bloom, glass refraction, polished metal, soft contact shadows, clean AA, AgX):
- **Anti-aliasing through post-processing fixed** — `EffectComposer` now uses a multisampled **HalfFloat** render target (`antialiasSamples`, default 4). The default post-FX path previously bypassed MSAA (jagged edges) and was LDR.
- **AgX tone mapping default** (the Blender 4.x look; configurable: aces/filmic/neutral/linear/none + `exposure`), applied per-frame.
- **Soft RectAreaLight (softbox)** key for product-grade speculars (`softLighting`).
- **Procedural IBL presets** — `MotionScene3DLighting.environment` widened to studio|warm|cool|sunset|city|dark|none via gradient-sky PMREM env maps (`environmentIntensity`).
- **HDRI / world environment** — `environmentUrl` (equirect .hdr/.exr/.jpg/.png via `HDRLoader`/`EXRLoader`/`TextureLoader`, chosen by extension) for real image-based lighting + reflections, plus opt-in `environmentBackground` backdrop. Async + non-blocking (preset fallback shown until the map loads; cached per-url). Verified in-browser (metal reflects + glass refracts the equirect, backdrop shows).

The PBR detail-map set (normal/roughness/metalness) was found to be **already wired** end-to-end for scene mode (`motion-renderer.ts` → `applyDetailMaps`).
- **Scene3D Lighting UI** — `PropertiesPanel.tsx` gained a "Lighting & Environment" section for `scene3d` layers (environment preset dropdown, HDRI map URL, backdrop + ground-shadow toggles, ambient/key/rim intensity + key color), so 3D lighting is now human-editable (it was agent-only before). Render-tested in `PropertiesPanel.scene3d.test.tsx`.
- **Agent tool** — `set_motion_scene3d_lighting` (in `packages/agent/src/registry.ts`, surfaced in the system prompt) lets the AI agent set the same lighting/environment/HDRI fields on a scene3d layer; validates the env preset, clamps intensities, guards non-scene3d layers. Tested in `motion-scene3d-lighting.test.ts` (5 cases). 170/170 agent tests pass.

This realizes the plan's reserved **interim realtime quality path** (§8 kickoff bullet, §1.4 "keep Three.js for now, EEVEE-class viewport later"). Cycles remains the path *only* if/when photoreal cinematic 3D is funded; the pinned source is staged for that. Remaining EEVEE Tier-1 TODO: CSM cascaded shadows, SSR reflections, detail maps on the legacy single-object path, and surfacing the new quality knobs (toneMapping/exposure/environmentUrl) through the store/UI/agent.
