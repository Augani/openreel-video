import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorInterface } from "./EditorInterface";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";

vi.mock("../../hooks/useEditorInitialization", () => ({
  useEditorInitialization: () => ({ initialized: true, initializing: false }),
}));
vi.mock("../../hooks/useKeyboardShortcuts", () => ({
  useKeyboardShortcuts: () => ({ showShortcutsOverlay: false, setShowShortcutsOverlay: vi.fn() }),
}));
vi.mock("./Toolbar", () => ({ Toolbar: () => <header>Toolbar</header> }));
vi.mock("./EditorActionRail", () => ({ EditorActionRail: () => <nav>Tools</nav> }));
vi.mock("./AssetsPanel", () => ({ AssetsPanel: () => <input aria-label="Media search" /> }));
vi.mock("./InspectorPanel", () => ({ InspectorPanel: () => <input aria-label="Clip title" /> }));
vi.mock("./Preview", () => ({ Preview: () => <canvas aria-label="Video preview" /> }));
vi.mock("./Timeline", () => ({ Timeline: () => <input aria-label="Timeline state" /> }));
vi.mock("./chat/ChatPanel", () => ({ ChatPanel: ({ onClose }: { onClose: () => void }) =>
  <div><input aria-label="AI message" /><button onClick={onClose}>Close AI</button></div>,
}));
vi.mock("./KeyframeEditorPanel", () => ({ KeyframeEditorPanel: () => null }));
vi.mock("../audio-mixer", () => ({ AudioMixer: () => null }));
vi.mock("./KeyboardShortcutsOverlay", () => ({ KeyboardShortcutsOverlay: () => null }));
vi.mock("./tour", () => ({ SpotlightTour: () => null, MoGraphTour: () => null }));

function resize(width: number) {
  act(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    window.dispatchEvent(new Event("resize"));
  });
}

describe("compact editing workspace", () => {
  const originalWidth = window.innerWidth;
  beforeEach(() => {
    resize(390);
    const panels = useUIStore.getState().panels;
    useUIStore.setState({ keyframeEditorOpen: false, selectedItems: [], panels: {
      ...panels, agentChat: { ...panels.agentChat, visible: false },
      audioMixer: { ...panels.audioMixer, visible: false },
    } });
    vi.spyOn(useProjectStore.getState(), "initializeAutoSave").mockResolvedValue();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resize(originalWidth); });

  it("keeps preview, media search, inspector and timeline state mounted across phone tabs and desktop resize", () => {
    const view = render(<EditorInterface />);
    const canvas = view.getByLabelText("Video preview");
    const media = view.getByLabelText("Media search") as HTMLInputElement;
    const title = view.getByLabelText("Clip title") as HTMLInputElement;
    const timeline = view.getByLabelText("Timeline state") as HTMLInputElement;
    media.value = "family"; title.value = "My video"; timeline.value = "scroll 500";
    expect(view.container.querySelector("#editor-panel-timeline")).not.toHaveAttribute("hidden");
    for (const panel of ["Media", "Edit", "Timeline"]) {
      fireEvent.click(view.getByRole("button", { name: panel }));
      expect(view.getByLabelText("Video preview")).toBe(canvas);
      expect(view.getByRole("button", { name: panel })).toHaveAttribute("aria-pressed", "true");
    }
    expect(view.getByLabelText("Media search")).toBe(media);
    expect(media.value).toBe("family"); expect(title.value).toBe("My video");
    expect(timeline.value).toBe("scroll 500");
    resize(820);
    expect(view.getByRole("navigation", { name: "Editor workspace" })).toBeInTheDocument();
    resize(1600);
    expect(view.queryByRole("navigation", { name: "Editor workspace" })).toBeNull();
    expect(view.container.querySelector("#editor-panel-inspector")).not.toHaveAttribute("hidden");
    expect(view.getByLabelText("Video preview")).toBe(canvas);
    resize(390);
    expect(title.value).toBe("My video");
  });

  it("preserves AI drafts after switching panels and returns to timeline when AI closes", async () => {
    const view = render(<EditorInterface />);
    fireEvent.click(view.getByRole("button", { name: "AI" }));
    const input = await view.findByLabelText("AI message") as HTMLInputElement;
    input.value = "Make this shorter";
    fireEvent.click(view.getByRole("button", { name: "Timeline" }));
    fireEvent.click(view.getByRole("button", { name: "AI" }));
    expect(view.getByLabelText("AI message")).toBe(input);
    expect(input.value).toBe("Make this shorter");
    fireEvent.click(view.getByRole("button", { name: "Close AI" }));
    expect(view.getByRole("button", { name: "Timeline" })).toHaveAttribute("aria-pressed", "true");
  });
});
