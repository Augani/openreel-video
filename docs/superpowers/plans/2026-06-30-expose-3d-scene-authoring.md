# Expose 3D Scene Authoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user create and edit a real multi-object 3D scene from the Motion UI (tool rail + inspector), exposing the existing Three.js engine that today only the agent can drive.

**Architecture:** A new `"scene3d"` case in the layer factory produces a scene-mode `MotionScene3DLayer` (an `objects[]` array of `MotionSceneObject3D` + a `camera`); the tool rail gains a "3D scene" entry; a new focused `Scene3DInspector` component renders Objects / Geometry / Material / Transform / Camera accordion sections that edit the selected layer's `objects[]`/`camera` via the inspector's existing `replaceLayer`. No data-model/schema changes — the types already exist.

**Tech Stack:** React + TypeScript, Zustand, Vitest + @testing-library/react, Three.js (renderer already built), the motion `primitives.tsx` controls.

## Global Constraints

- No line comments in code; no docstrings except public-API functions. (repo CLAUDE.md)
- TypeScript strict; no `any`; explicit return types on exported functions.
- Brand accent is emerald `#10b981` (use the `bg-accent`/`text-accent` tokens, not literals, in JSX).
- Tests live beside source as `*.test.ts`/`*.test.tsx`; run with `pnpm --filter @openreel/web test:run`.
- Type/lint gates: `cd apps/web && npx tsc --noEmit --ignoreDeprecations 6.0 -p tsconfig.json` and `npx eslint <files> --quiet` must be clean.
- v1 is inspector-driven, scene-mode (`objects[]`), primitives + GLB + 3D text only. OUT: viewport orbit/gizmo, geometry kernel, per-object keyframes.

---

### Task 1: Core factory — make `scene3d` a creatable, scene-mode layer

**Files:**
- Modify: `apps/web/src/motion/motion-layer-factory.ts`
- Test: `apps/web/src/motion/motion-layer-factory.test.ts` (create or extend)

**Interfaces:**
- Consumes: `createMotionScene3DLayer(options)` and types `MotionObject3D`, `MotionSceneObject3D` from `@openreel/core` (already exported from `packages/core/src/motion/motion-scene3d.ts` and `types.ts`).
- Produces: `createMotionLayerOfType(composition, "scene3d")` returns a `MotionScene3DLayer` with `type: "scene3d"`, `objects.length === 1`, and a defined `camera`. `CreatableMotionLayerType` now includes `"scene3d"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createMotionLayerOfType } from "./motion-layer-factory";
import type { MotionComposition, MotionScene3DLayer } from "@openreel/core";

const composition = {
  id: "c1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "#000000",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  guides: [],
  createdAt: 1,
  modifiedAt: 1,
} as unknown as MotionComposition;

describe("createMotionLayerOfType scene3d", () => {
  it("creates a scene-mode 3D layer with one object and a camera", () => {
    const layer = createMotionLayerOfType(composition, "scene3d") as MotionScene3DLayer;
    expect(layer.type).toBe("scene3d");
    expect(layer.objects).toBeDefined();
    expect(layer.objects?.length).toBe(1);
    expect(layer.objects?.[0].object.kind).toBe("rounded-box");
    expect(layer.camera).toBeDefined();
    expect(layer.lighting?.environment).toBe("studio");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/motion/motion-layer-factory.test.ts`
Expected: FAIL — `createMotionLayerOfType` throws "Unsupported motion layer type: scene3d" (the `default` exhaustive branch).

- [ ] **Step 3: Implement the scene3d case**

In `motion-layer-factory.ts`, extend the import and the union and add a case before `default`:

```ts
import {
  createMotionAdjustmentLayer,
  createMotionNullLayer,
  createMotionParticleLayer,
  createMotionScene3DLayer,
  DEFAULT_MOTION_TRANSFORM,
  DEFAULT_SHAPE_STYLE,
  type MotionComposition,
  type MotionLayer,
  type MotionObject3D,
} from "@openreel/core";

export type CreatableMotionLayerType =
  | "text"
  | "shape"
  | "group"
  | "null"
  | "adjustment"
  | "particle"
  | "scene3d";
```

```ts
    case "scene3d": {
      const heroObject: MotionObject3D = {
        kind: "rounded-box",
        size: 0.5,
        depth: 1,
        cornerRadius: 0.12,
      };
      return createMotionScene3DLayer({
        id,
        name: "3D Scene",
        duration: composition.duration,
        compositionWidth: composition.width,
        compositionHeight: composition.height,
        x: position.x,
        y: position.y,
        object: heroObject,
        objects: [
          {
            id: makeId("scene-obj"),
            name: "Object 1",
            object: heroObject,
            material: {
              kind: "physical",
              color: "#10b981",
              metalness: 0.1,
              roughness: 0.4,
            },
            transform3d: {
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
          },
        ],
        camera: {
          position: { x: 0, y: 0.5, z: 4 },
          target: { x: 0, y: 0, z: 0 },
          fov: 35,
        },
        lighting: { environment: "studio", groundShadow: true },
      });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/motion/motion-layer-factory.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit --ignoreDeprecations 6.0 -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/motion/motion-layer-factory.ts apps/web/src/motion/motion-layer-factory.test.ts
git commit -m "feat(motion): make scene3d a creatable scene-mode layer"
```

---

### Task 2: Tool rail — add a "3D scene" entry

**Files:**
- Modify: `apps/web/src/motion/components/MotionToolRail.tsx` (ADD_MENU at l.56-67; icon import)
- Test: `apps/web/src/motion/components/MotionToolRail.test.tsx` (create)

**Interfaces:**
- Consumes: `createMotionLayerOfType` + `CreatableMotionLayerType` (Task 1); the existing `addLayer` flow (`upsertMotionComposition`).
- Produces: clicking the "3D scene" menu item appends a `scene3d` layer and selects it.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MotionToolRail } from "./MotionToolRail";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";

describe("MotionToolRail 3D scene", () => {
  beforeEach(() => {
    const composition = {
      id: "c1", name: "S", width: 1920, height: 1080, frameRate: 30,
      duration: 5, backgroundColor: "#000", layers: [], assets: [],
      variables: [], markers: [], guides: [], createdAt: 1, modifiedAt: 1,
    };
    useProjectStore.setState({
      project: { ...useProjectStore.getState().project, motionCompositions: [composition] },
    } as never);
    useMotionStore.setState({ activeCompositionId: "c1" } as never);
  });

  it("adds a scene3d layer from the Add menu", () => {
    render(<MotionToolRail />);
    fireEvent.click(screen.getByRole("button", { name: /add layer/i }));
    fireEvent.click(screen.getByText("3D scene"));
    const comp = (useProjectStore.getState().project.motionCompositions ?? [])[0];
    expect(comp.layers.some((l) => l.type === "scene3d")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/motion/components/MotionToolRail.test.tsx`
Expected: FAIL — no "3D scene" text in the menu.

- [ ] **Step 3: Add the menu entry**

Ensure `Box` is imported from `@/icons/lucide-compat` in MotionToolRail.tsx, then add to `ADD_MENU`:

```ts
  { type: "scene3d", icon: Box, label: "3D scene" },
```

(Add it after the `shape` entry so 3D sits near the other visual primitives.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/motion/components/MotionToolRail.test.tsx`
Expected: PASS. (If the Add-menu trigger's accessible name differs, read MotionToolRail.tsx l.98-160 and match the real `aria-label`.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/motion/components/MotionToolRail.tsx apps/web/src/motion/components/MotionToolRail.test.tsx
git commit -m "feat(motion): add '3D scene' to the tool-rail Add menu"
```

---

### Task 3: `Scene3DInspector` — Objects + Geometry sections, wired into PropertiesPanel

**Files:**
- Create: `apps/web/src/motion/components/inspector/Scene3DInspector.tsx`
- Modify: `apps/web/src/motion/components/PropertiesPanel.tsx` (scene3d branch ~l.1094 — render `<Scene3DInspector>` above the existing Lighting & Environment section)
- Test: `apps/web/src/motion/components/inspector/Scene3DInspector.test.tsx` (create)

**Interfaces:**
- Consumes: `Section`, `SelectInput`, `Field`, `TextInput`, `NumberInput` from `../primitives`; `MOTION_OBJECT_3D_KINDS` from `@openreel/core`; types `MotionScene3DLayer`, `MotionSceneObject3D`, `MotionObject3DKind`.
- Produces (props):
  ```ts
  interface Scene3DInspectorProps {
    readonly layer: MotionScene3DLayer;
    readonly replaceLayer: (layer: MotionScene3DLayer) => void;
  }
  ```
  Internal helper `updateObjects(objects: readonly MotionSceneObject3D[]): void` calls `replaceLayer({ ...layer, objects })`. Active object tracked by local `activeId` state (defaults to `objects[0].id`, reset on `layer.id` change).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Scene3DInspector } from "./Scene3DInspector";
import type { MotionScene3DLayer } from "@openreel/core";

const baseLayer = {
  id: "L1", type: "scene3d", name: "3D Scene", startTime: 0, duration: 5,
  visible: true, locked: false, transform: {}, keyframes: [],
  object: { kind: "rounded-box" },
  objects: [
    { id: "o1", name: "Object 1", object: { kind: "rounded-box" }, material: { color: "#10b981" }, transform3d: {} },
  ],
  camera: { fov: 35 },
} as unknown as MotionScene3DLayer;

describe("Scene3DInspector objects + geometry", () => {
  it("adds an object and changes the active object's kind", () => {
    const replaceLayer = vi.fn();
    render(<Scene3DInspector layer={baseLayer} replaceLayer={replaceLayer} />);

    fireEvent.click(screen.getByRole("button", { name: /add object/i }));
    expect(replaceLayer).toHaveBeenCalled();
    const added = replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer;
    expect(added.objects?.length).toBe(2);

    fireEvent.change(screen.getByLabelText(/geometry kind/i), { target: { value: "sphere" } });
    const changed = replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer;
    expect(changed.objects?.[0].object.kind).toBe("sphere");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/motion/components/inspector/Scene3DInspector.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Scene3DInspector (Objects + Geometry)**

```tsx
import { useEffect, useState } from "react";
import {
  MOTION_OBJECT_3D_KINDS,
  type MotionObject3DKind,
  type MotionScene3DLayer,
  type MotionSceneObject3D,
} from "@openreel/core";
import { Plus, Trash2 } from "@/icons/lucide-compat";
import { Field, NumberInput, Section, SelectInput, TextInput } from "../primitives";

interface Scene3DInspectorProps {
  readonly layer: MotionScene3DLayer;
  readonly replaceLayer: (layer: MotionScene3DLayer) => void;
}

const KIND_OPTIONS = MOTION_OBJECT_3D_KINDS.map((kind) => ({
  value: kind,
  label: kind,
}));

const makeObjectId = (): string =>
  `scene-obj-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export function Scene3DInspector({
  layer,
  replaceLayer,
}: Scene3DInspectorProps): JSX.Element {
  const objects = layer.objects ?? [];
  const [activeId, setActiveId] = useState<string>(objects[0]?.id ?? "");

  useEffect(() => {
    if (!objects.some((object) => object.id === activeId)) {
      setActiveId(objects[0]?.id ?? "");
    }
  }, [activeId, objects]);

  const active = objects.find((object) => object.id === activeId) ?? null;

  const updateObjects = (next: readonly MotionSceneObject3D[]): void => {
    replaceLayer({ ...layer, objects: next });
  };

  const patchActive = (patch: Partial<MotionSceneObject3D>): void => {
    if (!active) return;
    updateObjects(
      objects.map((object) =>
        object.id === active.id ? { ...object, ...patch } : object,
      ),
    );
  };

  const patchActiveObject = (
    patch: Partial<MotionSceneObject3D["object"]>,
  ): void => {
    if (!active) return;
    patchActive({ object: { ...active.object, ...patch } });
  };

  const addObject = (): void => {
    const id = makeObjectId();
    updateObjects([
      ...objects,
      {
        id,
        name: `Object ${objects.length + 1}`,
        object: { kind: "rounded-box", size: 0.5 },
        material: { kind: "physical", color: "#10b981", metalness: 0.1, roughness: 0.4 },
        transform3d: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    ]);
    setActiveId(id);
  };

  const removeObject = (id: string): void => {
    updateObjects(objects.filter((object) => object.id !== id));
  };

  return (
    <>
      <Section title="Objects" keepOpenInAccordion>
        <div className="space-y-1">
          {objects.map((object) => (
            <div
              key={object.id}
              className={`flex items-center gap-2 rounded-[7px] border px-2 py-1.5 ${
                object.id === activeId
                  ? "border-accent bg-selected"
                  : "border-border bg-bg-1 hover:bg-bg-2"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveId(object.id)}
                className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-fg-2"
              >
                {object.name ?? object.object.kind}
              </button>
              <button
                type="button"
                aria-label={`Remove ${object.name ?? "object"}`}
                onClick={() => removeObject(object.id)}
                className="shrink-0 text-fg-muted hover:text-status-error"
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-label="Add object"
          onClick={addObject}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-border-strong py-2 text-[12px] font-medium text-fg-2 hover:text-accent hover:border-accent"
        >
          <Plus size={13} aria-hidden /> Add object
        </button>
      </Section>

      {active ? (
        <Section title="Geometry" keepOpenInAccordion>
          <Field label="Kind">
            <SelectInput
              value={active.object.kind}
              options={KIND_OPTIONS}
              onChange={(value) =>
                patchActiveObject({ kind: value as MotionObject3DKind })
              }
            />
          </Field>
          <Field label="Size">
            <NumberInput
              value={active.object.size ?? 0.5}
              min={0.05}
              max={2}
              step={0.05}
              onChange={(value) => patchActiveObject({ size: value })}
            />
          </Field>
          {active.object.kind === "model" ? (
            <Field label="Model URL (.glb / .gltf)">
              <TextInput
                value={active.object.modelUrl ?? ""}
                onChange={(value) => patchActiveObject({ modelUrl: value })}
                placeholder="https://…/model.glb"
              />
            </Field>
          ) : null}
          {active.object.kind === "text3d" ? (
            <Field label="Text">
              <TextInput
                value={active.object.text ?? ""}
                onChange={(value) => patchActiveObject({ text: value })}
                placeholder="3D"
              />
            </Field>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}
```

Wire into `PropertiesPanel.tsx` scene3d branch (~l.1094). Import at top:
```ts
import { Scene3DInspector } from "./inspector/Scene3DInspector";
```
Inside `selectedLayer.type === "scene3d" ? (` render `<Scene3DInspector layer={selectedLayer} replaceLayer={replaceLayer} />` immediately before the existing `<Section title="Lighting & Environment">`. (Use `replaceLayer` from PropertiesPanel l.411; it accepts `MotionLayer`, and `MotionScene3DLayer` is assignable.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/motion/components/inspector/Scene3DInspector.test.tsx`
Expected: PASS. (SelectInput renders a native `<select aria-label="Kind">` — the test's `getByLabelText(/geometry kind/i)` must match; if SelectInput's aria-label is just the field label "Kind", change the test query to `getByLabelText("Kind")`.)

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/web && npx tsc --noEmit --ignoreDeprecations 6.0 -p tsconfig.json 2>&1 | grep -c "error TS"` → `0`

```bash
git add apps/web/src/motion/components/inspector/Scene3DInspector.tsx apps/web/src/motion/components/inspector/Scene3DInspector.test.tsx apps/web/src/motion/components/PropertiesPanel.tsx
git commit -m "feat(motion): 3D inspector Objects + Geometry sections"
```

---

### Task 4: `Scene3DInspector` — Material, Transform, Camera sections

**Files:**
- Modify: `apps/web/src/motion/components/inspector/Scene3DInspector.tsx`
- Modify: `apps/web/src/motion/components/inspector/Scene3DInspector.test.tsx`

**Interfaces:**
- Consumes: `ColorInput`, `Slider` from `../primitives`; types `MotionMaterial3D`, `MotionSceneVector3`, `MotionScene3DCamera`.
- Produces: editing material color / metalness / roughness, an object's transform vectors, and the scene camera FOV all call `replaceLayer` with the patched layer.

- [ ] **Step 1: Extend the test (failing)**

```tsx
  it("edits material color, transform, and camera fov", () => {
    const replaceLayer = vi.fn();
    render(<Scene3DInspector layer={baseLayer} replaceLayer={replaceLayer} />);

    fireEvent.change(screen.getByLabelText(/material color/i), { target: { value: "#ff0000" } });
    expect((replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer).objects?.[0].material?.color).toBe("#ff0000");

    fireEvent.change(screen.getByLabelText(/camera fov/i), { target: { value: "50" } });
    expect((replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer).camera?.fov).toBe(50);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/motion/components/inspector/Scene3DInspector.test.tsx`
Expected: FAIL — no material color / camera fov controls.

- [ ] **Step 3: Add the sections**

Add imports `ColorInput, Slider` to the existing primitives import. Add a vector-row helper and the three sections. Insert the Material + Transform sections inside the `{active ? (...)}` block (after Geometry), and the Camera section after that block:

```tsx
import {
  ColorInput,
  Field,
  NumberInput,
  Section,
  SelectInput,
  Slider,
  TextInput,
} from "../primitives";
import type { MotionSceneVector3, MotionScene3DCamera } from "@openreel/core";
```

```tsx
function Vector3Row({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  value: MotionSceneVector3 | undefined;
  onChange: (next: MotionSceneVector3) => void;
  step?: number;
}): JSX.Element {
  const vec = value ?? { x: 0, y: 0, z: 0 };
  return (
    <Field label={label}>
      <div className="grid grid-cols-3 gap-1.5">
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberInput
            key={axis}
            value={vec[axis]}
            step={step}
            onChange={(n) => onChange({ ...vec, [axis]: n })}
          />
        ))}
      </div>
    </Field>
  );
}
```

Material section (inside `{active ? …}`, after Geometry):
```tsx
        <Section title="Material">
          <Field label="Color">
            <ColorInput
              value={active.material?.color ?? "#10b981"}
              onChange={(value) =>
                patchActive({ material: { ...active.material, color: value } })
              }
            />
          </Field>
          <Field label="Metalness">
            <Slider
              value={active.material?.metalness ?? 0.1}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                patchActive({ material: { ...active.material, metalness: value } })
              }
            />
          </Field>
          <Field label="Roughness">
            <Slider
              value={active.material?.roughness ?? 0.4}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                patchActive({ material: { ...active.material, roughness: value } })
              }
            />
          </Field>
          <Field label="Opacity">
            <Slider
              value={active.material?.opacity ?? 1}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                patchActive({ material: { ...active.material, opacity: value } })
              }
            />
          </Field>
        </Section>

        <Section title="Transform">
          <Vector3Row
            label="Position"
            value={active.transform3d?.position}
            onChange={(next) =>
              patchActive({ transform3d: { ...active.transform3d, position: next } })
            }
          />
          <Vector3Row
            label="Rotation"
            value={active.transform3d?.rotation}
            step={1}
            onChange={(next) =>
              patchActive({ transform3d: { ...active.transform3d, rotation: next } })
            }
          />
          <Vector3Row
            label="Scale"
            value={active.transform3d?.scale}
            step={0.05}
            onChange={(next) =>
              patchActive({ transform3d: { ...active.transform3d, scale: next } })
            }
          />
        </Section>
```

Camera section (after the `{active ? …}` block, always shown):
```tsx
      <Section title="Camera">
        <Field label="FOV">
          <NumberInput
            value={layer.camera?.fov ?? 35}
            min={10}
            max={120}
            step={1}
            onChange={(value) =>
              replaceLayer({ ...layer, camera: { ...layer.camera, fov: value } })
            }
          />
        </Field>
        <Vector3Row
          label="Position"
          value={layer.camera?.position}
          onChange={(next) =>
            replaceLayer({ ...layer, camera: { ...layer.camera, position: next } })
          }
        />
        <Vector3Row
          label="Target"
          value={layer.camera?.target}
          onChange={(next) =>
            replaceLayer({ ...layer, camera: { ...layer.camera, target: next } })
          }
        />
      </Section>
```

Note: `ColorInput` renders an input labelled by its `Field` ("Color"); the test queries `/material color/i`. If `ColorInput`'s accessible name is just "Color", set the test query to match the actual label, or give the Material color `Field` the label "Material color". Likewise FOV `Field` label "Camera FOV" so `getByLabelText(/camera fov/i)` matches — name the fields "Material color" and "Camera FOV" to satisfy the queries.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/motion/components/inspector/Scene3DInspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/web && npx tsc --noEmit --ignoreDeprecations 6.0 -p tsconfig.json 2>&1 | grep -c "error TS"` → `0`

```bash
git add apps/web/src/motion/components/inspector/Scene3DInspector.tsx apps/web/src/motion/components/inspector/Scene3DInspector.test.tsx
git commit -m "feat(motion): 3D inspector Material, Transform, Camera sections"
```

---

### Task 5: Integration verification

**Files:** none (verification gate).

- [ ] **Step 1: Full typecheck + lint**

Run: `cd apps/web && npx tsc --noEmit --ignoreDeprecations 6.0 -p tsconfig.json 2>&1 | grep -c "error TS"` → `0`
Run: `npx eslint src/motion/motion-layer-factory.ts src/motion/components/MotionToolRail.tsx src/motion/components/inspector/Scene3DInspector.tsx src/motion/components/PropertiesPanel.tsx --quiet` → no errors.

- [ ] **Step 2: Motion test suite (no regressions)**

Run: `cd apps/web && npx vitest run src/motion 2>&1 | tail -3`
Expected: the 3 new test files pass; pre-existing `PropertiesPanel.scene3d.test.tsx` failures (the `"sunset"` vs `"Sunset"` case bug) remain unchanged — no NEW failures.

- [ ] **Step 3: Visual check (dev server, both themes)**

With `pnpm dev` running, open `/#/motion`, Add → "3D scene". Verify: a 3D object renders in the viewport; the inspector shows Objects/Geometry/Material/Transform/Camera/Lighting; adding a second object renders it; changing kind/color/position/FOV updates the viewport; works in light and dark themes. (Drive via Playwright at 1536×1024 as in prior passes.)

- [ ] **Step 4: Commit any fixups**

```bash
git add -A && git commit -m "test(motion): verify 3D scene authoring end-to-end"
```

---

## Self-Review

- **Spec coverage:** Create path → Task 1 + 2. Inspector Objects/Geometry/Material/Transform/Camera → Tasks 3 + 4. Lighting kept → Task 3 wiring (renders Scene3DInspector above existing Lighting section). State via `replaceLayer`/immutable `objects[]` → Tasks 3/4 (chose local `activeId` over a store field — YAGNI, nothing else reads it; deviation from spec noted). Animation via existing keyframes / per-object out → respected (no per-object keyframe UI). Out-of-scope items absent. ✓
- **Placeholders:** none — every code step is complete; the only conditionals are real ("if the Add-menu aria-label differs, match the real one"), grounded in reading the file. ✓
- **Type consistency:** `createMotionScene3DLayer`, `MotionScene3DLayer`, `MotionSceneObject3D` (`object`/`material`/`transform3d`), `MotionMaterial3D` (`color`/`metalness`/`roughness`/`opacity`), `MotionScene3DCamera` (`fov`/`position`/`target`), `MOTION_OBJECT_3D_KINDS`, `MotionObject3DKind` all match `packages/core/src/motion/types.ts` and `motion-scene3d.ts`. `Scene3DInspectorProps`/`updateObjects`/`patchActive` consistent across Tasks 3–4. ✓
