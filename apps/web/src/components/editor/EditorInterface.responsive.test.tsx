import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorInterface } from "./EditorInterface";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useInspectorNavigationStore } from "../../stores/inspector-navigation-store";
import { useTimelineStore } from "../../stores/timeline-store";
import type { Clip, Keyframe } from "@openreel/core";
// Compile the real lazy module during collection, outside DOM readiness waits.
import "./mobile/MobileEditorTools";

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
vi.mock("./KeyframeEditorPanel", () => ({ KeyframeEditorPanel: ({ onClose, onUpdateKeyframes, onDeleteKeyframes, disabled }: {
  onClose: () => void; onUpdateKeyframes: (ids: string[], updates: Partial<Keyframe>) => void;
  onDeleteKeyframes: (ids: string[]) => void; disabled: boolean;
}) => <div aria-label="Keyframe editor test surface">
  <button disabled={disabled} onClick={() => onUpdateKeyframes(["a", "b"], { easing: "easeInCubic" })}>Ease both keys</button>
  <button disabled={disabled} onClick={() => onDeleteKeyframes(["a", "b"])}>Delete both keys</button>
  <button onClick={onClose}>Close graph</button>
</div> }));
vi.mock("../audio-mixer", () => ({ AudioMixer: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>Close mixer</button> }));
vi.mock("./KeyboardShortcutsOverlay", () => ({ KeyboardShortcutsOverlay: () => null }));
vi.mock("./tour/TourHost", () => ({ default: () => null }));

const mediaListeners = new Set<() => void>();
let coarsePointer = true;
let hover = false;

function matchesMedia(query: string) {
  return query.split(",").some(part => {
    const maxWidth = part.match(/max-width:\s*(\d+)px/);
    return (!maxWidth || window.innerWidth <= Number(maxWidth[1]))
      && (!part.includes("pointer: coarse") || coarsePointer)
      && (!part.includes("hover: none") || !hover);
  });
}

function resize(width: number) {
  act(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    window.dispatchEvent(new Event("resize"));
    for (const listener of mediaListeners) listener();
  });
}

describe("compact editing workspace", () => {
  const originalWidth = window.innerWidth;
  beforeEach(() => {
    coarsePointer = true;
    hover = false;
    useTimelineStore.setState({ playbackLockedReason: null });
    useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
    useInspectorNavigationStore.getState().clearRequest();
    resize(390);
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({
      matches: matchesMedia(query), media: query, onchange: null,
      addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
    } as unknown as MediaQueryList));
    const panels = useUIStore.getState().panels;
    useUIStore.setState({ keyframeEditorOpen: false, selectedItems: [], panels: {
      ...panels, agentChat: { ...panels.agentChat, visible: false },
      audioMixer: { ...panels.audioMixer, visible: false },
    } });
    vi.spyOn(useProjectStore.getState(), "initializeAutoSave").mockResolvedValue();
  });
  afterEach(() => { cleanup(); mediaListeners.clear(); vi.restoreAllMocks(); resize(originalWidth); });

  function graphProject() {
    useProjectStore.getState().createNewProject("Graph transaction check");
    const project = useProjectStore.getState().project;
    const trackId = project.timeline.tracks[0].id;
    const keys: Keyframe[] = [
      { id: "a", property: "opacity", time: 0, value: 0, easing: "linear" },
      { id: "b", property: "opacity", time: 4, value: 1, easing: "linear" },
      { id: "manual", property: "rotation", time: 1, value: 17, easing: "linear" },
    ];
    const clip: Clip = { id: "graph", trackId, mediaId: "media", startTime: 0, duration: 4, inPoint: 0, outPoint: 4,
      volume: 1, effects: [], audioEffects: [], keyframes: keys,
      transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } };
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: project.timeline.tracks.map(track => track.id === trackId ? { ...track, clips: [clip] } : track),
    } } });
    useUIStore.setState({ keyframeEditorOpen: true, selectedItems: [{ type: "clip", id: clip.id }] });
    return keys;
  }
  it("edits or deletes a full selection in one real history action and one Undo", async () => {
    const keys = graphProject(); const view = render(<EditorInterface/>);
    fireEvent.click(await view.findByRole("button", { name: "Ease both keys" }));
    expect(useProjectStore.getState().getClip("graph")?.keyframes.map(key => key.easing)).toEqual(["easeInCubic", "easeInCubic", "linear"]);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getClip("graph")?.keyframes).toEqual(keys);
    expect(useProjectStore.getState().canUndo()).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "Delete both keys" }));
    expect(useProjectStore.getState().getClip("graph")?.keyframes).toEqual([keys[2]]);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getClip("graph")?.keyframes).toEqual(keys);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
});
