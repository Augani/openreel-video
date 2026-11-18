import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Button } from "@openreel/ui";
import { GraphicsEngine, TitleEngine } from "@openreel/core";
import { useUIStore } from "../../stores/ui-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { SearchModal } from "./SearchModal";
import { InspectorPanel } from "./InspectorPanel";
import { useEngineStore } from "../../stores/engine-store";
import { useInspectorNavigationStore } from "../../stores/inspector-navigation-store";

function SearchInspector() {
  const [open, setOpen] = useState(false);
  return <>
    <InspectorPanel />
    <Button onClick={() => setOpen(true)}>Search inspector</Button>
    <SearchModal isOpen={open} onClose={() => setOpen(false)} />
  </>;
}


describe("SearchModal inspector routing", () => {
  beforeEach(() => {
    useInspectorNavigationStore.getState().clearRequest();
    useUIStore.setState({
      selectedItems: [{ type: "text-clip", id: "text-1" }],
    });
  });

  afterEach(() => {
    cleanup();
    useInspectorNavigationStore.getState().clearRequest();
    useUIStore.getState().clearSelection();
    vi.restoreAllMocks();
  });

  it.each(["svg", "sticker"] as const)("uses the real %s capability when searching and navigating", async kind => {
    useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
    useProjectStore.getState().createNewProject("Search graphics");
    const state = useProjectStore.getState(), track = state.project.timeline.tracks[0];
    const clip = kind === "svg" ? state.importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>', track.id, 0, 5)!
      : state.createStickerClip({ id: "search-sticker", trackId: track.id, startTime: 0, duration: 5, type: "emoji", imageUrl: "data:image/png;base64,AA==", keyframes: [], effects: [],
        transform: { position: { x: .5, y: .5 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } } })!;
    useUIStore.getState().select({ type: "shape-clip", id: clip.id, trackId: track.id });
    state.actionHistory.clear();
    const original = useProjectStore.getState().project;
    render(<SearchInspector />);
    fireEvent.click(screen.getByRole("button", { name: "Search inspector" }));
    expect(screen.getByText(`Find tools for the selected ${kind} clip.`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Shape Shader Fill" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Speed Control" })).toBeNull();
    const tool = kind === "svg" ? "SVG Properties" : "Motion Path";
    fireEvent.click(screen.getByRole("button", { name: `Open ${tool}` }));
    expect(await screen.findByRole("tab", { name: kind === "svg" ? "SVG" : "Animation" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: `Collapse ${tool} section` })).toBeInTheDocument();
    expect(useProjectStore.getState().project).toBe(original);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("finds retained particle effects for an SVG and opens its actual form", async () => {
    useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
    useProjectStore.getState().createNewProject("Particle search");
    const state=useProjectStore.getState(),track=state.project.timeline.tracks[0];
    const clip=state.importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>',track.id,0,5)!;
    useUIStore.getState().select({type:"shape-clip",id:clip.id,trackId:track.id});
    render(<SearchInspector/>);fireEvent.click(screen.getByRole("button",{name:"Search inspector"}));fireEvent.change(screen.getByRole("textbox",{name:"Search effects"}),{target:{value:"confetti"}});
    fireEvent.click(screen.getByRole("button",{name:"Open Particle Effects"}));
    expect(await screen.findByRole("button",{name:"Collapse Particle Effects section"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Preview Celebration Confetti"}));fireEvent.click(screen.getByRole("button",{name:"Add"}));
    await waitFor(()=>expect(useProjectStore.getState().project.particleEffects?.[0]).toMatchObject({clipId:clip.id,type:"confetti"}));
  });

  it("dismisses tools from the old project when the project is replaced", async () => {
    render(<SearchInspector />);
    fireEvent.click(screen.getByRole("button", { name: "Search inspector" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => useProjectStore.setState({ project: createEmptyProject("Replacement search owner") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useInspectorNavigationStore.getState().request).toBeNull();
  });

  it.each(["Text Properties", "Text Materials & Shaders"])(
    "opens the real advanced text controls from Transform through %s without editing the title",
    async (tool) => {
      useEngineStore.setState({ titleEngine: new TitleEngine() });
      useProjectStore.getState().createNewProject("Search navigation");
      const track = useProjectStore.getState().project.timeline.tracks.find((item) => item.type === "text")!;
      const title = useProjectStore.getState().createTextClip(track.id, 0, "Golden Hour", 5)!;
      useUIStore.getState().select({ type: "text-clip", id: title.id, trackId: track.id });
      useProjectStore.getState().actionHistory.clear();
      const original = useProjectStore.getState().project;
      await act(async () => { render(<SearchInspector />); });
      expect(screen.getByRole("button", { name: "Expand Advanced text properties section" })).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Transform" }), { button: 0, ctrlKey: false });
      expect(screen.getByRole("tab", { name: "Transform" })).toHaveAttribute("aria-selected", "true");
      fireEvent.click(screen.getByRole("button", { name: "Search inspector" }));
      if (tool === "Text Materials & Shaders") {
        const query = screen.getByRole("textbox", { name: "Search effects" });
        fireEvent.change(query, { target: { value: "materials" } });
        fireEvent.keyDown(query, { key: "Enter" });
      } else {
        fireEvent.click(screen.getByRole("button", { name: `Open ${tool}` }));
      }
      expect(await screen.findByRole("button", { name: "Collapse Advanced text properties section" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Text" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("combobox", { name: "Text Material" })).toBeInTheDocument();
      if (tool === "Text Materials & Shaders") {
        await waitFor(() => expect(screen.getByRole("combobox", { name: "Text Material" })).toHaveFocus());
      }
      expect(useProjectStore.getState().project).toBe(original);
      expect(useProjectStore.getState().canUndo()).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Collapse Advanced text properties section" }));
      fireEvent.click(screen.getByRole("button", { name: "Search inspector" }));
      fireEvent.click(screen.getByRole("button", { name: `Open ${tool}` }));
      expect(await screen.findByRole("combobox", { name: "Text Material" })).toBeInTheDocument();
      expect(useProjectStore.getState().project).toBe(original);
    },
  );

  it.each(["Clear search", "Close dialog"])(
    "lets Enter activate %s without selecting the highlighted tool",
    (name) => {
      const onClose = vi.fn();
      render(<SearchModal isOpen onClose={onClose} />);
      const query = screen.getByRole("textbox", { name: "Search effects" });
      fireEvent.change(query, { target: { value: "materials" } });
      const button = screen.getByRole("button", { name });
      button.focus();
      // JSDOM does not synthesize the native button click after Enter.
      if (fireEvent.keyDown(button, { key: "Enter" })) fireEvent.click(button);
      expect(useInspectorNavigationStore.getState().request).toBeNull();
      if (name === "Clear search") {
        expect(query).toHaveValue("");
        expect(onClose).not.toHaveBeenCalled();
      } else {
        expect(onClose).toHaveBeenCalledOnce();
      }
    },
  );

  it("classifies ordinary clips from their project track instead of assuming video", () => {
    const project = createEmptyProject("Search routing");
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [
            {
              id: "audio-track",
              name: "Voiceover",
              type: "audio",
              clips: [
                {
                  id: "audio-clip",
                  mediaId: "audio-media",
                  trackId: "audio-track",
                  startTime: 0,
                  duration: 4,
                  inPoint: 0,
                  outPoint: 4,
                  speed: 1,
                  volume: 1,
                  transform: {
                    position: { x: 0, y: 0 },
                    scale: { x: 1, y: 1 },
                    rotation: 0,
                    anchor: { x: 0.5, y: 0.5 },
                    opacity: 1,
                  },
                  effects: [],
                  audioEffects: [],
                  keyframes: [],
                },
              ],
              transitions: [],
              muted: false,
              locked: false,
              hidden: false,
              solo: false,
            },
          ],
        },
      },
    });
    useUIStore.setState({
      selectedItems: [{ type: "clip", id: "audio-clip" }],
    });

    render(<SearchModal isOpen onClose={vi.fn()} />);

    expect(screen.getByText("Audio Effects")).toBeInTheDocument();
    expect(screen.queryByText("Visual Effects")).toBeNull();
    expect(screen.getByText(/selected audio clip/i)).toBeInTheDocument();
  });
});
