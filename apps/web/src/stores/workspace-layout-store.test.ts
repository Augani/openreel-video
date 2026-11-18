import { beforeEach, describe, expect, it } from "vitest";
import { useEditorWorkspaceStore } from "./editor-workspace-store";
import { useUIStore } from "./ui-store";
import {
  BUILT_IN_WORKSPACES,
  DEFAULT_LAYOUT,
  MAX_INSPECTOR_W,
  MIN_MEDIA_W,
  layoutsEqual,
  sanitizeLayout,
  sanitizeWorkspaces,
  useWorkspaceLayoutStore,
} from "./workspace-layout-store";

const store = () => useWorkspaceLayoutStore.getState();

beforeEach(() => {
  localStorage.clear();
  useWorkspaceLayoutStore.setState({ layout: DEFAULT_LAYOUT, userWorkspaces: [], activeId: "editing", saveDialogOpen: false });
  useEditorWorkspaceStore.getState().setSection("media");
  useUIStore.getState().setPanelVisible("agentChat", false);
  useUIStore.getState().setPanelVisible("audioMixer", false);
});

describe("workspace layouts", () => {
  it("ships Editing, Color and Audio", () => {
    expect(BUILT_IN_WORKSPACES.map((w) => w.name)).toEqual(["Editing", "Color", "Audio"]);
  });

  it("applying a built-in workspace changes the dock geometry and the asset section", () => {
    expect(store().applyWorkspace("color")).toBe(true);
    expect(store().activeId).toBe("color");
    expect(store().layout.inspectorWidth).toBe(480);
    expect(useEditorWorkspaceStore.getState().section).toBe("effects");
    store().applyWorkspace("audio");
    expect(store().layout.timelineVh).toBe(46);
    expect(useEditorWorkspaceStore.getState().section).toBe("audio");
    expect(store().applyWorkspace("nope")).toBe(false);
  });

  it("saves the live layout as a user workspace and restores it later", () => {
    store().patchLayout({ mediaWidth: 500, timelineVh: 40 });
    useEditorWorkspaceStore.getState().setSection("text");
    const saved = store().saveWorkspace("  My   layout ");
    expect(saved?.name).toBe("My layout");
    store().applyWorkspace("editing");
    expect(store().layout.mediaWidth).toBe(DEFAULT_LAYOUT.mediaWidth);
    store().applyWorkspace(saved!.id);
    expect(store().layout.mediaWidth).toBe(500);
    expect(store().layout.timelineVh).toBe(40);
    expect(useEditorWorkspaceStore.getState().section).toBe("text");
  });

  it("refuses built-in names and overwrites a user workspace of the same name", () => {
    expect(store().saveWorkspace("editing")).toBeNull();
    expect(store().saveWorkspace("   ")).toBeNull();
    const first = store().saveWorkspace("Mine")!;
    store().patchLayout({ inspectorWidth: 400 });
    const second = store().saveWorkspace("mine")!;
    expect(second.id).toBe(first.id);
    expect(store().userWorkspaces).toHaveLength(1);
    expect(store().userWorkspaces[0].layout.inspectorWidth).toBe(400);
  });

  it("renames, updates and deletes user workspaces only", () => {
    const ws = store().saveWorkspace("A")!;
    expect(store().renameWorkspace(ws.id, "Audio")).toBe(false);
    expect(store().renameWorkspace(ws.id, "B")).toBe(true);
    store().patchLayout({ chatWidth: 480 });
    expect(store().updateWorkspace(ws.id)).toBe(true);
    expect(store().userWorkspaces[0].layout.chatWidth).toBe(480);
    expect(store().updateWorkspace("color")).toBe(false);
    expect(store().deleteWorkspace("color")).toBe(false);
    expect(store().deleteWorkspace(ws.id)).toBe(true);
    expect(store().activeId).toBe("editing");
  });

  it("reset puts the active workspace back as it was saved", () => {
    store().applyWorkspace("color");
    store().patchLayout({ inspectorWidth: 300 });
    store().resetActiveWorkspace();
    expect(store().layout.inspectorWidth).toBe(480);
  });

  it("clamps dock sizes", () => {
    store().patchLayout({ mediaWidth: 1, inspectorWidth: 99999 });
    expect(store().layout.mediaWidth).toBe(MIN_MEDIA_W);
    expect(store().layout.inspectorWidth).toBe(MAX_INSPECTOR_W);
  });

  it("persists user workspaces to the profile", () => {
    store().saveWorkspace("Persisted");
    const raw = JSON.parse(localStorage.getItem("openreel-workspaces") ?? "{}");
    expect(raw.state.userWorkspaces[0].name).toBe("Persisted");
  });

  it("drops malformed stored workspaces and fixes out-of-range values", () => {
    const clean = sanitizeWorkspaces([
      null,
      { id: "color", name: "Hijack", layout: {} },
      { id: "x", name: "   ", layout: {} },
      { id: "ok", name: "Fine", layout: { mediaWidth: -5, section: "bogus", mixerOpen: "yes" } },
    ]);
    expect(clean).toHaveLength(1);
    expect(clean[0].layout).toMatchObject({ mediaWidth: MIN_MEDIA_W, section: "media", mixerOpen: false });
    expect(sanitizeLayout({ timelineVh: Number.NaN }).timelineVh).toBe(DEFAULT_LAYOUT.timelineVh);
  });

  it("compares layouts with a small tolerance", () => {
    expect(layoutsEqual(DEFAULT_LAYOUT, { ...DEFAULT_LAYOUT, timelineVh: DEFAULT_LAYOUT.timelineVh + 0.2 })).toBe(true);
    expect(layoutsEqual(DEFAULT_LAYOUT, { ...DEFAULT_LAYOUT, section: "audio" })).toBe(false);
  });
});
