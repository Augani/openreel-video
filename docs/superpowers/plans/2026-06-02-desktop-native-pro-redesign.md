# Desktop Native Pro Redesign + Slimming — Implementation Plan (Phases 1–2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the OpenReel desktop app a native shell (frameless window + per-platform chrome + native menu), a DaVinci Resolve-style charcoal/teal theme, a desktop-only boot path with an Edit/Color/Deliver workspace scaffold, AND slim it down (strip the 62MB ffmpeg.wasm on desktop, trim fonts, add electron-builder packaging).

**Architecture:** A desktop-only view layer under `apps/web/src/desktop/` (gated on `window.openreel?.platform === "desktop"`, tree-shaken out of the web bundle) that reuses all shared stores/engines/hooks. Native chrome lives in the Electron main process (`apps/desktop`). The theme is a `.openreel-desktop` CSS-variable override that retints the existing token system. Slimming is a build-time ffmpeg.wasm exclusion + font curation + electron-builder.

**Tech Stack:** Electron 33 (main, tsup CJS), Vite 5 + React 18 + Zustand + Tailwind (renderer), zod IPC contracts, electron-builder (packaging), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-02-desktop-native-pro-redesign-design.md`.

**Scope of THIS plan:** spec §4 (native shell), §5 theme + workspace scaffold (NOT the per-panel forked views — that is Phase 3, a follow-up plan), §6 (slimming + packaging), §7–8 (error handling + tests). The Edit/Color/Deliver pages render the EXISTING editor panels as placeholders; replacing each with a forked Resolve view is Phase 3.

**Conventions (project CLAUDE.md):** no line comments / no JSDoc except public API; explicit return types on exported functions; avoid `any`; defensive guards + early returns; Conventional Commits; run typecheck + tests before each commit. Per-package: `pnpm --filter @openreel/desktop {typecheck,build,test:run}`, `pnpm --filter @openreel/web {typecheck,test:run,build}`. Desktop renderer build: `OPENREEL_DESKTOP=1 pnpm --filter @openreel/web build` (or `pnpm --filter @openreel/desktop build:renderer`).

**Key facts (verified 2026-06-02):**
- Boot entry `apps/web/src/main.tsx` already detects desktop (`window.openreel?.platform === "desktop"`) to install the native encoder backend; it mounts `<App/>` unconditionally today.
- `createWindow()` in `apps/desktop/src/main/index.ts:78-94` is a plain `BrowserWindow` (default frame, no vibrancy, no custom titlebar).
- Theme tokens are CSS vars in `apps/web/src/index.css` (`:root`, `[data-theme="dark"]` at ~:79; `--accent: oklch(0.72 0.16 162)` emerald) mapped by `apps/web/tailwind.config.js` (`bg`, `fg`, `accent`, `border`, …).
- The 62MB is two `@ffmpeg/core` + `@ffmpeg/core-mt` wasm cores pulled by **static `?url` imports** at the top of `packages/core/src/media/ffmpeg-fallback.ts:2-6`. `vite.config.ts` has `const isDesktop = process.env.OPENREEL_DESKTOP === "1"` and a `desktopHtmlPlugin()`.
- Fonts: `apps/web/public/fonts/` holds 267 woff2 + `google-fonts.css` (copied verbatim → ~6MB); desktop swaps the Google CDN `<link>` for `./fonts/google-fonts.css` via `desktopHtmlPlugin`.
- No `electron-builder` yet; `apps/desktop/package.json` `build` only compiles renderer+main.
- IPC harness: `apps/desktop/src/main/ipc/index.ts` exports `handle(channel, zodSchema, fn)`; channels in `apps/desktop/src/shared/channels.ts`; preload `contextBridge` in `apps/desktop/src/preload/index.ts`; renderer types in `apps/web/src/types/global.d.ts`. Mirror the existing `gpu`/`cloud` wiring exactly.

---

## File Structure

**Phase 1 — native shell + theme + boot**
- Create `apps/desktop/src/main/window-controls.ts` — pure window-control fns over an injected window accessor.
- Modify `apps/desktop/src/main/index.ts` — frameless/vibrancy `createWindow`; register window-control + menu IPC; build native menu.
- Create `apps/desktop/src/main/app-menu.ts` — native `Menu` template + IPC dispatch.
- Modify `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/ipc-contract.ts`, `apps/desktop/src/preload/index.ts`, `apps/web/src/types/global.d.ts` — `win:*` + `menu:*` surface.
- Create `apps/web/src/desktop/theme/desktop-theme.css` — `.openreel-desktop` charcoal/teal token overrides.
- Create `apps/web/src/desktop/DesktopApp.tsx` — desktop root (applies theme class, providers, workspace).
- Create `apps/web/src/desktop/shell/DesktopTitleBar.tsx`, `apps/web/src/desktop/shell/WindowControls.tsx`, `apps/web/src/desktop/shell/Workspace.tsx`.
- Modify `apps/web/src/main.tsx` — branch to `<DesktopApp/>` on desktop.
- Modify `apps/web/src/stores/ui-store.ts` — desktop workspace-page state.
- Tests alongside each.

**Phase 2 — slim + package**
- Create `apps/web/vite-plugins/strip-ffmpeg.ts` — build-time stub of `@ffmpeg/core(-mt)` asset imports when desktop.
- Modify `apps/web/vite.config.ts` — use the plugin; desktop font handling.
- Create `apps/web/scripts/check-desktop-bundle.mjs` — bundle-size + no-wasm assertion.
- Create `apps/desktop/electron-builder.yml` + modify `apps/desktop/package.json` — packaging config + scripts.
- Modify `apps/desktop/test/parity.md` — pending-human checks.

---

# PHASE 1 — Native shell + theme + boot scaffold

### Task 1: Window-control IPC (TDD)

**Files:**
- Create: `apps/desktop/src/main/window-controls.ts`
- Test: `apps/desktop/test/window-controls.test.ts`
- Modify: `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/ipc-contract.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/web/src/types/global.d.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/test/window-controls.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { applyWindowControl, windowIsMaximized } from "../src/main/window-controls";

function fakeWin(maximized = false) {
  const state = { maximized, minimized: false, closed: false };
  return {
    state,
    minimize: vi.fn(() => { state.minimized = true; }),
    maximize: vi.fn(() => { state.maximized = true; }),
    unmaximize: vi.fn(() => { state.maximized = false; }),
    close: vi.fn(() => { state.closed = true; }),
    isMaximized: vi.fn(() => state.maximized),
  };
}

describe("window-controls", () => {
  it("minimize/close call through", () => {
    const w = fakeWin();
    applyWindowControl(w as never, "minimize");
    expect(w.minimize).toHaveBeenCalled();
    applyWindowControl(w as never, "close");
    expect(w.close).toHaveBeenCalled();
  });
  it("maximize toggles based on current state", () => {
    const w = fakeWin(false);
    applyWindowControl(w as never, "toggleMaximize");
    expect(w.maximize).toHaveBeenCalledTimes(1);
    const w2 = fakeWin(true);
    applyWindowControl(w2 as never, "toggleMaximize");
    expect(w2.unmaximize).toHaveBeenCalledTimes(1);
  });
  it("windowIsMaximized reflects the window", () => {
    expect(windowIsMaximized(fakeWin(true) as never)).toBe(true);
    expect(windowIsMaximized(fakeWin(false) as never)).toBe(false);
  });
  it("is a no-op on a null window", () => {
    expect(() => applyWindowControl(null, "minimize")).not.toThrow();
    expect(windowIsMaximized(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @openreel/desktop test:run window-controls`
Expected: module not found.

- [ ] **Step 3: Implement `window-controls.ts`**
```ts
export type WindowControlAction = "minimize" | "toggleMaximize" | "close";

export interface ControllableWindow {
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  close(): void;
  isMaximized(): boolean;
}

export function applyWindowControl(win: ControllableWindow | null, action: WindowControlAction): void {
  if (!win) return;
  if (action === "minimize") {
    win.minimize();
    return;
  }
  if (action === "close") {
    win.close();
    return;
  }
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
}

export function windowIsMaximized(win: ControllableWindow | null): boolean {
  return win ? win.isMaximized() : false;
}
```

- [ ] **Step 4: Run → PASS** (4 tests). `pnpm --filter @openreel/desktop test:run window-controls`

- [ ] **Step 5: Wire channels + schema + handlers + preload + types**

`channels.ts` (inside `CHANNELS`, after the gpu entries):
```ts
  windowControl: "openreel:window:control",
  windowIsMaximized: "openreel:window:isMaximized",
```
`ipc-contract.ts`:
```ts
export const windowControlArgsSchema = z.object({
  action: z.enum(["minimize", "toggleMaximize", "close"]),
});
```
`main/index.ts` — import `BrowserWindow` is already imported; import the helpers + schema, and register inside `app.whenReady().then(...)`. The handler resolves the focused/sender window:
```ts
import { applyWindowControl, windowIsMaximized } from "./window-controls";
import { windowControlArgsSchema } from "../shared/ipc-contract";
// ...
  ipcMain.handle(CHANNELS.windowControl, (e, raw) => {
    const parsed = windowControlArgsSchema.parse(raw);
    applyWindowControl(BrowserWindow.fromWebContents(e.sender), parsed.action);
  });
  ipcMain.handle(CHANNELS.windowIsMaximized, (e) =>
    windowIsMaximized(BrowserWindow.fromWebContents(e.sender)),
  );
```
(Use `ipcMain.handle` directly here because the handler needs the `event.sender`, matching the existing `CHANNELS.exportStart` pattern at `main/index.ts`. `BrowserWindow` satisfies `ControllableWindow` structurally.)
`preload/index.ts` (after `gpu`):
```ts
  win: {
    minimize: () => ipcRenderer.invoke(CHANNELS.windowControl, { action: "minimize" }),
    toggleMaximize: () => ipcRenderer.invoke(CHANNELS.windowControl, { action: "toggleMaximize" }),
    close: () => ipcRenderer.invoke(CHANNELS.windowControl, { action: "close" }),
    isMaximized: () => ipcRenderer.invoke(CHANNELS.windowIsMaximized),
  },
```
`apps/web/src/types/global.d.ts` (inside `openreel`, after `gpu`):
```ts
      win: {
        minimize(): Promise<void>;
        toggleMaximize(): Promise<void>;
        close(): Promise<void>;
        isMaximized(): Promise<boolean>;
      };
```

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @openreel/desktop typecheck && pnpm --filter @openreel/desktop test:run && pnpm --filter @openreel/web typecheck`
Expected: all clean, window-controls 4/4 pass.
```bash
git add apps/desktop/src/main/window-controls.ts apps/desktop/test/window-controls.test.ts apps/desktop/src/shared/channels.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/web/src/types/global.d.ts
git commit -m "feat(desktop): window-control IPC (minimize/maximize/close/isMaximized) for custom title bar"
```

### Task 2: Frameless window + per-platform chrome

**Files:** Modify `apps/desktop/src/main/index.ts` (`createWindow`)

> Frameless/vibrancy can't be unit-tested; verify by launch + flag human. Keep the change minimal and platform-branched.

- [ ] **Step 1: Rewrite `createWindow` for frameless + per-platform chrome**

Replace the `new BrowserWindow({...})` options in `createWindow` (`main/index.ts:79-93`) with:
```ts
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: isMac ? undefined : "#1b1b20",
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    titleBarOverlay: false,
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    vibrancy: isMac ? "under-window" : undefined,
    visualEffectState: isMac ? "active" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.loadURL(APP_INDEX);
```
(`titleBarStyle: "hidden"` on Win/Linux gives a frameless window where the renderer draws its own controls — Task 5. On mac, `hiddenInset` keeps the traffic lights but hides the title bar so the custom bar sits behind them; `trafficLightPosition` aligns them to the custom bar height.)

- [ ] **Step 2: Verify build + launch**

Run: `pnpm --filter @openreel/desktop build && pnpm --filter @openreel/desktop typecheck`
Expected: build + typecheck clean. (Visual confirmation of frameless window + traffic lights is human — recorded in Task 11's parity note.)

- [ ] **Step 3: Commit**
```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat(desktop): frameless window with per-platform chrome (mac hiddenInset+vibrancy, win/linux hidden)"
```

### Task 3: Desktop theme token layer (TDD)

**Files:**
- Create: `apps/web/src/desktop/theme/desktop-theme.css`
- Test: `apps/web/src/desktop/theme/desktop-theme.test.ts`

- [ ] **Step 1: Write the failing test** (asserts the stylesheet defines the charcoal/teal overrides under the desktop scope)

Create `apps/web/src/desktop/theme/desktop-theme.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("./desktop-theme.css", import.meta.url)), "utf8");

describe("desktop-theme.css", () => {
  it("scopes overrides under .openreel-desktop", () => {
    expect(css).toContain(".openreel-desktop");
  });
  it("retints the accent to teal and surfaces to charcoal", () => {
    expect(css).toMatch(/--accent:\s*oklch\([^)]*19[0-9]/); // teal hue ~195
    expect(css).toMatch(/--bg:\s*oklch\(0\.1[0-9]/); // dark charcoal base
  });
  it("defines the full surface ramp + border tokens it overrides", () => {
    for (const token of ["--bg", "--bg-1", "--bg-2", "--bg-3", "--border", "--accent", "--accent-strong"]) {
      expect(css).toContain(`${token}:`);
    }
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @openreel/web test:run desktop-theme`

- [ ] **Step 3: Implement `desktop-theme.css`** (charcoal neutral ramp + teal accent; reuses the same token names the app already consumes)
```css
.openreel-desktop {
  color-scheme: dark;

  --bg: oklch(0.16 0.004 250);
  --bg-1: oklch(0.185 0.004 250);
  --bg-2: oklch(0.21 0.004 250);
  --bg-3: oklch(0.25 0.004 250);
  --bg-elev: oklch(0.235 0.004 250);
  --border: oklch(0.3 0.004 250);
  --border-strong: oklch(0.38 0.005 250);

  --fg: oklch(0.93 0.004 250);
  --fg-2: oklch(0.72 0.006 250);
  --fg-3: oklch(0.58 0.006 250);
  --fg-muted: oklch(0.46 0.006 250);

  --hover: oklch(0.27 0.004 250);
  --selected: oklch(0.3 0.02 195);

  --accent: oklch(0.72 0.1 195);
  --accent-strong: oklch(0.66 0.11 195);
  --accent-soft: oklch(0.3 0.04 195);
  --accent-fg: oklch(0.16 0.004 250);
  --accent-glow: oklch(0.72 0.1 195 / 0.35);

  --track-bg: oklch(0.2 0.004 250);
  --tl-bg: oklch(0.15 0.004 250);
  --waveform: oklch(0.72 0.1 195 / 0.55);
  --stage-bg: oklch(0.12 0.003 250);
}
```

- [ ] **Step 4: Run → PASS** (3 tests). `pnpm --filter @openreel/web test:run desktop-theme`

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/desktop/theme/desktop-theme.css apps/web/src/desktop/theme/desktop-theme.test.ts
git commit -m "feat(web): desktop DaVinci-style charcoal/teal theme token layer (.openreel-desktop)"
```

### Task 4: Window controls + title bar components (TDD)

**Files:**
- Create: `apps/web/src/desktop/shell/WindowControls.tsx`, `apps/web/src/desktop/shell/DesktopTitleBar.tsx`
- Test: `apps/web/src/desktop/shell/WindowControls.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/desktop/shell/WindowControls.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WindowControls } from "./WindowControls";

const win = { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn().mockResolvedValue(false) };

beforeEach(() => {
  (window as unknown as { openreel: unknown }).openreel = { platform: "desktop", win };
});
afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
  vi.clearAllMocks();
});

describe("WindowControls", () => {
  it("renders nothing on macOS (native traffic lights)", () => {
    const { container } = render(<WindowControls platform="darwin" />);
    expect(container.firstChild).toBeNull();
  });
  it("renders min/max/close on win32 and wires them", () => {
    render(<WindowControls platform="win32" />);
    fireEvent.click(screen.getByLabelText("Minimize"));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(win.minimize).toHaveBeenCalledTimes(1);
    expect(win.close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @openreel/web test:run WindowControls`

- [ ] **Step 3: Implement `WindowControls.tsx`** (no-op on mac; custom buttons on win/linux)
```tsx
export function WindowControls({ platform }: { platform: string }): JSX.Element | null {
  if (platform === "darwin") return null;
  const api = typeof window !== "undefined" ? window.openreel?.win : undefined;
  if (!api) return null;
  return (
    <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <button type="button" aria-label="Minimize" className="h-8 w-10 text-fg-2 hover:bg-hover" onClick={() => void api.minimize()}>
        &#8211;
      </button>
      <button type="button" aria-label="Maximize" className="h-8 w-10 text-fg-2 hover:bg-hover" onClick={() => void api.toggleMaximize()}>
        &#9633;
      </button>
      <button type="button" aria-label="Close" className="h-8 w-10 text-fg-2 hover:bg-red-600 hover:text-white" onClick={() => void api.close()}>
        &#10005;
      </button>
    </div>
  );
}
```
(Add `import type React from "react";` if needed for the CSS cast. The `WebkitAppRegion` cast is required because React's CSS types omit it.)

- [ ] **Step 4: Implement `DesktopTitleBar.tsx`** (draggable unified bar; left spacer for mac traffic lights; embeds the Workspace tabs slot + WindowControls)
```tsx
import { WindowControls } from "./WindowControls";

export function DesktopTitleBar({ platform, children }: { platform: string; children?: React.ReactNode }): JSX.Element {
  const isMac = platform === "darwin";
  return (
    <header
      className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-bg-1 text-fg"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-3" style={{ paddingLeft: isMac ? 76 : 12 }}>
        <span className="text-xs font-semibold tracking-wide text-fg-2">OpenReel</span>
      </div>
      <div className="flex items-center" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        {children}
      </div>
      <WindowControls platform={platform} />
    </header>
  );
}
```
(`import type React from "react";` at top.)

- [ ] **Step 5: Run → PASS** (2 tests). `pnpm --filter @openreel/web test:run WindowControls`

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @openreel/web typecheck`
```bash
git add apps/web/src/desktop/shell/WindowControls.tsx apps/web/src/desktop/shell/WindowControls.test.tsx apps/web/src/desktop/shell/DesktopTitleBar.tsx
git commit -m "feat(web): desktop title bar + window controls (drag region, mac/win-aware)"
```

### Task 5: Workspace pages + ui-store state (TDD)

**Files:**
- Modify: `apps/web/src/stores/ui-store.ts`
- Create: `apps/web/src/desktop/shell/Workspace.tsx`
- Test: `apps/web/src/desktop/shell/Workspace.test.tsx`

- [ ] **Step 1: Add desktop workspace-page state to `ui-store.ts`**

Read `ui-store.ts` first. Add a `DesktopPage` type and state. Near the `PanelId` definitions:
```ts
export type DesktopPage = "edit" | "color" | "deliver";
```
Add to the store state interface + initial state + action (match the store's existing `create`/persist style):
```ts
  desktopPage: DesktopPage;
  setDesktopPage(page: DesktopPage): void;
```
Initial `desktopPage: "edit"`; action `setDesktopPage: (page) => set({ desktopPage: page })`. (It will persist via the existing partialize since it's a top-level field — confirm partialize includes it or is generic; if partialize enumerates keys explicitly, add `desktopPage`.)

- [ ] **Step 2: Write the failing test** for `Workspace`

Create `apps/web/src/desktop/shell/Workspace.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Workspace } from "./Workspace";
import { useUIStore } from "../../stores/ui-store";

beforeEach(() => {
  useUIStore.setState({ desktopPage: "edit" });
});

describe("Workspace", () => {
  it("renders page tabs and switches the active page in the store", () => {
    render(<Workspace />);
    expect(screen.getByRole("tab", { name: "Edit" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Color" }));
    expect(useUIStore.getState().desktopPage).toBe("color");
  });
  it("shows the active page body", () => {
    render(<Workspace />);
    fireEvent.click(screen.getByRole("tab", { name: "Deliver" }));
    expect(screen.getByTestId("desktop-page-deliver")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run → FAIL.** `pnpm --filter @openreel/web test:run Workspace`

- [ ] **Step 4: Implement `Workspace.tsx`** (page tabs + placeholder page bodies that will host forked panels in Phase 3)
```tsx
import { useUIStore, type DesktopPage } from "../../stores/ui-store";

const PAGES: { id: DesktopPage; label: string }[] = [
  { id: "edit", label: "Edit" },
  { id: "color", label: "Color" },
  { id: "deliver", label: "Deliver" },
];

export function Workspace(): JSX.Element {
  const page = useUIStore((s) => s.desktopPage);
  const setPage = useUIStore((s) => s.setDesktopPage);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-fg">
      <nav role="tablist" className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-bg-1 px-2">
        {PAGES.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={page === p.id}
            type="button"
            className={
              page === p.id
                ? "h-7 rounded px-3 text-xs font-medium bg-accent-soft text-accent"
                : "h-7 rounded px-3 text-xs font-medium text-fg-2 hover:bg-hover"
            }
            onClick={() => setPage(p.id)}
          >
            {p.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-hidden" data-testid={`desktop-page-${page}`}>
        <PagePlaceholder page={page} />
      </div>
    </div>
  );
}

function PagePlaceholder({ page }: { page: DesktopPage }): JSX.Element {
  return (
    <div className="grid h-full place-items-center text-sm text-fg-muted">
      {page === "edit" && "Edit workspace"}
      {page === "color" && "Color workspace"}
      {page === "deliver" && "Deliver workspace"}
    </div>
  );
}
```
(Phase 3 replaces `PagePlaceholder` with the forked Resolve panels. The placeholder keeps Phase 1 shippable and testable.)

- [ ] **Step 5: Run → PASS** (2 tests). `pnpm --filter @openreel/web test:run Workspace`

- [ ] **Step 6: Verify store + commit**

Run: `pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/web test:run ui-store`
```bash
git add apps/web/src/stores/ui-store.ts apps/web/src/desktop/shell/Workspace.tsx apps/web/src/desktop/shell/Workspace.test.tsx
git commit -m "feat(web): desktop Edit/Color/Deliver workspace pages + ui-store page state"
```

### Task 6: DesktopApp root + boot branch (TDD)

**Files:**
- Create: `apps/web/src/desktop/DesktopApp.tsx`
- Test: `apps/web/src/desktop/DesktopApp.test.tsx`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/desktop/DesktopApp.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { DesktopApp } from "./DesktopApp";

beforeEach(() => {
  (window as unknown as { openreel: unknown }).openreel = {
    platform: "desktop",
    win: { minimize: () => {}, toggleMaximize: () => {}, close: () => {}, isMaximized: async () => false },
  };
});
afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
});

describe("DesktopApp", () => {
  it("applies the desktop theme class to its root", () => {
    const { container } = render(<DesktopApp />);
    expect(container.querySelector(".openreel-desktop")).not.toBeNull();
  });
  it("renders the title bar and workspace", () => {
    const { getByText, getByRole } = render(<DesktopApp />);
    expect(getByText("OpenReel")).toBeTruthy();
    expect(getByRole("tablist")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @openreel/web test:run DesktopApp`

- [ ] **Step 3: Implement `DesktopApp.tsx`**
```tsx
import { DesktopTitleBar } from "./shell/DesktopTitleBar";
import { Workspace } from "./shell/Workspace";
import { ErrorBoundary } from "../components/ErrorBoundary";
import "./theme/desktop-theme.css";

function detectPlatform(): string {
  if (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)) return "darwin";
  if (typeof navigator !== "undefined" && /Win/i.test(navigator.platform)) return "win32";
  return "linux";
}

export function DesktopApp(): JSX.Element {
  const platform = detectPlatform();
  return (
    <div className="openreel-desktop flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
      <DesktopTitleBar platform={platform} />
      <div className="min-h-0 flex-1">
        <ErrorBoundary>
          <Workspace />
        </ErrorBoundary>
      </div>
    </div>
  );
}
```
(Verify the real export name + props of `apps/web/src/components/ErrorBoundary.tsx`; if it requires a `name`/`fallback` prop, pass it. If the codebase's panel boundary is a differently-named component, use that. The workspace page tabs come from Task 5.)

- [ ] **Step 4: Branch the boot in `main.tsx`**

In `apps/web/src/main.tsx`, the file currently does `ReactDOM.createRoot(...).render(<App/>)` somewhere after the desktop encoder-backend block (read the full file to find the render call — it may be implicit). Add a desktop branch at the render site:
```tsx
import { DesktopApp } from "./desktop/DesktopApp";
// ...
const isDesktop = typeof window !== "undefined" && window.openreel?.platform === "desktop";
const rootEl = document.getElementById("root")!;
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    {isDesktop ? (
      <DesktopApp />
    ) : (
      <PostHogProvider client={posthog}>
        <App />
      </PostHogProvider>
    )}
  </React.StrictMode>,
);
```
ADAPT to the file's ACTUAL existing render call (it may already wrap `<App/>` in providers and StrictMode differently). The ONLY change: when `isDesktop`, render `<DesktopApp/>` instead of `<App/>`. Preserve all existing web providers/StrictMode for the web path exactly as they are. Do NOT remove the existing desktop encoder-backend block.

- [ ] **Step 5: Run → PASS** + full web suite + typecheck

Run: `pnpm --filter @openreel/web test:run DesktopApp && pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/web test:run`
Expected: DesktopApp 2/2, no regressions.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/desktop/DesktopApp.tsx apps/web/src/desktop/DesktopApp.test.tsx apps/web/src/main.tsx
git commit -m "feat(web): desktop boots into DesktopApp shell (theme + title bar + workspace); web path unchanged"
```

### Task 7: Native application menu

**Files:**
- Create: `apps/desktop/src/main/app-menu.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/test/app-menu.test.ts`

> The menu template (structure + role/accelerator mapping) is unit-testable as a pure builder; `Menu.setApplicationMenu` wiring is verified by launch.

- [ ] **Step 1: Write the failing test** for a pure menu-template builder
```ts
import { describe, it, expect } from "vitest";
import { buildMenuTemplate } from "../src/main/app-menu";

describe("buildMenuTemplate", () => {
  it("includes the app menu first on mac and not on others", () => {
    const mac = buildMenuTemplate("darwin");
    expect(mac[0].label).toBe("OpenReel");
    const win = buildMenuTemplate("win32");
    expect(win[0].label).toBe("File");
  });
  it("has File/Edit/View/Window/Help groups", () => {
    const labels = buildMenuTemplate("win32").map((m) => m.label);
    for (const l of ["File", "Edit", "View", "Window", "Help"]) expect(labels).toContain(l);
  });
  it("File>New uses CmdOrCtrl+N", () => {
    const file = buildMenuTemplate("win32").find((m) => m.label === "File");
    const item = file?.submenu?.find((s) => s.label === "New Project");
    expect(item?.accelerator).toBe("CmdOrCtrl+N");
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @openreel/desktop test:run app-menu`

- [ ] **Step 3: Implement `app-menu.ts`** (pure builder returns a serializable template; a separate fn installs it)
```ts
import { Menu, type MenuItemConstructorOptions, type BrowserWindow } from "electron";

export interface MenuNode {
  label: string;
  accelerator?: string;
  role?: string;
  submenu?: MenuNode[];
}

export function buildMenuTemplate(platform: string): MenuNode[] {
  const isMac = platform === "darwin";
  const template: MenuNode[] = [];
  if (isMac) {
    template.push({
      label: "OpenReel",
      submenu: [{ label: "About OpenReel", role: "about" }, { label: "Quit", role: "quit", accelerator: "Cmd+Q" }],
    });
  }
  template.push({
    label: "File",
    submenu: [
      { label: "New Project", accelerator: "CmdOrCtrl+N" },
      { label: "Open…", accelerator: "CmdOrCtrl+O" },
      { label: "Export…", accelerator: "CmdOrCtrl+E" },
    ],
  });
  template.push({
    label: "Edit",
    submenu: [
      { label: "Undo", accelerator: "CmdOrCtrl+Z", role: "undo" },
      { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", role: "redo" },
      { label: "Cut", role: "cut" },
      { label: "Copy", role: "copy" },
      { label: "Paste", role: "paste" },
    ],
  });
  template.push({ label: "View", submenu: [{ label: "Toggle Full Screen", role: "togglefullscreen" }] });
  template.push({ label: "Window", submenu: [{ label: "Minimize", role: "minimize" }, { label: "Close", role: "close" }] });
  template.push({ label: "Help", submenu: [{ label: "OpenReel Help" }] });
  return template;
}

export function installApplicationMenu(platform: string, onAction: (id: string) => void): void {
  const toElectron = (node: MenuNode): MenuItemConstructorOptions => ({
    label: node.label,
    accelerator: node.accelerator,
    role: node.role as MenuItemConstructorOptions["role"],
    submenu: node.submenu?.map(toElectron),
    click: node.role
      ? undefined
      : () => onAction(node.label),
  });
  const template = buildMenuTemplate(platform).map(toElectron);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function sendMenuAction(win: BrowserWindow | null, id: string): void {
  if (win) win.webContents.send("openreel:menu:action", id);
}
```

- [ ] **Step 4: Run → PASS** (3 tests). `pnpm --filter @openreel/desktop test:run app-menu`

- [ ] **Step 5: Install the menu in `main/index.ts`** + forward actions to the focused window

In `app.whenReady().then(...)`, after `createWindow()`, add:
```ts
import { installApplicationMenu, sendMenuAction } from "./app-menu";
// ...
  installApplicationMenu(process.platform, (id) => sendMenuAction(BrowserWindow.getFocusedWindow(), id));
```
The renderer can later subscribe to `openreel:menu:action` (a follow-up wires it to the keyboard-shortcut service; not required for Phase 1 — the menu + native roles like undo/redo/copy already function). Optionally expose a preload listener `onMenuAction(cb)` if a Phase-1 consumer needs it; otherwise defer.

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @openreel/desktop typecheck && pnpm --filter @openreel/desktop build && pnpm --filter @openreel/desktop test:run`
```bash
git add apps/desktop/src/main/app-menu.ts apps/desktop/test/app-menu.test.ts apps/desktop/src/main/index.ts
git commit -m "feat(desktop): native application menu (File/Edit/View/Window/Help) with roles + accelerators"
```

---

# PHASE 2 — Slim + package

### Task 8: Strip ffmpeg.wasm from the desktop bundle (TDD)

**Files:**
- Create: `apps/web/vite-plugins/strip-ffmpeg.ts`, `apps/web/vite-plugins/strip-ffmpeg.test.ts`
- Modify: `apps/web/vite.config.ts`
- Create: `apps/web/scripts/check-desktop-bundle.mjs`

- [ ] **Step 1: Write the failing test** for the plugin's pure id-matcher + load result
```ts
import { describe, it, expect } from "vitest";
import { isFfmpegCoreAsset, stripFfmpegPlugin } from "./strip-ffmpeg";

describe("strip-ffmpeg", () => {
  it("matches the @ffmpeg/core(-mt) asset url imports", () => {
    expect(isFfmpegCoreAsset("/x/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url")).toBe(true);
    expect(isFfmpegCoreAsset("/x/node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js?url")).toBe(true);
    expect(isFfmpegCoreAsset("/x/node_modules/@ffmpeg/util/dist/esm/index.js")).toBe(false);
    expect(isFfmpegCoreAsset("/x/src/app.ts")).toBe(false);
  });
  it("plugin is inert when not desktop (load returns undefined)", () => {
    const p = stripFfmpegPlugin(false);
    expect(p.load("/n/@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url")).toBeUndefined();
  });
  it("plugin stubs the asset to an empty url string when desktop", () => {
    const p = stripFfmpegPlugin(true);
    expect(p.load("/n/@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url")).toBe('export default "";');
    expect(p.load("/n/src/app.ts")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @openreel/web test:run strip-ffmpeg`

- [ ] **Step 3: Implement `strip-ffmpeg.ts`**
```ts
import type { Plugin } from "vite";

const FFMPEG_CORE_ASSET = /@ffmpeg\/core(-mt)?\/.*\.(wasm|js)(\?url)?$/;

export function isFfmpegCoreAsset(id: string): boolean {
  return FFMPEG_CORE_ASSET.test(id);
}

export function stripFfmpegPlugin(isDesktop: boolean): Plugin {
  return {
    name: "openreel-strip-ffmpeg",
    enforce: "pre",
    load(id: string): string | undefined {
      if (!isDesktop) return undefined;
      if (isFfmpegCoreAsset(id)) return 'export default "";';
      return undefined;
    },
  };
}
```
(On desktop, the static `?url` imports in `ffmpeg-fallback.ts` resolve to an empty-string default export, so Vite never emits the 62MB wasm. The `ffmpeg-fallback` code paths are already desktop-guarded — they only run when `nativeMediaAvailable()` is false, which is never on desktop. The `FFmpeg`/`@ffmpeg/util` JS is small and left intact.)

- [ ] **Step 4: Run → PASS** (3 tests). `pnpm --filter @openreel/web test:run strip-ffmpeg`

- [ ] **Step 5: Wire into `vite.config.ts`**

Add the import and plugin:
```ts
import { stripFfmpegPlugin } from "./vite-plugins/strip-ffmpeg";
// ...
  plugins: [react(), desktopHtmlPlugin(), stripFfmpegPlugin(isDesktop)],
```

- [ ] **Step 6: Build the desktop renderer and assert the wasm is gone**

Run: `OPENREEL_DESKTOP=1 pnpm --filter @openreel/web build`
Then verify no ffmpeg-core wasm in dist:
```bash
find apps/web/dist -name "ffmpeg-core*.wasm" | head    # expect: empty
du -sh apps/web/dist                                    # expect: ~10MB, down from 72MB
```
Also run the web (non-desktop) build to confirm wasm still ships there:
```bash
pnpm --filter @openreel/web build && find apps/web/dist -name "ffmpeg-core*.wasm" | head   # expect: 2 files present
```

- [ ] **Step 7: Create the bundle-size guard `apps/web/scripts/check-desktop-bundle.mjs`**
```js
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const MAX_BYTES = 20 * 1024 * 1024;

function walk(dir) {
  let total = 0;
  const wasm = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const r = walk(p);
      total += r.total;
      wasm.push(...r.wasm);
    } else {
      total += statSync(p).size;
      if (/ffmpeg-core.*\.wasm$/.test(entry.name)) wasm.push(p);
    }
  }
  return { total, wasm };
}

const { total, wasm } = walk(DIST);
if (wasm.length > 0) {
  console.error(`Desktop bundle contains ffmpeg.wasm cores (should be stripped):\n${wasm.join("\n")}`);
  process.exit(1);
}
if (total > MAX_BYTES) {
  console.error(`Desktop bundle ${(total / 1048576).toFixed(1)}MB exceeds budget ${(MAX_BYTES / 1048576).toFixed(0)}MB`);
  process.exit(1);
}
console.log(`Desktop bundle OK: ${(total / 1048576).toFixed(1)}MB, no ffmpeg.wasm`);
```
Run (after the desktop build from Step 6): `node apps/web/scripts/check-desktop-bundle.mjs` → expect "Desktop bundle OK". (Adjust `MAX_BYTES` if the first measured slim build is legitimately above 20MB but well under the old 72MB — set it ~20% above the measured value.)

- [ ] **Step 8: Commit**
```bash
git add apps/web/vite-plugins/strip-ffmpeg.ts apps/web/vite-plugins/strip-ffmpeg.test.ts apps/web/vite.config.ts apps/web/scripts/check-desktop-bundle.mjs
git commit -m "feat(web): strip 62MB ffmpeg.wasm from desktop bundle (native sidecar covers it) + size guard"
```

### Task 9: Trim bundled fonts on desktop

**Files:** Modify `apps/web/vite.config.ts` (desktop font handling) + `apps/web/public/fonts/` strategy

> The 267 woff2 in `public/fonts` are copied verbatim (~6MB). Goal: bundle only a curated default set on desktop; the font picker lazy-loads the rest. Keep the existing offline self-hosting for the bundled set (COEP-safe).

- [ ] **Step 1: Decide the curated set** — read `apps/web/src/components/editor/inspector/font-options.ts` `FONT_CATEGORIES.Popular` (Inter, Poppins, Montserrat, Roboto, Open Sans, Lato, Outfit, DM Sans) + the UI font (Geist). These stay bundled.

- [ ] **Step 2: Add a desktop font-pruning step to the build**

Add a small Vite `closeBundle` hook (in a new `apps/web/vite-plugins/prune-fonts.ts`, plugin-tested like Task 8 isn't strictly needed — this is a build I/O step) that, when `isDesktop`, removes from `dist/fonts` every woff2 whose `@font-face` family in `google-fonts.css` is NOT in the curated set, and rewrites `dist/fonts/google-fonts.css` to keep only the curated `@font-face` blocks. Implement defensively: parse `@font-face { ... font-family: 'X' ... src: url(./Y.woff2) }` blocks, keep curated families, delete the rest's woff2 files + css blocks.
```ts
import type { Plugin } from "vite";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const CURATED = new Set(["Geist","Inter","Poppins","Montserrat","Roboto","Open Sans","Lato","Outfit","DM Sans"]);

export function pruneFontsPlugin(isDesktop: boolean, outDir = "dist"): Plugin {
  return {
    name: "openreel-prune-fonts",
    apply: "build",
    closeBundle() {
      if (!isDesktop) return;
      const cssPath = join(process.cwd(), outDir, "fonts", "google-fonts.css");
      if (!existsSync(cssPath)) return;
      const css = readFileSync(cssPath, "utf8");
      const blocks = css.split(/(?=@font-face)/g);
      const kept: string[] = [];
      for (const block of blocks) {
        const fam = /font-family:\s*['"]([^'"]+)['"]/.exec(block)?.[1];
        if (!fam) { kept.push(block); continue; }
        if (CURATED.has(fam)) { kept.push(block); continue; }
        for (const m of block.matchAll(/url\(\.\/([^)]+\.woff2)\)/g)) {
          const f = join(process.cwd(), outDir, "fonts", m[1]);
          if (existsSync(f)) rmSync(f);
        }
      }
      writeFileSync(cssPath, kept.join(""));
    },
  };
}
```
Wire it in `vite.config.ts`: `plugins: [react(), desktopHtmlPlugin(), stripFfmpegPlugin(isDesktop), pruneFontsPlugin(isDesktop)]`.
The font picker (font-options.ts) already lazy-loads/injects fonts on demand for custom fonts; for non-curated catalog fonts on desktop, ensure selection triggers an on-demand `@font-face` injection (it uses IndexedDB for custom fonts; catalog fonts not bundled will need a lazy fetch — if that path doesn't exist, scope this task to ONLY pruning + keep the picker showing curated families on desktop, and note catalog-font lazy-load as a follow-up).

- [ ] **Step 3: Build + verify the drop**

Run: `OPENREEL_DESKTOP=1 pnpm --filter @openreel/web build && du -sh apps/web/dist/fonts`
Expected: fonts dir down from ~6MB to <1MB. Confirm the curated families still render (the UI Geist font + Popular set present in `dist/fonts`).

- [ ] **Step 4: Commit**
```bash
git add apps/web/vite-plugins/prune-fonts.ts apps/web/vite.config.ts
git commit -m "feat(web): prune non-curated fonts from desktop bundle (curated set stays self-hosted)"
```

### Task 10: electron-builder packaging

**Files:**
- Create: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Add electron-builder + scripts to `apps/desktop/package.json`**

Add to `devDependencies`: `"electron-builder": "^24.13.3"`. Add scripts:
```json
    "pack": "pnpm run build && electron-builder --dir",
    "dist": "pnpm run build && electron-builder"
```
Run `pnpm install` from the repo root to fetch electron-builder.

- [ ] **Step 2: Create `apps/desktop/electron-builder.yml`**
```yaml
appId: video.openreel.desktop
productName: OpenReel
asar: true
directories:
  output: release
files:
  - dist/**/*
  - "!**/*.map"
extraResources:
  - from: resources/bin
    to: bin
    filter:
      - "**/*"
mac:
  category: public.app-category.video
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip
      arch: [arm64, x64]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
win:
  target:
    - target: nsis
      arch: [x64]
linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
  category: AudioVideo
```
The renderer bundle is built into `apps/web/dist`; ensure the desktop build copies/points the renderer correctly. The current `rendererRoot()` in `main/index.ts` expects `process.resourcesPath/renderer` when packaged. So add to `electron-builder.yml` `extraResources` a mapping of the web dist into `renderer`:
```yaml
extraResources:
  - from: ../web/dist
    to: renderer
    filter: ["**/*"]
  - from: resources/bin
    to: bin
    filter: ["**/*"]
```
And in `files`, include the compiled main/preload (`dist/**/*` from `apps/desktop/dist`). Confirm `main` in package.json (`dist/main/index.js`) and the `APP_INDEX`/`app://` protocol resolve against `process.resourcesPath/renderer` when packaged (it does per `rendererRoot()`).

- [ ] **Step 3: Create `apps/desktop/build/entitlements.mac.plist`** (minimal hardened-runtime entitlements for a notarizable app)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
```
(JIT + unsigned-exec-memory are required by Chromium/V8; disable-library-validation lets the bundled native ffmpeg binary load.)

- [ ] **Step 4: Verify a dir-pack builds (no signing)**

Run: `cd apps/desktop && CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run pack`
Expected: `electron-builder --dir` produces `apps/desktop/release/<platform>-unpacked/` without signing. (Full signed `dist` needs certs — Task 11/human. If `pack` fails because the native ffmpeg binary is absent in `resources/bin`, confirm the MANIFEST/placeholder from the earlier desktop work; the gitignored binary may be absent in dev — document that signed packaging requires the per-arch binary present.)

- [ ] **Step 5: Commit**
```bash
git add apps/desktop/electron-builder.yml apps/desktop/build/entitlements.mac.plist apps/desktop/package.json
git commit -m "feat(desktop): electron-builder packaging (per-arch mac/win/linux, asar, native ffmpeg resource, hardened entitlements)"
```

### Task 11: Lazy-load heavy panels + parity notes

**Files:**
- Modify: `apps/web/src/desktop/shell/Workspace.tsx` (lazy boundaries for Phase-3 heavy panels — scaffold now)
- Modify: `apps/desktop/test/parity.md`

- [ ] **Step 1: Make the Workspace page bodies lazy-ready**

Wrap the page body in `Suspense` so Phase 3's heavy panels (three.js scopes, preview) code-split cleanly:
```tsx
import { Suspense } from "react";
// in Workspace render, wrap the page container:
      <div className="min-h-0 flex-1 overflow-hidden" data-testid={`desktop-page-${page}`}>
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-fg-muted">Loading…</div>}>
          <PagePlaceholder page={page} />
        </Suspense>
      </div>
```
Re-run `pnpm --filter @openreel/web test:run Workspace` → still 2/2 (Suspense with sync children resolves immediately).

- [ ] **Step 2: Record pending-human checks in `apps/desktop/test/parity.md`**

Append a `# Desktop Native Pro Redesign — pending human checks (Phases 1–2)` section: frameless window + mac traffic lights alignment + vibrancy; Win/Linux custom min/max/close behavior; native menu (File/Edit/View/Window/Help) + accelerators; the DaVinci charcoal/teal look of the shell; a real packaged-build size + cold-start measurement per platform; signed/notarized `dist` requires certs (mac hardened-runtime + notarize creds; Windows Authenticode) supplied via CI/env.

- [ ] **Step 3: Full verification matrix + commit**

Run:
```bash
pnpm --filter @openreel/desktop typecheck && pnpm --filter @openreel/desktop build && pnpm --filter @openreel/desktop test:run
pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/web test:run
OPENREEL_DESKTOP=1 pnpm --filter @openreel/web build && node apps/web/scripts/check-desktop-bundle.mjs
```
Expected: all green; bundle guard reports OK (no ffmpeg.wasm, under budget).
```bash
git add apps/web/src/desktop/shell/Workspace.tsx apps/desktop/test/parity.md
git commit -m "feat(web): lazy-ready desktop workspace pages + record desktop redesign pending-human checks"
```

---

## Self-Review

**Spec coverage:** §3 fork boundary + boot → T6 (DesktopApp + main.tsx branch), shared logic untouched. §4 native shell → T1 (window IPC), T2 (frameless/vibrancy), T4 (title bar + controls), T7 (native menu). §5 theme + workspace → T3 (charcoal/teal tokens), T5 (Edit/Color/Deliver pages + ui-store). §6 slimming → T8 (ffmpeg strip + size guard), T9 (font prune), T10 (electron-builder), T11 (lazy-load). §7 error handling → T6 (ErrorBoundary around Workspace), T1 (zod-validated, null-safe window controls). §8 testing → unit tests per task + T8 bundle guard + T11 parity notes. §9 phasing: this plan = Phases 1+2; **Phase 3 (per-panel forked Resolve views) is a SEPARATE follow-up plan** — flagged in the handoff. §10 non-goals respected (web app untouched: T6 only branches the render site; no feature changes; placeholder pages, not new panels). §11 open items resolved: token values pinned (T3), context-menu mechanism deferred to Phase 3 (the menu in T7 uses native roles), bundle budget set in T8, `desktop/` stays in `apps/web`.

**Placeholder scan:** every code step has real code. T9 Step 2 contains a conditional ("if that path doesn't exist, scope to pruning + note follow-up") — this is an explicit, bounded fallback with a concrete default action (prune + keep curated picker), not deferred work. T10 references the pre-existing native ffmpeg binary/MANIFEST and notes signed packaging needs certs (a real external dependency, not a placeholder).

**Type/contract consistency:** `WindowControlAction` ("minimize"|"toggleMaximize"|"close") consistent across `window-controls.ts`, the zod schema, preload `win.*`, and `global.d.ts`. `win:*`/`menu:*` channel strings consistent across channels↔handlers↔preload. `DesktopPage` ("edit"|"color"|"deliver") consistent across ui-store, Workspace, tests. `isFfmpegCoreAsset`/`stripFfmpegPlugin` signatures consistent T8 plugin↔config↔test. `.openreel-desktop` class consistent across desktop-theme.css, DesktopApp, and its test. `buildMenuTemplate(platform)`/`installApplicationMenu`/`sendMenuAction` consistent T7.

**Known verification dependencies (flagged, not gaps):** exact existing render call in `main.tsx` and the `ErrorBoundary` export shape (T6 instructs to adapt to the real code); the catalog-font lazy-load path (T9 has a defined fallback); the packaged native ffmpeg binary presence (T10, external). Frameless window / vibrancy / native menu visuals + packaged size need human verification (T11 parity).
