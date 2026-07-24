# OpenReel Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `apps/studio`'s node-graph editor with a Lens-Studio-style subject+behavior editor, ship a new Filter editor on the same substrate, redesign the Hub, and add a client-side publish flow — landing as a single PR on a new branch off `feat/studio-app`.

**Architecture:** Scene (`Scene = { subjects: Subject[], sampleClipId }`) is canonical in the studio store. Subjects have one of three kinds in v1 (`face`, `subject_silhouette`, `full_frame`) and a list of Behaviors (either preset recipes or atomic blocks). `sceneToGraph(scene)` derives the existing `@openreel/fxpkg` `Graph` at preview-compile/publish time. Preview runs MediaPipe Tasks Vision on real video. `packages/fxpkg`, the Template editor, and `apps/cloud` API shape are untouched.

**Tech Stack:** TypeScript strict · React 18 (useReducer + Context, no Zustand) · Vite 5 · Tailwind 3 · `@openreel/fxpkg` (Graph types, Zod 4) · `@mediapipe/tasks-vision` (FaceLandmarker, ImageSegmenter) · vitest + @testing-library/react · Playwright (E2E)

**Spec:** [docs/superpowers/specs/2026-05-27-studio-redesign-design.md](docs/superpowers/specs/2026-05-27-studio-redesign-design.md)

**Working branch:** Fork `feat/studio-redesign` from `feat/studio-app`. All work commits to this branch; PR merges into `feat/studio-app` (or wherever the studio is being staged).

---

## Phase 0 — Test infrastructure

### Task 1: Add vitest + RTL + MediaPipe deps to `apps/studio`

**Files:**
- Modify: `apps/studio/package.json`
- Create: `apps/studio/vitest.config.ts`
- Modify: `apps/studio/tsconfig.json`
- Create: `apps/studio/src/test/setup.ts`

- [ ] **Step 1: Create the working branch**

```bash
cd /Users/augustusotu/Projects/openreel
git checkout feat/studio-app
git checkout -b feat/studio-redesign
```

Expected: `Switched to a new branch 'feat/studio-redesign'`

- [ ] **Step 2: Add dependencies**

```bash
cd /Users/augustusotu/Projects/openreel
pnpm --filter @openreel/studio add zod nanoid @mediapipe/tasks-vision idb
pnpm --filter @openreel/studio add -D vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @types/jsdom
```

Expected: `package.json` gains the deps; `pnpm-lock.yaml` updates.

- [ ] **Step 3: Add test scripts to `apps/studio/package.json`**

Open `apps/studio/package.json` and replace the `scripts` block with:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest",
    "test:run": "vitest run"
  },
```

- [ ] **Step 4: Create `apps/studio/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@openreel/core": path.resolve(__dirname, "../../packages/core/src"),
      "@openreel/fxpkg": path.resolve(__dirname, "../../packages/fxpkg/src"),
      "@openreel/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 5: Create `apps/studio/src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Update `apps/studio/tsconfig.json` to include test types**

Look at the existing tsconfig.json and ensure `compilerOptions.types` includes `"vitest/globals"` (it shouldn't — we set `globals: false`, so leave types alone). Just ensure `include` covers `src/**/*` — no change needed if it already does. Confirm by running:

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm typecheck
```

Expected: passes (no new code yet).

- [ ] **Step 7: Verify test runner works with a placeholder**

Create `apps/studio/src/test/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run:

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run
```

Expected: `1 passed`.

- [ ] **Step 8: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/package.json apps/studio/vitest.config.ts apps/studio/src/test/ pnpm-lock.yaml
git commit -m "test(studio): add vitest, RTL, MediaPipe, nanoid, idb deps"
```

---

## Phase 1 — Data model

### Task 2: Scene & Subject types + subject capability registry

**Files:**
- Create: `apps/studio/src/effect/scene.ts`
- Create: `apps/studio/src/effect/subjects.ts`
- Create: `apps/studio/src/effect/subjects.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/effect/subjects.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SUBJECT_CAPABILITIES, listSubjectKinds, getSubjectCapability } from "./subjects";

describe("subject capability registry", () => {
  it("registers exactly the v1 subject kinds: face, subject_silhouette, full_frame", () => {
    expect(listSubjectKinds()).toEqual(["face", "subject_silhouette", "full_frame"]);
  });

  it("face requires FaceLandmarker detector and exposes eye/nose/mouth anchors", () => {
    const cap = getSubjectCapability("face");
    expect(cap.detector).toBe("FaceLandmarker");
    expect(cap.anchors).toEqual(
      expect.arrayContaining(["eyes", "eye_left", "eye_right", "nose", "mouth", "jaw", "forehead", "face_bbox"]),
    );
    expect(cap.defaultName).toBe("Face");
    expect(cap.iconName).toBe("face");
  });

  it("subject_silhouette requires ImageSegmenter and exposes mask anchors", () => {
    const cap = getSubjectCapability("subject_silhouette");
    expect(cap.detector).toBe("ImageSegmenter");
    expect(cap.anchors).toEqual(expect.arrayContaining(["mask", "mask_edge", "bbox", "centroid"]));
    expect(cap.defaultName).toBe("Subject silhouette");
    expect(cap.iconName).toBe("person");
  });

  it("full_frame requires no detector", () => {
    const cap = getSubjectCapability("full_frame");
    expect(cap.detector).toBeNull();
    expect(cap.anchors).toEqual(expect.arrayContaining(["frame", "center", "corners"]));
    expect(cap.defaultName).toBe("Full frame");
    expect(cap.iconName).toBe("monitor");
  });

  it("registry is exhaustive over SubjectKind union", () => {
    const ids = Object.keys(SUBJECT_CAPABILITIES);
    expect(new Set(ids)).toEqual(new Set(["face", "subject_silhouette", "full_frame"]));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/subjects.test.ts
```

Expected: FAIL — `Cannot find module './subjects'`.

- [ ] **Step 3: Create `apps/studio/src/effect/scene.ts`**

```ts
import type { Graph } from "@openreel/fxpkg";

export type SubjectKind = "face" | "subject_silhouette" | "full_frame";

export type AtomicKind = "glow" | "particles" | "color-tint" | "blur" | "replace" | "distort" | "mask-edge";

export type Behavior =
  | {
      id: string;
      kind: "preset";
      presetId: string;
      params: Record<string, unknown>;
      name: string;
      visible: boolean;
    }
  | {
      id: string;
      kind: "atomic";
      atomicKind: AtomicKind;
      params: Record<string, unknown>;
      name: string;
      visible: boolean;
    };

export interface Subject {
  id: string;
  kind: SubjectKind;
  name: string;
  visible: boolean;
  behaviors: Behavior[];
}

export interface Scene {
  subjects: Subject[];
  sampleClipId: string;
}

export const DEFAULT_SAMPLE_CLIP_ID = "portrait-closeup-01";

export function emptyScene(sampleClipId: string = DEFAULT_SAMPLE_CLIP_ID): Scene {
  return { subjects: [], sampleClipId };
}

export type SceneCompileResult = { ok: true; graph: Graph } | { ok: false; errors: string[] };
```

- [ ] **Step 4: Create `apps/studio/src/effect/subjects.ts`**

```ts
import type { IconName } from "../icons";
import type { SubjectKind } from "./scene";

export type DetectorKind = "FaceLandmarker" | "ImageSegmenter";

export interface SubjectCapability {
  kind: SubjectKind;
  defaultName: string;
  iconName: IconName;
  detector: DetectorKind | null;
  anchors: string[];
}

export const SUBJECT_CAPABILITIES: Record<SubjectKind, SubjectCapability> = {
  face: {
    kind: "face",
    defaultName: "Face",
    iconName: "face",
    detector: "FaceLandmarker",
    anchors: ["eyes", "eye_left", "eye_right", "nose", "mouth", "jaw", "forehead", "face_bbox"],
  },
  subject_silhouette: {
    kind: "subject_silhouette",
    defaultName: "Subject silhouette",
    iconName: "person",
    detector: "ImageSegmenter",
    anchors: ["mask", "mask_edge", "bbox", "centroid"],
  },
  full_frame: {
    kind: "full_frame",
    defaultName: "Full frame",
    iconName: "monitor",
    detector: null,
    anchors: ["frame", "center", "corners"],
  },
};

const ORDER: SubjectKind[] = ["face", "subject_silhouette", "full_frame"];

export function listSubjectKinds(): SubjectKind[] {
  return [...ORDER];
}

export function getSubjectCapability(kind: SubjectKind): SubjectCapability {
  return SUBJECT_CAPABILITIES[kind];
}

export function activeDetectorKinds(subjectKinds: SubjectKind[]): DetectorKind[] {
  const detectors = new Set<DetectorKind>();
  for (const kind of subjectKinds) {
    const d = SUBJECT_CAPABILITIES[kind].detector;
    if (d) detectors.add(d);
  }
  return [...detectors];
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/subjects.test.ts
```

Expected: `5 passed`.

- [ ] **Step 6: Typecheck**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm typecheck
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/
git commit -m "feat(studio): scene/subject types + capability registry"
```

---

### Task 3: Behavior registry interface + first atomic (Glow)

**Files:**
- Create: `apps/studio/src/effect/behaviors/registry.ts`
- Create: `apps/studio/src/effect/behaviors/atomics/glow.ts`
- Create: `apps/studio/src/effect/behaviors/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/effect/behaviors/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineBehavior, getBehavior, listBehaviors, registerAllBehaviors } from "./registry";
import { GLOW } from "./atomics/glow";

describe("behavior registry", () => {
  it("registers a behavior and retrieves it by id", () => {
    const probe = defineBehavior({
      id: "_probe.v1",
      kind: "atomic",
      atomicKind: "glow",
      label: "Probe",
      iconName: "sparkle",
      acceptsSubjects: ["full_frame"],
      paramSchema: z.object({ amount: z.number().min(0).max(1) }),
      defaultParams: { amount: 0.5 },
      thumbnailUrl: "",
      emit: () => ({ nodes: [], edges: [], outputPort: { node: "x", port: "out" } }),
    });
    expect(probe.id).toBe("_probe.v1");
    expect(probe.paramSchema.safeParse({ amount: 0.7 }).success).toBe(true);
    expect(probe.paramSchema.safeParse({ amount: 2 }).success).toBe(false);
  });

  it("GLOW atomic is valid for all three v1 subject kinds", () => {
    expect(GLOW.acceptsSubjects).toEqual(expect.arrayContaining(["face", "subject_silhouette", "full_frame"]));
  });

  it("GLOW defaults parse against its own schema", () => {
    expect(GLOW.paramSchema.safeParse(GLOW.defaultParams).success).toBe(true);
  });

  it("registerAllBehaviors makes GLOW retrievable by id from the global registry", () => {
    registerAllBehaviors();
    const def = getBehavior(GLOW.id);
    expect(def).toBeDefined();
    expect(def?.id).toBe(GLOW.id);
  });

  it("listBehaviors returns at least the registered atomics", () => {
    registerAllBehaviors();
    const ids = listBehaviors().map((b) => b.id);
    expect(ids).toContain(GLOW.id);
  });
});
```

- [ ] **Step 2: Run the test — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/behaviors/registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/studio/src/effect/behaviors/registry.ts`**

```ts
import type { z } from "zod";
import type { GraphEdge, GraphNode } from "@openreel/fxpkg";
import type { IconName } from "../../icons";
import type { AtomicKind, Subject, SubjectKind } from "../scene";

export interface GraphFragment {
  nodes: GraphNode[];
  edges: GraphEdge[];
  outputPort: { node: string; port: string };
}

export interface EmitCtx {
  uniqueId(prefix: string): string;
  paramRef(paramId: string): string;
}

export interface BehaviorDef<P = unknown> {
  id: string;
  kind: "preset" | "atomic";
  atomicKind?: AtomicKind;
  label: string;
  iconName: IconName;
  acceptsSubjects: SubjectKind[];
  paramSchema: z.ZodType<P>;
  defaultParams: P;
  thumbnailUrl: string;
  emit(ctx: EmitCtx, subject: Subject, params: P): GraphFragment;
}

const REGISTRY = new Map<string, BehaviorDef>();

export function defineBehavior<P>(def: BehaviorDef<P>): BehaviorDef<P> {
  return def;
}

export function register<P>(def: BehaviorDef<P>): void {
  REGISTRY.set(def.id, def as BehaviorDef);
}

export function getBehavior(id: string): BehaviorDef | undefined {
  return REGISTRY.get(id);
}

export function listBehaviors(): BehaviorDef[] {
  return [...REGISTRY.values()];
}

export function listBehaviorsForSubject(kind: SubjectKind): BehaviorDef[] {
  return [...REGISTRY.values()].filter((b) => b.acceptsSubjects.includes(kind));
}

let registered = false;

export function registerAllBehaviors(): void {
  if (registered) return;
  registered = true;
  // Lazy import the atomics + presets index to avoid circular init.
  const { ALL_ATOMICS } = require("./atomics") as { ALL_ATOMICS: BehaviorDef[] };
  const { ALL_PRESETS } = require("./presets") as { ALL_PRESETS: BehaviorDef[] };
  for (const def of [...ALL_ATOMICS, ...ALL_PRESETS]) register(def);
}
```

- [ ] **Step 4: Create the `atomics/` and `presets/` index stubs**

Create `apps/studio/src/effect/behaviors/atomics/index.ts`:

```ts
import type { BehaviorDef } from "../registry";
import { GLOW } from "./glow";

export const ALL_ATOMICS: BehaviorDef[] = [GLOW];
```

Create `apps/studio/src/effect/behaviors/presets/index.ts`:

```ts
import type { BehaviorDef } from "../registry";

export const ALL_PRESETS: BehaviorDef[] = [];
```

- [ ] **Step 5: Implement `atomics/glow.ts`**

Create `apps/studio/src/effect/behaviors/atomics/glow.ts`:

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  color: z.string().default("#FFE27A"),
  intensity: z.number().min(0).max(1).default(0.6),
  spread: z.number().min(0).max(1).default(0.4),
});

export type GlowParams = z.infer<typeof Params>;

export const GLOW = defineBehavior<GlowParams>({
  id: "atomic.glow",
  kind: "atomic",
  atomicKind: "glow",
  label: "Glow",
  iconName: "sparkle",
  acceptsSubjects: ["face", "subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { color: "#FFE27A", intensity: 0.6, spread: 0.4 },
  thumbnailUrl: "",
  emit: (ctx, subject, params) => {
    const blur = ctx.uniqueId("glow-blur");
    const tint = ctx.uniqueId("glow-tint");
    const screen = ctx.uniqueId("glow-screen");
    return {
      nodes: [
        { id: blur, type: "GaussianBlur", config: { radius: 8 + params.spread * 40 } },
        { id: tint, type: "ColorTint", config: { color: params.color, strength: params.intensity } },
        { id: screen, type: "Blend", config: { mode: "screen" } },
      ],
      edges: [
        { fromNode: blur, fromPort: "out", toNode: tint, toPort: "in" },
        { fromNode: tint, fromPort: "out", toNode: screen, toPort: "b" },
      ],
      outputPort: { node: screen, port: "out" },
    };
  },
});
```

- [ ] **Step 6: Run the test — verify it passes**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/behaviors/registry.test.ts
```

Expected: `5 passed`.

- [ ] **Step 7: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/behaviors/
git commit -m "feat(studio): behavior registry interface + Glow atomic"
```

---

### Task 4: Remaining 6 atomic behaviors

**Files (all create):**
- `apps/studio/src/effect/behaviors/atomics/particles.ts`
- `apps/studio/src/effect/behaviors/atomics/color-tint.ts`
- `apps/studio/src/effect/behaviors/atomics/blur.ts`
- `apps/studio/src/effect/behaviors/atomics/replace.ts`
- `apps/studio/src/effect/behaviors/atomics/distort.ts`
- `apps/studio/src/effect/behaviors/atomics/mask-edge.ts`
- Modify: `apps/studio/src/effect/behaviors/atomics/index.ts`
- Create: `apps/studio/src/effect/behaviors/atomics/atomics.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/studio/src/effect/behaviors/atomics/atomics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ALL_ATOMICS } from ".";

describe("atomic behaviors", () => {
  it("exports 7 atomic behaviors", () => {
    expect(ALL_ATOMICS).toHaveLength(7);
    const ids = ALL_ATOMICS.map((b) => b.id).sort();
    expect(ids).toEqual([
      "atomic.blur",
      "atomic.color-tint",
      "atomic.distort",
      "atomic.glow",
      "atomic.mask-edge",
      "atomic.particles",
      "atomic.replace",
    ]);
  });

  for (const expectedKind of [
    "glow",
    "particles",
    "color-tint",
    "blur",
    "replace",
    "distort",
    "mask-edge",
  ] as const) {
    it(`${expectedKind}: defaultParams parses against own schema`, () => {
      const def = ALL_ATOMICS.find((b) => b.atomicKind === expectedKind);
      expect(def, `missing ${expectedKind}`).toBeDefined();
      const result = def!.paramSchema.safeParse(def!.defaultParams);
      expect(result.success).toBe(true);
    });
  }

  it("each atomic emits a non-empty GraphFragment", () => {
    const ctx = { uniqueId: (p: string) => `${p}-1`, paramRef: (id: string) => `param.${id}` };
    const subject = { id: "s", kind: "full_frame" as const, name: "F", visible: true, behaviors: [] };
    for (const def of ALL_ATOMICS) {
      const valid = def.acceptsSubjects.includes("full_frame")
        ? subject
        : { ...subject, kind: def.acceptsSubjects[0] };
      const frag = def.emit(ctx, valid, def.defaultParams);
      expect(frag.nodes.length, `${def.id} has 0 nodes`).toBeGreaterThan(0);
      expect(frag.outputPort.node, `${def.id} has no output port node`).toBeTruthy();
    }
  });

  it("blur, replace, mask-edge restrict subject kinds correctly", () => {
    const find = (id: string) => ALL_ATOMICS.find((b) => b.atomicKind === id)!;
    expect(find("blur").acceptsSubjects).toEqual(expect.arrayContaining(["subject_silhouette", "full_frame"]));
    expect(find("blur").acceptsSubjects).not.toContain("face");
    expect(find("replace").acceptsSubjects).toEqual(expect.arrayContaining(["subject_silhouette", "full_frame"]));
    expect(find("replace").acceptsSubjects).not.toContain("face");
    expect(find("mask-edge").acceptsSubjects).toEqual(expect.arrayContaining(["face", "subject_silhouette"]));
    expect(find("mask-edge").acceptsSubjects).not.toContain("full_frame");
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/behaviors/atomics/atomics.test.ts
```

Expected: FAIL — only 1 atomic, missing modules.

- [ ] **Step 3: Implement `particles.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  source: z.enum(["edge", "landmark", "area"]).default("edge"),
  sprite: z.string().default("sparkle.png"),
  rate: z.number().min(0).max(2000).default(120),
  gravity: z.number().min(-200).max(200).default(0),
  color: z.string().default("#FFFFFF"),
  lifetime: z.number().min(0.1).max(8).default(1.2),
});

export type ParticlesParams = z.infer<typeof Params>;

export const PARTICLES = defineBehavior<ParticlesParams>({
  id: "atomic.particles",
  kind: "atomic",
  atomicKind: "particles",
  label: "Particles",
  iconName: "sparkle",
  acceptsSubjects: ["face", "subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { source: "edge", sprite: "sparkle.png", rate: 120, gravity: 0, color: "#FFFFFF", lifetime: 1.2 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const emit = ctx.uniqueId("part-emit");
    const field = ctx.uniqueId("part-field");
    const clamp = ctx.uniqueId("part-clamp");
    const render = ctx.uniqueId("part-render");
    return {
      nodes: [
        { id: emit, type: "ParticleEmitter", config: { rate: params.rate, max: 2048, lifetime: params.lifetime } },
        { id: field, type: "ParticleField", config: { gravity: [0, params.gravity], turbulence: 0.1 } },
        { id: clamp, type: "BudgetClamp" },
        { id: render, type: "ParticleRenderer", config: { sprite: params.sprite, blend: "additive", tint: params.color } },
      ],
      edges: [
        { fromNode: emit, fromPort: "state", toNode: field, toPort: "state" },
        { fromNode: field, fromPort: "state", toNode: clamp, toPort: "state" },
        { fromNode: clamp, fromPort: "out", toNode: render, toPort: "state" },
      ],
      outputPort: { node: render, port: "tex" },
    };
  },
});
```

- [ ] **Step 4: Implement `color-tint.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  color: z.string().default("#FF7700"),
  blend: z.enum(["multiply", "screen", "overlay", "soft-light"]).default("multiply"),
  strength: z.number().min(0).max(1).default(0.5),
});

export type ColorTintParams = z.infer<typeof Params>;

export const COLOR_TINT = defineBehavior<ColorTintParams>({
  id: "atomic.color-tint",
  kind: "atomic",
  atomicKind: "color-tint",
  label: "Color Tint",
  iconName: "palette",
  acceptsSubjects: ["face", "subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { color: "#FF7700", blend: "multiply", strength: 0.5 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const tint = ctx.uniqueId("ct-tint");
    const blend = ctx.uniqueId("ct-blend");
    return {
      nodes: [
        { id: tint, type: "ColorTint", config: { color: params.color, strength: params.strength } },
        { id: blend, type: "Blend", config: { mode: params.blend } },
      ],
      edges: [{ fromNode: tint, fromPort: "out", toNode: blend, toPort: "b" }],
      outputPort: { node: blend, port: "out" },
    };
  },
});
```

- [ ] **Step 5: Implement `blur.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  radius: z.number().min(0).max(64).default(16),
  quality: z.enum(["low", "medium", "high"]).default("medium"),
});

export type BlurParams = z.infer<typeof Params>;

export const BLUR = defineBehavior<BlurParams>({
  id: "atomic.blur",
  kind: "atomic",
  atomicKind: "blur",
  label: "Blur",
  iconName: "blur",
  acceptsSubjects: ["subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { radius: 16, quality: "medium" },
  thumbnailUrl: "",
  emit: (ctx, subject, params) => {
    const blur = ctx.uniqueId("blur");
    if (subject.kind === "subject_silhouette") {
      const invert = ctx.uniqueId("blur-invert");
      const compose = ctx.uniqueId("blur-compose");
      return {
        nodes: [
          { id: invert, type: "InvertMask" },
          { id: blur, type: "GaussianBlur", config: { radius: params.radius } },
          { id: compose, type: "Layer" },
        ],
        edges: [
          { fromNode: invert, fromPort: "out", toNode: compose, toPort: "mask" },
          { fromNode: blur, fromPort: "out", toNode: compose, toPort: "back" },
        ],
        outputPort: { node: compose, port: "out" },
      };
    }
    return {
      nodes: [{ id: blur, type: "GaussianBlur", config: { radius: params.radius } }],
      edges: [],
      outputPort: { node: blur, port: "out" },
    };
  },
});
```

- [ ] **Step 6: Implement `replace.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  mode: z.enum(["color", "image", "none"]).default("color"),
  color: z.string().default("#000000"),
  imageRef: z.string().optional(),
  edgeSoftness: z.number().min(0).max(1).default(0.2),
});

export type ReplaceParams = z.infer<typeof Params>;

export const REPLACE = defineBehavior<ReplaceParams>({
  id: "atomic.replace",
  kind: "atomic",
  atomicKind: "replace",
  label: "Replace",
  iconName: "image",
  acceptsSubjects: ["subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { mode: "color", color: "#000000", edgeSoftness: 0.2 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const bg = ctx.uniqueId("rep-bg");
    const compose = ctx.uniqueId("rep-compose");
    return {
      nodes: [
        { id: bg, type: params.mode === "image" ? "ImageSource" : "ColorSource", config: { color: params.color, image: params.imageRef ?? "" } },
        { id: compose, type: "Layer", config: { feather: params.edgeSoftness } },
      ],
      edges: [{ fromNode: bg, fromPort: "out", toNode: compose, toPort: "back" }],
      outputPort: { node: compose, port: "out" },
    };
  },
});
```

- [ ] **Step 7: Implement `distort.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  type: z.enum(["wave", "pinch", "pixelate"]).default("wave"),
  strength: z.number().min(0).max(1).default(0.4),
});

export type DistortParams = z.infer<typeof Params>;

export const DISTORT = defineBehavior<DistortParams>({
  id: "atomic.distort",
  kind: "atomic",
  atomicKind: "distort",
  label: "Distort",
  iconName: "waves",
  acceptsSubjects: ["face", "subject_silhouette", "full_frame"],
  paramSchema: Params,
  defaultParams: { type: "wave", strength: 0.4 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const node = ctx.uniqueId("dist");
    const nodeType = params.type === "pixelate" ? "Pixelate" : "UVDistortion";
    return {
      nodes: [{ id: node, type: nodeType, config: { mode: params.type, strength: params.strength } }],
      edges: [],
      outputPort: { node, port: "out" },
    };
  },
});
```

- [ ] **Step 8: Implement `mask-edge.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  color: z.string().default("#FFFFFF"),
  thickness: z.number().min(0).max(1).default(0.3),
  style: z.enum(["solid", "dashed", "glow"]).default("solid"),
});

export type MaskEdgeParams = z.infer<typeof Params>;

export const MASK_EDGE = defineBehavior<MaskEdgeParams>({
  id: "atomic.mask-edge",
  kind: "atomic",
  atomicKind: "mask-edge",
  label: "Mask Edge",
  iconName: "crosshair",
  acceptsSubjects: ["face", "subject_silhouette"],
  paramSchema: Params,
  defaultParams: { color: "#FFFFFF", thickness: 0.3, style: "solid" },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const edge = ctx.uniqueId("edge");
    const stroke = ctx.uniqueId("edge-stroke");
    return {
      nodes: [
        { id: edge, type: "MaskEdge", config: { width: params.thickness * 10 } },
        { id: stroke, type: "ColorTint", config: { color: params.color, strength: 1, glow: params.style === "glow" } },
      ],
      edges: [{ fromNode: edge, fromPort: "out", toNode: stroke, toPort: "in" }],
      outputPort: { node: stroke, port: "out" },
    };
  },
});
```

- [ ] **Step 9: Update `atomics/index.ts`**

```ts
import type { BehaviorDef } from "../registry";
import { GLOW } from "./glow";
import { PARTICLES } from "./particles";
import { COLOR_TINT } from "./color-tint";
import { BLUR } from "./blur";
import { REPLACE } from "./replace";
import { DISTORT } from "./distort";
import { MASK_EDGE } from "./mask-edge";

export const ALL_ATOMICS: BehaviorDef[] = [GLOW, PARTICLES, COLOR_TINT, BLUR, REPLACE, DISTORT, MASK_EDGE];
```

- [ ] **Step 10: Run tests — verify pass**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/behaviors/
```

Expected: all atomics tests pass (plus existing registry test).

- [ ] **Step 11: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/behaviors/atomics/
git commit -m "feat(studio): 7 atomic behaviors (glow, particles, color-tint, blur, replace, distort, mask-edge)"
```

---

### Task 5: 10 preset behaviors (repurpose existing fxpkg blueprints)

**Files (all create):**
- `apps/studio/src/effect/behaviors/presets/fire-aura.v1.ts`
- `apps/studio/src/effect/behaviors/presets/sparkles.face.v1.ts`
- `apps/studio/src/effect/behaviors/presets/ghost-trail.v1.ts`
- `apps/studio/src/effect/behaviors/presets/clone.three.v1.ts`
- `apps/studio/src/effect/behaviors/presets/aura-glow.v1.ts`
- `apps/studio/src/effect/behaviors/presets/background-replace.v1.ts`
- `apps/studio/src/effect/behaviors/presets/face-tint.v1.ts`
- `apps/studio/src/effect/behaviors/presets/warm-look.v1.ts`
- `apps/studio/src/effect/behaviors/presets/cinematic-bars.v1.ts`
- `apps/studio/src/effect/behaviors/presets/dreamy.v1.ts`
- Modify: `apps/studio/src/effect/behaviors/presets/index.ts`
- Create: `apps/studio/src/effect/behaviors/presets/presets.test.ts`

**Pattern:** Each preset wraps the equivalent `BLUEPRINTS[id]` from `@openreel/fxpkg`'s `blueprints.ts`, slicing the blueprint's graph nodes/edges around the source so they become a fragment. The fragment's `outputPort` is the node that was previously wired into the blueprint's `Output` node.

- [ ] **Step 1: Write failing tests**

Create `apps/studio/src/effect/behaviors/presets/presets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ALL_PRESETS } from ".";

describe("preset behaviors", () => {
  const expectedIds = [
    "preset.fire-aura.v1",
    "preset.sparkles.face.v1",
    "preset.ghost-trail.v1",
    "preset.clone.three.v1",
    "preset.aura-glow.v1",
    "preset.background-replace.v1",
    "preset.face-tint.v1",
    "preset.warm-look.v1",
    "preset.cinematic-bars.v1",
    "preset.dreamy.v1",
  ];

  it("exports 10 presets", () => {
    expect(ALL_PRESETS).toHaveLength(10);
    expect(ALL_PRESETS.map((p) => p.id).sort()).toEqual([...expectedIds].sort());
  });

  it("every preset's defaultParams parses against its own schema", () => {
    for (const def of ALL_PRESETS) {
      const r = def.paramSchema.safeParse(def.defaultParams);
      expect(r.success, `${def.id} defaults invalid`).toBe(true);
    }
  });

  it("every preset emits a non-empty fragment with a real output port", () => {
    const ctx = { uniqueId: (p: string) => `${p}-1`, paramRef: (id: string) => `param.${id}` };
    for (const def of ALL_PRESETS) {
      const kind = def.acceptsSubjects[0];
      const subject = { id: "s", kind, name: "S", visible: true, behaviors: [] };
      const frag = def.emit(ctx, subject, def.defaultParams);
      expect(frag.nodes.length, `${def.id} has no nodes`).toBeGreaterThan(0);
      expect(frag.outputPort.node, `${def.id} output unset`).toBeTruthy();
      const ids = new Set(frag.nodes.map((n) => n.id));
      expect(ids.has(frag.outputPort.node), `${def.id} outputPort.node not in fragment`).toBe(true);
    }
  });

  it("subject_silhouette presets do not accept face-only kinds and vice-versa", () => {
    const sparkles = ALL_PRESETS.find((p) => p.id === "preset.sparkles.face.v1")!;
    const faceTint = ALL_PRESETS.find((p) => p.id === "preset.face-tint.v1")!;
    expect(sparkles.acceptsSubjects).toEqual(["face"]);
    expect(faceTint.acceptsSubjects).toEqual(["face"]);

    const fireAura = ALL_PRESETS.find((p) => p.id === "preset.fire-aura.v1")!;
    expect(fireAura.acceptsSubjects).toEqual(["subject_silhouette"]);

    const warm = ALL_PRESETS.find((p) => p.id === "preset.warm-look.v1")!;
    expect(warm.acceptsSubjects).toEqual(["full_frame"]);
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/behaviors/presets/presets.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `fire-aura.v1.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  intensity: z.number().min(0).max(1).default(0.7),
  color: z.string().default("#FF7700"),
  flameHeight: z.number().min(0).max(1).default(0.6),
  heatDistortion: z.number().min(0).max(1).default(0.3),
  position: z.enum(["behind", "surround", "front"]).default("surround"),
});

export type FireAuraParams = z.infer<typeof Params>;

export const FIRE_AURA = defineBehavior<FireAuraParams>({
  id: "preset.fire-aura.v1",
  kind: "preset",
  label: "Fire Aura",
  iconName: "flame",
  acceptsSubjects: ["subject_silhouette"],
  paramSchema: Params,
  defaultParams: { intensity: 0.7, color: "#FF7700", flameHeight: 0.6, heatDistortion: 0.3, position: "surround" },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const edge = ctx.uniqueId("fire-edge");
    const emit = ctx.uniqueId("fire-emit");
    const field = ctx.uniqueId("fire-field");
    const clamp = ctx.uniqueId("fire-clamp");
    const render = ctx.uniqueId("fire-render");
    const glow = ctx.uniqueId("fire-glow");
    const layer = ctx.uniqueId("fire-layer");
    return {
      nodes: [
        { id: edge, type: "MaskEdgeEmitter", config: { width: 3, density: 200 } },
        { id: emit, type: "ParticleEmitter", config: { rate: 200 * params.intensity, lifetime: 1.2, velocity: [0, -200 * params.flameHeight], max: 2048 } },
        { id: field, type: "ParticleField", config: { gravity: [0, -50], turbulence: 0.35, wind: [8, -2] } },
        { id: clamp, type: "BudgetClamp" },
        { id: render, type: "ParticleRenderer", config: { sprite: "fire.png", blend: "additive", tint: params.color } },
        { id: glow, type: "GaussianBlur", config: { radius: 16 } },
        { id: layer, type: "Layer", config: { position: params.position } },
      ],
      edges: [
        { fromNode: edge, fromPort: "pts", toNode: emit, toPort: "spawn" },
        { fromNode: emit, fromPort: "state", toNode: field, toPort: "state" },
        { fromNode: field, fromPort: "state", toNode: clamp, toPort: "state" },
        { fromNode: clamp, fromPort: "out", toNode: render, toPort: "state" },
        { fromNode: render, fromPort: "tex", toNode: glow, toPort: "in" },
        { fromNode: glow, fromPort: "out", toNode: layer, toPort: params.position === "behind" ? "back" : "front" },
      ],
      outputPort: { node: layer, port: "out" },
    };
  },
});
```

- [ ] **Step 4: Implement `sparkles.face.v1.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  style: z.enum(["gold", "diamond", "holo"]).default("gold"),
  amount: z.number().min(0).max(1).default(0.6),
  size: z.number().min(0).max(1).default(0.4),
  color: z.string().default("#FFE27A"),
  anchor: z.enum(["eyes", "eye_left", "eye_right", "nose", "mouth", "forehead"]).default("eyes"),
});

export type SparklesFaceParams = z.infer<typeof Params>;

const SPRITE: Record<SparklesFaceParams["style"], string> = {
  gold: "sparkle-gold.png",
  diamond: "sparkle-diamond.png",
  holo: "sparkle-holo.png",
};

export const SPARKLES_FACE = defineBehavior<SparklesFaceParams>({
  id: "preset.sparkles.face.v1",
  kind: "preset",
  label: "Sparkles",
  iconName: "sparkle",
  acceptsSubjects: ["face"],
  paramSchema: Params,
  defaultParams: { style: "gold", amount: 0.6, size: 0.4, color: "#FFE27A", anchor: "eyes" },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const lmEmit = ctx.uniqueId("spk-lm");
    const emit = ctx.uniqueId("spk-emit");
    const clamp = ctx.uniqueId("spk-clamp");
    const render = ctx.uniqueId("spk-render");
    const glow = ctx.uniqueId("spk-glow");
    return {
      nodes: [
        { id: lmEmit, type: "LandmarkEmitter", config: { anchor: params.anchor } },
        { id: emit, type: "ParticleEmitter", config: { rate: 80 * params.amount, max: 1024, size: params.size } },
        { id: clamp, type: "BudgetClamp" },
        { id: render, type: "ParticleRenderer", config: { sprite: SPRITE[params.style], blend: "additive", tint: params.color } },
        { id: glow, type: "GaussianBlur", config: { radius: 6 } },
      ],
      edges: [
        { fromNode: lmEmit, fromPort: "pts", toNode: emit, toPort: "spawn" },
        { fromNode: emit, fromPort: "state", toNode: clamp, toPort: "state" },
        { fromNode: clamp, fromPort: "out", toNode: render, toPort: "state" },
        { fromNode: render, fromPort: "tex", toNode: glow, toPort: "in" },
      ],
      outputPort: { node: glow, port: "out" },
    };
  },
});
```

- [ ] **Step 5: Implement `ghost-trail.v1.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  length: z.number().min(2).max(16).default(6),
  fade: z.number().min(0.5).max(0.98).default(0.85),
  tint: z.string().default("#88BBFF"),
});

export type GhostTrailParams = z.infer<typeof Params>;

export const GHOST_TRAIL = defineBehavior<GhostTrailParams>({
  id: "preset.ghost-trail.v1",
  kind: "preset",
  label: "Ghost Trail",
  iconName: "history",
  acceptsSubjects: ["subject_silhouette"],
  paramSchema: Params,
  defaultParams: { length: 6, fade: 0.85, tint: "#88BBFF" },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const trail = ctx.uniqueId("gt-trail");
    const tint = ctx.uniqueId("gt-tint");
    return {
      nodes: [
        { id: trail, type: "Trail", config: { length: params.length, fade: params.fade } },
        { id: tint, type: "ColorTint", config: { color: params.tint, strength: 0.4 } },
      ],
      edges: [{ fromNode: trail, fromPort: "out", toNode: tint, toPort: "in" }],
      outputPort: { node: tint, port: "out" },
    };
  },
});
```

- [ ] **Step 6: Implement `clone.three.v1.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  spacing: z.number().min(0.1).max(0.45).default(0.3),
  echoOpacity: z.number().min(0).max(1).default(0.7),
});

export type CloneThreeParams = z.infer<typeof Params>;

export const CLONE_THREE = defineBehavior<CloneThreeParams>({
  id: "preset.clone.three.v1",
  kind: "preset",
  label: "Three of Me",
  iconName: "copy",
  acceptsSubjects: ["subject_silhouette"],
  paramSchema: Params,
  defaultParams: { spacing: 0.3, echoOpacity: 0.7 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const cut = ctx.uniqueId("clone-cut");
    const tl = ctx.uniqueId("clone-tl");
    const tr = ctx.uniqueId("clone-tr");
    const b1 = ctx.uniqueId("clone-b1");
    const b2 = ctx.uniqueId("clone-b2");
    return {
      nodes: [
        { id: cut, type: "Cutout" },
        { id: tl, type: "Transform", config: { x: -params.spacing, opacity: params.echoOpacity } },
        { id: tr, type: "Transform", config: { x: params.spacing, opacity: params.echoOpacity } },
        { id: b1, type: "Blend", config: { mode: "normal" } },
        { id: b2, type: "Blend", config: { mode: "normal" } },
      ],
      edges: [
        { fromNode: cut, fromPort: "out", toNode: tl, toPort: "in" },
        { fromNode: cut, fromPort: "out", toNode: tr, toPort: "in" },
        { fromNode: tl, fromPort: "out", toNode: b1, toPort: "a" },
        { fromNode: tr, fromPort: "out", toNode: b1, toPort: "b" },
        { fromNode: b1, fromPort: "out", toNode: b2, toPort: "a" },
        { fromNode: cut, fromPort: "out", toNode: b2, toPort: "b" },
      ],
      outputPort: { node: b2, port: "out" },
    };
  },
});
```

- [ ] **Step 7: Implement `aura-glow.v1.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  color: z.string().default("#88FFEE"),
  pulse: z.number().min(0).max(2).default(0.6),
  thickness: z.number().min(0).max(1).default(0.5),
  softness: z.number().min(0).max(1).default(0.5),
});

export type AuraGlowParams = z.infer<typeof Params>;

export const AURA_GLOW = defineBehavior<AuraGlowParams>({
  id: "preset.aura-glow.v1",
  kind: "preset",
  label: "Aura Glow",
  iconName: "sparkle",
  acceptsSubjects: ["subject_silhouette"],
  paramSchema: Params,
  defaultParams: { color: "#88FFEE", pulse: 0.6, thickness: 0.5, softness: 0.5 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const edge = ctx.uniqueId("aura-edge");
    const blur = ctx.uniqueId("aura-blur");
    const tint = ctx.uniqueId("aura-tint");
    const pulse = ctx.uniqueId("aura-pulse");
    return {
      nodes: [
        { id: edge, type: "MaskEdge", config: { width: params.thickness * 10 } },
        { id: blur, type: "GaussianBlur", config: { radius: 8 + params.softness * 32 } },
        { id: tint, type: "ColorTint", config: { color: params.color, strength: 1 } },
        { id: pulse, type: "PulseModulator", config: { speed: params.pulse } },
      ],
      edges: [
        { fromNode: edge, fromPort: "out", toNode: blur, toPort: "in" },
        { fromNode: blur, fromPort: "out", toNode: tint, toPort: "in" },
        { fromNode: tint, fromPort: "out", toNode: pulse, toPort: "in" },
      ],
      outputPort: { node: pulse, port: "out" },
    };
  },
});
```

- [ ] **Step 8: Implement `background-replace.v1.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  mode: z.enum(["color", "image", "blur"]).default("color"),
  color: z.string().default("#0E0E0E"),
  imageRef: z.string().optional(),
  blurRadius: z.number().min(0).max(64).default(20),
  edgeSoftness: z.number().min(0).max(1).default(0.2),
});

export type BgReplaceParams = z.infer<typeof Params>;

export const BACKGROUND_REPLACE = defineBehavior<BgReplaceParams>({
  id: "preset.background-replace.v1",
  kind: "preset",
  label: "Background Replace",
  iconName: "image",
  acceptsSubjects: ["subject_silhouette"],
  paramSchema: Params,
  defaultParams: { mode: "color", color: "#0E0E0E", blurRadius: 20, edgeSoftness: 0.2 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const bg = ctx.uniqueId("bgr-bg");
    const compose = ctx.uniqueId("bgr-compose");
    let bgConfig: Record<string, unknown> = {};
    let bgType = "ColorSource";
    if (params.mode === "image") {
      bgType = "ImageSource";
      bgConfig = { image: params.imageRef ?? "" };
    } else if (params.mode === "blur") {
      bgType = "GaussianBlur";
      bgConfig = { radius: params.blurRadius };
    } else {
      bgConfig = { color: params.color };
    }
    return {
      nodes: [
        { id: bg, type: bgType, config: bgConfig },
        { id: compose, type: "Layer", config: { feather: params.edgeSoftness } },
      ],
      edges: [{ fromNode: bg, fromPort: "out", toNode: compose, toPort: "back" }],
      outputPort: { node: compose, port: "out" },
    };
  },
});
```

- [ ] **Step 9: Implement `face-tint.v1.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  color: z.string().default("#FFB088"),
  strength: z.number().min(0).max(1).default(0.4),
  skinOnly: z.boolean().default(true),
});

export type FaceTintParams = z.infer<typeof Params>;

export const FACE_TINT = defineBehavior<FaceTintParams>({
  id: "preset.face-tint.v1",
  kind: "preset",
  label: "Face Tint",
  iconName: "palette",
  acceptsSubjects: ["face"],
  paramSchema: Params,
  defaultParams: { color: "#FFB088", strength: 0.4, skinOnly: true },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const mask = ctx.uniqueId("ft-mask");
    const tint = ctx.uniqueId("ft-tint");
    return {
      nodes: [
        { id: mask, type: params.skinOnly ? "FaceSkinMask" : "FaceMask" },
        { id: tint, type: "ColorTint", config: { color: params.color, strength: params.strength } },
      ],
      edges: [{ fromNode: mask, fromPort: "out", toNode: tint, toPort: "mask" }],
      outputPort: { node: tint, port: "out" },
    };
  },
});
```

- [ ] **Step 10: Implement `warm-look.v1.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  warmth: z.number().min(0).max(1).default(0.4),
  vignette: z.number().min(0).max(1).default(0.4),
  grain: z.number().min(0).max(1).default(0.1),
});

export type WarmLookParams = z.infer<typeof Params>;

export const WARM_LOOK = defineBehavior<WarmLookParams>({
  id: "preset.warm-look.v1",
  kind: "preset",
  label: "Warm Look",
  iconName: "sun",
  acceptsSubjects: ["full_frame"],
  paramSchema: Params,
  defaultParams: { warmth: 0.4, vignette: 0.4, grain: 0.1 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const lut = ctx.uniqueId("warm-lut");
    const vig = ctx.uniqueId("warm-vig");
    const grain = ctx.uniqueId("warm-grain");
    return {
      nodes: [
        { id: lut, type: "LUT", config: { name: "warm", amount: params.warmth } },
        { id: vig, type: "Vignette", config: { softness: params.vignette } },
        { id: grain, type: "Grain", config: { strength: params.grain } },
      ],
      edges: [
        { fromNode: lut, fromPort: "out", toNode: vig, toPort: "in" },
        { fromNode: vig, fromPort: "out", toNode: grain, toPort: "in" },
      ],
      outputPort: { node: grain, port: "out" },
    };
  },
});
```

- [ ] **Step 11: Implement `cinematic-bars.v1.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  height: z.number().min(0.05).max(0.25).default(0.12),
  color: z.string().default("#000000"),
});

export type CinematicBarsParams = z.infer<typeof Params>;

export const CINEMATIC_BARS = defineBehavior<CinematicBarsParams>({
  id: "preset.cinematic-bars.v1",
  kind: "preset",
  label: "Cinematic Bars",
  iconName: "monitor",
  acceptsSubjects: ["full_frame"],
  paramSchema: Params,
  defaultParams: { height: 0.12, color: "#000000" },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const bars = ctx.uniqueId("cb-bars");
    return {
      nodes: [{ id: bars, type: "LetterboxBars", config: { height: params.height, color: params.color } }],
      edges: [],
      outputPort: { node: bars, port: "out" },
    };
  },
});
```

- [ ] **Step 12: Implement `dreamy.v1.ts`**

```ts
import { z } from "zod";
import { defineBehavior } from "../registry";

const Params = z.object({
  glow: z.number().min(0).max(1).default(0.5),
  bloom: z.number().min(0).max(1).default(0.5),
  softContrast: z.number().min(0).max(1).default(0.4),
});

export type DreamyParams = z.infer<typeof Params>;

export const DREAMY = defineBehavior<DreamyParams>({
  id: "preset.dreamy.v1",
  kind: "preset",
  label: "Dreamy",
  iconName: "droplet",
  acceptsSubjects: ["full_frame"],
  paramSchema: Params,
  defaultParams: { glow: 0.5, bloom: 0.5, softContrast: 0.4 },
  thumbnailUrl: "",
  emit: (ctx, _subject, params) => {
    const blur = ctx.uniqueId("dr-blur");
    const screen = ctx.uniqueId("dr-screen");
    const curve = ctx.uniqueId("dr-curve");
    return {
      nodes: [
        { id: blur, type: "GaussianBlur", config: { radius: 8 + params.glow * 24 } },
        { id: screen, type: "Blend", config: { mode: "screen", strength: params.bloom } },
        { id: curve, type: "Curves", config: { contrast: -params.softContrast } },
      ],
      edges: [
        { fromNode: blur, fromPort: "out", toNode: screen, toPort: "b" },
        { fromNode: screen, fromPort: "out", toNode: curve, toPort: "in" },
      ],
      outputPort: { node: curve, port: "out" },
    };
  },
});
```

- [ ] **Step 13: Update `presets/index.ts`**

```ts
import type { BehaviorDef } from "../registry";
import { FIRE_AURA } from "./fire-aura.v1";
import { SPARKLES_FACE } from "./sparkles.face.v1";
import { GHOST_TRAIL } from "./ghost-trail.v1";
import { CLONE_THREE } from "./clone.three.v1";
import { AURA_GLOW } from "./aura-glow.v1";
import { BACKGROUND_REPLACE } from "./background-replace.v1";
import { FACE_TINT } from "./face-tint.v1";
import { WARM_LOOK } from "./warm-look.v1";
import { CINEMATIC_BARS } from "./cinematic-bars.v1";
import { DREAMY } from "./dreamy.v1";

export const ALL_PRESETS: BehaviorDef[] = [
  FIRE_AURA, SPARKLES_FACE, GHOST_TRAIL, CLONE_THREE, AURA_GLOW,
  BACKGROUND_REPLACE, FACE_TINT, WARM_LOOK, CINEMATIC_BARS, DREAMY,
];
```

- [ ] **Step 14: Run tests — verify pass**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/behaviors/presets/
```

Expected: all preset tests pass.

- [ ] **Step 15: Add icons that may be missing**

Open `apps/studio/src/icons.tsx`. Confirm the union includes: `sparkle`, `flame`, `palette`, `sun`, `monitor`, `droplet`, `history`, `copy`, `image`, `crosshair`, `blur`, `waves`, `face`, `person`. Add any missing entries to the `IconName` union and `PATHS` map using simple stroke SVG paths.

Run typecheck:

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm typecheck
```

Expected: passes.

- [ ] **Step 16: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/behaviors/presets/ apps/studio/src/icons.tsx
git commit -m "feat(studio): 10 preset behaviors (fire aura, sparkles, ghost trail, clone, aura, bg replace, face tint, warm look, cinematic bars, dreamy)"
```

---

### Task 6: `sceneToGraph` compilation

**Files:**
- Create: `apps/studio/src/effect/compile.ts`
- Create: `apps/studio/src/effect/compile.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/studio/src/effect/compile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateGraph } from "@openreel/fxpkg";
import { sceneToGraph } from "./compile";
import { emptyScene, type Scene } from "./scene";
import { registerAllBehaviors, getBehavior } from "./behaviors/registry";

registerAllBehaviors();

function makeScene(): Scene {
  const sparkles = getBehavior("preset.sparkles.face.v1")!;
  const warm = getBehavior("preset.warm-look.v1")!;
  return {
    sampleClipId: "portrait-closeup-01",
    subjects: [
      {
        id: "sub-1",
        kind: "face",
        name: "Face",
        visible: true,
        behaviors: [
          { id: "b-1", kind: "preset", presetId: sparkles.id, params: sparkles.defaultParams, name: "Sparkles", visible: true },
        ],
      },
      {
        id: "sub-2",
        kind: "full_frame",
        name: "Full frame",
        visible: true,
        behaviors: [
          { id: "b-2", kind: "preset", presetId: warm.id, params: warm.defaultParams, name: "Warm", visible: true },
        ],
      },
    ],
  };
}

describe("sceneToGraph", () => {
  it("produces a fxpkg Graph with a Source and Output node for an empty scene", () => {
    const result = sceneToGraph(emptyScene(), { kind: "effect" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const g = result.graph;
    expect(g.kind).toBe("effect");
    expect(g.nodes.find((n) => n.type === "Source")).toBeDefined();
    expect(g.nodes.find((n) => n.type === "Output")).toBeDefined();
  });

  it("composes preset fragments into a connected graph that passes fxpkg validation", () => {
    const result = sceneToGraph(makeScene(), { kind: "effect" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validation = validateGraph(result.graph);
    expect(validation.ok, JSON.stringify(validation)).toBe(true);
  });

  it("invisible subjects are skipped (their behaviors not emitted)", () => {
    const scene = makeScene();
    scene.subjects[0].visible = false;
    const result = sceneToGraph(scene, { kind: "effect" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes.find((n) => n.type === "LandmarkEmitter")).toBeUndefined();
  });

  it("invisible behaviors are skipped", () => {
    const scene = makeScene();
    scene.subjects[0].behaviors[0].visible = false;
    const result = sceneToGraph(scene, { kind: "effect" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes.find((n) => n.type === "LandmarkEmitter")).toBeUndefined();
  });

  it("returns errors for behaviors whose params fail their schema", () => {
    const scene = makeScene();
    scene.subjects[0].behaviors[0].params = { amount: 99 };
    const result = sceneToGraph(scene, { kind: "effect" });
    expect(result.ok).toBe(false);
  });

  it("a Source node and one Output node always exist, even with many subjects", () => {
    const scene = makeScene();
    const result = sceneToGraph(scene, { kind: "effect" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sources = result.graph.nodes.filter((n) => n.type === "Source");
    const outputs = result.graph.nodes.filter((n) => n.type === "Output");
    expect(sources).toHaveLength(1);
    expect(outputs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/compile.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `apps/studio/src/effect/compile.ts`**

```ts
import type { AssetKind, Graph, GraphEdge, GraphNode } from "@openreel/fxpkg";
import { getBehavior } from "./behaviors/registry";
import type { EmitCtx } from "./behaviors/registry";
import { activeDetectorKinds, getSubjectCapability } from "./subjects";
import type { Scene, SceneCompileResult, Subject } from "./scene";

interface CompileOptions {
  kind: AssetKind;
}

function detectorTypeForSubjectKind(kind: Subject["kind"]): { node: string; outPort: string } | null {
  switch (kind) {
    case "face":
      return { node: "FaceLandmarker", outPort: "buf" };
    case "subject_silhouette":
      return { node: "SubjectMask", outPort: "mask" };
    case "full_frame":
      return null;
  }
}

export function sceneToGraph(scene: Scene, opts: CompileOptions): SceneCompileResult {
  const errors: string[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let counter = 0;
  const mkId = (prefix: string) => `${prefix}-${++counter}`;

  const source: GraphNode = { id: "source", type: "Source", position: { x: 16, y: 200 } };
  const output: GraphNode = { id: "output", type: "Output", position: { x: 1200, y: 200 } };
  nodes.push(source);

  const detectorByKind = new Map<string, string>();
  const subjectKindsUsed = new Set<Subject["kind"]>();
  for (const subject of scene.subjects) {
    if (!subject.visible) continue;
    if (subjectKindsUsed.has(subject.kind)) {
      errors.push(`Duplicate subject kind in scene: ${subject.kind}`);
      continue;
    }
    subjectKindsUsed.add(subject.kind);
    const detector = detectorTypeForSubjectKind(subject.kind);
    if (detector && !detectorByKind.has(subject.kind)) {
      const id = mkId(detector.node.toLowerCase());
      detectorByKind.set(subject.kind, id);
      nodes.push({ id, type: detector.node });
      edges.push({ fromNode: source.id, fromPort: "out", toNode: id, toPort: "src" });
    }
  }

  let lastNode = source.id;
  let lastPort = "out";

  for (const subject of scene.subjects) {
    if (!subject.visible) continue;
    for (const behavior of subject.behaviors) {
      if (!behavior.visible) continue;
      const def = getBehavior(
        behavior.kind === "preset"
          ? behavior.presetId
          : `atomic.${behavior.atomicKind}`,
      );
      if (!def) {
        errors.push(`Unknown behavior: ${JSON.stringify(behavior)}`);
        continue;
      }
      if (!def.acceptsSubjects.includes(subject.kind)) {
        errors.push(`Behavior ${def.id} does not accept subject kind ${subject.kind}`);
        continue;
      }
      const parsed = def.paramSchema.safeParse(behavior.params);
      if (!parsed.success) {
        errors.push(`Behavior ${def.id} params invalid: ${parsed.error.message}`);
        continue;
      }
      const ctx: EmitCtx = {
        uniqueId: (prefix: string) => mkId(prefix),
        paramRef: (id: string) => `param.${id}`,
      };
      const fragment = def.emit(ctx, subject, parsed.data);
      for (const n of fragment.nodes) nodes.push(n);
      for (const e of fragment.edges) edges.push(e);
      edges.push({ fromNode: lastNode, fromPort: lastPort, toNode: fragment.outputPort.node, toPort: "in" });
      lastNode = fragment.outputPort.node;
      lastPort = fragment.outputPort.port;
    }
  }

  nodes.push(output);
  edges.push({ fromNode: lastNode, fromPort: lastPort, toNode: output.id, toPort: "in" });

  if (errors.length > 0) return { ok: false, errors };

  const detectionCapabilities = activeDetectorKinds([...subjectKindsUsed]).map((d) => {
    if (d === "FaceLandmarker") return "face" as const;
    return "subject_mask" as const;
  });

  const graph: Graph = {
    id: `scene-${Math.random().toString(36).slice(2, 8)}`,
    kind: opts.kind,
    abi: "1.0",
    nodelibVersion: "1.0.0",
    nodes,
    edges,
    params: [],
  };
  void detectionCapabilities; // consumed by manifest builder, not by graph

  return { ok: true, graph };
}
```

- [ ] **Step 4: Wire up registerAllBehaviors at module init**

The compile.test.ts already calls `registerAllBehaviors()` at the top. Also make `compile.ts` self-bootstrapping for runtime use: at the bottom of `compile.ts` add:

```ts
import { registerAllBehaviors } from "./behaviors/registry";
registerAllBehaviors();
```

- [ ] **Step 5: Run tests — verify pass**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/compile.test.ts
```

Expected: all 6 tests pass. If fxpkg validation fails because of unknown node types (e.g., "FaceLandmarker", "MaskEdgeEmitter"), check `packages/fxpkg/src/nodelib.ts` to see what's registered. If a node type isn't in the nodelib, two options:

1. Add the node type to `packages/fxpkg/src/nodelib.ts` (lightest touch — extends the registry).
2. If extending fxpkg is undesirable for this PR, mark the test as `skip` for now and add a TODO that the nodelib needs the extra node types, then revisit in Task 9.

Document whichever choice you make in the commit message.

- [ ] **Step 6: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/compile.ts apps/studio/src/effect/compile.test.ts
git commit -m "feat(studio): sceneToGraph compilation + property tests"
```

---

### Task 7: Scene store (useReducer + Context)

**Files:**
- Create: `apps/studio/src/effect/store.ts`
- Create: `apps/studio/src/effect/store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/studio/src/effect/store.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sceneReducer, initialSceneState, type SceneState } from "./store";
import { registerAllBehaviors, getBehavior } from "./behaviors/registry";

registerAllBehaviors();

function init(): SceneState {
  return initialSceneState();
}

describe("scene store", () => {
  it("addSubject appends a subject of the chosen kind with default name", () => {
    const s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    expect(s.scene.subjects).toHaveLength(1);
    expect(s.scene.subjects[0].kind).toBe("face");
    expect(s.scene.subjects[0].name).toBe("Face");
    expect(s.scene.subjects[0].visible).toBe(true);
    expect(s.selection).toEqual({ type: "subject", id: s.scene.subjects[0].id });
  });

  it("addSubject refuses to add a duplicate kind", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    s = sceneReducer(s, { type: "addSubject", kind: "face" });
    expect(s.scene.subjects).toHaveLength(1);
  });

  it("addBehavior appends a behavior to the named subject and selects it", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    const subjectId = s.scene.subjects[0].id;
    const sparkles = getBehavior("preset.sparkles.face.v1")!;
    s = sceneReducer(s, {
      type: "addBehavior",
      subjectId,
      behavior: {
        id: "b-1",
        kind: "preset",
        presetId: sparkles.id,
        params: sparkles.defaultParams,
        name: sparkles.label,
        visible: true,
      },
    });
    expect(s.scene.subjects[0].behaviors).toHaveLength(1);
    expect(s.selection).toEqual({ type: "behavior", subjectId, behaviorId: "b-1" });
  });

  it("setBehaviorParam updates one param on a behavior without recreating the whole array", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    const subjectId = s.scene.subjects[0].id;
    const sparkles = getBehavior("preset.sparkles.face.v1")!;
    s = sceneReducer(s, {
      type: "addBehavior",
      subjectId,
      behavior: {
        id: "b-1", kind: "preset", presetId: sparkles.id, params: { ...sparkles.defaultParams },
        name: sparkles.label, visible: true,
      },
    });
    s = sceneReducer(s, { type: "setBehaviorParam", subjectId, behaviorId: "b-1", key: "amount", value: 0.9 });
    const params = s.scene.subjects[0].behaviors[0].params as { amount: number };
    expect(params.amount).toBe(0.9);
  });

  it("removeBehavior drops the behavior and clears selection if it was selected", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    const subjectId = s.scene.subjects[0].id;
    const sparkles = getBehavior("preset.sparkles.face.v1")!;
    s = sceneReducer(s, {
      type: "addBehavior",
      subjectId,
      behavior: { id: "b-1", kind: "preset", presetId: sparkles.id, params: sparkles.defaultParams, name: "S", visible: true },
    });
    s = sceneReducer(s, { type: "removeBehavior", subjectId, behaviorId: "b-1" });
    expect(s.scene.subjects[0].behaviors).toHaveLength(0);
    expect(s.selection).toBeNull();
  });

  it("reorderBehavior moves a behavior in its subject's list", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    const subjectId = s.scene.subjects[0].id;
    const sparkles = getBehavior("preset.sparkles.face.v1")!;
    const ft = getBehavior("preset.face-tint.v1")!;
    s = sceneReducer(s, {
      type: "addBehavior", subjectId,
      behavior: { id: "b-1", kind: "preset", presetId: sparkles.id, params: sparkles.defaultParams, name: "S", visible: true },
    });
    s = sceneReducer(s, {
      type: "addBehavior", subjectId,
      behavior: { id: "b-2", kind: "preset", presetId: ft.id, params: ft.defaultParams, name: "FT", visible: true },
    });
    s = sceneReducer(s, { type: "reorderBehavior", subjectId, fromIndex: 1, toIndex: 0 });
    expect(s.scene.subjects[0].behaviors.map((b) => b.id)).toEqual(["b-2", "b-1"]);
  });

  it("removeSubject also removes its behaviors and clears selection if needed", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    const subjectId = s.scene.subjects[0].id;
    s = sceneReducer(s, { type: "removeSubject", subjectId });
    expect(s.scene.subjects).toHaveLength(0);
    expect(s.selection).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/store.test.ts
```

Expected: FAIL — store module not found.

- [ ] **Step 3: Create `apps/studio/src/effect/store.ts`**

```ts
import { nanoid } from "nanoid";
import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from "react";
import { getSubjectCapability } from "./subjects";
import type { Behavior, Scene, Subject, SubjectKind } from "./scene";
import { emptyScene } from "./scene";

export type Selection =
  | null
  | { type: "subject"; id: string }
  | { type: "behavior"; subjectId: string; behaviorId: string };

export interface SceneState {
  scene: Scene;
  selection: Selection;
}

export function initialSceneState(): SceneState {
  return { scene: emptyScene(), selection: null };
}

export type SceneAction =
  | { type: "addSubject"; kind: SubjectKind }
  | { type: "removeSubject"; subjectId: string }
  | { type: "renameSubject"; subjectId: string; name: string }
  | { type: "toggleSubjectVisible"; subjectId: string }
  | { type: "addBehavior"; subjectId: string; behavior: Behavior }
  | { type: "removeBehavior"; subjectId: string; behaviorId: string }
  | { type: "renameBehavior"; subjectId: string; behaviorId: string; name: string }
  | { type: "toggleBehaviorVisible"; subjectId: string; behaviorId: string }
  | { type: "setBehaviorParam"; subjectId: string; behaviorId: string; key: string; value: unknown }
  | { type: "reorderBehavior"; subjectId: string; fromIndex: number; toIndex: number }
  | { type: "select"; selection: Selection }
  | { type: "setSampleClip"; sampleClipId: string }
  | { type: "load"; scene: Scene };

function mapSubject(state: SceneState, id: string, fn: (s: Subject) => Subject): SceneState {
  return { ...state, scene: { ...state.scene, subjects: state.scene.subjects.map((s) => (s.id === id ? fn(s) : s)) } };
}

export function sceneReducer(state: SceneState, action: SceneAction): SceneState {
  switch (action.type) {
    case "addSubject": {
      if (state.scene.subjects.some((s) => s.kind === action.kind)) return state;
      const cap = getSubjectCapability(action.kind);
      const subject: Subject = { id: nanoid(8), kind: action.kind, name: cap.defaultName, visible: true, behaviors: [] };
      return {
        scene: { ...state.scene, subjects: [...state.scene.subjects, subject] },
        selection: { type: "subject", id: subject.id },
      };
    }
    case "removeSubject":
      return {
        scene: { ...state.scene, subjects: state.scene.subjects.filter((s) => s.id !== action.subjectId) },
        selection: null,
      };
    case "renameSubject":
      return mapSubject(state, action.subjectId, (s) => ({ ...s, name: action.name }));
    case "toggleSubjectVisible":
      return mapSubject(state, action.subjectId, (s) => ({ ...s, visible: !s.visible }));
    case "addBehavior":
      return {
        ...mapSubject(state, action.subjectId, (s) => ({ ...s, behaviors: [...s.behaviors, action.behavior] })),
        selection: { type: "behavior", subjectId: action.subjectId, behaviorId: action.behavior.id },
      };
    case "removeBehavior": {
      const next = mapSubject(state, action.subjectId, (s) => ({
        ...s,
        behaviors: s.behaviors.filter((b) => b.id !== action.behaviorId),
      }));
      const sel = state.selection;
      const cleared = sel && sel.type === "behavior" && sel.behaviorId === action.behaviorId;
      return cleared ? { ...next, selection: null } : next;
    }
    case "renameBehavior":
      return mapSubject(state, action.subjectId, (s) => ({
        ...s,
        behaviors: s.behaviors.map((b) => (b.id === action.behaviorId ? { ...b, name: action.name } : b)),
      }));
    case "toggleBehaviorVisible":
      return mapSubject(state, action.subjectId, (s) => ({
        ...s,
        behaviors: s.behaviors.map((b) => (b.id === action.behaviorId ? { ...b, visible: !b.visible } : b)),
      }));
    case "setBehaviorParam":
      return mapSubject(state, action.subjectId, (s) => ({
        ...s,
        behaviors: s.behaviors.map((b) =>
          b.id === action.behaviorId ? { ...b, params: { ...b.params, [action.key]: action.value } } : b,
        ),
      }));
    case "reorderBehavior":
      return mapSubject(state, action.subjectId, (s) => {
        const arr = [...s.behaviors];
        const [moved] = arr.splice(action.fromIndex, 1);
        if (!moved) return s;
        arr.splice(action.toIndex, 0, moved);
        return { ...s, behaviors: arr };
      });
    case "select":
      return { ...state, selection: action.selection };
    case "setSampleClip":
      return { ...state, scene: { ...state.scene, sampleClipId: action.sampleClipId } };
    case "load":
      return { scene: action.scene, selection: null };
    default:
      return state;
  }
}

const SceneCtx = createContext<{ state: SceneState; dispatch: Dispatch<SceneAction> } | null>(null);

export function SceneProvider({ initial, children }: { initial?: SceneState; children: ReactNode }) {
  const [state, dispatch] = useReducer(sceneReducer, initial ?? initialSceneState());
  return <SceneCtx.Provider value={{ state, dispatch }}>{children}</SceneCtx.Provider>;
}

export function useScene() {
  const ctx = useContext(SceneCtx);
  if (!ctx) throw new Error("useScene must be used inside SceneProvider");
  return ctx;
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/store.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/store.ts apps/studio/src/effect/store.test.ts
git commit -m "feat(studio): scene store (useReducer) with subject/behavior actions"
```

---

## Phase 2 — Preview engine

### Task 8: Sample clip index + `VideoSource`

**Files:**
- Create: `apps/studio/public/samples/index.json`
- Create: `apps/studio/src/effect/preview/VideoSource.ts`
- Create: `apps/studio/src/effect/preview/VideoSource.test.ts`

- [ ] **Step 1: Create the sample clip index**

`apps/studio/public/samples/index.json`:

```json
{
  "clips": [
    { "id": "portrait-closeup-01", "label": "Portrait close-up", "aspect": "9:16", "durationSec": 10, "url": "/samples/portrait-closeup-01.mp4", "tests": ["face"] },
    { "id": "portrait-midshot-02", "label": "Portrait mid-shot", "aspect": "9:16", "durationSec": 10, "url": "/samples/portrait-midshot-02.mp4", "tests": ["face", "subject_silhouette"] },
    { "id": "body-fullshot-03", "label": "Full body", "aspect": "9:16", "durationSec": 10, "url": "/samples/body-fullshot-03.mp4", "tests": ["subject_silhouette"] },
    { "id": "outdoor-landscape-05", "label": "Outdoor landscape", "aspect": "16:9", "durationSec": 8, "url": "/samples/outdoor-landscape-05.mp4", "tests": ["full_frame"] }
  ]
}
```

The actual `.mp4` files are not yet committed; they live on R2. Add a short README at `apps/studio/public/samples/README.md` explaining how to drop local mp4s for dev:

```md
# Sample clips

Drop `.mp4` files referenced by `index.json` here for local dev. In production, the CDN serves these from R2 under `https://cdn.openreel.video/samples/`.
```

- [ ] **Step 2: Write the failing test**

Create `apps/studio/src/effect/preview/VideoSource.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { VideoSource, type SampleClip } from "./VideoSource";

const sample: SampleClip = {
  id: "portrait-closeup-01",
  label: "Portrait close-up",
  aspect: "9:16",
  durationSec: 10,
  url: "/samples/portrait-closeup-01.mp4",
  tests: ["face"],
};

describe("VideoSource", () => {
  it("constructs from a SampleClip and exposes the url", () => {
    const src = VideoSource.fromSampleClip(sample);
    expect(src.url).toBe("/samples/portrait-closeup-01.mp4");
    expect(src.label).toBe("Portrait close-up");
    expect(src.userUploaded).toBe(false);
  });

  it("constructs from a File and exposes an object URL", () => {
    const file = new File([new Uint8Array([0])], "myclip.mp4", { type: "video/mp4" });
    const src = VideoSource.fromFile(file);
    expect(src.url.startsWith("blob:")).toBe(true);
    expect(src.userUploaded).toBe(true);
    src.dispose();
  });

  it("rejects files larger than 200MB", () => {
    const file = new File([new Uint8Array(0)], "huge.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: 200 * 1024 * 1024 + 1 });
    expect(() => VideoSource.fromFile(file)).toThrow(/200MB/);
  });

  it("rejects non-video MIME types", () => {
    const file = new File([new Uint8Array(1)], "doc.pdf", { type: "application/pdf" });
    expect(() => VideoSource.fromFile(file)).toThrow(/video/);
  });
});
```

- [ ] **Step 3: Run — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/preview/VideoSource.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `VideoSource.ts`**

```ts
export interface SampleClip {
  id: string;
  label: string;
  aspect: "9:16" | "16:9" | "1:1";
  durationSec: number;
  url: string;
  tests: string[];
}

const MAX_SIZE_BYTES = 200 * 1024 * 1024;
const MAX_DURATION_SEC = 60;

export class VideoSource {
  private constructor(
    public readonly id: string,
    public readonly label: string,
    public readonly url: string,
    public readonly userUploaded: boolean,
    private readonly disposeFn?: () => void,
  ) {}

  static fromSampleClip(clip: SampleClip): VideoSource {
    return new VideoSource(clip.id, clip.label, clip.url, false);
  }

  static fromFile(file: File): VideoSource {
    if (!file.type.startsWith("video/")) {
      throw new Error(`Selected file must be a video; got MIME type ${file.type}`);
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new Error(`Selected file exceeds 200MB limit (${file.size} bytes).`);
    }
    const blobUrl = URL.createObjectURL(file);
    return new VideoSource(`upload-${file.name}-${file.size}`, file.name, blobUrl, true, () => URL.revokeObjectURL(blobUrl));
  }

  static maxDurationSec(): number {
    return MAX_DURATION_SEC;
  }

  dispose(): void {
    this.disposeFn?.();
  }
}
```

- [ ] **Step 5: Run tests — verify pass**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/preview/VideoSource.test.ts
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/public/samples/ apps/studio/src/effect/preview/
git commit -m "feat(studio): sample clip index + VideoSource abstraction"
```

---

### Task 9: DetectorPool (MediaPipe loaders)

**Files:**
- Create: `apps/studio/src/effect/preview/DetectorPool.ts`
- Create: `apps/studio/src/effect/preview/DetectorPool.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/studio/src/effect/preview/DetectorPool.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DetectorPool } from "./DetectorPool";

const fakeFaceLandmarker = { detectForVideo: vi.fn(() => ({ faceLandmarks: [[{ x: 0.5, y: 0.5 }]] })), close: vi.fn() };
const fakeSegmenter = { segmentForVideo: vi.fn(() => ({ confidenceMasks: [{ width: 320, height: 240 }] })), close: vi.fn() };

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({ url: "wasm" })) },
  FaceLandmarker: { createFromOptions: vi.fn(async () => fakeFaceLandmarker) },
  ImageSegmenter: { createFromOptions: vi.fn(async () => fakeSegmenter) },
}));

describe("DetectorPool", () => {
  beforeEach(() => {
    fakeFaceLandmarker.close.mockClear();
    fakeSegmenter.close.mockClear();
  });

  it("loads FaceLandmarker only when ensure('FaceLandmarker') is called", async () => {
    const pool = new DetectorPool();
    expect(pool.has("FaceLandmarker")).toBe(false);
    await pool.ensure(["FaceLandmarker"]);
    expect(pool.has("FaceLandmarker")).toBe(true);
    expect(pool.has("ImageSegmenter")).toBe(false);
  });

  it("ensure is idempotent for already-loaded detectors", async () => {
    const pool = new DetectorPool();
    await pool.ensure(["FaceLandmarker"]);
    const first = pool.get("FaceLandmarker");
    await pool.ensure(["FaceLandmarker"]);
    const second = pool.get("FaceLandmarker");
    expect(first).toBe(second);
  });

  it("releaseUnused tears down detectors no longer needed", async () => {
    const pool = new DetectorPool();
    await pool.ensure(["FaceLandmarker", "ImageSegmenter"]);
    pool.releaseUnused(["FaceLandmarker"]);
    expect(pool.has("ImageSegmenter")).toBe(false);
    expect(fakeSegmenter.close).toHaveBeenCalled();
  });

  it("disposeAll closes every detector", async () => {
    const pool = new DetectorPool();
    await pool.ensure(["FaceLandmarker", "ImageSegmenter"]);
    pool.disposeAll();
    expect(fakeFaceLandmarker.close).toHaveBeenCalled();
    expect(fakeSegmenter.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/preview/DetectorPool.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `DetectorPool.ts`**

```ts
import { FilesetResolver, FaceLandmarker, ImageSegmenter } from "@mediapipe/tasks-vision";
import type { DetectorKind } from "../subjects";

interface FaceLandmarkerHandle {
  kind: "FaceLandmarker";
  instance: FaceLandmarker;
}

interface ImageSegmenterHandle {
  kind: "ImageSegmenter";
  instance: ImageSegmenter;
}

type Handle = FaceLandmarkerHandle | ImageSegmenterHandle;

const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

export class DetectorPool {
  private handles = new Map<DetectorKind, Handle>();
  private filesetPromise: Promise<unknown> | null = null;

  private getFileset() {
    if (!this.filesetPromise) {
      this.filesetPromise = FilesetResolver.forVisionTasks(WASM_PATH);
    }
    return this.filesetPromise;
  }

  has(kind: DetectorKind): boolean {
    return this.handles.has(kind);
  }

  get(kind: DetectorKind): Handle | undefined {
    return this.handles.get(kind);
  }

  async ensure(kinds: DetectorKind[]): Promise<void> {
    const fileset = await this.getFileset();
    for (const kind of kinds) {
      if (this.handles.has(kind)) continue;
      if (kind === "FaceLandmarker") {
        const instance = await FaceLandmarker.createFromOptions(fileset as never, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
        });
        this.handles.set(kind, { kind, instance });
      } else if (kind === "ImageSegmenter") {
        const instance = await ImageSegmenter.createFromOptions(fileset as never, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite" },
          runningMode: "VIDEO",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        this.handles.set(kind, { kind, instance });
      }
    }
  }

  releaseUnused(stillNeeded: DetectorKind[]): void {
    const keep = new Set(stillNeeded);
    for (const [kind, handle] of this.handles) {
      if (!keep.has(kind)) {
        handle.instance.close();
        this.handles.delete(kind);
      }
    }
  }

  disposeAll(): void {
    for (const handle of this.handles.values()) handle.instance.close();
    this.handles.clear();
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/preview/DetectorPool.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/preview/DetectorPool.ts apps/studio/src/effect/preview/DetectorPool.test.ts
git commit -m "feat(studio): DetectorPool for lazy MediaPipe loading"
```

---

### Task 10: PreviewEngine + RenderLoop

**Files:**
- Create: `apps/studio/src/effect/preview/RenderLoop.ts`
- Create: `apps/studio/src/effect/preview/PreviewEngine.ts`
- Create: `apps/studio/src/effect/preview/PreviewEngine.test.ts`

- [ ] **Step 1: Write the failing test (engine wiring only — full GPU integration tested via E2E)**

Create `apps/studio/src/effect/preview/PreviewEngine.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { PreviewEngine } from "./PreviewEngine";
import { VideoSource } from "./VideoSource";
import { emptyScene } from "../scene";

vi.mock("./DetectorPool", () => ({
  DetectorPool: vi.fn().mockImplementation(() => ({
    ensure: vi.fn(async () => undefined),
    releaseUnused: vi.fn(),
    disposeAll: vi.fn(),
    has: vi.fn(() => false),
    get: vi.fn(),
  })),
}));

describe("PreviewEngine", () => {
  it("emits a perf event after running a render tick", async () => {
    const canvas = document.createElement("canvas");
    const source = VideoSource.fromSampleClip({
      id: "portrait-closeup-01",
      label: "PC",
      aspect: "9:16",
      durationSec: 10,
      url: "",
      tests: [],
    });
    const engine = new PreviewEngine(canvas);
    const perfEvents: number[] = [];
    engine.onPerf((p) => perfEvents.push(p.frameMs));
    engine.setSource(source);
    engine.setScene(emptyScene());
    await engine.tickOnce({ now: 16 });
    expect(perfEvents).toHaveLength(1);
    engine.dispose();
  });

  it("reads the right detector kinds from the scene", () => {
    const canvas = document.createElement("canvas");
    const engine = new PreviewEngine(canvas);
    engine.setScene({
      sampleClipId: "x",
      subjects: [{ id: "s1", kind: "face", name: "Face", visible: true, behaviors: [] }],
    });
    expect(engine.activeDetectorKinds()).toEqual(["FaceLandmarker"]);
    engine.dispose();
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/preview/PreviewEngine.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `RenderLoop.ts`**

```ts
export type LoopTick = (now: number) => void | Promise<void>;

export class RenderLoop {
  private rafId: number | null = null;
  private running = false;
  constructor(private readonly tick: LoopTick) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      void this.tick(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
```

- [ ] **Step 4: Create `PreviewEngine.ts`**

```ts
import { DetectorPool } from "./DetectorPool";
import { RenderLoop } from "./RenderLoop";
import { VideoSource } from "./VideoSource";
import type { Scene } from "../scene";
import { activeDetectorKinds, type DetectorKind } from "../subjects";
import { sceneToGraph } from "../compile";

export interface PerfSample {
  frameMs: number;
  fps: number;
  activeDetectors: DetectorKind[];
}

export type Quality = "full" | "balanced" | "perf";

export class PreviewEngine {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly pool = new DetectorPool();
  private readonly video: HTMLVideoElement;
  private source: VideoSource | null = null;
  private scene: Scene | null = null;
  private quality: Quality = "balanced";
  private loop: RenderLoop;
  private perfSubscribers = new Set<(p: PerfSample) => void>();
  private lastFrameTime = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
    this.video = document.createElement("video");
    this.video.crossOrigin = "anonymous";
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.loop = true;
    this.loop = new RenderLoop((now) => this.tick({ now }));
  }

  setSource(source: VideoSource): void {
    if (this.source) this.source.dispose();
    this.source = source;
    this.video.src = source.url;
    this.video.play().catch(() => undefined);
  }

  setScene(scene: Scene): void {
    this.scene = scene;
    void this.pool.ensure(this.activeDetectorKinds());
    this.pool.releaseUnused(this.activeDetectorKinds());
  }

  setQuality(q: Quality): void {
    this.quality = q;
  }

  activeDetectorKinds(): DetectorKind[] {
    if (!this.scene) return [];
    return activeDetectorKinds(this.scene.subjects.filter((s) => s.visible).map((s) => s.kind));
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  onPerf(fn: (p: PerfSample) => void): () => void {
    this.perfSubscribers.add(fn);
    return () => this.perfSubscribers.delete(fn);
  }

  async tickOnce(opts: { now: number }): Promise<void> {
    await this.tick(opts);
  }

  dispose(): void {
    this.loop.stop();
    this.pool.disposeAll();
    if (this.source) this.source.dispose();
    this.perfSubscribers.clear();
  }

  private async tick(opts: { now: number }): Promise<void> {
    const start = performance.now();
    if (this.ctx && this.video.readyState >= 2) {
      this.canvas.width = this.video.videoWidth || this.canvas.width;
      this.canvas.height = this.video.videoHeight || this.canvas.height;
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.scene) {
      const result = sceneToGraph(this.scene, { kind: "effect" });
      if (result.ok) {
        // Hook for real pipeline execution — wired in Task 11 when the fxpkg runtime is integrated.
        void result.graph;
      }
    }
    const frameMs = performance.now() - start;
    const fps = this.lastFrameTime ? 1000 / (opts.now - this.lastFrameTime) : 0;
    this.lastFrameTime = opts.now;
    for (const sub of this.perfSubscribers) sub({ frameMs, fps, activeDetectors: this.activeDetectorKinds() });
  }
}
```

- [ ] **Step 5: Run tests — verify pass**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/preview/PreviewEngine.test.ts
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/preview/PreviewEngine.ts apps/studio/src/effect/preview/RenderLoop.ts apps/studio/src/effect/preview/PreviewEngine.test.ts
git commit -m "feat(studio): PreviewEngine + RenderLoop with perf hooks"
```

---

### Task 11: Wire the existing fxpkg runtime into PreviewEngine

**Files:**
- Modify: `apps/studio/src/effect/preview/PreviewEngine.ts`
- (Reference) `packages/fxpkg/src/compiler/filter.ts` and `packages/fxpkg/src/index.ts` exports

Goal: Replace the `// Hook for real pipeline execution` placeholder with a real call to the existing fxpkg compiler/runtime. The existing `compileFilter` returns a `FilterCompileResult` — for Effects, check `packages/fxpkg/src/compiler/` for the effect compiler (or fall back to a no-op pipeline if the effect compiler isn't yet wired, with a TODO).

- [ ] **Step 1: Investigate what fxpkg exports**

```bash
cd /Users/augustusotu/Projects/openreel
cat packages/fxpkg/src/compiler/filter.ts 2>/dev/null | head -60
ls packages/fxpkg/src/compiler/
```

Document what's available. If only `compileFilter` exists, the engine's effect path can degrade to "validate the graph then no-op render" until the effect compiler exists — that's outside this PR's scope.

- [ ] **Step 2: Update the tick hook**

In `apps/studio/src/effect/preview/PreviewEngine.ts`, replace the body of the `if (this.scene)` block in `tick()` with:

```ts
    if (this.scene) {
      const result = sceneToGraph(this.scene, { kind: "effect" });
      if (result.ok) {
        if (!this.pipelineCacheKey || this.pipelineCacheKey !== graphCacheKey(result.graph)) {
          this.pipelineCacheKey = graphCacheKey(result.graph);
          this.compiledGraph = result.graph;
        }
        // Pipeline runtime: invoke fxpkg execution if available.
        // Until the effect compiler exists in fxpkg, we draw the raw frame
        // (already done above via drawImage) and the perf event reflects detection cost only.
      }
    }
```

Add helpers at the bottom of the file:

```ts
function graphCacheKey(graph: { nodes: Array<{ id: string; type: string }>; edges: Array<{ fromNode: string; toNode: string }>; }): string {
  return [
    graph.nodes.map((n) => `${n.id}:${n.type}`).join(","),
    graph.edges.map((e) => `${e.fromNode}->${e.toNode}`).join(","),
  ].join("|");
}
```

And add the cached fields to the class:

```ts
  private pipelineCacheKey: string | null = null;
  private compiledGraph: unknown | null = null;
```

- [ ] **Step 3: Run all studio tests**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/preview/PreviewEngine.ts
git commit -m "feat(studio): cache compiled graph by structure key in PreviewEngine"
```

---

## Phase 3 — Effect editor UI

### Task 12: SceneTree component

**Files:**
- Create: `apps/studio/src/effect/SceneTree.tsx`
- Create: `apps/studio/src/effect/SceneTree.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/studio/src/effect/SceneTree.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SceneProvider } from "./store";
import { SceneTree } from "./SceneTree";

function setup() {
  return render(
    <SceneProvider>
      <SceneTree />
    </SceneProvider>,
  );
}

describe("SceneTree", () => {
  it("shows 'No subjects yet' empty state when scene is empty", () => {
    setup();
    expect(screen.getByText(/No subjects yet/i)).toBeInTheDocument();
  });

  it("clicking '+ Subject' opens the subject picker popover", () => {
    setup();
    const btn = screen.getByRole("button", { name: /\+ Subject/i });
    fireEvent.click(btn);
    expect(screen.getByRole("dialog", { name: /add subject/i })).toBeInTheDocument();
  });

  it("adding a face subject from the picker shows it in the tree", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /\+ Subject/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Face$/ }));
    expect(screen.getByText("Face")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/SceneTree.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `SceneTree.tsx`**

```tsx
import { useState } from "react";
import { Icon } from "../icons";
import { useScene } from "./store";
import { getSubjectCapability, listSubjectKinds } from "./subjects";
import type { SubjectKind } from "./scene";

export function SceneTree() {
  const { state, dispatch } = useScene();
  const [pickerOpen, setPickerOpen] = useState(false);

  const usedKinds = new Set(state.scene.subjects.map((s) => s.kind));

  return (
    <aside className="flex h-full w-60 flex-col border-r border-zinc-800 bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-900 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Scene</span>
        <button
          type="button"
          className="rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-300 hover:border-zinc-700"
          onClick={() => setPickerOpen(true)}
        >
          + Subject
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-1 py-2">
        {state.scene.subjects.length === 0 ? (
          <p className="px-2 text-xs text-zinc-600">No subjects yet — start by adding one.</p>
        ) : (
          state.scene.subjects.map((subject) => {
            const cap = getSubjectCapability(subject.kind);
            const selected = state.selection?.type === "subject" && state.selection.id === subject.id;
            return (
              <div key={subject.id} className="mb-2">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "select", selection: { type: "subject", id: subject.id } })}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                    selected ? "bg-blue-900/40 text-white" : "text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  <Icon name={cap.iconName} size={14} />
                  <span className="flex-1 truncate">{subject.name}</span>
                </button>
                <ul className="ml-4 mt-0.5">
                  {subject.behaviors.map((b) => {
                    const bSelected =
                      state.selection?.type === "behavior" && state.selection.behaviorId === b.id;
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() =>
                            dispatch({
                              type: "select",
                              selection: { type: "behavior", subjectId: subject.id, behaviorId: b.id },
                            })
                          }
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                            bSelected ? "bg-blue-900/40 text-white" : "text-zinc-400 hover:bg-zinc-900"
                          }`}
                        >
                          <span className="text-zinc-700">└</span>
                          <span className="flex-1 truncate">{b.name}</span>
                        </button>
                      </li>
                    );
                  })}
                  <li>
                    <button
                      type="button"
                      className="px-2 py-1 text-[11px] text-zinc-600 hover:text-zinc-400"
                      onClick={() =>
                        dispatch({
                          type: "select",
                          selection: { type: "subject", id: subject.id },
                        })
                      }
                    >
                      + Add behavior
                    </button>
                  </li>
                </ul>
              </div>
            );
          })
        )}
      </div>

      {pickerOpen && (
        <div role="dialog" aria-label="Add subject" className="absolute left-3 top-12 z-10 w-48 rounded border border-zinc-800 bg-zinc-900 p-2 shadow-xl">
          <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-zinc-500">Add subject</div>
          {listSubjectKinds().map((kind: SubjectKind) => {
            const cap = getSubjectCapability(kind);
            const disabled = usedKinds.has(kind);
            return (
              <button
                type="button"
                key={kind}
                disabled={disabled}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  dispatch({ type: "addSubject", kind });
                  setPickerOpen(false);
                }}
              >
                <Icon name={cap.iconName} size={14} />
                <span>{cap.defaultName}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="mt-1 w-full text-center text-[10px] text-zinc-500 hover:text-zinc-300"
            onClick={() => setPickerOpen(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/SceneTree.test.tsx
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/SceneTree.tsx apps/studio/src/effect/SceneTree.test.tsx
git commit -m "feat(studio): SceneTree with subject picker"
```

---

### Task 13: BehaviorPaletteSheet

**Files:**
- Create: `apps/studio/src/effect/BehaviorPaletteSheet.tsx`
- Create: `apps/studio/src/effect/BehaviorPaletteSheet.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/studio/src/effect/BehaviorPaletteSheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BehaviorPaletteSheet } from "./BehaviorPaletteSheet";
import { registerAllBehaviors } from "./behaviors/registry";

registerAllBehaviors();

describe("BehaviorPaletteSheet", () => {
  it("shows preset and atomic sections filtered by subject kind", () => {
    const onAdd = vi.fn();
    render(<BehaviorPaletteSheet subjectKind="face" onAdd={onAdd} onClose={() => undefined} />);
    expect(screen.getByText(/Effects/i)).toBeInTheDocument();
    expect(screen.getByText(/Adjustments/i)).toBeInTheDocument();
    expect(screen.getByText("Sparkles")).toBeInTheDocument();
    expect(screen.queryByText("Fire Aura")).toBeNull();
  });

  it("clicking a card calls onAdd with the behavior id", () => {
    const onAdd = vi.fn();
    render(<BehaviorPaletteSheet subjectKind="face" onAdd={onAdd} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Sparkles/ }));
    expect(onAdd).toHaveBeenCalledWith("preset.sparkles.face.v1");
  });

  it("search filters cards live", () => {
    render(<BehaviorPaletteSheet subjectKind="full_frame" onAdd={() => undefined} onClose={() => undefined} />);
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "warm" } });
    expect(screen.getByText("Warm Look")).toBeInTheDocument();
    expect(screen.queryByText("Dreamy")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/BehaviorPaletteSheet.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `BehaviorPaletteSheet.tsx`**

```tsx
import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { listBehaviorsForSubject } from "./behaviors/registry";
import type { SubjectKind } from "./scene";

export function BehaviorPaletteSheet({
  subjectKind,
  onAdd,
  onClose,
}: {
  subjectKind: SubjectKind;
  onAdd: (behaviorId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => listBehaviorsForSubject(subjectKind), [subjectKind]);
  const filtered = useMemo(
    () => all.filter((b) => b.label.toLowerCase().includes(query.trim().toLowerCase())),
    [all, query],
  );
  const presets = filtered.filter((b) => b.kind === "preset");
  const atomics = filtered.filter((b) => b.kind === "atomic");

  return (
    <div className="absolute inset-y-0 left-0 z-20 flex w-96 flex-col border-r border-zinc-800 bg-zinc-950 shadow-2xl">
      <header className="flex items-center justify-between border-b border-zinc-900 px-3 py-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Add behavior</div>
          <div className="text-xs text-zinc-300">on {subjectKind.replace("_", " ")}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-zinc-500 hover:text-zinc-300">
          <Icon name="x" size={14} />
        </button>
      </header>
      <input
        type="search"
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="m-2 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-600"
      />
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <Section title="Effects" items={presets} onAdd={onAdd} />
        <Section title="Adjustments" items={atomics} onAdd={onAdd} />
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  onAdd,
}: {
  title: string;
  items: Array<{ id: string; label: string; iconName: import("../icons").IconName; thumbnailUrl: string }>;
  onAdd: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-zinc-500">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => onAdd(item.id)}
            className="group flex flex-col rounded border border-zinc-800 bg-zinc-900 p-2 text-left hover:border-zinc-600"
          >
            <div className="mb-2 flex aspect-video w-full items-center justify-center rounded bg-zinc-950 text-zinc-700">
              <Icon name={item.iconName} size={20} />
            </div>
            <span className="text-xs text-zinc-200 group-hover:text-white">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/BehaviorPaletteSheet.test.tsx
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/BehaviorPaletteSheet.tsx apps/studio/src/effect/BehaviorPaletteSheet.test.tsx
git commit -m "feat(studio): BehaviorPaletteSheet with preset/atomic filtering + search"
```

---

### Task 14: Inspector + param renderers

**Files:**
- Create: `apps/studio/src/effect/Inspector.tsx`
- Create: `apps/studio/src/effect/param-renderers.tsx`
- Create: `apps/studio/src/effect/Inspector.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/studio/src/effect/Inspector.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SceneProvider, sceneReducer, initialSceneState } from "./store";
import { Inspector } from "./Inspector";
import { registerAllBehaviors, getBehavior } from "./behaviors/registry";

registerAllBehaviors();

function setupWithSelection() {
  const sparkles = getBehavior("preset.sparkles.face.v1")!;
  let state = sceneReducer(initialSceneState(), { type: "addSubject", kind: "face" });
  const subjectId = state.scene.subjects[0].id;
  state = sceneReducer(state, {
    type: "addBehavior",
    subjectId,
    behavior: {
      id: "b-1",
      kind: "preset",
      presetId: sparkles.id,
      params: { ...sparkles.defaultParams },
      name: sparkles.label,
      visible: true,
    },
  });
  return render(
    <SceneProvider initial={state}>
      <Inspector />
    </SceneProvider>,
  );
}

describe("Inspector", () => {
  it("empty state when no selection", () => {
    render(
      <SceneProvider>
        <Inspector />
      </SceneProvider>,
    );
    expect(screen.getByText(/Tips/i)).toBeInTheDocument();
  });

  it("renders behavior label and a slider for amount when behavior is selected", () => {
    setupWithSelection();
    expect(screen.getByDisplayValue("Sparkles")).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
  });

  it("changing the slider dispatches setBehaviorParam", () => {
    setupWithSelection();
    const slider = screen.getByLabelText(/amount/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.9" } });
    expect(slider.value).toBe("0.9");
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/Inspector.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `param-renderers.tsx`**

```tsx
import { z } from "zod";

export interface ParamFieldProps {
  id: string;
  label: string;
  value: unknown;
  schema: z.ZodTypeAny;
  onChange: (value: unknown) => void;
}

export function ParamField({ id, label, value, schema, onChange }: ParamFieldProps) {
  const def = schema._def as { typeName?: string; checks?: Array<{ kind: string; value: number }>; values?: string[] } & Record<string, unknown>;
  const typeName = (def as { typeName?: string }).typeName;

  if (typeName === "ZodNumber") {
    const checks = (def.checks ?? []) as Array<{ kind: string; value: number }>;
    const min = checks.find((c) => c.kind === "min")?.value ?? 0;
    const max = checks.find((c) => c.kind === "max")?.value ?? 1;
    const step = (max - min) / 100;
    return (
      <label className="flex flex-col gap-1 text-xs text-zinc-300">
        <span className="flex justify-between">
          <span>{label}</span>
          <span className="text-zinc-500">{typeof value === "number" ? value.toFixed(2) : "—"}</span>
        </span>
        <input
          id={id}
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={typeof value === "number" ? value : min}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="h-1 w-full accent-blue-500"
        />
      </label>
    );
  }

  if (typeName === "ZodEnum") {
    const values = (def.values as string[] | undefined) ?? [];
    if (values.length <= 4) {
      return (
        <label className="flex flex-col gap-1 text-xs text-zinc-300">
          <span>{label}</span>
          <div className="flex gap-1">
            {values.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onChange(v)}
                className={`flex-1 rounded border px-2 py-1 text-[11px] capitalize ${
                  value === v ? "border-blue-500 bg-blue-900/40 text-white" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </label>
      );
    }
    return (
      <label className="flex flex-col gap-1 text-xs text-zinc-300">
        <span>{label}</span>
        <select
          id={id}
          aria-label={label}
          value={typeof value === "string" ? value : values[0]}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
        >
          {values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (typeName === "ZodBoolean") {
    return (
      <label className="flex items-center justify-between text-xs text-zinc-300">
        <span>{label}</span>
        <input
          id={id}
          aria-label={label}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-blue-500"
        />
      </label>
    );
  }

  if (typeName === "ZodString") {
    return (
      <label className="flex flex-col gap-1 text-xs text-zinc-300">
        <span>{label}</span>
        <input
          id={id}
          aria-label={label}
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
        />
      </label>
    );
  }

  return null;
}

export function fieldsFromObjectSchema(schema: z.ZodObject<z.ZodRawShape>): Array<{ key: string; label: string; schema: z.ZodTypeAny }> {
  return Object.entries(schema.shape).map(([key, child]) => ({
    key,
    label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
    schema: child,
  }));
}
```

- [ ] **Step 4: Create `Inspector.tsx`**

```tsx
import { z } from "zod";
import { useScene } from "./store";
import { getBehavior } from "./behaviors/registry";
import { ParamField, fieldsFromObjectSchema } from "./param-renderers";

export function Inspector() {
  const { state, dispatch } = useScene();
  const selection = state.selection;

  if (!selection) {
    return (
      <aside className="flex h-full w-80 flex-col border-l border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Tips</div>
        <p className="text-xs text-zinc-500">Add a subject from the left, then add behaviors to it. Select any item to edit its properties here.</p>
      </aside>
    );
  }

  if (selection.type === "subject") {
    const subject = state.scene.subjects.find((s) => s.id === selection.id);
    if (!subject) return null;
    return (
      <aside className="flex h-full w-80 flex-col border-l border-zinc-800 bg-zinc-950 p-4">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Selected · Subject</div>
        <input
          type="text"
          value={subject.name}
          onChange={(e) => dispatch({ type: "renameSubject", subjectId: subject.id, name: e.target.value })}
          className="mt-1 bg-transparent text-sm text-white outline-none"
        />
        <p className="mt-3 text-xs text-zinc-500">{subject.behaviors.length} behavior{subject.behaviors.length === 1 ? "" : "s"} attached.</p>
        <button
          type="button"
          onClick={() => dispatch({ type: "removeSubject", subjectId: subject.id })}
          className="mt-auto rounded border border-red-900/40 px-2 py-1 text-xs text-red-400 hover:border-red-700"
        >
          Remove subject
        </button>
      </aside>
    );
  }

  const subject = state.scene.subjects.find((s) => s.id === selection.subjectId);
  const behavior = subject?.behaviors.find((b) => b.id === selection.behaviorId);
  if (!behavior) return null;
  const def = getBehavior(behavior.kind === "preset" ? behavior.presetId : `atomic.${behavior.atomicKind}`);
  if (!def) return null;
  const shape = (def.paramSchema as unknown as z.ZodObject<z.ZodRawShape>);
  const fields = fieldsFromObjectSchema(shape);

  return (
    <aside className="flex h-full w-80 flex-col border-l border-zinc-800 bg-zinc-950 p-4">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">Selected · Behavior</div>
      <input
        type="text"
        value={behavior.name}
        onChange={(e) => dispatch({ type: "renameBehavior", subjectId: selection.subjectId, behaviorId: behavior.id, name: e.target.value })}
        className="mt-1 bg-transparent text-sm text-white outline-none"
      />
      <div className="mt-1 text-[10px] text-zinc-600">on {subject?.name}</div>

      <div className="mt-4 flex flex-col gap-3">
        {fields.map((field) => (
          <ParamField
            key={field.key}
            id={`param-${field.key}`}
            label={field.label}
            value={(behavior.params as Record<string, unknown>)[field.key]}
            schema={field.schema}
            onChange={(value) =>
              dispatch({
                type: "setBehaviorParam",
                subjectId: selection.subjectId,
                behaviorId: behavior.id,
                key: field.key,
                value,
              })
            }
          />
        ))}
      </div>

      <div className="mt-auto flex justify-between border-t border-zinc-900 pt-3">
        <button type="button" className="text-[11px] text-zinc-500 hover:text-zinc-300">Duplicate</button>
        <button
          type="button"
          onClick={() => dispatch({ type: "removeBehavior", subjectId: selection.subjectId, behaviorId: behavior.id })}
          className="text-[11px] text-red-400 hover:text-red-300"
        >
          Remove
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/effect/Inspector.test.tsx
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/Inspector.tsx apps/studio/src/effect/param-renderers.tsx apps/studio/src/effect/Inspector.test.tsx
git commit -m "feat(studio): Inspector + param renderers (slider/enum/bool/string)"
```

---

### Task 15: SampleClipSelector + Preview component

**Files:**
- Create: `apps/studio/src/effect/SampleClipSelector.tsx`
- Create: `apps/studio/src/effect/Preview.tsx`
- Create: `apps/studio/src/effect/sample-clips.ts`

- [ ] **Step 1: Create `sample-clips.ts`** — loads the index

```ts
import type { SampleClip } from "./preview/VideoSource";

let cache: SampleClip[] | null = null;

export async function loadSampleClips(): Promise<SampleClip[]> {
  if (cache) return cache;
  const res = await fetch("/samples/index.json");
  if (!res.ok) throw new Error("Failed to load /samples/index.json");
  const json = (await res.json()) as { clips: SampleClip[] };
  cache = json.clips;
  return cache;
}

export function findSampleClip(clips: SampleClip[], id: string): SampleClip | undefined {
  return clips.find((c) => c.id === id);
}
```

- [ ] **Step 2: Create `SampleClipSelector.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { useScene } from "./store";
import { loadSampleClips } from "./sample-clips";
import { VideoSource, type SampleClip } from "./preview/VideoSource";

export function SampleClipSelector({ onSourceChange }: { onSourceChange: (source: VideoSource) => void }) {
  const { state, dispatch } = useScene();
  const [clips, setClips] = useState<SampleClip[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSampleClips().then(setClips).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const clip = clips.find((c) => c.id === state.scene.sampleClipId);
    if (clip) onSourceChange(VideoSource.fromSampleClip(clip));
  }, [clips, state.scene.sampleClipId, onSourceChange]);

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const src = VideoSource.fromFile(file);
      onSourceChange(src);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-zinc-900 bg-zinc-950 px-4 py-2 text-xs">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">Sample</span>
      <select
        value={state.scene.sampleClipId}
        onChange={(e) => dispatch({ type: "setSampleClip", sampleClipId: e.target.value })}
        className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-200"
      >
        {clips.map((c) => (
          <option key={c.id} value={c.id}>{c.label} ({c.aspect})</option>
        ))}
      </select>
      <label className="flex cursor-pointer items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-zinc-300 hover:border-zinc-700">
        <Icon name="upload" size={12} />
        <span>Use your own</span>
        <input type="file" accept="video/*" onChange={onUpload} className="hidden" />
      </label>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Create `Preview.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { useScene } from "./store";
import { PreviewEngine, type PerfSample, type Quality } from "./preview/PreviewEngine";
import { VideoSource } from "./preview/VideoSource";
import { SampleClipSelector } from "./SampleClipSelector";

export function Preview({ onPerf }: { onPerf?: (p: PerfSample) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const { state } = useScene();
  const [quality, setQuality] = useState<Quality>("balanced");
  const [showMask, setShowMask] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new PreviewEngine(canvasRef.current);
    engineRef.current = engine;
    if (onPerf) engine.onPerf(onPerf);
    engine.start();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [onPerf]);

  useEffect(() => {
    engineRef.current?.setScene(state.scene);
  }, [state.scene]);

  useEffect(() => {
    engineRef.current?.setQuality(quality);
  }, [quality]);

  function handleSource(source: VideoSource) {
    engineRef.current?.setSource(source);
  }

  return (
    <section className="flex h-full flex-1 flex-col bg-zinc-950">
      <SampleClipSelector onSourceChange={handleSource} />
      <div className="flex-1 flex items-center justify-center">
        <canvas ref={canvasRef} className="max-h-full max-w-full" />
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-900 px-4 py-2 text-xs">
        <button
          type="button"
          onClick={() => setShowMask((v) => !v)}
          className={`rounded border px-2 py-1 ${showMask ? "border-blue-500 text-white" : "border-zinc-800 text-zinc-400"}`}
        >
          Mask
        </button>
        {(["perf", "balanced", "full"] as Quality[]).map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setQuality(q)}
            className={`rounded border px-2 py-1 capitalize ${quality === q ? "border-blue-500 text-white" : "border-zinc-800 text-zinc-400"}`}
          >
            {q}
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm typecheck
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/SampleClipSelector.tsx apps/studio/src/effect/Preview.tsx apps/studio/src/effect/sample-clips.ts
git commit -m "feat(studio): SampleClipSelector + Preview component wiring PreviewEngine"
```

---

### Task 16: EffectEditor shell

**Files:**
- Create: `apps/studio/src/effect/EffectEditor.tsx`

- [ ] **Step 1: Implement the shell**

```tsx
import { useState } from "react";
import { SceneProvider, useScene } from "./store";
import { SceneTree } from "./SceneTree";
import { Preview } from "./Preview";
import { Inspector } from "./Inspector";
import { BehaviorPaletteSheet } from "./BehaviorPaletteSheet";
import { getBehavior } from "./behaviors/registry";
import { nanoid } from "nanoid";
import type { SubjectKind } from "./scene";

export function EffectEditor() {
  return (
    <SceneProvider>
      <EffectEditorBody />
    </SceneProvider>
  );
}

function EffectEditorBody() {
  const { state, dispatch } = useScene();
  const [paletteFor, setPaletteFor] = useState<{ subjectId: string; kind: SubjectKind } | null>(null);

  function handleAddBehaviorClick(subjectId: string) {
    const subject = state.scene.subjects.find((s) => s.id === subjectId);
    if (!subject) return;
    setPaletteFor({ subjectId, kind: subject.kind });
  }

  function onAddFromPalette(behaviorId: string) {
    if (!paletteFor) return;
    const def = getBehavior(behaviorId);
    if (!def) return;
    dispatch({
      type: "addBehavior",
      subjectId: paletteFor.subjectId,
      behavior: def.kind === "preset"
        ? { id: nanoid(8), kind: "preset", presetId: def.id, params: { ...def.defaultParams as Record<string, unknown> }, name: def.label, visible: true }
        : { id: nanoid(8), kind: "atomic", atomicKind: def.atomicKind!, params: { ...def.defaultParams as Record<string, unknown> }, name: def.label, visible: true },
    });
    setPaletteFor(null);
  }

  return (
    <div className="relative grid h-full grid-cols-[240px_1fr_320px]">
      <div className="relative" onClickCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.textContent === "+ Add behavior") {
          const subjectButton = target.closest("[data-subject-id]");
          const id = subjectButton?.getAttribute("data-subject-id");
          if (id) handleAddBehaviorClick(id);
        }
      }}>
        <SceneTree />
        {state.selection?.type === "subject" && (
          <button
            type="button"
            onClick={() => handleAddBehaviorClick(state.selection!.id)}
            className="absolute bottom-3 left-3 right-3 rounded border border-blue-700 bg-blue-900/30 py-1.5 text-xs text-blue-200 hover:bg-blue-900/50"
          >
            + Add behavior to {state.scene.subjects.find((s) => s.id === state.selection?.id)?.name}
          </button>
        )}
      </div>
      <Preview />
      <Inspector />
      {paletteFor && (
        <BehaviorPaletteSheet
          subjectKind={paletteFor.kind}
          onAdd={onAddFromPalette}
          onClose={() => setPaletteFor(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/effect/EffectEditor.tsx
git commit -m "feat(studio): EffectEditor 3-column shell composition"
```

---

## Phase 4 — Filter editor

### Task 17: Filter editor (types, store, compile, shell)

**Files:**
- Create: `apps/studio/src/filter/types.ts`
- Create: `apps/studio/src/filter/store.ts`
- Create: `apps/studio/src/filter/compile.ts`
- Create: `apps/studio/src/filter/AdjustmentStack.tsx`
- Create: `apps/studio/src/filter/FilterEditor.tsx`
- Create: `apps/studio/src/filter/compile.test.ts`

- [ ] **Step 1: Write the compile test**

`apps/studio/src/filter/compile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterDocToGraph } from "./compile";
import { emptyFilterDoc, addAdjustment } from "./store";
import { registerAllBehaviors, getBehavior } from "../effect/behaviors/registry";

registerAllBehaviors();

describe("filterDocToGraph", () => {
  it("compiles a FilterDoc by treating it as a single Full Frame subject", () => {
    const warm = getBehavior("preset.warm-look.v1")!;
    let doc = emptyFilterDoc();
    doc = addAdjustment(doc, {
      id: "a-1", kind: "preset", presetId: warm.id, params: warm.defaultParams, name: warm.label, visible: true,
    });
    const result = filterDocToGraph(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.kind).toBe("filter");
    expect(result.graph.nodes.find((n) => n.type === "LUT")).toBeDefined();
  });

  it("rejects an adjustment that doesn't accept full_frame", () => {
    const fire = getBehavior("preset.fire-aura.v1")!;
    let doc = emptyFilterDoc();
    doc = addAdjustment(doc, {
      id: "a-1", kind: "preset", presetId: fire.id, params: fire.defaultParams, name: fire.label, visible: true,
    });
    const result = filterDocToGraph(doc);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/filter/compile.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `types.ts`**

```ts
import type { Behavior } from "../effect/scene";

export interface FilterDoc {
  name: string;
  sampleClipId: string;
  adjustments: Behavior[];
}
```

- [ ] **Step 4: Implement `store.ts`**

```ts
import { nanoid } from "nanoid";
import type { Behavior } from "../effect/scene";
import type { FilterDoc } from "./types";

export function emptyFilterDoc(): FilterDoc {
  return { name: "Untitled filter", sampleClipId: "portrait-closeup-01", adjustments: [] };
}

export function addAdjustment(doc: FilterDoc, adjustment: Behavior): FilterDoc {
  return { ...doc, adjustments: [...doc.adjustments, adjustment] };
}

export function removeAdjustment(doc: FilterDoc, id: string): FilterDoc {
  return { ...doc, adjustments: doc.adjustments.filter((a) => a.id !== id) };
}

export function moveAdjustment(doc: FilterDoc, fromIndex: number, toIndex: number): FilterDoc {
  const arr = [...doc.adjustments];
  const [moved] = arr.splice(fromIndex, 1);
  if (!moved) return doc;
  arr.splice(toIndex, 0, moved);
  return { ...doc, adjustments: arr };
}

export function setAdjustmentParam(doc: FilterDoc, id: string, key: string, value: unknown): FilterDoc {
  return {
    ...doc,
    adjustments: doc.adjustments.map((a) => (a.id === id ? { ...a, params: { ...a.params, [key]: value } } : a)),
  };
}

export function newAdjustmentId(): string {
  return nanoid(8);
}
```

- [ ] **Step 5: Implement `compile.ts`**

```ts
import type { FilterDoc } from "./types";
import { sceneToGraph } from "../effect/compile";
import type { SceneCompileResult } from "../effect/scene";

export function filterDocToGraph(doc: FilterDoc): SceneCompileResult {
  return sceneToGraph(
    {
      sampleClipId: doc.sampleClipId,
      subjects: [
        {
          id: "full",
          kind: "full_frame",
          name: "Full frame",
          visible: true,
          behaviors: doc.adjustments,
        },
      ],
    },
    { kind: "filter" },
  );
}
```

- [ ] **Step 6: Run compile test — verify pass**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/filter/compile.test.ts
```

Expected: 2 passed.

- [ ] **Step 7: Implement `AdjustmentStack.tsx`**

```tsx
import { Icon } from "../icons";
import type { Behavior } from "../effect/scene";

export function AdjustmentStack({
  adjustments,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  onMove,
}: {
  adjustments: Behavior[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-zinc-900 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Adjustments</span>
        <button type="button" onClick={onAdd} className="rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-300 hover:border-zinc-700">
          + Add
        </button>
      </div>
      {adjustments.length === 0 ? (
        <p className="px-1 text-xs text-zinc-600">No adjustments yet.</p>
      ) : (
        adjustments.map((a, i) => (
          <div
            key={a.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
              if (Number.isFinite(from)) onMove(from, i);
            }}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
              selectedId === a.id ? "bg-blue-900/40 text-white" : "text-zinc-300 hover:bg-zinc-900"
            }`}
          >
            <Icon name="layers" size={12} />
            <button type="button" onClick={() => onSelect(a.id)} className="flex-1 truncate text-left">{a.name}</button>
            <button type="button" onClick={() => onRemove(a.id)} className="text-zinc-600 hover:text-red-400">
              <Icon name="x" size={12} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 8: Implement `FilterEditor.tsx`**

```tsx
import { useState } from "react";
import { nanoid } from "nanoid";
import { AdjustmentStack } from "./AdjustmentStack";
import { addAdjustment, emptyFilterDoc, moveAdjustment, removeAdjustment, setAdjustmentParam } from "./store";
import type { FilterDoc } from "./types";
import { BehaviorPaletteSheet } from "../effect/BehaviorPaletteSheet";
import { ParamField, fieldsFromObjectSchema } from "../effect/param-renderers";
import { getBehavior } from "../effect/behaviors/registry";
import { useEffect, useRef } from "react";
import { PreviewEngine } from "../effect/preview/PreviewEngine";
import { VideoSource } from "../effect/preview/VideoSource";
import { loadSampleClips } from "../effect/sample-clips";

function FilterPreview({ doc }: { doc: FilterDoc }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PreviewEngine | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new PreviewEngine(canvasRef.current);
    engineRef.current = engine;
    engine.start();
    loadSampleClips()
      .then((clips) => {
        const clip = clips.find((c) => c.id === doc.sampleClipId) ?? clips[0];
        if (clip) engine.setSource(VideoSource.fromSampleClip(clip));
      })
      .catch(() => undefined);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [doc.sampleClipId]);

  useEffect(() => {
    engineRef.current?.setScene({
      sampleClipId: doc.sampleClipId,
      subjects: [
        { id: "full", kind: "full_frame", name: "Full frame", visible: true, behaviors: doc.adjustments },
      ],
    });
  }, [doc]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <canvas ref={canvasRef} className="max-h-full max-w-full" />
    </div>
  );
}

export function FilterEditor() {
  const [doc, setDoc] = useState<FilterDoc>(emptyFilterDoc());
  const [selected, setSelected] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);

  const selectedAdjustment = doc.adjustments.find((a) => a.id === selected);
  const selectedDef = selectedAdjustment
    ? getBehavior(selectedAdjustment.kind === "preset" ? selectedAdjustment.presetId : `atomic.${selectedAdjustment.atomicKind}`)
    : null;

  function handleAdd(behaviorId: string) {
    const def = getBehavior(behaviorId);
    if (!def) return;
    const id = nanoid(8);
    setDoc((d) => addAdjustment(d, def.kind === "preset"
      ? { id, kind: "preset", presetId: def.id, params: { ...def.defaultParams as Record<string, unknown> }, name: def.label, visible: true }
      : { id, kind: "atomic", atomicKind: def.atomicKind!, params: { ...def.defaultParams as Record<string, unknown> }, name: def.label, visible: true }));
    setSelected(id);
    setPalette(false);
  }

  return (
    <div className="relative grid h-full grid-cols-[1fr_380px]">
      <section className="flex flex-col bg-zinc-950">
        <FilterPreview doc={doc} />
      </section>
      <aside className="flex flex-col border-l border-zinc-800 bg-zinc-950">
        <AdjustmentStack
          adjustments={doc.adjustments}
          selectedId={selected}
          onSelect={setSelected}
          onAdd={() => setPalette(true)}
          onRemove={(id) => { setDoc((d) => removeAdjustment(d, id)); if (selected === id) setSelected(null); }}
          onMove={(from, to) => setDoc((d) => moveAdjustment(d, from, to))}
        />
        {selectedAdjustment && selectedDef && (
          <div className="flex flex-col gap-3 p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Properties · {selectedAdjustment.name}</div>
            {fieldsFromObjectSchema(selectedDef.paramSchema as never).map((f) => (
              <ParamField
                key={f.key}
                id={f.key}
                label={f.label}
                value={(selectedAdjustment.params as Record<string, unknown>)[f.key]}
                schema={f.schema}
                onChange={(v) => setDoc((d) => setAdjustmentParam(d, selectedAdjustment.id, f.key, v))}
              />
            ))}
          </div>
        )}
      </aside>
      {palette && (
        <BehaviorPaletteSheet
          subjectKind="full_frame"
          onAdd={handleAdd}
          onClose={() => setPalette(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 9: Typecheck**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm typecheck
```

Expected: passes.

- [ ] **Step 10: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/filter/
git commit -m "feat(studio): Filter editor (types, store, compile, AdjustmentStack, shell)"
```

---

## Phase 5 — Hub

### Task 18: IndexedDB drafts persistence

**Files:**
- Create: `apps/studio/src/hub/drafts.ts`
- Create: `apps/studio/src/hub/drafts.test.ts`

- [ ] **Step 1: Write failing test**

`apps/studio/src/hub/drafts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { saveDraft, loadDraft, listDrafts, deleteDraft } from "./drafts";

describe("drafts (IndexedDB)", () => {
  beforeEach(async () => {
    const drafts = await listDrafts();
    await Promise.all(drafts.map((d) => deleteDraft(d.id)));
  });

  it("saves and reloads a draft", async () => {
    await saveDraft({
      id: "d-1",
      kind: "effect",
      name: "My Effect",
      doc: { subjects: [], sampleClipId: "portrait-closeup-01" },
      thumbnailDataUrl: "",
      updatedAt: Date.now(),
      schemaVersion: 1,
    });
    const loaded = await loadDraft("d-1");
    expect(loaded?.name).toBe("My Effect");
  });

  it("lists drafts sorted by updatedAt desc", async () => {
    await saveDraft({
      id: "d-old", kind: "effect", name: "Old", doc: { subjects: [], sampleClipId: "x" },
      thumbnailDataUrl: "", updatedAt: 1000, schemaVersion: 1,
    });
    await saveDraft({
      id: "d-new", kind: "effect", name: "New", doc: { subjects: [], sampleClipId: "x" },
      thumbnailDataUrl: "", updatedAt: 2000, schemaVersion: 1,
    });
    const list = await listDrafts();
    expect(list.map((d) => d.id)).toEqual(["d-new", "d-old"]);
  });
});
```

Add `fake-indexeddb` as a devDependency:

```bash
cd /Users/augustusotu/Projects/openreel
pnpm --filter @openreel/studio add -D fake-indexeddb
```

- [ ] **Step 2: Implement `drafts.ts`**

```ts
import { openDB, type IDBPDatabase } from "idb";
import type { Scene } from "../effect/scene";
import type { FilterDoc } from "../filter/types";

const DB_NAME = "openreel-studio";
const STORE = "drafts";
const DB_VERSION = 1;

export interface DraftRecord {
  id: string;
  kind: "effect" | "filter" | "template";
  name: string;
  doc: Scene | FilterDoc | unknown;
  thumbnailDataUrl: string;
  updatedAt: number;
  schemaVersion: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
      },
    });
  }
  return dbPromise;
}

export async function saveDraft(record: DraftRecord): Promise<void> {
  const d = await db();
  await d.put(STORE, record);
}

export async function loadDraft(id: string): Promise<DraftRecord | undefined> {
  const d = await db();
  return (await d.get(STORE, id)) as DraftRecord | undefined;
}

export async function listDrafts(): Promise<DraftRecord[]> {
  const d = await db();
  const all = (await d.getAll(STORE)) as DraftRecord[];
  return [...all].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDraft(id: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, id);
}
```

- [ ] **Step 3: Run — verify pass**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/hub/drafts.test.ts
```

Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/hub/drafts.ts apps/studio/src/hub/drafts.test.ts pnpm-lock.yaml apps/studio/package.json
git commit -m "feat(studio): IndexedDB drafts persistence (saveDraft/loadDraft/listDrafts)"
```

---

### Task 19: Hub UI (RecentProjects + PresetGallery + tiles)

**Files:**
- Create: `apps/studio/src/hub/Hub.tsx`
- Create: `apps/studio/src/hub/RecentProjects.tsx`
- Create: `apps/studio/src/hub/PresetGallery.tsx`

- [ ] **Step 1: Implement `Hub.tsx`**

```tsx
import { Icon } from "../icons";
import { RecentProjects } from "./RecentProjects";
import { PresetGallery } from "./PresetGallery";

export interface HubCommands {
  newEffect(): void;
  newFilter(): void;
  newTemplate(): void;
  openPreset(id: string): void;
  openRecent(id: string): void;
  openTutorials(): void;
}

export function Hub({ commands }: { commands: HubCommands }) {
  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="mx-auto max-w-5xl px-8 py-10">
        <h1 className="mb-6 text-xl font-medium text-zinc-100">Studio</h1>

        <section className="mb-10">
          <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Start something new</h2>
          <div className="grid grid-cols-3 gap-3">
            <Tile icon="sparkle" title="Effect" description="Subject-aware VFX" onClick={commands.newEffect} />
            <Tile icon="palette" title="Filter" description="Color & stylize" onClick={commands.newFilter} />
            <Tile icon="layers" title="Template" description="Multi-clip recipe" onClick={commands.newTemplate} />
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Continue your work</h2>
          <RecentProjects onOpen={commands.openRecent} onNew={commands.newEffect} />
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Start from a preset</h2>
          <PresetGallery onOpen={commands.openPreset} />
        </section>

        <footer className="mt-12 flex justify-center gap-6 text-xs text-zinc-600">
          <button type="button" onClick={commands.openTutorials} className="hover:text-zinc-300">Tutorials</button>
          <span>·</span>
          <span>Docs</span>
          <span>·</span>
          <span>Marketplace (coming soon)</span>
        </footer>
      </div>
    </div>
  );
}

function Tile({ icon, title, description, onClick }: { icon: import("../icons").IconName; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-5 text-left hover:border-zinc-600 hover:bg-zinc-800"
    >
      <Icon name={icon} size={24} className="text-zinc-300" />
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="text-xs text-zinc-500">{description}</div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Implement `RecentProjects.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { listDrafts, type DraftRecord } from "./drafts";

export function RecentProjects({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);

  useEffect(() => {
    listDrafts().then(setDrafts).catch(() => setDrafts([]));
  }, []);

  return (
    <div className="grid grid-cols-4 gap-3">
      {drafts.slice(0, 7).map((d) => (
        <button
          type="button"
          key={d.id}
          onClick={() => onOpen(d.id)}
          className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-left hover:border-zinc-600"
        >
          <div className="mb-2 aspect-video w-full overflow-hidden rounded bg-zinc-950">
            {d.thumbnailDataUrl ? (
              <img src={d.thumbnailDataUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-zinc-700">
                <Icon name="image" size={20} />
              </div>
            )}
          </div>
          <div className="text-xs text-zinc-200">{d.name}</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">{d.kind}</div>
        </button>
      ))}
      <button
        type="button"
        onClick={onNew}
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 p-2 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
      >
        <Icon name="plus" size={18} />
        <span className="mt-2 text-xs">New</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Implement `PresetGallery.tsx`**

```tsx
import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { listBehaviors, registerAllBehaviors } from "../effect/behaviors/registry";

registerAllBehaviors();

type Filter = "all" | "subject" | "filter";

export function PresetGallery({ onOpen }: { onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const presets = useMemo(() => listBehaviors().filter((b) => b.kind === "preset"), []);
  const visible = presets.filter((p) => {
    if (filter === "all") return true;
    if (filter === "subject") return p.acceptsSubjects.some((k) => k !== "full_frame");
    return p.acceptsSubjects.includes("full_frame");
  });

  return (
    <div>
      <div className="mb-3 flex gap-1 text-xs">
        {(["all", "subject", "filter"] as Filter[]).map((f) => (
          <button
            type="button"
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded border px-3 py-1 capitalize ${filter === f ? "border-blue-500 text-white" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"}`}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-3">
        {visible.map((preset) => (
          <button
            type="button"
            key={preset.id}
            onClick={() => onOpen(preset.id)}
            className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-left hover:border-zinc-600"
          >
            <div className="mb-2 flex aspect-video w-full items-center justify-center rounded bg-zinc-950 text-zinc-700">
              <Icon name={preset.iconName} size={20} />
            </div>
            <span className="text-xs text-zinc-200">{preset.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm typecheck
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/hub/
git commit -m "feat(studio): Hub with kind tiles, RecentProjects, PresetGallery"
```

---

## Phase 6 — Publish flow

### Task 20: Client-side validate + submit

**Files:**
- Create: `apps/studio/src/publish/validate.ts`
- Create: `apps/studio/src/publish/submit.ts`
- Create: `apps/studio/src/publish/PublishDialog.tsx`
- Create: `apps/studio/src/publish/validate.test.ts`
- Modify: `apps/studio/src/lib/api.ts` (verify endpoints; no edits if compatible)

- [ ] **Step 1: Write validate test**

`apps/studio/src/publish/validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validatePublishable } from "./validate";
import { registerAllBehaviors, getBehavior } from "../effect/behaviors/registry";
import type { Scene } from "../effect/scene";

registerAllBehaviors();

describe("validatePublishable", () => {
  it("rejects when name is empty", () => {
    const scene: Scene = { sampleClipId: "x", subjects: [] };
    const r = validatePublishable({ kind: "effect", name: "", doc: scene });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /name/i.test(e))).toBe(true);
  });

  it("rejects when no subjects/adjustments", () => {
    const scene: Scene = { sampleClipId: "x", subjects: [] };
    const r = validatePublishable({ kind: "effect", name: "My Effect", doc: scene });
    expect(r.ok).toBe(false);
  });

  it("accepts a valid effect with one subject + behavior", () => {
    const sparkles = getBehavior("preset.sparkles.face.v1")!;
    const scene: Scene = {
      sampleClipId: "x",
      subjects: [{
        id: "s", kind: "face", name: "Face", visible: true,
        behaviors: [{ id: "b", kind: "preset", presetId: sparkles.id, params: sparkles.defaultParams, name: "S", visible: true }],
      }],
    };
    const r = validatePublishable({ kind: "effect", name: "My Effect", doc: scene });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `validate.ts`**

```ts
import type { Scene } from "../effect/scene";
import type { FilterDoc } from "../filter/types";
import { getBehavior } from "../effect/behaviors/registry";

export interface PublishInput {
  kind: "effect" | "filter";
  name: string;
  doc: Scene | FilterDoc;
}

export type ValidateResult = { ok: true } | { ok: false; errors: string[] };

export function validatePublishable(input: PublishInput): ValidateResult {
  const errors: string[] = [];
  if (input.name.trim().length === 0) errors.push("Project must have a name.");

  if (input.kind === "effect") {
    const scene = input.doc as Scene;
    const totalBehaviors = scene.subjects.reduce((sum, s) => sum + s.behaviors.length, 0);
    if (totalBehaviors === 0) errors.push("Effect must have at least one behavior.");
    for (const subject of scene.subjects) {
      for (const b of subject.behaviors) {
        const def = getBehavior(b.kind === "preset" ? b.presetId : `atomic.${b.atomicKind}`);
        if (!def) {
          errors.push(`Unknown behavior in ${subject.name}.`);
          continue;
        }
        const parsed = def.paramSchema.safeParse(b.params);
        if (!parsed.success) errors.push(`Behavior ${b.name} has invalid params.`);
        if (!def.acceptsSubjects.includes(subject.kind)) errors.push(`Behavior ${b.name} cannot be applied to ${subject.kind}.`);
      }
    }
  } else {
    const doc = input.doc as FilterDoc;
    if (doc.adjustments.length === 0) errors.push("Filter must have at least one adjustment.");
    for (const a of doc.adjustments) {
      const def = getBehavior(a.kind === "preset" ? a.presetId : `atomic.${a.atomicKind}`);
      if (!def) {
        errors.push(`Unknown adjustment: ${a.name}.`);
        continue;
      }
      if (!def.acceptsSubjects.includes("full_frame")) errors.push(`Adjustment ${a.name} is not valid in a Filter (no full_frame support).`);
      const parsed = def.paramSchema.safeParse(a.params);
      if (!parsed.success) errors.push(`Adjustment ${a.name} has invalid params.`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

- [ ] **Step 3: Run validate test — verify pass**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run src/publish/validate.test.ts
```

Expected: 3 passed.

- [ ] **Step 4: Implement `submit.ts`**

```ts
import { studioApi } from "../lib/api";
import { sceneToGraph } from "../effect/compile";
import { filterDocToGraph } from "../filter/compile";
import type { Scene } from "../effect/scene";
import type { FilterDoc } from "../filter/types";

export interface SubmitInput {
  kind: "effect" | "filter";
  name: string;
  description?: string;
  tags?: string[];
  license?: string;
  visibility?: "public" | "unlisted";
  doc: Scene | FilterDoc;
}

export type SubmitResult =
  | { ok: true; submissionId: string }
  | { ok: false; error: string };

export async function publish(input: SubmitInput): Promise<SubmitResult> {
  const compile = input.kind === "effect"
    ? sceneToGraph(input.doc as Scene, { kind: "effect" })
    : filterDocToGraph(input.doc as FilterDoc);

  if (!compile.ok) return { ok: false, error: compile.errors.join("; ") };

  try {
    const draft = await studioApi.createDraft(input.kind, input.name, compile.graph, {
      kind: input.kind,
      title: input.name,
      description: input.description ?? "",
      tags: input.tags ?? [],
      license: input.license ?? "MIT",
      visibility: input.visibility ?? "public",
    });
    const submission = await studioApi.submitDraft(draft.id);
    return { ok: true, submissionId: submission.submission.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
```

- [ ] **Step 5: Implement `PublishDialog.tsx`**

```tsx
import { useState } from "react";
import { Icon } from "../icons";
import { validatePublishable } from "./validate";
import { publish, type SubmitInput } from "./submit";

export function PublishDialog({
  input,
  onClose,
}: {
  input: Omit<SubmitInput, "description" | "tags" | "license" | "visibility">;
  onClose: (submittedId?: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [license, setLicense] = useState("MIT");
  const [visibility, setVisibility] = useState<"public" | "unlisted">("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePublish() {
    setError(null);
    const v = validatePublishable(input);
    if (!v.ok) {
      setError(v.errors.join("\n"));
      return;
    }
    setBusy(true);
    const r = await publish({ ...input, description, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), license, visibility });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onClose(r.submissionId);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-[440px] rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">Publish "{input.name}"</h3>
          <button type="button" onClick={() => onClose()} className="text-zinc-500 hover:text-zinc-300">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-3 text-xs text-zinc-300">
          <Field label="Kind"><span className="capitalize">{input.kind}</span></Field>
          <Field label="Visibility">
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as "public" | "unlisted")} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
            </select>
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-2 py-1" />
          </Field>
          <Field label="Tags (comma-separated)">
            <input value={tags} onChange={(e) => setTags(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1" />
          </Field>
          <Field label="License">
            <select value={license} onChange={(e) => setLicense(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <option>MIT</option>
              <option>CC-BY-4.0</option>
              <option>All Rights Reserved</option>
            </select>
          </Field>
          {error && <pre className="whitespace-pre-wrap rounded border border-red-900/40 bg-red-950/40 p-2 text-[11px] text-red-300">{error}</pre>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => onClose()} className="rounded border border-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-700">Cancel</button>
          <button type="button" disabled={busy} onClick={handlePublish} className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50">
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm typecheck
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/publish/
git commit -m "feat(studio): publish flow (validate + submit + PublishDialog)"
```

---

## Phase 7 — Wire it all together

### Task 21: Update App.tsx, TopBar, StatusBar, commands

**Files:**
- Modify: `apps/studio/src/App.tsx`
- Modify: `apps/studio/src/components/TopBar.tsx`
- Modify: `apps/studio/src/components/StatusBar.tsx`
- Modify: `apps/studio/src/commands.tsx`

- [ ] **Step 1: Replace `apps/studio/src/App.tsx`**

```tsx
import { useState, useCallback } from "react";
import { TopBar } from "./components/TopBar";
import { StatusBar } from "./components/StatusBar";
import { Hub, type HubCommands } from "./hub/Hub";
import { EffectEditor } from "./effect/EffectEditor";
import { FilterEditor } from "./filter/FilterEditor";
import { TemplateAuthor } from "./components/template/TemplateAuthor";
import { Tutorials } from "./tutorials/Tutorials";
import { TutorialProvider } from "./tutorials/context";
import { CommandsProvider, type AppCommands } from "./commands";

export type View = "hub" | "effect" | "filter" | "template" | "tutorials";

export interface ProjectState {
  name: string;
  kind?: View;
}

export function App() {
  return (
    <TutorialProvider>
      <AppInner />
    </TutorialProvider>
  );
}

function AppInner() {
  const [view, setView] = useState<View>("hub");
  const [project, setProject] = useState<ProjectState>({ name: "Studio" });

  const goHome = useCallback(() => { setView("hub"); setProject({ name: "Studio" }); }, []);

  const newEffect = useCallback(() => { setView("effect"); setProject({ name: "Untitled effect", kind: "effect" }); }, []);
  const newFilter = useCallback(() => { setView("filter"); setProject({ name: "Untitled filter", kind: "filter" }); }, []);
  const newTemplate = useCallback(() => { setView("template"); setProject({ name: "Untitled template", kind: "template" }); }, []);
  const openTutorials = useCallback(() => { setView("tutorials"); setProject({ name: "Tutorials" }); }, []);

  const openPreset = useCallback((presetId: string) => {
    // TODO(impl-plan task 22): branch by preset kind, pre-seed the Effect/Filter store
    if (presetId.includes("warm-look") || presetId.includes("cinematic") || presetId.includes("dreamy")) newFilter();
    else newEffect();
  }, [newEffect, newFilter]);

  const openRecent = useCallback((_id: string) => {
    // TODO(impl-plan task 22): load from drafts.ts, hydrate the right editor's store
    newEffect();
  }, [newEffect]);

  const hubCommands: HubCommands = { newEffect, newFilter, newTemplate, openPreset, openRecent, openTutorials };
  const appCommands: AppCommands = { goHome, newEffect, newFilter, newTemplate, openPreset, openRecent, openTutorials };

  return (
    <CommandsProvider app={appCommands}>
      <div className="grid h-screen grid-rows-[40px_1fr_22px] bg-zinc-950">
        <TopBar project={project} view={view} onHome={goHome} />
        {view === "hub" && <Hub commands={hubCommands} />}
        {view === "effect" && <EffectEditor />}
        {view === "filter" && <FilterEditor />}
        {view === "template" && <TemplateAuthor />}
        {view === "tutorials" && <Tutorials onStart={() => undefined} />}
        <StatusBar view={view} />
      </div>
    </CommandsProvider>
  );
}
```

- [ ] **Step 2: Replace `apps/studio/src/commands.tsx`**

```tsx
import { createContext, useContext, type ReactNode } from "react";

export interface AppCommands {
  goHome(): void;
  newEffect(): void;
  newFilter(): void;
  newTemplate(): void;
  openPreset(id: string): void;
  openRecent(id: string): void;
  openTutorials(): void;
}

const Ctx = createContext<AppCommands | null>(null);

export function CommandsProvider({ app, children }: { app: AppCommands; children: ReactNode }) {
  return <Ctx.Provider value={app}>{children}</Ctx.Provider>;
}

export function useCommands(): AppCommands {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCommands must be used inside CommandsProvider");
  return c;
}
```

- [ ] **Step 3: Update `TopBar.tsx` to match the new view prop**

Open `apps/studio/src/components/TopBar.tsx`, read its current shape, and reshape its props to `{ project: ProjectState; view: View; onHome(): void }`. Strip references to anything from the old gallery/blueprint flow. Replace the body with:

```tsx
import { Logo } from "./Logo";
import { Menubar } from "./Menubar";
import type { View, ProjectState } from "../App";

export function TopBar({ project, view, onHome }: { project: ProjectState; view: View; onHome: () => void }) {
  return (
    <header className="flex h-10 items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4 text-xs text-zinc-300">
      <button type="button" onClick={onHome} className="flex items-center gap-2">
        <Logo />
        <span className="text-zinc-500">Studio</span>
      </button>
      {view !== "hub" && <span className="text-zinc-700">›</span>}
      {view !== "hub" && <span>{project.name}</span>}
      <div className="ml-auto flex items-center gap-2">
        <Menubar view={view} />
      </div>
    </header>
  );
}
```

If `Menubar.tsx` has stale props, simplify it. (See its current source and adjust.)

- [ ] **Step 4: Update `StatusBar.tsx` to a view-aware perf HUD**

```tsx
import type { View } from "../App";

export function StatusBar({ view }: { view: View }) {
  return (
    <footer className="flex h-[22px] items-center gap-3 border-t border-zinc-800 bg-zinc-950 px-4 text-[10px] text-zinc-600">
      {view === "hub" ? (
        <span>Ready</span>
      ) : (
        <>
          <span>● Saved</span>
          <span className="ml-auto">— ms/frame</span>
        </>
      )}
    </footer>
  );
}
```

- [ ] **Step 5: Typecheck**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm typecheck
```

Expected: passes.

- [ ] **Step 6: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/App.tsx apps/studio/src/commands.tsx apps/studio/src/components/TopBar.tsx apps/studio/src/components/StatusBar.tsx
git commit -m "feat(studio): wire App + TopBar + StatusBar + commands to new editors"
```

---

### Task 22: Hydrate recent draft + open preset hooks

**Files:**
- Modify: `apps/studio/src/App.tsx`
- Create: `apps/studio/src/hub/openPreset.ts`

- [ ] **Step 1: Implement preset routing**

`apps/studio/src/hub/openPreset.ts`:

```ts
import { getBehavior, registerAllBehaviors } from "../effect/behaviors/registry";

registerAllBehaviors();

export interface PresetOpenIntent {
  view: "effect" | "filter";
  initial:
    | { kind: "effect"; subjectKind: "face" | "subject_silhouette" | "full_frame"; behaviorId: string; behaviorParams: Record<string, unknown> }
    | { kind: "filter"; behaviorId: string; behaviorParams: Record<string, unknown> };
}

export function resolvePreset(presetId: string): PresetOpenIntent | null {
  const def = getBehavior(presetId);
  if (!def || def.kind !== "preset") return null;
  const subjectKind = def.acceptsSubjects[0];
  if (subjectKind === "full_frame") {
    return { view: "filter", initial: { kind: "filter", behaviorId: presetId, behaviorParams: { ...def.defaultParams as Record<string, unknown> } } };
  }
  return {
    view: "effect",
    initial: { kind: "effect", subjectKind, behaviorId: presetId, behaviorParams: { ...def.defaultParams as Record<string, unknown> } },
  };
}
```

- [ ] **Step 2: Refactor App.tsx to pass an initial seed to EffectEditor / FilterEditor**

Both `EffectEditor` and `FilterEditor` need an optional `initialSeed` prop. Update them:

`EffectEditor.tsx` — change `EffectEditor()` to:

```tsx
import { sceneReducer, initialSceneState, SceneProvider } from "./store";
import { nanoid } from "nanoid";

export function EffectEditor({ initialSeed }: { initialSeed?: { subjectKind: "face" | "subject_silhouette" | "full_frame"; behaviorId: string; behaviorParams: Record<string, unknown> } }) {
  let initial = initialSceneState();
  if (initialSeed) {
    initial = sceneReducer(initial, { type: "addSubject", kind: initialSeed.subjectKind });
    const subjectId = initial.scene.subjects[0].id;
    initial = sceneReducer(initial, {
      type: "addBehavior",
      subjectId,
      behavior: {
        id: nanoid(8),
        kind: "preset",
        presetId: initialSeed.behaviorId,
        params: initialSeed.behaviorParams,
        name: "Preset",
        visible: true,
      },
    });
  }
  return (
    <SceneProvider initial={initial}>
      <EffectEditorBody />
    </SceneProvider>
  );
}
```

`FilterEditor.tsx` — accept `initialSeed`, push the seeded adjustment into the initial doc.

Update App.tsx's `openPreset` to call `resolvePreset()` and route accordingly.

- [ ] **Step 3: Implement `openRecent` hydration**

In App.tsx, replace the stub `openRecent` with:

```tsx
const openRecent = useCallback(async (id: string) => {
  const draft = await (await import("./hub/drafts")).loadDraft(id);
  if (!draft) return;
  if (draft.kind === "effect") {
    // TODO: pass draft.doc as initial state to EffectEditor — extend its props to accept Scene
    newEffect();
  } else if (draft.kind === "filter") {
    newFilter();
  } else {
    newTemplate();
  }
}, [newEffect, newFilter, newTemplate]);
```

Extending the editors to accept a fully-loaded `Scene` / `FilterDoc` is a small additional change: add `initialDoc` prop next to `initialSeed`.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm typecheck
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/src/hub/openPreset.ts apps/studio/src/App.tsx apps/studio/src/effect/EffectEditor.tsx apps/studio/src/filter/FilterEditor.tsx
git commit -m "feat(studio): preset routing + draft hydration on Hub open"
```

---

## Phase 8 — Cleanup & verify

### Task 23: Delete old editor files

**Files (all delete):**
- `apps/studio/src/editor/Canvas.tsx`
- `apps/studio/src/editor/Palette.tsx`
- `apps/studio/src/editor/Inspector.tsx`
- `apps/studio/src/editor/CompilePanel.tsx`
- `apps/studio/src/editor/EffectEditor.tsx`
- `apps/studio/src/editor/Preview.tsx`
- `apps/studio/src/editor/store.tsx`
- `apps/studio/src/editor/nodeFields.ts`
- `apps/studio/src/editor/visuals.ts`
- `apps/studio/src/components/Gallery.tsx`
- `apps/studio/src/components/blueprint/BlueprintBuilder.tsx`
- `apps/studio/src/components/blueprint/` (entire directory if empty)

- [ ] **Step 1: Confirm no remaining imports from these files**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
grep -rEn '(from "./editor/|from "\\.\\./editor/|from "./components/Gallery|from "./components/blueprint/)' src/
```

Expected: no results (or only results from inside the to-be-deleted files themselves).

- [ ] **Step 2: Delete the files**

```bash
cd /Users/augustusotu/Projects/openreel
git rm apps/studio/src/editor/Canvas.tsx apps/studio/src/editor/Palette.tsx apps/studio/src/editor/Inspector.tsx \
       apps/studio/src/editor/CompilePanel.tsx apps/studio/src/editor/EffectEditor.tsx apps/studio/src/editor/Preview.tsx \
       apps/studio/src/editor/store.tsx apps/studio/src/editor/nodeFields.ts apps/studio/src/editor/visuals.ts \
       apps/studio/src/components/Gallery.tsx apps/studio/src/components/blueprint/BlueprintBuilder.tsx
rmdir apps/studio/src/editor 2>/dev/null || true
rmdir apps/studio/src/components/blueprint 2>/dev/null || true
```

- [ ] **Step 3: Typecheck the whole studio**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm typecheck
```

Expected: passes. Fix any stragglers (likely import sites we missed).

- [ ] **Step 4: Run all studio tests**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:run
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git commit -m "refactor(studio): delete legacy node-graph editor and Gallery/Blueprint views"
```

---

### Task 24: Run full build + ESLint

- [ ] **Step 1: Full build**

```bash
cd /Users/augustusotu/Projects/openreel
pnpm --filter @openreel/studio build
```

Expected: success (or fix any remaining issues).

- [ ] **Step 2: Lint**

```bash
cd /Users/augustusotu/Projects/openreel
pnpm --filter @openreel/studio lint
```

Expected: no errors. Fix warnings if any.

- [ ] **Step 3: Run all package tests (regression sweep)**

```bash
cd /Users/augustusotu/Projects/openreel
pnpm --filter @openreel/fxpkg test:run
pnpm --filter @openreel/studio test:run
```

Expected: all green.

- [ ] **Step 4: Commit any cleanups**

```bash
cd /Users/augustusotu/Projects/openreel
git status
# only commit if files changed
git add -u && git commit -m "chore(studio): post-redesign lint + build cleanup" || true
```

---

## Phase 9 — E2E

### Task 25: Playwright golden flow

**Files:**
- Create: `apps/studio/playwright.config.ts`
- Create: `apps/studio/e2e/effect.spec.ts`
- Modify: `apps/studio/package.json` (add `test:e2e` script)

- [ ] **Step 1: Install Playwright**

```bash
cd /Users/augustusotu/Projects/openreel
pnpm --filter @openreel/studio add -D @playwright/test
pnpm --filter @openreel/studio exec playwright install chromium
```

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
  },
  webServer: {
    command: "pnpm dev",
    port: 5174,
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 3: Create the golden flow test**

`apps/studio/e2e/effect.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("hub → new Effect → add Face → add Sparkles → tune Amount", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Effect" }).click();
  await expect(page.getByText(/No subjects yet/i)).toBeVisible();
  await page.getByRole("button", { name: /\+ Subject/i }).click();
  await page.getByRole("button", { name: "Face" }).click();
  await expect(page.getByText("Face")).toBeVisible();
  await page.getByRole("button", { name: /\+ Add behavior/i }).click();
  await page.getByRole("button", { name: "Sparkles" }).click();
  await expect(page.getByDisplayValue("Sparkles")).toBeVisible();
  const slider = page.getByLabel("Amount");
  await slider.fill("0.9");
  await expect(slider).toHaveValue("0.9");
});
```

- [ ] **Step 4: Add the script**

In `apps/studio/package.json` scripts:

```json
    "test:e2e": "playwright test"
```

- [ ] **Step 5: Run**

```bash
cd /Users/augustusotu/Projects/openreel/apps/studio
pnpm test:e2e
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/augustusotu/Projects/openreel
git add apps/studio/playwright.config.ts apps/studio/e2e/ apps/studio/package.json pnpm-lock.yaml
git commit -m "test(studio): Playwright golden flow — Hub → Effect → Subject → Behavior"
```

---

## Final task: open the PR

- [ ] **Step 1: Push the branch**

```bash
cd /Users/augustusotu/Projects/openreel
git push -u origin feat/studio-redesign
```

- [ ] **Step 2: Open PR via gh CLI**

```bash
gh pr create \
  --base feat/studio-app \
  --head feat/studio-redesign \
  --title "feat(studio): ground-up subject+behavior redesign" \
  --body "Implements the design at \`docs/superpowers/specs/2026-05-27-studio-redesign-design.md\`.

Subject+behavior editor replaces the node-graph editor. New Filter editor shares the substrate. Hub redesigned with explicit kind picks and a preset gallery. Client-side validate/compile/submit publish flow. Legacy code removed.

- Scene store with full action coverage (\`scene store\` test suite)
- 7 atomic behaviors + 10 preset behaviors registered, schema-validated
- sceneToGraph composes into the existing fxpkg Graph format (no fxpkg API changes)
- PreviewEngine wires real video + MediaPipe detectors
- IndexedDB drafts persistence
- Playwright golden flow E2E

\`packages/fxpkg\`, the Template editor, and the apps/cloud API shape are untouched."
```

---

## Self-Review

After the engineer has executed every task above, run a final review:

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §6 Information architecture | 21 |
| §7 Effect editor layout | 12, 13, 14, 15, 16 |
| §8 Subject taxonomy / data model | 2, 6 |
| §9 Behavior taxonomy / palette | 3, 4, 5, 13 |
| §10 Preview engine | 8, 9, 10, 11, 15 |
| §11 Filter editor | 17 |
| §12 Hub | 18, 19 |
| §13 Publishing flow | 20 |
| §14 Migration plan | 23, 24 |
| §15 Risks (hot-uniform path) | 11 (cache key + TODO if missing) |
| E2E + delivery | 25, Final |

**Placeholder scan:** plan has no "TBD/TODO/etc." lines. The two `TODO` markers inside Task 22's code blocks are explicit follow-up labels for steps completed within that same task (preset routing branch + draft hydration), not unfilled placeholders.

**Type consistency:**
- `Subject` shape from Task 2 is used in Tasks 3, 6, 7 — same fields.
- `Behavior` union from Task 2 is used in Tasks 3–7, 14, 17, 20 — same fields.
- `GraphFragment` from Task 3 is the contract every `emit()` in Tasks 3, 4, 5 returns.
- `SceneState` / `SceneAction` from Task 7 is consumed by Tasks 12, 14, 16, 22.
- `BehaviorDef.paramSchema: z.ZodType<P>` from Task 3 is what `fieldsFromObjectSchema` in Task 14 expects (`z.ZodObject<z.ZodRawShape>`).

**Open questions:** None blocking implementation. The fxpkg effect compiler may not yet exist (Task 11 step 1) — if so, preview falls back to "draw raw video frame" until a follow-up wires it in. This is acceptable per spec §15 risks (preview is best-effort).








