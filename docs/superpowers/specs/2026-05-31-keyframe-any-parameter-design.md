# Keyframe Any Parameter — Design

Date: 2026-05-31
Status: Approved design, pending spec review
Area: `apps/web` + `packages/core` — animation / keyframes

## 1. Problem

Keyframing is real but **stranded**: the engine interpolates with bezier easing and there's a
canvas graph editor, but you can only **create** keyframes for a fixed list of 10 properties
(6 transform + `effect.brightness/contrast/saturation/blur`), exposed via a central dropdown in
`KeyframesSection`. The render evaluator hardcodes those four effects by **type** in
`video-engine.getAnimatedEffects` (an `effectPropertyMap` literal). You cannot keyframe other
effects, color grading, audio, crop/anchor, and there's no per-control affordance.

## 2. Goals

- **Keyframe any parameter** across all four families: transform/crop/geometry, every video-effect
  param (per instance), scalar color-grade params, and audio volume/pan.
- **Inline ◇/◆ stopwatch** on every control (After Effects / Premiere / Resolve pattern) — the
  industry-standard, most discoverable UX. Adopt incrementally per section.
- Reuse the existing `keyframeEngine` (interpolation + bezier easing) and the graph editor — **no
  new animation math**.
- One storage model; evaluation distributed to whichever engine owns the property.

## 3. Non-goals (v1 scope boundaries)

- Color-grade **wheels / curves / HSL / LUT** keyframing (multi-value; separate effort). v1 color =
  **scalar** grade params only (e.g. temperature, tint, and any single-value grade sliders).
- No new easing types or a redesigned graph editor (reuse the current one).
- No keyframing of structural/array params (mask point arrays, etc.).

## 4. Current state (verified)

- `Keyframe` (`packages/core/src/types/timeline.ts:138`): `{id, time, property: string, value, easing}`.
  Stored on `clip.keyframes`.
- `keyframeEngine` (`packages/core/src/video/keyframe-engine.ts`): `addKeyframe`, `removeKeyframe`,
  `updateKeyframe`, `getKeyframesForProperty`, `getValueAtTime`, `interpolateWithBezier`, easing
  presets. Property-agnostic — operates on any `property` string.
- `video-engine.ts`: `getAnimatedTransform` (transform.* via animator) + `getAnimatedEffects`
  (hardcoded `effectPropertyMap` for brightness/contrast/saturation/blur, matched by effect **type**).
- `KeyframesSection.tsx` (605 lines): central dropdown of 10 properties + easing UI.
- `KeyframeEditorPanel.tsx` (522 lines): canvas graph editor with draggable keyframes.
- **Color grading** is NOT on the clip — it lives in the web `effects-bridge`
  (`clipColorGrading: Map<clipId, ColorGradingSettings>`), applied by `ColorGradingEngine` in the
  web render path (`project-store.ts:544` reads `effectsBridge.getColorGrading(clipId)`).
- **Audio** volume/pan has its own automation (`clip.automation` → `AutomationPoint[]`), scheduled
  on gain nodes by `audio-engine.ts` (`applyVolumeAutomation`, `resolveClipVolumeAutomation`).
- `LabeledSlider` (`packages/ui`) is the shared control primitive (now also `defaultValue`,
  editable pill).
- Store action `updateClipKeyframes(clipId, keyframes)` exists (`project-store.ts:457`).

## 5. Design

### 5.1 Storage & property naming (one model)
All keyframes remain in `clip.keyframes`. Canonical property strings:
- `transform.position.x|y`, `transform.scale.x|y`, `transform.rotation`, `transform.opacity`,
  `transform.anchor.x|y`, `transform.borderRadius`
- `transform.crop.x|y|width|height`
- `effect.<effectId>.<paramKey>` — **per effect instance** (replaces by-type matching)
- `colorGrade.<param>` — scalar grade params (temperature, tint, …)
- `audio.volume`, `audio.pan`

**Keyframe values are stored in the property's canonical engine unit** (e.g. `transform.scale.x` =
raw `1.0`, `transform.opacity` = `0..1`), NOT the display unit. Display formatting (percentages,
`px`, `°`) is metadata on the registry so a control showing "100%" still stores `1.0`.

### 5.2 Property registry — `packages/core/src/animation/keyframe-registry.ts`
A descriptor per property family:
```ts
interface KeyframePropertyDescriptor {
  property: string;            // canonical key or a builder for effect.<id>.<param>
  label: string;
  family: "transform" | "crop" | "effect" | "colorGrade" | "audio";
  min: number; max: number; step: number;
  unit?: string;               // display unit
  displayScale?: number;       // value * displayScale = displayed number (e.g. 100 for scale/opacity)
  read: (clip: Clip, ctx?: KeyframeReadCtx) => number;   // current static value, canonical unit
}
```
- Static descriptors for transform/crop/audio.
- Effect descriptors are **derived** from `EFFECT_DEFINITIONS` (`types/effects.ts`) — each effect
  type's params (min/max/step/default) become `effect.<id>.<paramKey>` descriptors at runtime given
  an effect instance.
- Color-grade descriptors enumerate the **scalar** fields of `ColorGradingSettings`.
The registry is the single source of truth for ranges/labels/units used by both the UI and the
keyframe-seeding logic. (Color-grade `read` pulls from the bridge; see 5.4.)

### 5.3 Inline control — `apps/web/src/components/editor/inspector/KeyframableControl.tsx`
Wraps `LabeledSlider`, adds the ◇/◆ stopwatch button. Props:
`{ clipId, property, value, onChange, min, max, step, label, unit, displayScale?, defaultValue? }`.
Behavior:
- Reads `clip.keyframes` for `property` (via project-store) and the playhead time (timeline-store);
  `localTime = playhead - clip.startTime`.
- **Not animated** (no keyframes for `property`): renders a plain `LabeledSlider`; `◇` hollow.
  `onChange` updates the static value as today.
- **Enable** (`◇` click): add a keyframe at `localTime` with the current value → `◆` filled.
- **Animated**: the displayed value = `keyframeEngine.getValueAtTime(kfs, localTime)`; changing the
  slider **upserts** a keyframe at `localTime` (`updateClipKeyframes`). A second diamond state marks
  "a keyframe exists exactly at the playhead."
- **Disable** (`◆` click): remove all keyframes for `property`, then bake the value-at-playhead back
  to static via the section's `onChange`.
- Falls back to a plain slider if `property`/`clipId` is absent → **incremental adoption**.
- Pure presentational re the engines; only touches keyframe + the section's existing updater.

### 5.4 Evaluation — three sites, one helper
Add `evaluateKeyframesAt(keyframes, localTime): Map<string, number>` (thin wrapper over
`keyframeEngine.getValueAtTime` grouped by property). Each engine applies the properties it owns:
- **`video-engine`**: replace `getAnimatedEffects`'s hardcoded map. For each `effect.<id>.<param>`
  keyframe, patch that **instance's** param; apply `transform.*` and `transform.crop.*` to the
  animated transform. (Generalizes today's behavior; per-instance.)
- **Web color render path** (where `effectsBridge.getColorGrading(clipId)` feeds `ColorGradingEngine`):
  before applying, override `colorGrade.<param>` fields with their value-at-playhead.
- **`audio-engine`**: evaluate `audio.volume`/`audio.pan` at `t` and apply to the gain/pan nodes —
  bridged into the existing automation scheduling (keyframes take precedence over static
  `clip.volume`/automation when present).

### 5.5 UI rollout (incremental)
Swap `LabeledSlider` → `KeyframableControl` (with `clipId` + `property`) in:
`TransformTab` inline sliders, `CropSection`, `VideoEffectsSection` (per effect param),
`ColorGradingSection` (scalar params), and the audio volume/pan control. The central
`KeyframesSection` and the **graph editor stay** (verify the editor reads `clip.keyframes` generically,
not a hardcoded 10 — adjust grouping/labels to use the registry if needed).

## 6. Data flow
```
User ◇ on a control → KeyframableControl → updateClipKeyframes(clipId, kfs) → project-store (set)
Render @ time t:
  video-engine.createClipRenderInfo → evaluateKeyframesAt → patch transform/crop/effect-instance
  web color path → evaluateKeyframesAt → override colorGrade.* → ColorGradingEngine
  audio-engine → evaluateKeyframesAt → gain/pan at t
```

## 7. Testing (Vitest)
- `keyframe-registry`: descriptors expose correct ranges/units; effect descriptors derive from
  `EFFECT_DEFINITIONS`; color-grade descriptors cover the scalar fields.
- `evaluateKeyframesAt`: returns interpolated values per property at t (incl. bezier easing).
- `video-engine`: a keyframed `effect.<id>.radius` animates that instance; `transform.crop.width`
  animates; two effects of the same type are disambiguated by id.
- Color: `colorGrade.temperature` keyframes override the grading at t.
- Audio: `audio.volume` keyframes drive gain at t (precedence over static volume).
- `KeyframableControl`: enable adds a keyframe at playhead; animated shows interpolated value;
  change upserts; disable clears + bakes static value; plain-slider fallback with no `property`.

## 8. Risks & mitigations
- **Unit mismatch** (display vs stored, e.g. scale %) → registry carries `displayScale`/`unit`;
  keyframe values always canonical. Covered by a registry test.
- **Color/audio cross-layer** → keep storage unified (`clip.keyframes`); only evaluation is
  per-layer; each site is a small, isolated patch.
- **Broad UI swap** → `KeyframableControl` falls back to a plain slider, so sections migrate one at
  a time without regressions; existing slider tests still pass.
- **Graph editor coupling** → verify it's property-generic before relying on reuse; minimal
  registry-driven labels if not.
- **Performance** (per-frame evaluation over many keyframes) → group once per clip per frame; only
  evaluate properties that have keyframes (cheap when none).

## 9. Acceptance
- Any transform/crop/effect-param/scalar-color/audio-volume-pan control can be keyframed via its
  inline ◇/◆, animates correctly in playback and export, and is editable in the graph editor.
- Per-effect-instance keyframing works with duplicate effect types.
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @openreel/web test:run`, and
  `pnpm --filter @openreel/core test:run` pass; existing keyframe behavior preserved.
