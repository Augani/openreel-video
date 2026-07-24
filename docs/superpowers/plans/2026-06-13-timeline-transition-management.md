# Timeline Transition Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a clickable chip on each clip-to-clip cut that has a transition, so web/desktop users can see, select, edit, and remove transitions directly on the timeline.

**Architecture:** A pure geometry helper resolves a track's transitions into positioned handles (only where both clips exist and abut). `TrackLane` renders a small `TransitionHandle` chip per handle, centered on the cut and floated above the clips. Clicking a chip selects the transition via a new `"transition"` selection type; the existing `InspectorPanel` then renders the already-built `TransitionInspector` for editing/removal. Delete/Backspace removes a selected transition. No render-engine or data-model changes — the crossfade already blends both clips.

**Tech Stack:** React + TypeScript, Zustand stores, Vitest + @testing-library/react, Tailwind, lucide-react icons. Web code is shared by the Electron desktop build, so this covers both.

---

### Task 1: Add `"transition"` selection type

**Files:**
- Modify: `apps/web/src/stores/ui-store.ts:14-22`
- Test: `apps/web/src/stores/ui-store.transition-selection.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/stores/ui-store.transition-selection.test.ts`:

```ts
import "../test/install-local-storage-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "./ui-store";

describe("ui-store transition selection", () => {
  beforeEach(() => {
    useUIStore.getState().clearSelection();
  });

  it("selects a transition item", () => {
    useUIStore.getState().select({
      type: "transition",
      id: "tr-1",
      trackId: "track-1",
    });
    const items = useUIStore.getState().selectedItems;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "transition", id: "tr-1" });
  });

  it("excludes transitions from getSelectedClipIds", () => {
    useUIStore.getState().select({ type: "transition", id: "tr-1" });
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openreel/web test:run src/stores/ui-store.transition-selection.test.ts`
Expected: FAIL — TypeScript rejects `type: "transition"` because it is not in `SelectionType`.

- [ ] **Step 3: Add the type member**

In `apps/web/src/stores/ui-store.ts`, change the `SelectionType` union (lines 14-22) to include `"transition"`:

```ts
export type SelectionType =
  | "clip"
  | "track"
  | "effect"
  | "keyframe"
  | "marker"
  | "text-clip"
  | "shape-clip"
  | "subtitle"
  | "transition";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openreel/web test:run src/stores/ui-store.transition-selection.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/ui-store.ts apps/web/src/stores/ui-store.transition-selection.test.ts
git commit -m "feat(web): add transition selection type"
```

---

### Task 2: Pure helper to resolve transition handles

**Files:**
- Create: `apps/web/src/components/editor/timeline/transition-handles.ts`
- Test: `apps/web/src/components/editor/timeline/transition-handles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/editor/timeline/transition-handles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Clip, Track, Transition } from "@openreel/core";
import {
  resolveTransitionHandles,
  TRANSITION_ADJACENCY_TOLERANCE,
} from "./transition-handles";

function clip(id: string, startTime: number, duration: number): Clip {
  return { id, startTime, duration } as unknown as Clip;
}

function transition(id: string, clipAId: string, clipBId: string): Transition {
  return {
    id,
    clipAId,
    clipBId,
    type: "crossfade",
    duration: 1,
    params: {},
  } as Transition;
}

function track(clips: Clip[], transitions: Transition[]): Track {
  return { id: "t1", clips, transitions } as unknown as Track;
}

describe("resolveTransitionHandles", () => {
  it("resolves a handle centered on the cut for an adjacent pair", () => {
    const a = clip("a", 0, 2);
    const b = clip("b", 2, 3);
    const result = resolveTransitionHandles(
      track([a, b], [transition("tr", "a", "b")]),
      50,
    );
    expect(result).toHaveLength(1);
    expect(result[0].transition.id).toBe("tr");
    expect(result[0].clipA.id).toBe("a");
    expect(result[0].clipB.id).toBe("b");
    expect(result[0].centerX).toBe(100); // b.startTime(2) * 50
  });

  it("skips a transition whose clips are not adjacent", () => {
    const a = clip("a", 0, 2);
    const b = clip("b", 5, 3); // 3s gap
    const result = resolveTransitionHandles(
      track([a, b], [transition("tr", "a", "b")]),
      50,
    );
    expect(result).toEqual([]);
  });

  it("skips a transition referencing a missing clip", () => {
    const a = clip("a", 0, 2);
    const result = resolveTransitionHandles(
      track([a], [transition("tr", "a", "ghost")]),
      50,
    );
    expect(result).toEqual([]);
  });

  it("treats sub-tolerance gaps as adjacent", () => {
    const a = clip("a", 0, 2);
    const b = clip("b", 2 + TRANSITION_ADJACENCY_TOLERANCE / 2, 3);
    const result = resolveTransitionHandles(
      track([a, b], [transition("tr", "a", "b")]),
      50,
    );
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openreel/web test:run src/components/editor/timeline/transition-handles.test.ts`
Expected: FAIL — `Cannot find module './transition-handles'`.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/components/editor/timeline/transition-handles.ts`:

```ts
import type { Clip, Track, Transition } from "@openreel/core";

export const TRANSITION_ADJACENCY_TOLERANCE = 0.05;

export interface ResolvedTransitionHandle {
  transition: Transition;
  clipA: Clip;
  clipB: Clip;
  centerX: number;
}

export function resolveTransitionHandles(
  track: Track,
  pixelsPerSecond: number,
): ResolvedTransitionHandle[] {
  const clipsById = new Map(track.clips.map((clip) => [clip.id, clip]));
  const handles: ResolvedTransitionHandle[] = [];

  for (const transition of track.transitions) {
    const clipA = clipsById.get(transition.clipAId);
    const clipB = clipsById.get(transition.clipBId);
    if (!clipA || !clipB) continue;

    const gap = Math.abs(clipB.startTime - (clipA.startTime + clipA.duration));
    if (gap > TRANSITION_ADJACENCY_TOLERANCE) continue;

    handles.push({
      transition,
      clipA,
      clipB,
      centerX: clipB.startTime * pixelsPerSecond,
    });
  }

  return handles;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openreel/web test:run src/components/editor/timeline/transition-handles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/timeline/transition-handles.ts apps/web/src/components/editor/timeline/transition-handles.test.ts
git commit -m "feat(web): add transition handle resolver"
```

---

### Task 3: TransitionHandle chip component

**Files:**
- Create: `apps/web/src/components/editor/timeline/TransitionHandle.tsx`
- Modify: `apps/web/src/components/editor/timeline/index.ts:1-12`
- Test: `apps/web/src/components/editor/timeline/TransitionHandle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/editor/timeline/TransitionHandle.test.tsx`:

```tsx
import "../../../test/install-local-storage-mock";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Clip, Transition } from "@openreel/core";
import { TransitionHandle } from "./TransitionHandle";
import type { ResolvedTransitionHandle } from "./transition-handles";

function makeHandle(): ResolvedTransitionHandle {
  return {
    transition: {
      id: "tr-1",
      clipAId: "a",
      clipBId: "b",
      type: "crossfade",
      duration: 1.5,
      params: {},
    } as Transition,
    clipA: { id: "a", startTime: 0, duration: 2 } as unknown as Clip,
    clipB: { id: "b", startTime: 2, duration: 2 } as unknown as Clip,
    centerX: 100,
  };
}

describe("TransitionHandle", () => {
  it("renders a labeled button positioned on the cut", () => {
    render(
      <TransitionHandle
        handle={makeHandle()}
        trackId="track-1"
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: /crossfade/i });
    expect(button).toBeTruthy();
    expect(button.getAttribute("title")).toContain("1.5s");
  });

  it("calls onSelect with transition id and track id on click", () => {
    const onSelect = vi.fn();
    render(
      <TransitionHandle
        handle={makeHandle()}
        trackId="track-1"
        isSelected={false}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /crossfade/i }));
    expect(onSelect).toHaveBeenCalledWith("tr-1", "track-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openreel/web test:run src/components/editor/timeline/TransitionHandle.test.tsx`
Expected: FAIL — `Cannot find module './TransitionHandle'`.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/editor/timeline/TransitionHandle.tsx`:

```tsx
import React, { useCallback } from "react";
import { Shuffle } from "lucide-react";
import type { ResolvedTransitionHandle } from "./transition-handles";

const HIT_AREA = 36;
const CHIP_SIZE = 22;

interface TransitionHandleProps {
  handle: ResolvedTransitionHandle;
  trackId: string;
  isSelected: boolean;
  onSelect: (transitionId: string, trackId: string) => void;
}

export const TransitionHandle: React.FC<TransitionHandleProps> = ({
  handle,
  trackId,
  isSelected,
  onSelect,
}) => {
  const { transition, centerX } = handle;
  const label = `${transition.type} · ${transition.duration.toFixed(1)}s`;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(transition.id, trackId);
    },
    [transition.id, trackId, onSelect],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className="absolute top-0 bottom-0 z-30 flex items-center justify-center cursor-pointer"
      style={{ left: centerX - HIT_AREA / 2, width: HIT_AREA }}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      title={label}
      role="button"
      aria-label={`Edit transition: ${label}`}
      data-transition-id={transition.id}
    >
      <div
        className={`flex items-center justify-center rounded-md border shadow-sm transition-colors ${
          isSelected
            ? "bg-primary border-white text-white ring-2 ring-primary/60"
            : "bg-primary/90 border-white/80 text-white hover:bg-primary"
        }`}
        style={{ width: CHIP_SIZE, height: CHIP_SIZE }}
      >
        <Shuffle size={13} />
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Export from the barrel**

In `apps/web/src/components/editor/timeline/index.ts`, add after the existing exports (line 11/12):

```ts
export { TransitionHandle } from "./TransitionHandle";
export {
  resolveTransitionHandles,
  TRANSITION_ADJACENCY_TOLERANCE,
} from "./transition-handles";
export type { ResolvedTransitionHandle } from "./transition-handles";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openreel/web test:run src/components/editor/timeline/TransitionHandle.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/editor/timeline/TransitionHandle.tsx apps/web/src/components/editor/timeline/TransitionHandle.test.tsx apps/web/src/components/editor/timeline/index.ts
git commit -m "feat(web): add transition chip component"
```

---

### Task 4: Render chips in TrackLane

**Files:**
- Modify: `apps/web/src/components/editor/timeline/TrackLane.tsx` (imports ~9-13, props 21-61 + 63-87, render ~241-289)

- [ ] **Step 1: Add the imports**

In `apps/web/src/components/editor/timeline/TrackLane.tsx`, after the existing component imports (after line 12 `import { KeyframeTrack } from "./KeyframeTrack";`), add:

```ts
import { TransitionHandle } from "./TransitionHandle";
import { resolveTransitionHandles } from "./transition-handles";
```

- [ ] **Step 2: Add the two new props to the interface**

In `TrackLaneProps` (interface ending at line 61), add after `selectedKeyframeIds?: string[];`:

```ts
  onSelectTransition: (transitionId: string, trackId: string) => void;
  selectedTransitionId?: string | null;
```

- [ ] **Step 3: Destructure the new props**

In the component parameter list (lines 63-87), add after `selectedKeyframeIds = [],`:

```ts
  onSelectTransition,
  selectedTransitionId = null,
```

- [ ] **Step 4: Compute the handles (memoized)**

Inside the component body, after `const clipsWithKeyframes = useMemo(...)` (ends line 99), add:

```ts
  const transitionHandles = useMemo(
    () => resolveTransitionHandles(track, pixelsPerSecond),
    [track, pixelsPerSecond],
  );
```

- [ ] **Step 5: Render the chips inside the lane**

In `TrackLane.tsx`, inside the lane `<div>` that has `onDrop={handleDrop}`, immediately after the `shapeClips.map(...)` block closes (the `))}` ending the shape clips list, before the `{isDragOver && (` overlay at line 282), insert:

```tsx
        {transitionHandles.map((handle) => (
          <TransitionHandle
            key={handle.transition.id}
            handle={handle}
            trackId={track.id}
            isSelected={selectedTransitionId === handle.transition.id}
            onSelect={onSelectTransition}
          />
        ))}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS for `TrackLane.tsx` (it will report a missing-prop error at the `<TrackLane>` call site in `Timeline.tsx` because `onSelectTransition` is required — that is fixed in Task 5; if you want a clean run now, complete Task 5 before typechecking).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor/timeline/TrackLane.tsx
git commit -m "feat(web): render transition chips in track lane"
```

---

### Task 5: Wire selection through Timeline

**Files:**
- Modify: `apps/web/src/components/editor/Timeline.tsx` (useUIStore destructure ~112, add handler ~314, TrackLane props 1156-1187)

- [ ] **Step 1: Pull `selectedItems` from the UI store**

In `apps/web/src/components/editor/Timeline.tsx`, find the `useUIStore()` destructure that ends at line 112 (it already includes `select`). Add `selectedItems` to that destructure list, e.g.:

```ts
    select,
    selectedItems,
```

- [ ] **Step 2: Add the selection handler and derive the selected id**

After `handleSelectClip` (the `useCallback` ending at line 314), add:

```ts
  const handleSelectTransition = useCallback(
    (transitionId: string, trackId: string) => {
      select({ type: "transition", id: transitionId, trackId });
    },
    [select],
  );

  const selectedTransitionId =
    selectedItems.find((item) => item.type === "transition")?.id ?? null;
```

- [ ] **Step 3: Pass the new props to TrackLane**

In the `<TrackLane ... />` JSX (lines 1156-1187), add after `selectedKeyframeIds={selectedKeyframeIds}`:

```tsx
                  onSelectTransition={handleSelectTransition}
                  selectedTransitionId={selectedTransitionId}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS (no missing-prop errors; `selectedItems` and the new props resolve).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/Timeline.tsx
git commit -m "feat(web): select transition from timeline chip"
```

---

### Task 6: Show the transition editor in the Inspector

**Files:**
- Modify: `apps/web/src/components/editor/InspectorPanel.tsx` (imports ~59, store destructure 77-89, derive after 138, render branch ~952)

- [ ] **Step 1: Add imports**

In `apps/web/src/components/editor/InspectorPanel.tsx`, after `import { AiTab } from "./inspector/tabs/AiTab";` (line 59), add:

```ts
import { TransitionInspector } from "./inspector/TransitionInspector";
import { Shuffle } from "lucide-react";
```

(If `lucide-react` is already imported elsewhere in the file, add `Shuffle` to that existing import instead of a second import line.)

- [ ] **Step 2: Destructure the transition store actions**

In the `useProjectStore()` destructure (lines 77-87), add three entries alongside `getClip`:

```ts
    getClip,
    getClipTransition,
    updateClipTransition,
    removeClipTransition,
```

And add `clearSelection` to the `useUIStore()` destructure at line 89:

```ts
  const { getSelectedClipIds, clearSelection } = useUIStore();
```

- [ ] **Step 3: Derive the selected transition and its clips**

After the `selectedSubtitle` memo (ends line 138), add:

```ts
  const selectedTransitionId = useMemo(() => {
    return selectedItems.find((item) => item.type === "transition")?.id ?? null;
  }, [selectedItems]);

  const selectedTransition = useMemo(() => {
    if (!selectedTransitionId) return null;
    return getClipTransition(selectedTransitionId) ?? null;
  }, [selectedTransitionId, getClipTransition, project.modifiedAt]);

  const transitionClipA = useMemo(
    () => (selectedTransition ? getClip(selectedTransition.clipAId) ?? null : null),
    [selectedTransition, getClip, project.modifiedAt],
  );
  const transitionClipB = useMemo(
    () => (selectedTransition ? getClip(selectedTransition.clipBId) ?? null : null),
    [selectedTransition, getClip, project.modifiedAt],
  );
```

- [ ] **Step 4: Add the render branch**

In the render, the chain is `selectedClip ? (...) : selectedSubtitle ? (...) : (...)` (the `selectedSubtitle` branch starts at line 952 with `) : selectedSubtitle ? (`). Insert a transition branch **before** the `selectedSubtitle` branch. Change:

```tsx
          </InspectorTabErrorBoundary>
        ) : selectedSubtitle ? (
```

to:

```tsx
          </InspectorTabErrorBoundary>
        ) : selectedTransition && transitionClipA && transitionClipB ? (
          <div className="space-y-3">
            <div className="p-3 bg-primary/10 rounded-lg border border-primary/30">
              <div className="flex items-center gap-2">
                <Shuffle size={14} className="text-primary" />
                <span className="text-xs font-medium text-text-primary">
                  Transition
                </span>
              </div>
              <p className="text-[10px] text-text-muted mt-1">
                Between two clips · centered on the cut
              </p>
            </div>
            <TransitionInspector
              clipA={transitionClipA}
              clipB={transitionClipB}
              transition={selectedTransition}
              onTransitionUpdate={(id, updates) =>
                updateClipTransition(id, updates)
              }
              onTransitionRemove={(id) => {
                void removeClipTransition(id);
                clearSelection();
              }}
            />
          </div>
        ) : selectedSubtitle ? (
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS. `TransitionInspector` props match (`clipA`, `clipB`, `transition`, `onTransitionUpdate`, `onTransitionRemove`); `getClip` returns `Clip | undefined`; `getClipTransition` returns `Transition | undefined`.

- [ ] **Step 6: Run the inspector test suite to confirm no regressions**

Run: `pnpm --filter @openreel/web test:run src/components/editor/InspectorPanel.tabs.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor/InspectorPanel.tsx
git commit -m "feat(web): edit selected transition in inspector"
```

---

### Task 7: Delete a selected transition with Delete/Backspace

**Files:**
- Modify: `apps/web/src/hooks/useKeyboardShortcuts.ts:160-164`

- [ ] **Step 1: Extend the delete handler**

In `apps/web/src/hooks/useKeyboardShortcuts.ts`, replace the existing `handleDelete` (lines 160-164):

```ts
  const handleDelete = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    selectedIds.forEach((id) => removeClip(id));
    clearSelection();
  }, [getSelectedClipIds, removeClip, clearSelection]);
```

with:

```ts
  const handleDelete = useCallback(() => {
    const transitionItems = useUIStore
      .getState()
      .selectedItems.filter((item) => item.type === "transition");
    if (transitionItems.length > 0) {
      const { removeClipTransition } = useProjectStore.getState();
      transitionItems.forEach((item) => {
        void removeClipTransition(item.id);
      });
      clearSelection();
      return;
    }
    const selectedIds = getSelectedClipIds();
    selectedIds.forEach((id) => removeClip(id));
    clearSelection();
  }, [getSelectedClipIds, removeClip, clearSelection]);
```

(`useUIStore` and `useProjectStore` are already imported at the top of the file, lines 6-7.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useKeyboardShortcuts.ts
git commit -m "feat(web): delete selected transition with delete key"
```

---

### Task 8: Full verification and manual check

**Files:** none (verification only)

- [ ] **Step 1: Run the full web test suite**

Run: `pnpm --filter @openreel/web test:run`
Expected: PASS (including the three new test files).

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/web lint`
Expected: No errors. Fix any new warnings introduced by this change.

- [ ] **Step 3: Manual check in the dev server**

Run: `pnpm dev`
Then in the browser at http://localhost:5173:
1. Add two adjacent video clips on the same track.
2. Drag a crossfade from the Transitions panel onto the boundary (existing add flow).
3. Confirm a chip appears centered on the cut, straddling both clips.
4. Click the chip → the right Inspector shows the transition editor (type grid, duration slider).
5. Change the type and duration; confirm playback reflects the change.
6. Press Delete while the chip is selected → the chip and transition disappear.
7. Re-add, then use the Inspector's Remove button → confirm removal.
8. Move one clip away so the pair is no longer adjacent → confirm the chip disappears.

- [ ] **Step 4: Final commit (if lint/typecheck fixes were needed)**

```bash
git add -A
git commit -m "chore(web): finalize timeline transition management"
```

---

## Self-Review notes

- **Spec coverage:** chip on the cut straddling clips (Tasks 2-4); chip only where a transition exists (Task 2 resolver — iterates `track.transitions`, not clip pairs); click → select → Inspector edit (Tasks 1, 5, 6); remove via Inspector + Delete key (Tasks 6, 7); render guard for non-adjacent/missing clips (Task 2); no render/data-model changes (none touched). All spec sections map to a task.
- **Type consistency:** `resolveTransitionHandles(track, pixelsPerSecond) → ResolvedTransitionHandle[]`; `ResolvedTransitionHandle` is the same shape used by `TransitionHandle` and exported from the barrel. `TransitionInspector` is invoked with exactly its declared props (`clipA`, `clipB`, `transition`, `onTransitionUpdate`, `onTransitionRemove`). `onSelectTransition(transitionId, trackId)` signature is identical in `TransitionHandle`, `TrackLane`, and `Timeline`.
- **No placeholders:** every code step contains complete code; commands include expected output.
- **Known minor tradeoff:** the 36px chip hit area straddles the seam and overlaps the inner edge of each clip's trim handle (~18px each side); chip `z-30` wins over trim handles `z-20`. Acceptable for v1; revisit if users report trimming-at-the-seam difficulty.
