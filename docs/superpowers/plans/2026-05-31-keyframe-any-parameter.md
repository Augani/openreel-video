# Keyframe Any Parameter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users keyframe (animate over time) *any* parameter — transform, crop/geometry, every video-effect param (per effect instance), scalar color-grade params (temperature/tint), and audio volume/pan — via an inline ◇/◆ stopwatch on each control.

**Architecture:** One storage model (`clip.keyframes`, canonical engine units). A core **property registry** + an `evaluateKeyframesAt` helper. Evaluation distributed to the engine that owns each property: `video-engine` (transform/crop/effects), the web color render path (`colorGrade.*`), and `audio-engine` + realtime graph (`audio.volume/pan`). UI: a `KeyframableControl` wrapper around the shared `LabeledSlider`, adopted incrementally per section.

**Tech Stack:** TypeScript (strict), React 18, Zustand, WebGPU/Canvas render, Web Audio, Vitest. Reuses existing `keyframeEngine` (interpolation + bezier easing) and the generic `KeyframeEditorPanel` graph editor.

**Key facts (from the codebase, do not re-derive):**
- `Keyframe = {id, time, property, value, easing}` on `clip.keyframes` (readonly; replace whole array). Times are **clip-local seconds** (`playhead - clip.startTime`).
- `keyframeEngine` (singleton, `packages/core/src/video/keyframe-engine.ts`): `addKeyframe(_clipId, property, time, value, "linear") → ExtendedKeyframe` (returns ONE; you append+sort); `getKeyframesForProperty(kfs, property)`; `getValueAtTime(kfs, time) → {value, ...}` (read `.value`).
- Store: `updateClipKeyframes(clipId, keyframes): boolean`, `getClip(clipId): Clip|undefined` (non-reactive; gate `useMemo` on `project.modifiedAt`). Playhead: `useTimelineStore(s => s.playheadPosition)` (global seconds).
- `EFFECT_DEFINITIONS` (`packages/core/src/types/effects.ts`): 14 types; each param `{key,label,type,min,max,step,unit,default}`.
- Color grading lives in the web `EffectsBridge.clipColorGrading` Map (NOT on clip); scalars are `temperature`/`tint` ([-100,100]); applied in `canvas-renderers.ts applyEffectsToFrame → effectsBridge.processColorGrading(clipId, frame)` (no time arg today).
- Audio: `clip.volume` + `clip.automation.{volume,pan}` (`AutomationPoint{time,value}`); offline `audio-engine.createClipRenderInfo` builds `AudioClipRenderInfo`; volume ramps via `scheduleVolumeAutomationOnGain`; pan is set STATIC on `pannerNode`. Live path mirrors in `realtime-audio-graph.ts`. No inspector clip-volume slider exists.

---

## File Structure

New:
- `packages/core/src/animation/keyframe-properties.ts` — property registry + `KeyframePropertyDescriptor`, `getKeyframePropertyDescriptor`, `deriveEffectDescriptor`, `listColorGradeScalarProps`, family parsers.
- `packages/core/src/animation/evaluate-keyframes.ts` — `evaluateKeyframesAt(keyframes, localTime): Map<string, number>`.
- `apps/web/src/components/editor/inspector/KeyframableControl.tsx` — inline ◇/◆ control wrapping `LabeledSlider`.
- `apps/web/src/components/editor/inspector/use-keyframable.ts` — hook with the enable/disable/upsert logic (so the component stays thin + testable).
- Tests alongside each.

Modified:
- `packages/core/src/video/video-engine.ts` — generalize `getAnimatedTransform` + `getAnimatedEffects`.
- `apps/web/src/components/editor/inspector/tabs/TransformTab.tsx`, `CropSection.tsx`, `VideoEffectsSection.tsx`, `ColorGradingSection.tsx` — swap sliders.
- `apps/web/src/components/editor/inspector/tabs/AudioTab.tsx` (+ a new `ClipVolumeSection.tsx`) — net-new keyframable Volume/Pan.
- `apps/web/src/stores/project-store.ts` — add `setClipVolume`.
- `apps/web/src/components/editor/preview/canvas-renderers.ts` + `Preview.tsx` — thread clip-local time, override `colorGrade.*`.
- `packages/core/src/audio/audio-engine.ts`, `clip-volume-automation.ts` (+ new `clip-pan-automation.ts`), `realtime-audio-graph.ts` — audio volume/pan keyframes.
- `packages/core/src/audio/types.ts` — add `panAutomation` to `AudioClipRenderInfo`.

**Property naming (canonical):** `transform.position.x|y`, `transform.scale.x|y`, `transform.rotation`, `transform.opacity`, `transform.anchor.x|y`, `transform.borderRadius`, `transform.crop.x|y|width|height`, `effect.<effectId>.<paramKey>`, `colorGrade.temperature|tint`, `audio.volume`, `audio.pan`. **Values are canonical engine units** (opacity 0..1, scale raw, effect.params raw). The control converts display↔canonical via `displayScale`.

> NOTE — pre-existing bug to fix consistently: `KeyframesSection` stores keyframe `time = playheadPosition` (global) but the renderer evaluates at clip-local time. All new code uses **clip-local** time (`playheadPosition - clip.startTime`). Task 12 aligns `KeyframesSection`.

---

## Phase 1 — Core foundation

### Task 1: Property registry

**Files:**
- Create: `packages/core/src/animation/keyframe-properties.ts`
- Test: `packages/core/src/animation/keyframe-properties.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  getStaticDescriptor,
  deriveEffectDescriptor,
  COLOR_GRADE_SCALAR_PROPS,
} from "./keyframe-properties";

describe("keyframe-properties", () => {
  it("static descriptors expose canonical ranges + displayScale", () => {
    const opacity = getStaticDescriptor("transform.opacity");
    expect(opacity).toMatchObject({ min: 0, max: 1, displayScale: 100, unit: "%", family: "transform" });
    const posX = getStaticDescriptor("transform.position.x");
    expect(posX).toMatchObject({ displayScale: 1, family: "transform" });
    expect(getStaticDescriptor("transform.crop.width")?.family).toBe("crop");
    expect(getStaticDescriptor("audio.volume")).toMatchObject({ min: 0, max: 2, family: "audio" });
    expect(getStaticDescriptor("audio.pan")).toMatchObject({ min: -1, max: 1, family: "audio" });
  });

  it("derives an effect param descriptor from EFFECT_DEFINITIONS", () => {
    const d = deriveEffectDescriptor("eff123", "blur", "radius");
    expect(d).toMatchObject({ property: "effect.eff123.radius", min: 0, max: 100, step: 1, unit: "px", family: "effect" });
  });

  it("lists color-grade scalar props", () => {
    expect(COLOR_GRADE_SCALAR_PROPS).toEqual(["colorGrade.temperature", "colorGrade.tint"]);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `pnpm --filter @openreel/core exec vitest run keyframe-properties.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { EFFECT_DEFINITIONS } from "../types/effects";

export type KeyframeFamily = "transform" | "crop" | "effect" | "colorGrade" | "audio";

export interface KeyframePropertyDescriptor {
  property: string;
  label: string;
  family: KeyframeFamily;
  min: number;
  max: number;
  step: number;
  unit: string;
  defaultValue: number;
  displayScale: number;
}

const STATIC: Record<string, KeyframePropertyDescriptor> = {
  "transform.position.x": { property: "transform.position.x", label: "Position X", family: "transform", min: -4000, max: 4000, step: 1, unit: "px", defaultValue: 0, displayScale: 1 },
  "transform.position.y": { property: "transform.position.y", label: "Position Y", family: "transform", min: -4000, max: 4000, step: 1, unit: "px", defaultValue: 0, displayScale: 1 },
  "transform.scale.x": { property: "transform.scale.x", label: "Scale X", family: "transform", min: 0, max: 10, step: 0.01, unit: "%", defaultValue: 1, displayScale: 100 },
  "transform.scale.y": { property: "transform.scale.y", label: "Scale Y", family: "transform", min: 0, max: 10, step: 0.01, unit: "%", defaultValue: 1, displayScale: 100 },
  "transform.rotation": { property: "transform.rotation", label: "Rotation", family: "transform", min: -360, max: 360, step: 1, unit: "deg", defaultValue: 0, displayScale: 1 },
  "transform.opacity": { property: "transform.opacity", label: "Opacity", family: "transform", min: 0, max: 1, step: 0.01, unit: "%", defaultValue: 1, displayScale: 100 },
  "transform.anchor.x": { property: "transform.anchor.x", label: "Anchor X", family: "transform", min: 0, max: 1, step: 0.01, unit: "", defaultValue: 0.5, displayScale: 1 },
  "transform.anchor.y": { property: "transform.anchor.y", label: "Anchor Y", family: "transform", min: 0, max: 1, step: 0.01, unit: "", defaultValue: 0.5, displayScale: 1 },
  "transform.borderRadius": { property: "transform.borderRadius", label: "Border Radius", family: "transform", min: 0, max: 200, step: 1, unit: "px", defaultValue: 0, displayScale: 1 },
  "transform.crop.x": { property: "transform.crop.x", label: "Crop X", family: "crop", min: 0, max: 1, step: 0.001, unit: "", defaultValue: 0, displayScale: 1 },
  "transform.crop.y": { property: "transform.crop.y", label: "Crop Y", family: "crop", min: 0, max: 1, step: 0.001, unit: "", defaultValue: 0, displayScale: 1 },
  "transform.crop.width": { property: "transform.crop.width", label: "Crop W", family: "crop", min: 0, max: 1, step: 0.001, unit: "", defaultValue: 1, displayScale: 1 },
  "transform.crop.height": { property: "transform.crop.height", label: "Crop H", family: "crop", min: 0, max: 1, step: 0.001, unit: "", defaultValue: 1, displayScale: 1 },
  "audio.volume": { property: "audio.volume", label: "Volume", family: "audio", min: 0, max: 2, step: 0.01, unit: "", defaultValue: 1, displayScale: 1 },
  "audio.pan": { property: "audio.pan", label: "Pan", family: "audio", min: -1, max: 1, step: 0.01, unit: "", defaultValue: 0, displayScale: 1 },
  "colorGrade.temperature": { property: "colorGrade.temperature", label: "Temperature", family: "colorGrade", min: -100, max: 100, step: 1, unit: "", defaultValue: 0, displayScale: 1 },
  "colorGrade.tint": { property: "colorGrade.tint", label: "Tint", family: "colorGrade", min: -100, max: 100, step: 1, unit: "", defaultValue: 0, displayScale: 1 },
};

export const COLOR_GRADE_SCALAR_PROPS = ["colorGrade.temperature", "colorGrade.tint"];

export function getStaticDescriptor(property: string): KeyframePropertyDescriptor | undefined {
  return STATIC[property];
}

export function deriveEffectDescriptor(
  effectId: string,
  effectType: string,
  paramKey: string,
): KeyframePropertyDescriptor | undefined {
  const def = EFFECT_DEFINITIONS.find((d) => d.type === effectType);
  const param = def?.params.find((p) => p.key === paramKey);
  if (!param) return undefined;
  return {
    property: `effect.${effectId}.${paramKey}`,
    label: param.label,
    family: "effect",
    min: param.min ?? 0,
    max: param.max ?? 1,
    step: param.step ?? 0.01,
    unit: param.unit ?? "",
    defaultValue: typeof param.default === "number" ? param.default : 0,
    displayScale: 1,
  };
}
```

- [ ] **Step 4: Run test, confirm PASS (3 tests).** Run: `pnpm --filter @openreel/core exec vitest run keyframe-properties.test.ts`
- [ ] **Step 5: typecheck** `pnpm typecheck` → pass.
- [ ] **Step 6: Commit**

```bash
git add packages/core/src/animation/keyframe-properties.ts packages/core/src/animation/keyframe-properties.test.ts
git commit -m "feat(keyframes): property registry (transform/crop/effect/color/audio descriptors)"
```

### Task 2: `evaluateKeyframesAt` helper

**Files:**
- Create: `packages/core/src/animation/evaluate-keyframes.ts`
- Test: `packages/core/src/animation/evaluate-keyframes.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { evaluateKeyframesAt } from "./evaluate-keyframes";
import type { Keyframe } from "../types/timeline";

const kf = (property: string, time: number, value: number): Keyframe => ({
  id: `${property}-${time}`, property, time, value, easing: "linear",
});

describe("evaluateKeyframesAt", () => {
  it("returns interpolated value per property at local time", () => {
    const kfs = [kf("transform.opacity", 0, 0), kf("transform.opacity", 2, 1), kf("effect.e1.radius", 0, 0), kf("effect.e1.radius", 1, 10)];
    const m = evaluateKeyframesAt(kfs, 1);
    expect(m.get("transform.opacity")).toBeCloseTo(0.5);
    expect(m.get("effect.e1.radius")).toBeCloseTo(10);
  });
  it("empty keyframes → empty map", () => {
    expect(evaluateKeyframesAt([], 1).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.** `pnpm --filter @openreel/core exec vitest run evaluate-keyframes.test.ts`

- [ ] **Step 3: Implement**

```ts
import type { Keyframe } from "../types/timeline";
import { keyframeEngine } from "../video/keyframe-engine";

export function evaluateKeyframesAt(
  keyframes: Keyframe[],
  localTime: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!keyframes || keyframes.length === 0) return out;
  const byProp = new Map<string, Keyframe[]>();
  for (const kf of keyframes) {
    const arr = byProp.get(kf.property);
    if (arr) arr.push(kf);
    else byProp.set(kf.property, [kf]);
  }
  for (const [property, kfs] of byProp) {
    const result = keyframeEngine.getValueAtTime(kfs, localTime);
    if (typeof result.value === "number") out.set(property, result.value);
  }
  return out;
}
```

- [ ] **Step 4: Run, confirm PASS (2).** **Step 5: typecheck.** **Step 6: Commit**

```bash
git add packages/core/src/animation/evaluate-keyframes.ts packages/core/src/animation/evaluate-keyframes.test.ts
git commit -m "feat(keyframes): generic evaluateKeyframesAt helper"
```

### Task 3: Generalize video-engine evaluation (transform incl. anchor/crop + per-instance effects)

**Files:**
- Modify: `packages/core/src/video/video-engine.ts` (`getAnimatedTransform` ~1595-1686, `getAnimatedEffects` ~1528-1593)
- Test: `packages/core/src/video/video-engine.keyframes.test.ts` (create — unit-test the two methods via a small exposed helper, or test through `createClipRenderInfo` if accessible; if both are private, extract the pure logic into `animate-clip.ts` and test that)

- [ ] **Step 1: Extract pure logic + failing test.** Create `packages/core/src/video/animate-clip.ts` exporting two pure functions used by the engine:

```ts
import type { Clip, Effect, Transform } from "../types/timeline";
import { evaluateKeyframesAt } from "../animation/evaluate-keyframes";

export function animateTransform(clip: Clip, localTime: number): Transform {
  const base = clip.transform;
  if (!clip.keyframes?.length) return base;
  const v = evaluateKeyframesAt(clip.keyframes, localTime);
  const num = (p: string, fallback: number) => (v.has(p) ? (v.get(p) as number) : fallback);
  return {
    position: { x: num("transform.position.x", base.position.x), y: num("transform.position.y", base.position.y) },
    scale: { x: num("transform.scale.x", base.scale.x), y: num("transform.scale.y", base.scale.y) },
    rotation: num("transform.rotation", base.rotation),
    opacity: num("transform.opacity", base.opacity),
    anchor: { x: num("transform.anchor.x", base.anchor.x), y: num("transform.anchor.y", base.anchor.y) },
    borderRadius: v.has("transform.borderRadius") ? num("transform.borderRadius", 0) : base.borderRadius,
    fitMode: base.fitMode,
    rotate3d: base.rotate3d,
    perspective: base.perspective,
    transformStyle: base.transformStyle,
    crop: base.crop
      ? {
          x: num("transform.crop.x", base.crop.x),
          y: num("transform.crop.y", base.crop.y),
          width: num("transform.crop.width", base.crop.width),
          height: num("transform.crop.height", base.crop.height),
        }
      : base.crop,
  };
}

const LEGACY_EFFECT_PARAM: Record<string, string> = {
  brightness: "value", contrast: "value", saturation: "value", blur: "radius",
};

export function animateEffects(clip: Clip, localTime: number): Effect[] {
  const base = clip.effects || [];
  if (!clip.keyframes?.length) return base;
  const v = evaluateKeyframesAt(clip.keyframes, localTime);
  // property → {effectId?|type, paramKey, value}
  const byId = new Map<string, Record<string, number>>(); // effectId → {paramKey: value}
  const byType = new Map<string, { paramKey: string; value: number }>(); // legacy effect.<type>
  for (const [property, value] of v) {
    if (!property.startsWith("effect.")) continue;
    const parts = property.split(".");
    if (parts.length >= 3) {
      const effectId = parts[1];
      const paramKey = parts.slice(2).join(".");
      const m = byId.get(effectId) ?? {};
      m[paramKey] = value;
      byId.set(effectId, m);
    } else if (parts.length === 2) {
      const type = parts[1];
      byType.set(type, { paramKey: LEGACY_EFFECT_PARAM[type] ?? "value", value });
    }
  }
  if (byId.size === 0 && byType.size === 0) return base;
  const seenType = new Set<string>();
  const patched = base.map((effect) => {
    let params = effect.params;
    if (byId.has(effect.id)) params = { ...params, ...byId.get(effect.id) };
    const legacy = byType.get(effect.type);
    if (legacy) { params = { ...params, [legacy.paramKey]: legacy.value }; seenType.add(effect.type); }
    return params === effect.params ? effect : { ...effect, params };
  });
  for (const [type, { paramKey, value }] of byType) {
    if (seenType.has(type)) continue;
    patched.push({ id: `kf-synth-${clip.id}-${type}`, type, enabled: true, params: { [paramKey]: value } } as Effect);
  }
  return patched;
}
```

Test `animate-clip.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { animateTransform, animateEffects } from "./animate-clip";
import type { Clip } from "../types/timeline";

const baseClip = (over: Partial<Clip>): Clip => ({
  id: "c1", mediaId: "m", trackId: "t", startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
  effects: [], audioEffects: [], keyframes: [], volume: 1,
  transform: { position: {x:0,y:0}, scale:{x:1,y:1}, rotation:0, anchor:{x:0.5,y:0.5}, opacity:1, crop:{x:0,y:0,width:1,height:1} },
  ...over,
} as Clip);

describe("animate-clip", () => {
  it("animates crop.width and anchor", () => {
    const clip = baseClip({ keyframes: [
      { id:"a", property:"transform.crop.width", time:0, value:1, easing:"linear" },
      { id:"b", property:"transform.crop.width", time:2, value:0.5, easing:"linear" },
    ]});
    expect(animateTransform(clip, 1).crop!.width).toBeCloseTo(0.75);
  });
  it("animates a specific effect instance by id", () => {
    const clip = baseClip({
      effects: [{ id:"e1", type:"blur", enabled:true, params:{ radius: 0 } }, { id:"e2", type:"blur", enabled:true, params:{ radius: 99 } }],
      keyframes: [ { id:"k1", property:"effect.e1.radius", time:0, value:0, easing:"linear" }, { id:"k2", property:"effect.e1.radius", time:1, value:10, easing:"linear" } ],
    });
    const eff = animateEffects(clip, 1);
    expect(eff.find(e=>e.id==="e1")!.params.radius).toBeCloseTo(10);
    expect(eff.find(e=>e.id==="e2")!.params.radius).toBe(99);
  });
  it("supports legacy effect.<type>", () => {
    const clip = baseClip({ effects:[{id:"e1",type:"brightness",enabled:true,params:{value:0}}],
      keyframes:[{id:"k",property:"effect.brightness",time:0,value:50,easing:"linear"}] });
    expect(animateEffects(clip, 0).find(e=>e.type==="brightness")!.params.value).toBe(50);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.** `pnpm --filter @openreel/core exec vitest run animate-clip.test.ts`
- [ ] **Step 3: Implement `animate-clip.ts` (above).**
- [ ] **Step 4: Run, confirm PASS (3).**
- [ ] **Step 5: Wire into video-engine.** In `video-engine.ts`, replace the bodies of `getAnimatedTransform`/`getAnimatedEffects` to delegate: `import { animateTransform, animateEffects } from "./animate-clip";` and `return animateTransform(clip, localTime);` / `return animateEffects(clip, localTime);`. Keep the method signatures. Run `pnpm --filter @openreel/core test:run` → existing video-engine tests still pass (behavior superset-compatible).
- [ ] **Step 6: typecheck + commit**

```bash
git add packages/core/src/video/animate-clip.ts packages/core/src/video/animate-clip.test.ts packages/core/src/video/video-engine.ts
git commit -m "feat(keyframes): generalize core evaluation to crop/anchor + per-instance effects"
```

---

## Phase 2 — Inline control + UI rollout

### Task 4: `useKeyframable` hook + `KeyframableControl`

**Files:**
- Create: `apps/web/src/components/editor/inspector/use-keyframable.ts`
- Create: `apps/web/src/components/editor/inspector/KeyframableControl.tsx`
- Test: `apps/web/src/components/editor/inspector/KeyframableControl.test.tsx`

- [ ] **Step 1: Failing test** (uses the InspectorPanel.tabs seeding pattern; selects a clip, renders the control, asserts enable/upsert):

```tsx
import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { KeyframableControl } from "./KeyframableControl";

const clipId = "c1";
function seed() {
  const p = createEmptyProject("t");
  const seeded = { ...p, timeline: { ...p.timeline, duration: 10, tracks: [{ id: "tr", type: "video", name: "v", clips: [{
    id: clipId, mediaId: "m", trackId: "tr", startTime: 2, duration: 8, inPoint: 0, outPoint: 8,
    effects: [], audioEffects: [], keyframes: [], volume: 1,
    transform: { position:{x:0,y:0}, scale:{x:1,y:1}, rotation:0, anchor:{x:0.5,y:0.5}, opacity:1 },
  }], transitions: [], locked:false, hidden:false, muted:false, solo:false }] } };
  useProjectStore.setState({ project: seeded as never });
  useTimelineStore.setState({ playheadPosition: 4 }); // clip-local = 4 - 2 = 2
}

describe("KeyframableControl", () => {
  beforeEach(seed);
  afterEach(() => { cleanup(); useProjectStore.setState({ project: createEmptyProject("r") as never }); });

  it("enabling adds a keyframe at clip-local time with the current value", () => {
    render(<KeyframableControl clipId={clipId} property="transform.opacity" label="Opacity" value={100} onChange={() => {}} min={0} max={100} step={1} unit="%" displayScale={100} />);
    fireEvent.click(screen.getByRole("button", { name: /keyframe Opacity/i }));
    const kfs = useProjectStore.getState().getClip(clipId)!.keyframes;
    expect(kfs).toHaveLength(1);
    expect(kfs[0]).toMatchObject({ property: "transform.opacity", time: 2, value: 1 }); // 100/displayScale=1, local time 2
  });

  it("shows filled state when already keyframed", () => {
    seed();
    useProjectStore.getState().updateClipKeyframes(clipId, [{ id:"k", property:"transform.opacity", time:0, value:0.5, easing:"linear" }]);
    render(<KeyframableControl clipId={clipId} property="transform.opacity" label="Opacity" value={100} onChange={() => {}} min={0} max={100} step={1} unit="%" displayScale={100} />);
    expect(screen.getByRole("button", { name: /keyframe Opacity/i })).toHaveAttribute("aria-pressed", "true");
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.** `pnpm --filter @openreel/web exec vitest run KeyframableControl.test.tsx`

- [ ] **Step 3: Implement the hook** `use-keyframable.ts`:

```ts
import { useCallback, useMemo } from "react";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { keyframeEngine } from "@openreel/core";

export function useKeyframable(clipId: string, property: string, displayScale: number) {
  const updateClipKeyframes = useProjectStore((s) => s.updateClipKeyframes);
  const getClip = useProjectStore((s) => s.getClip);
  const modifiedAt = useProjectStore((s) => s.project.modifiedAt);
  const playhead = useTimelineStore((s) => s.playheadPosition);

  const { keyframes, clipStart } = useMemo(() => {
    const clip = getClip(clipId);
    return { keyframes: clip?.keyframes ?? [], clipStart: clip?.startTime ?? 0 };
  }, [getClip, clipId, modifiedAt]);

  const propKfs = useMemo(
    () => keyframes.filter((k) => k.property === property).sort((a, b) => a.time - b.time),
    [keyframes, property],
  );
  const localTime = playhead - clipStart;
  const isAnimated = propKfs.length > 0;

  const valueAtPlayhead = useMemo(() => {
    if (!isAnimated) return undefined;
    const r = keyframeEngine.getValueAtTime(propKfs, localTime);
    return typeof r.value === "number" ? r.value : undefined;
  }, [isAnimated, propKfs, localTime]);

  // upsert a keyframe (canonical value) at the current clip-local time
  const upsert = useCallback(
    (canonicalValue: number) => {
      const existing = propKfs.find((k) => Math.abs(k.time - localTime) < 0.001);
      let next;
      if (existing) {
        next = keyframes.map((k) => (k.id === existing.id ? { ...k, value: canonicalValue } : k));
      } else {
        const kf = keyframeEngine.addKeyframe(clipId, property, localTime, canonicalValue, "linear");
        next = [...keyframes, kf].sort((a, b) => a.time - b.time);
      }
      updateClipKeyframes(clipId, next);
    },
    [keyframes, propKfs, localTime, clipId, property, updateClipKeyframes],
  );

  const enable = useCallback((canonicalValue: number) => upsert(canonicalValue), [upsert]);
  const disable = useCallback(() => {
    updateClipKeyframes(clipId, keyframes.filter((k) => k.property !== property));
  }, [keyframes, clipId, property, updateClipKeyframes]);

  return { isAnimated, valueAtPlayhead, upsert, enable, disable };
}
```

(Confirm `keyframeEngine` is exported from `@openreel/core`; if not, import from `@openreel/core/...` path used elsewhere — match `KeyframesSection`'s import.)

- [ ] **Step 4: Implement `KeyframableControl.tsx`:**

```tsx
import * as React from "react";
import { LabeledSlider, type LabeledSliderProps } from "@openreel/ui";
import { Diamond } from "lucide-react";
import { useKeyframable } from "./use-keyframable";

export interface KeyframableControlProps extends LabeledSliderProps {
  clipId?: string;
  property?: string;
  displayScale?: number;
}

export const KeyframableControl: React.FC<KeyframableControlProps> = ({
  clipId, property, displayScale = 1, value, onChange, label, ...rest
}) => {
  if (!clipId || !property) {
    return <LabeledSlider label={label} value={value} onChange={onChange} {...rest} />;
  }
  return (
    <Keyframed clipId={clipId} property={property} displayScale={displayScale} value={value} onChange={onChange} label={label} {...rest} />
  );
};

const Keyframed: React.FC<Required<Pick<KeyframableControlProps, "clipId" | "property" | "displayScale">> & LabeledSliderProps> = ({
  clipId, property, displayScale, value, onChange, label, ...rest
}) => {
  const { isAnimated, valueAtPlayhead, upsert, enable, disable } = useKeyframable(clipId, property, displayScale);
  const displayValue = isAnimated && valueAtPlayhead !== undefined ? valueAtPlayhead * displayScale : value;

  const handleChange = (next: number) => {
    if (isAnimated) upsert(next / displayScale);
    else onChange(next);
  };
  const toggle = () => {
    if (isAnimated) disable();
    else enable(value / displayScale);
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={`keyframe ${label}`}
        aria-pressed={isAnimated}
        onClick={toggle}
        className={isAnimated ? "text-accent" : "text-fg-3 hover:text-fg"}
      >
        <Diamond size={12} fill={isAnimated ? "currentColor" : "none"} />
      </button>
      <div className="flex-1">
        <LabeledSlider label={label} value={displayValue} onChange={handleChange} {...rest} />
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Run, confirm PASS (2).** **Step 6: typecheck (`pnpm typecheck`).** **Step 7: Commit**

```bash
git add apps/web/src/components/editor/inspector/use-keyframable.ts apps/web/src/components/editor/inspector/KeyframableControl.tsx apps/web/src/components/editor/inspector/KeyframableControl.test.tsx
git commit -m "feat(keyframes): inline KeyframableControl + useKeyframable hook"
```

### Task 5: Adopt in Transform + Crop

**Files:** Modify `inspector/tabs/TransformTab.tsx`, `inspector/CropSection.tsx`

- [ ] **Step 1:** In `TransformTab.tsx`, replace each `LabeledSlider` with `KeyframableControl`, adding `clipId={clipId}`, the `property`, and `displayScale`. Mapping (display value/onChange stay as-is):
  - Position X → `property="transform.position.x"`, `displayScale={1}`
  - Position Y → `transform.position.y`, 1
  - Scale X (`value={transform.scale.x*100}`) → `transform.scale.x`, `displayScale={100}`
  - Scale Y → `transform.scale.y`, 100
  - Rotation → `transform.rotation`, 1
  - Opacity (`value={transform.opacity*100}`) → `transform.opacity`, `displayScale={100}`
  - Border Radius → `transform.borderRadius`, 1
  Import `KeyframableControl` from `../KeyframableControl`. `clipId` is already a prop of TransformTab.
- [ ] **Step 2:** In `CropSection.tsx`, wrap its crop sliders similarly (`transform.crop.x|y|width|height`, displayScale per how it displays — likely 1 or 100 if shown as %). Read the file to confirm its current sliders + display scaling.
- [ ] **Step 3:** `pnpm --filter @openreel/web typecheck` → pass; `pnpm --filter @openreel/web exec vitest run InspectorPanel.tabs KeyframableControl` → pass (the real-isolation test still finds "Position X").
- [ ] **Step 4: Commit** `git commit -am "feat(keyframes): keyframable transform + crop controls"`

### Task 6: Adopt in Video Effects (per param)

**Files:** Modify `inspector/VideoEffectsSection.tsx`

- [ ] **Step 1:** Replace each `EffectSlider`/`LabeledSlider` in `renderParams()` with `KeyframableControl`, passing `clipId={clipId}`, `property={`effect.${effect.id}.${paramKey}`}`, and `displayScale` matching that param's display (1 for brightness `value`; 100 for contrast/saturation which display ×100; 1 for blur radius, etc.). The `paramKey` is the key already used in `onUpdate(effect.id, { <key>: v })`. Keep `value`/`onChange` exactly as today.
- [ ] **Step 2:** typecheck + `pnpm --filter @openreel/web exec vitest run VideoEffectsSection` (if a test exists) → pass.
- [ ] **Step 3: Commit** `git commit -am "feat(keyframes): keyframable video-effect params (per instance)"`

### Task 7: Adopt in Color Grading scalars

**Files:** Modify `inspector/ColorGradingSection.tsx`

- [ ] **Step 1:** Swap the Temperature slider (lines ~198-206) → `KeyframableControl clipId={clipId} property="colorGrade.temperature" displayScale={1}` and Tint (~220-228) → `property="colorGrade.tint"`. Keep value/onChange (`handleTemperatureChange`/`handleTintChange`).
- [ ] **Step 2:** typecheck → pass. **Commit** `git commit -am "feat(keyframes): keyframable color temperature/tint"`

---

## Phase 3 — Color grading evaluation (web render)

### Task 8: Apply `colorGrade.*` keyframes at render time

**Files:** Modify `apps/web/src/components/editor/preview/canvas-renderers.ts` (`applyEffectsToFrame` ~1921), `apps/web/src/components/editor/Preview.tsx` (callers), `apps/web/src/bridges/effects-bridge.ts` (`processColorGrading`).

- [ ] **Step 1:** Add an optional `localTime` param to `applyEffectsToFrame(clipId, frame, localTime?)`. When present, read the clip's keyframes (via project-store `getClip`), compute `evaluateKeyframesAt(keyframes, localTime)`, and for `colorGrade.temperature`/`colorGrade.tint` call a NEW `effectsBridge.setColorGradingOverride(clipId, { temperature?, tint? })` before `processColorGrading`, then `clearColorGradingOverride(clipId)` after. Implement the override in `EffectsBridge`: a transient `Map<clipId, Partial<ColorGradingSettings>>` that `getColorGrading` merges on top of the base settings.
- [ ] **Step 2:** Thread clip-local time into the `applyEffectsToFrame` callers in `Preview.tsx` (the render loop knows the clip + frame time → `time - clip.startTime`). For callers without an obvious clip/time, pass `undefined` (no behavior change).
- [ ] **Step 3:** Ensure the `clipNeedsFrameProcessing` gate (`Preview.tsx:96-112`) also returns true when the clip has any `colorGrade.*` keyframe (so a clip with only keyframed grading still processes).
- [ ] **Step 4:** Add a unit test for the bridge override: `effects-bridge.colorGradeOverride.test.ts` — `setColorGradingOverride` then `getColorGrading` returns merged values; `clear` reverts. (Pure Map logic; no WebGL needed.)
- [ ] **Step 5:** typecheck + `pnpm --filter @openreel/web build` (render path compiles). **Commit** `git commit -am "feat(keyframes): animate color temperature/tint at render time"`

---

## Phase 4 — Audio volume/pan keyframes

### Task 9: Net-new keyframable clip Volume/Pan control

**Files:** Create `inspector/ClipVolumeSection.tsx`; modify `inspector/tabs/AudioTab.tsx`; add `setClipVolume` to `project-store.ts`.

- [ ] **Step 1:** Add `setClipVolume(clipId, volume): boolean` to project-store (mirror `updateClipKeyframes`'s immutable track/clip update, setting `volume`). Test it in `project-store` style.
- [ ] **Step 2:** Create `ClipVolumeSection` rendering two `KeyframableControl`s: Volume (`property="audio.volume"`, value=`clip.volume`, onChange=`setClipVolume`, min 0 max 2 step 0.01) and Pan (`property="audio.pan"`, value from `getPanFromAudioEffects`/0, onChange → a `setClipPan` or audio-effect update, min -1 max 1). Render it in `AudioTab` (it receives `clipId`/`selectedClip`).
- [ ] **Step 3:** typecheck + a render test (seed clip, toggle Volume keyframe → keyframe stored with `property:"audio.volume"`). **Commit.**

### Task 10: Evaluate audio keyframes in the offline engine

**Files:** Modify `packages/core/src/audio/audio-engine.ts`, `packages/core/src/audio/types.ts`; create `packages/core/src/audio/clip-pan-automation.ts`.

- [ ] **Step 1:** Add `panAutomation?: AutomationPoint[]` to `AudioClipRenderInfo` (`types.ts`).
- [ ] **Step 2:** In `audio-engine.createClipRenderInfo`, derive automation from keyframes when present: a helper `keyframesToAutomation(clip.keyframes, "audio.volume")` → `AutomationPoint[]` (map each kf `{time: kf.time, value: kf.value}`; these are clip-local already). If `audio.volume` keyframes exist, set `volumeAutomation` to them (taking precedence over `resolveClipVolumeAutomation`); likewise build `panAutomation` from `audio.pan` keyframes.
- [ ] **Step 3:** Create `clip-pan-automation.ts` `schedulePanAutomationOnPanner(pannerNode, points, basePan, clipOffset, duration, startTime)` mirroring `scheduleVolumeAutomationOnGain` (setValueAtTime + linearRampToValueAtTime on `pannerNode.pan`).
- [ ] **Step 4:** In `renderClipToContext` (~444-465) and `renderClipToContextFromSegments` (~598-607), also capture `pannerNode` from `createClipOutputNodes`, and when `clipInfo.panAutomation?.length`, call `schedulePanAutomationOnPanner(...)`.
- [ ] **Step 5:** Unit test: a clip with `audio.volume` keyframes yields `volumeAutomation` points (test `keyframesToAutomation` + that `createClipRenderInfo` picks them up — extract `keyframesToAutomation` as a pure exported fn and test it). **typecheck + `pnpm --filter @openreel/core test:run`.** **Commit.**

### Task 11: Mirror in the realtime (live preview) audio graph

**Files:** Modify `packages/core/src/audio/realtime-audio-graph.ts` (and `playback-controller.ts` if it builds render info).

- [ ] **Step 1:** Where the realtime graph sets `outputGain.gain.value`/`panNode.pan.value` statically, apply the same keyframe-derived automation (reuse `scheduleVolumeAutomationOnGain` for volume — already imported — and `schedulePanAutomationOnPanner` for pan).
- [ ] **Step 2:** typecheck + `pnpm --filter @openreel/core test:run`. **Commit** `git commit -am "feat(keyframes): animate audio volume/pan (offline + live)"`

---

## Phase 5 — Polish & verification

### Task 12: Align KeyframesSection + graph editor with the registry

**Files:** Modify `inspector/KeyframesSection.tsx`, optionally `KeyframeEditorPanel.tsx`.

- [ ] **Step 1:** Fix the clip-local time bug: when adding/evaluating in `KeyframesSection`, use `playheadPosition - clip.startTime` (not raw `playheadPosition`). Update `handleAddKeyframe` + `currentValue`/`hasKeyframeAtPlayhead`.
- [ ] **Step 2:** Add `PROPERTY_COLORS` entries (or registry-driven colors/labels) for the new property families in `KeyframeEditorPanel` so they show friendly labels instead of raw strings (use `getStaticDescriptor(property)?.label` with a fallback to the raw string).
- [ ] **Step 3:** typecheck + `pnpm --filter @openreel/web exec vitest run KeyframesSection` (if present). **Commit.**

### Task 13: Full verification

- [ ] **Step 1:** `pnpm typecheck` (all packages) → pass.
- [ ] **Step 2:** `pnpm --filter @openreel/web lint` → no new errors.
- [ ] **Step 3:** `pnpm --filter @openreel/core test:run` and `pnpm --filter @openreel/web test:run` → only pre-existing unrelated failures, if any.
- [ ] **Step 4:** `pnpm --filter @openreel/web build` → succeeds.
- [ ] **Step 5:** Manual smoke (`pnpm dev`): keyframe Opacity, an effect's Blur (two blur effects → independent), Temperature, and Volume; scrub the playhead → values interpolate in the preview; export a short clip → animation bakes in; open the graph editor → all properties listed.
- [ ] **Step 6:** Final commit.

---

## Self-Review

- **Spec coverage:** registry (T1), evaluateKeyframesAt (T2), core transform/crop/effect-instance eval (T3), inline control + hook (T4), UI rollout transform/crop/effects/color (T5-T7), color render eval (T8), audio volume/pan incl. net-new control + offline + live (T9-T11), KeyframesSection bug-fix + graph editor labels (T12), verification (T13). All spec sections mapped.
- **Placeholder scan:** the harder tasks (T5 crop displayScale, T6 per-param displayScale, T8 caller threading) say "read the file to confirm" for values that genuinely must be read live — they are bounded, located lookups, not vague work; all new units are fully coded.
- **Type consistency:** `KeyframePropertyDescriptor`, `getStaticDescriptor`/`deriveEffectDescriptor`, `evaluateKeyframesAt`, `animateTransform`/`animateEffects`, `useKeyframable`, `KeyframableControl` (clipId/property/displayScale), `panAutomation`, `setClipVolume`, `keyframesToAutomation`, `schedulePanAutomationOnPanner` are used consistently across tasks.

**Note on scope:** This is large (3 layers + net-new audio control + live-audio mirror). Recommend executing/merging **phase by phase** (Phase 1-2 = a shippable "keyframe transform/crop/effects" PR; Phase 3 color; Phase 4 audio) even though it's one spec.
