# Inspector Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the openreel inspector's scroll-anchor "tabs" with real isolated tabs (clicking a tab shows only that tab's controls), adapt the tab set to clip type, and keep every existing section — delivered as a low-risk in-place change.

**Architecture:** Phase A converts `InspectorPanel.tsx` to real tabs **in place**: a new `ui-store.inspectorActiveTab`, a `clip-tabs.config` mapping clip type → ordered tabs, a presentational `InspectorTabs` strip + `InspectorClipHeader`, an `InspectorTabPanel` gate + error boundary, and slider ergonomics on the shared `LabeledSlider`. Existing section components and all their store wiring are reused untouched — each rendered block is simply gated to its assigned tab. Phase B (separate follow-up plan) mechanically extracts each tab's body into `tabs/*Tab.tsx` to slim the file.

**Tech Stack:** React 18, TypeScript (strict), Zustand (`persist` + `subscribeWithSelector`), Tailwind, Radix-based `@openreel/ui`, lucide-react, Vitest + @testing-library/react.

---

## File Structure

New files (Phase A):
- `apps/web/src/components/editor/inspector/clip-tabs.config.ts` — tab ids, defs (icon+label), clipType→tabs mapping. One responsibility: the taxonomy.
- `apps/web/src/components/editor/inspector/shell/InspectorTabs.tsx` — presentational tab strip (no store access).
- `apps/web/src/components/editor/inspector/shell/InspectorClipHeader.tsx` — presentational header (name/duration/type).
- `apps/web/src/components/editor/inspector/shell/InspectorTabPanel.tsx` — gate: render children only when active.
- `apps/web/src/components/editor/inspector/shell/InspectorTabErrorBoundary.tsx` — isolates a failing tab body.
- Tests alongside each new file.

Modified files (Phase A):
- `apps/web/src/stores/ui-store.ts` — add `inspectorActiveTab` + setter.
- `packages/ui/src/components/labeled-slider.tsx` — add `defaultValue` + editable/reset pill.
- `apps/web/src/components/editor/InspectorPanel.tsx` — swap shell, gate blocks by tab.

Deferred to Phase B (separate plan): `inspector/ClipInspector.tsx`, `inspector/tabs/*Tab.tsx`, `shell/InspectorGroup.tsx`, slimming `InspectorPanel.tsx` to a thin router.

---

## Task 1: ui-store — `inspectorActiveTab` state

**Files:**
- Modify: `apps/web/src/stores/ui-store.ts` (interface `UIState` ~line 60-144; initial state ~194-251)
- Test: `apps/web/src/stores/ui-store.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "./ui-store";

describe("ui-store inspectorActiveTab", () => {
  beforeEach(() => {
    useUIStore.setState({ inspectorActiveTab: "transform" });
  });

  it("defaults to transform", () => {
    expect(useUIStore.getState().inspectorActiveTab).toBe("transform");
  });

  it("setInspectorActiveTab updates the value", () => {
    useUIStore.getState().setInspectorActiveTab("color");
    expect(useUIStore.getState().inspectorActiveTab).toBe("color");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openreel/web test:run -- ui-store.test.ts`
Expected: FAIL — `setInspectorActiveTab is not a function` / `inspectorActiveTab` undefined.

- [ ] **Step 3: Add state + setter to the store**

In `UIState` interface, after `keyframeEditorOpen: boolean;` (line ~90) add:

```ts
  inspectorActiveTab: string;
```

In the same interface, after `toggleKeyframeEditor: () => void;` (line ~131) add:

```ts
  setInspectorActiveTab: (tabId: string) => void;
```

In the store initializer, after `keyframeEditorOpen: false,` (line ~227) add:

```ts
        inspectorActiveTab: "transform",
```

After the `setKeyframeEditorOpen` / `toggleKeyframeEditor` setters, add:

```ts
        setInspectorActiveTab: (tabId: string) => set({ inspectorActiveTab: tabId }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openreel/web test:run -- ui-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/ui-store.ts apps/web/src/stores/ui-store.test.ts
git commit -m "feat(inspector): add inspectorActiveTab to ui-store"
```

---

## Task 2: clip-tabs.config — taxonomy

**Files:**
- Create: `apps/web/src/components/editor/inspector/clip-tabs.config.ts`
- Test: `apps/web/src/components/editor/inspector/clip-tabs.config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { getTabIdsForClipType, getTabsForClipType, TAB_DEFS } from "./clip-tabs.config";

describe("clip-tabs.config", () => {
  it("video has all 7 media tabs in workflow order", () => {
    expect(getTabIdsForClipType("video")).toEqual([
      "transform", "color", "effects", "audio", "speed", "animate", "ai",
    ]);
  });

  it("image drops audio and speed", () => {
    expect(getTabIdsForClipType("image")).toEqual([
      "transform", "color", "effects", "animate", "ai",
    ]);
  });

  it("audio clip shows only audio and speed", () => {
    expect(getTabIdsForClipType("audio")).toEqual(["audio", "speed"]);
  });

  it("text/shape/svg/sticker share transform/style/animate/ai", () => {
    for (const t of ["text", "shape", "svg", "sticker"] as const) {
      expect(getTabIdsForClipType(t)).toEqual(["transform", "style", "animate", "ai"]);
    }
  });

  it("null clip type yields no tabs", () => {
    expect(getTabIdsForClipType(null)).toEqual([]);
    expect(getTabsForClipType(null)).toEqual([]);
  });

  it("getTabsForClipType returns defs with labels and icons", () => {
    const defs = getTabsForClipType("video");
    expect(defs[0]).toMatchObject({ id: "transform", label: "Transform" });
    expect(typeof defs[0].icon).toBe("object");
    expect(Object.keys(TAB_DEFS)).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openreel/web test:run -- clip-tabs.config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the config**

```ts
import type { LucideIcon } from "lucide-react";
import { Move, Palette, Wand2, Volume2, Gauge, Film, Sparkles, Type } from "lucide-react";

export type InspectorTabId =
  | "transform"
  | "color"
  | "effects"
  | "audio"
  | "speed"
  | "animate"
  | "ai"
  | "style";

export type InspectorClipType =
  | "video"
  | "image"
  | "audio"
  | "text"
  | "shape"
  | "svg"
  | "sticker";

export interface InspectorTabDef {
  id: InspectorTabId;
  label: string;
  icon: LucideIcon;
}

export const TAB_DEFS: Record<InspectorTabId, InspectorTabDef> = {
  transform: { id: "transform", label: "Transform", icon: Move },
  color: { id: "color", label: "Color", icon: Palette },
  effects: { id: "effects", label: "Effects", icon: Wand2 },
  audio: { id: "audio", label: "Audio", icon: Volume2 },
  speed: { id: "speed", label: "Speed", icon: Gauge },
  animate: { id: "animate", label: "Animate", icon: Film },
  ai: { id: "ai", label: "AI", icon: Sparkles },
  style: { id: "style", label: "Style", icon: Type },
};

const TABS_BY_CLIP_TYPE: Record<InspectorClipType, InspectorTabId[]> = {
  video: ["transform", "color", "effects", "audio", "speed", "animate", "ai"],
  image: ["transform", "color", "effects", "animate", "ai"],
  audio: ["audio", "speed"],
  text: ["transform", "style", "animate", "ai"],
  shape: ["transform", "style", "animate", "ai"],
  svg: ["transform", "style", "animate", "ai"],
  sticker: ["transform", "style", "animate", "ai"],
};

export function getTabIdsForClipType(
  clipType: InspectorClipType | null,
): InspectorTabId[] {
  if (!clipType) return [];
  return TABS_BY_CLIP_TYPE[clipType];
}

export function getTabsForClipType(
  clipType: InspectorClipType | null,
): InspectorTabDef[] {
  return getTabIdsForClipType(clipType).map((id) => TAB_DEFS[id]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openreel/web test:run -- clip-tabs.config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/inspector/clip-tabs.config.ts apps/web/src/components/editor/inspector/clip-tabs.config.test.ts
git commit -m "feat(inspector): add clip-tabs taxonomy config"
```

---

## Task 3: InspectorTabs strip

**Files:**
- Create: `apps/web/src/components/editor/inspector/shell/InspectorTabs.tsx`
- Test: `apps/web/src/components/editor/inspector/shell/InspectorTabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InspectorTabs } from "./InspectorTabs";
import { getTabsForClipType } from "../clip-tabs.config";

describe("InspectorTabs", () => {
  const tabs = getTabsForClipType("video");

  it("renders a tab button per def", () => {
    render(<InspectorTabs tabs={tabs} activeId="transform" onSelect={() => {}} />);
    expect(screen.getAllByRole("tab")).toHaveLength(tabs.length);
  });

  it("marks the active tab aria-selected", () => {
    render(<InspectorTabs tabs={tabs} activeId="color" onSelect={() => {}} />);
    expect(screen.getByRole("tab", { name: /Color/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Transform/ })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelect with the tab id on click", () => {
    const onSelect = vi.fn();
    render(<InspectorTabs tabs={tabs} activeId="transform" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: /Effects/ }));
    expect(onSelect).toHaveBeenCalledWith("effects");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openreel/web test:run -- InspectorTabs.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

```tsx
import * as React from "react";
import { cn } from "@openreel/ui/lib/utils";
import type { InspectorTabDef, InspectorTabId } from "../clip-tabs.config";

export interface InspectorTabsProps {
  tabs: InspectorTabDef[];
  activeId: InspectorTabId;
  onSelect: (id: InspectorTabId) => void;
}

export const InspectorTabs: React.FC<InspectorTabsProps> = ({ tabs, activeId, onSelect }) => {
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    if (next) onSelect(next.id);
  };

  return (
    <div
      role="tablist"
      aria-label="Inspector tabs"
      className="flex items-center gap-0.5 px-2 border-b border-border overflow-x-auto scrollbar-none shrink-0"
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-2 text-[12px] font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
              active
                ? "text-accent border-accent"
                : "text-fg-3 border-transparent hover:text-fg",
            )}
          >
            <Icon size={13} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openreel/web test:run -- InspectorTabs.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/inspector/shell/InspectorTabs.tsx apps/web/src/components/editor/inspector/shell/InspectorTabs.test.tsx
git commit -m "feat(inspector): add InspectorTabs strip component"
```

---

## Task 4: InspectorClipHeader + InspectorTabPanel

**Files:**
- Create: `apps/web/src/components/editor/inspector/shell/InspectorClipHeader.tsx`
- Create: `apps/web/src/components/editor/inspector/shell/InspectorTabPanel.tsx`
- Test: `apps/web/src/components/editor/inspector/shell/InspectorShell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InspectorClipHeader } from "./InspectorClipHeader";
import { InspectorTabPanel } from "./InspectorTabPanel";

describe("InspectorClipHeader", () => {
  it("renders name, duration and type", () => {
    render(<InspectorClipHeader name="Scenic Clip" durationSeconds={15} typeLabel="video" />);
    expect(screen.getByText("Scenic Clip")).toBeInTheDocument();
    expect(screen.getByText("15.00s")).toBeInTheDocument();
    expect(screen.getByText("video")).toBeInTheDocument();
  });
});

describe("InspectorTabPanel", () => {
  it("renders children only when active matches tab", () => {
    const { rerender } = render(
      <InspectorTabPanel tab="color" active="transform">body</InspectorTabPanel>,
    );
    expect(screen.queryByText("body")).toBeNull();
    rerender(<InspectorTabPanel tab="color" active="color">body</InspectorTabPanel>);
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openreel/web test:run -- InspectorShell.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create both components**

`InspectorClipHeader.tsx`:

```tsx
import * as React from "react";

export interface InspectorClipHeaderProps {
  name: string;
  durationSeconds: number;
  typeLabel: string;
}

export const InspectorClipHeader: React.FC<InspectorClipHeaderProps> = ({
  name,
  durationSeconds,
  typeLabel,
}) => (
  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0">
    <div className="min-w-0">
      <p className="text-[11.5px] text-fg font-medium truncate">{name}</p>
      <p className="text-[10px] text-fg-muted mt-0.5">{durationSeconds.toFixed(2)}s</p>
    </div>
    <span className="text-[10px] uppercase tracking-wide text-fg-3 bg-bg-2 border border-border rounded px-1.5 py-0.5 shrink-0">
      {typeLabel}
    </span>
  </div>
);
```

`InspectorTabPanel.tsx`:

```tsx
import * as React from "react";

export interface InspectorTabPanelProps {
  tab: string;
  active: string;
  children: React.ReactNode;
}

export const InspectorTabPanel: React.FC<InspectorTabPanelProps> = ({ tab, active, children }) =>
  active === tab ? <div role="tabpanel">{children}</div> : null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openreel/web test:run -- InspectorShell.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/inspector/shell/InspectorClipHeader.tsx apps/web/src/components/editor/inspector/shell/InspectorTabPanel.tsx apps/web/src/components/editor/inspector/shell/InspectorShell.test.tsx
git commit -m "feat(inspector): add clip header and tab panel gate"
```

---

## Task 5: InspectorTabErrorBoundary

**Files:**
- Create: `apps/web/src/components/editor/inspector/shell/InspectorTabErrorBoundary.tsx`
- Test: `apps/web/src/components/editor/inspector/shell/InspectorTabErrorBoundary.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InspectorTabErrorBoundary } from "./InspectorTabErrorBoundary";

function Boom(): JSX.Element {
  throw new Error("boom");
}

describe("InspectorTabErrorBoundary", () => {
  it("renders a fallback when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <InspectorTabErrorBoundary>
        <Boom />
      </InspectorTabErrorBoundary>,
    );
    expect(screen.getByText(/hit an error/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders children when they do not throw", () => {
    render(
      <InspectorTabErrorBoundary>
        <div>ok</div>
      </InspectorTabErrorBoundary>,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openreel/web test:run -- InspectorTabErrorBoundary.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the boundary**

```tsx
import * as React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class InspectorTabErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false });
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-center text-xs text-text-secondary">
          This panel hit an error. Switch tabs and back to retry.
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openreel/web test:run -- InspectorTabErrorBoundary.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/inspector/shell/InspectorTabErrorBoundary.tsx apps/web/src/components/editor/inspector/shell/InspectorTabErrorBoundary.test.tsx
git commit -m "feat(inspector): add tab error boundary"
```

---

## Task 6: LabeledSlider ergonomics (reset + type-to-edit)

**Files:**
- Modify: `packages/ui/src/components/labeled-slider.tsx:5-41`
- Test: `packages/ui/src/components/labeled-slider.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LabeledSlider } from "./labeled-slider";

describe("LabeledSlider ergonomics", () => {
  it("typing a value and pressing Enter commits the clamped number", () => {
    const onChange = vi.fn();
    render(<LabeledSlider label="Opacity" value={50} min={0} max={100} onChange={onChange} />);
    fireEvent.click(screen.getByText("50"));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it("double-clicking the value resets to defaultValue", () => {
    const onChange = vi.fn();
    render(
      <LabeledSlider label="Scale" value={20} min={0} max={100} defaultValue={100} onChange={onChange} />,
    );
    fireEvent.doubleClick(screen.getByText("20"));
    expect(onChange).toHaveBeenCalledWith(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openreel/ui test:run -- labeled-slider.test.tsx`
Expected: FAIL — no editable pill / no `defaultValue` handling.

- [ ] **Step 3: Update the component**

Replace `LabeledSliderProps` (lines 5-14) and the `LabeledSlider` body (lines 16-40) with:

```tsx
export interface LabeledSliderProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  defaultValue?: number
  className?: string
}

const LabeledSlider = React.forwardRef<HTMLDivElement, LabeledSliderProps>(
  ({ label, value, onChange, min = 0, max = 100, step = 1, unit = "", defaultValue, className }, ref) => {
    const displayValue = step < 1 ? value.toFixed(1) : Math.round(value)
    const [editing, setEditing] = React.useState(false)
    const [draft, setDraft] = React.useState("")

    const clamp = (n: number) => Math.min(max, Math.max(min, n))
    const commit = () => {
      const parsed = parseFloat(draft)
      if (!Number.isNaN(parsed)) onChange(clamp(parsed))
      setEditing(false)
    }

    return (
      <div ref={ref} className={cn("space-y-1", className)}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary">{label}</span>
          {editing ? (
            <input
              autoFocus
              type="number"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit()
                if (e.key === "Escape") setEditing(false)
              }}
              className="w-14 text-[10px] font-mono text-text-primary bg-background-tertiary px-1 py-0.5 rounded border border-border text-right"
            />
          ) : (
            <span
              role="button"
              tabIndex={0}
              title={defaultValue !== undefined ? "Click to edit, double-click to reset" : "Click to edit"}
              onClick={() => {
                setDraft(String(value))
                setEditing(true)
              }}
              onDoubleClick={() => {
                if (defaultValue !== undefined) {
                  setEditing(false)
                  onChange(defaultValue)
                }
              }}
              className="text-[10px] font-mono text-text-primary bg-background-tertiary px-1.5 py-0.5 rounded border border-border cursor-text select-none"
            >
              {displayValue}
              {unit}
            </span>
          )}
        </div>
        <Slider
          value={[value]}
          onValueChange={(values) => onChange(values[0])}
          min={min}
          max={max}
          step={step}
          className="h-1.5"
        />
      </div>
    )
  }
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openreel/ui test:run -- labeled-slider.test.tsx`
Expected: PASS (2 tests). If `@openreel/ui` has no `test:run` script, run `pnpm --filter @openreel/ui test -- --run labeled-slider.test.tsx`.

- [ ] **Step 5: Verify no consumers break**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS — `defaultValue` is optional, existing call sites unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/labeled-slider.tsx packages/ui/src/components/labeled-slider.test.tsx
git commit -m "feat(ui): editable + resettable LabeledSlider value pill"
```

---

## Task 7: Swap the inspector shell (header + real tabs + active-tab state)

This replaces the scroll-anchor strip and clip-info card with the new shell, wired to `ui-store`. It does NOT yet gate the body (Task 8) — after this task all sections still render; only navigation chrome changes.

**Files:**
- Modify: `apps/web/src/components/editor/InspectorPanel.tsx` (imports ~1-85; clipType ~748-793; tab strip ~912-973; clip-info card ~982-990)

- [ ] **Step 1: Add imports**

At the end of the local imports block (after line 85), add:

```tsx
import { getTabsForClipType, getTabIdsForClipType, type InspectorClipType, type InspectorTabId } from "./inspector/clip-tabs.config";
import { InspectorTabs } from "./inspector/shell/InspectorTabs";
import { InspectorClipHeader } from "./inspector/shell/InspectorClipHeader";
import { InspectorTabPanel } from "./inspector/shell/InspectorTabPanel";
import { InspectorTabErrorBoundary } from "./inspector/shell/InspectorTabErrorBoundary";
```

- [ ] **Step 2: Replace tab state with ui-store-backed active tab + clamp**

Delete the old `inspectorTabs` array, `activeInspectorTab` useState, `inspectorBodyRef`, and `scrollToInspectorTab` (lines ~912-940). Replace with:

```tsx
  const tabs = useMemo(
    () => getTabsForClipType(clipType as InspectorClipType | null),
    [clipType],
  );
  const inspectorActiveTab = useUIStore((s) => s.inspectorActiveTab);
  const setInspectorActiveTab = useUIStore((s) => s.setInspectorActiveTab);

  const tabIds = useMemo(
    () => getTabIdsForClipType(clipType as InspectorClipType | null),
    [clipType],
  );
  const activeTab: InspectorTabId =
    (tabIds.includes(inspectorActiveTab as InspectorTabId)
      ? (inspectorActiveTab as InspectorTabId)
      : tabIds[0]) ?? ("transform" as InspectorTabId);

  useEffect(() => {
    if (tabIds.length > 0 && !tabIds.includes(inspectorActiveTab as InspectorTabId)) {
      setInspectorActiveTab(tabIds[0]);
    }
  }, [tabIds, inspectorActiveTab, setInspectorActiveTab]);
```

- [ ] **Step 3: Replace the tab strip JSX**

Replace the old strip `<div className="flex items-center px-3.5 py-2 ...">...</div>` (lines ~947-973) with:

```tsx
      {selectedClip && tabs.length > 0 && (
        <>
          <InspectorClipHeader
            name={`${selectedClip.id.substring(0, 20)}…`}
            durationSeconds={selectedClip.duration}
            typeLabel={clipType ?? "clip"}
          />
          <InspectorTabs
            tabs={tabs}
            activeId={activeTab}
            onSelect={(id) => setInspectorActiveTab(id)}
          />
        </>
      )}
```

- [ ] **Step 4: Remove the redundant clip-info card and the body ref**

Delete the `{/* Clip Info */}` card block (lines ~982-990) — it is now the header. On the scroll container `<div ref={inspectorBodyRef} ...>` remove the `ref={inspectorBodyRef}` attribute (the ref no longer exists). Leave the scroll container itself.

- [ ] **Step 5: Verify it compiles and renders**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS. (Any leftover reference to `scrollToInspectorTab`/`activeInspectorTab`/`inspectorBodyRef` will surface here — remove them.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/editor/InspectorPanel.tsx
git commit -m "feat(inspector): real tab strip + clip header wired to ui-store"
```

---

## Task 8: Gate every section block to its tab

Wrap each currently-rendered block in `<InspectorTabPanel tab="<assigned>" active={activeTab}>...</InspectorTabPanel>`, preserving any existing clip-type condition **inside** the panel. Wrap is additive — do not change the block's internals or its existing `showX`/`clipType ===` guards.

**Canonical block → tab assignment** (every block currently rendered in `InspectorPanel.tsx`; line numbers are pre-edit approximate — locate by the component/section name):

| Block (component / inline section) | Approx. line | Tab |
|---|---|---|
| Applied effects/templates `Section` | 992 | effects |
| AI Auto-Captions inline (`clipType === "video"`) | 1142–1253 | ai |
| AI Stylize anchor content | 1141 | ai |
| `BackgroundRemovalSection` | 1259 | effects |
| `AutoReframeSection` | 1265 | ai |
| `AutoCutSilenceSection` | 1271 | audio |
| `AudioTextSyncPanel` | 1278 | audio |
| `AutoEditPanel` | 1285 | ai |
| `HighlightExtractorPanel` | 1292 | ai |
| Transform inline sliders (Position/Scale/Rotation/Opacity/BorderRadius/Fit) | 1300–1418 | transform |
| `CropSection` | 1430 | transform |
| `SpeedSection` | 1448 | speed |
| `StabilizationSection` | 1465 | speed |
| `SpeedRampSection` | 1481 | speed |
| `AlignmentSection` | 1497 | transform |
| `BlendingSection` | 1513 | transform |
| `Transform3DSection` | 1529 | transform |
| `KeyframesSection` | 1536 | animate |
| `ClipTransitionSection` | 1551 | animate |
| `MotionPresetsPanel` | 1566 | animate |
| `MotionPathSection` | 1582 | animate |
| `ParticleEffectsSectionWrapper` | 1599 | effects |
| `EmphasisAnimationSection` | 1619 | animate |
| Chroma Key inline (Enable/Key Color/Tolerance) | 1625–1657 | effects |
| `MotionTrackingSection` | 1664 | effects |
| `VideoEffectsSection` | 1670 | effects |
| `GreenScreenSection` | 1680 | effects |
| `PiPSection` | 1691 | effects |
| `MaskSection` | 1697 | effects |
| `NestedSequenceSection` | 1703 | effects |
| `AdjustmentLayerSection` | 1709 | effects |
| `ColorGradingSection` | 1721 | color |
| `NoiseReductionSection` | 1732 | audio |
| `AudioEffectsSection` | 1744 | audio |
| `AudioDuckingSection` | 1755 | audio |
| `TextSection` | 1761 | style |
| `TextAnimationSection` | 1771 | animate |
| `BehindSubjectSection` | 1781 | effects |
| `ShapeSection` | 1787 | style |
| `SVGSection` | 1794 | style |
| Quick Actions card (Remove Background / Dialogue Cleanup / Auto-Color) | 1799–1858 | ai |

The subtitle path (`selectedSubtitle`, ~1860–2258) and the no-selection `EmptyState` are NOT gated — leave them exactly as-is.

- [ ] **Step 1: Wrap each block**

For each row above, wrap the existing JSX. Example — Transform inline block becomes:

```tsx
<InspectorTabPanel tab="transform" active={activeTab}>
  {/* existing Position/Scale/Rotation/Opacity/BorderRadius/Fit JSX, unchanged */}
</InspectorTabPanel>
```

Example preserving an existing guard — `VideoEffectsSection`:

```tsx
<InspectorTabPanel tab="effects" active={activeTab}>
  {showVideoEffects && (
    <Section title="Video Effects">
      <VideoEffectsSection clipId={clipId} />
    </Section>
  )}
</InspectorTabPanel>
```

(Keep whatever `Section` wrapper / `showX` guard the block currently has; only add the `InspectorTabPanel` around it.)

- [ ] **Step 2: Wrap the gated body in the error boundary**

Wrap the whole selected-clip body (the region that contains all the gated `InspectorTabPanel`s, inside `{selectedClip ? ( ... ) : (<EmptyState/>)}`) in:

```tsx
<InspectorTabErrorBoundary key={activeTab}>
  {/* all gated InspectorTabPanel blocks */}
</InspectorTabErrorBoundary>
```

The `key={activeTab}` resets the boundary when the user switches tabs.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS.

- [ ] **Step 4: Lint**

Run: `pnpm --filter @openreel/web lint`
Expected: PASS (no unused `Section`/import warnings; if the old `ChevronDown`-based `Section` is still used by gated blocks, it stays).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/InspectorPanel.tsx
git commit -m "feat(inspector): gate sections into real isolated tabs"
```

---

## Task 9: Behavior test — real tabs isolate content

**Files:**
- Test: `apps/web/src/components/editor/InspectorPanel.tabs.test.tsx` (create)

> This test renders the panel against a seeded project store. Match the existing rendering-test setup used by `inspector/AudioDuckingSection.test.tsx` / `NoiseReductionSection.persistence.test.tsx` (same `@testing-library/react` + store seeding helpers). Reuse their store-seeding helper/imports verbatim so a video clip is selected.

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InspectorPanel } from "./InspectorPanel";
import { useUIStore } from "../../stores/ui-store";
// Reuse the project-store seeding helper used by the sibling inspector tests
// to create a project with one selected video clip, e.g.:
// import { seedProjectWithSelectedVideoClip } from "./inspector/test-helpers";

describe("InspectorPanel real tabs", () => {
  beforeEach(() => {
    useUIStore.setState({ inspectorActiveTab: "transform" });
    // seedProjectWithSelectedVideoClip();
  });

  it("shows the tablist with the video tab set", () => {
    render(<InspectorPanel />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Transform/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Audio/ })).toBeInTheDocument();
  });

  it("switching tabs swaps the visible panel", () => {
    render(<InspectorPanel />);
    fireEvent.click(screen.getByRole("tab", { name: /Audio/ }));
    expect(useUIStore.getState().inspectorActiveTab).toBe("audio");
    const panels = screen.getAllByRole("tabpanel");
    expect(panels.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Wire the seeding helper**

Open `apps/web/src/components/editor/inspector/AudioDuckingSection.test.tsx` and copy its project-store seeding approach into this test (or into a shared `inspector/test-helpers.ts` if one is introduced) so a video clip is selected before render. Replace the commented import/call above with the real helper.

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @openreel/web test:run -- InspectorPanel.tabs.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/InspectorPanel.tabs.test.tsx apps/web/src/components/editor/inspector/test-helpers.ts
git commit -m "test(inspector): verify real tab isolation"
```

---

## Task 10: Transform slider reset defaults (ergonomics payoff)

Give the Transform inline sliders sensible `defaultValue`s so double-click-reset is meaningful (the headline "just move the slider" win).

**Files:**
- Modify: `apps/web/src/components/editor/InspectorPanel.tsx` (Transform inline sliders, ~1300-1418)

- [ ] **Step 1: Add defaultValue to each Transform LabeledSlider**

For the inline Transform sliders add `defaultValue`:
- Position X → `defaultValue={0}`
- Position Y → `defaultValue={0}`
- Scale X → `defaultValue={100}`
- Scale Y → `defaultValue={100}`
- Rotation → `defaultValue={0}`
- Opacity → `defaultValue={100}`
- Border Radius → `defaultValue={0}`

Example:

```tsx
<LabeledSlider
  label="Opacity"
  value={transform.opacity * 100}
  onChange={(opacity) => handleTransformChange({ opacity: opacity / 100 })}
  min={0}
  max={100}
  step={1}
  unit="%"
  defaultValue={100}
/>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/editor/InspectorPanel.tsx
git commit -m "feat(inspector): default values enable double-click reset on Transform"
```

---

## Task 11: Full verification & manual smoke

- [ ] **Step 1: Typecheck the whole web app**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `pnpm --filter @openreel/web lint`
Expected: PASS.

- [ ] **Step 3: Full web test run**

Run: `pnpm --filter @openreel/web test:run`
Expected: PASS — no regressions in existing inspector/section tests.

- [ ] **Step 4: UI package tests**

Run: `pnpm --filter @openreel/ui test:run` (or `pnpm --filter @openreel/ui test -- --run`)
Expected: PASS.

- [ ] **Step 5: Manual smoke (dev server)**

Run: `pnpm dev`, open http://localhost:5173, select a video clip. Verify:
- header shows name/duration/type; tab strip shows Transform/Color/Effects/Audio/Speed/Animate/AI.
- clicking each tab shows ONLY that tab's controls; no endless scroll across groups.
- select an audio clip → only Audio/Speed tabs; an image → no Audio/Speed; a text clip → Transform/Style/Animate/AI.
- switch clips of the same type → the chosen tab persists.
- double-click a Transform value → resets; click a value → type a number → Enter commits within bounds.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore(inspector): finalize real tabbed inspector (Phase A)"
```

---

## Phase B (separate follow-up plan — recommended)

Phase A delivers the entire user-facing goal (real isolated tabs, clip-type adaptation, kept features, ergonomics) but leaves `InspectorPanel.tsx` large. Phase B is a **mechanical** refactor to be written as its own plan:

1. Introduce `inspector/shell/InspectorGroup.tsx` (standardized collapsible) replacing ad-hoc `Section`/`SubSection`.
2. Create `inspector/tabs/TransformTab.tsx … StyleTab.tsx`; move each tab's gated JSX (and only the handlers/state that block uses) out of `InspectorPanel.tsx`, one tab per commit, running `pnpm --filter @openreel/web test:run` after each move.
3. Create `inspector/ClipInspector.tsx` owning the shell + active-tab + clip-type tab list; reduce `InspectorPanel.tsx` to a thin router: `selection → <ClipInspector clipId> | <SubtitleInspector> | <EmptyState>`.
4. Add the parity test asserting every section component is referenced by exactly one tab module.

Each Phase B step is behavior-preserving and independently testable; do it only after Phase A is merged and verified.

---

## Self-Review

- **Spec coverage:** real isolated tabs (Tasks 7-8), keep-everything parity (Task 8 table covers every rendered block), reuse sections unchanged (Task 8 wraps only), clip-type adaptation (Tasks 2,7,9), persistent header (Tasks 4,7), active-tab persistence + clamp (Tasks 1,7), error boundary (Tasks 5,8), slider ergonomics (Tasks 6,10), tests (Tasks 1-9,11). File-split goal → Phase B (explicitly deferred, not dropped).
- **Placeholder scan:** none — the one external dependency (project-store seeding helper) is resolved by reusing the sibling inspector tests' existing setup (Task 9 Step 2), not invented.
- **Type consistency:** `InspectorTabId`/`InspectorClipType`/`InspectorTabDef`, `getTabsForClipType`/`getTabIdsForClipType`, `TAB_DEFS`, `inspectorActiveTab`/`setInspectorActiveTab`, `LabeledSlider.defaultValue`, `InspectorTabPanel`(tab/active), `InspectorTabs`(tabs/activeId/onSelect) are used consistently across tasks.
