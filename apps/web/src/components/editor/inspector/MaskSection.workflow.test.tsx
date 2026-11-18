import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler } from "react";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MaskEngine, TitleEngine, type Clip, type Project, type Mask } from "@openreel/core";
import { createEditorMask, editClipMasks } from "../../../services/clip-masks";
import { selectOption } from "../../../test/select-option";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";

import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { MaskSection } from "./MaskSection";

const CLIP_ID = "mask-workflow-clip";

function clip(): Clip {
  return {
    id: CLIP_ID,
    mediaId: "mask-media",
    trackId: "mask-track",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
  };
}

function project(): Project {
  const empty = createEmptyProject("Mask workflow");
  return {
    ...empty,
    modifiedAt: 1,
    timeline: {
      ...empty.timeline,
      duration: 5,
      tracks: [
        {
          id: "mask-track",
          type: "video",
          name: "Video",
          clips: [clip()],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
}

describe("MaskSection professional workflow", () => {
  let engine: MaskEngine;
  let originalGetMaskEngine: ReturnType<typeof useEngineStore.getState>["getMaskEngine"];
  let originalTitleEngine: ReturnType<typeof useEngineStore.getState>["titleEngine"];

  beforeEach(() => {
    engine = new MaskEngine({ width: 1920, height: 1080 });
    originalGetMaskEngine = useEngineStore.getState().getMaskEngine;
    originalTitleEngine = useEngineStore.getState().titleEngine;
    useEngineStore.setState({ getMaskEngine: async () => engine, titleEngine: new TitleEngine() });
    useProjectStore.setState({
      hasOpenProject: true,
      project: project(),
    });
    useProjectStore.getState().actionHistory.clear();
    useProjectStore.getState().actionHistory.setAutoGroupWindow(0);
    useTimelineStore.setState({ playbackLockedReason: null });
    useUIStore.setState({ effectApplicationClipId: null, exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  });

  afterEach(() => {
    cleanup();
    useEngineStore.setState({ getMaskEngine: originalGetMaskEngine, titleEngine: originalTitleEngine });
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("creates an editable custom path, persists opacity, and duplicates all settings", async () => {
    render(<MaskSection clipId={CLIP_ID} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Add custom path mask" }),
    );

    await waitFor(() => {
      expect(engine.getMasksForClip(CLIP_ID)).toHaveLength(1);
      expect(useProjectStore.getState().project.masks).toHaveLength(1);
      expect(useProjectStore.getState().project.modifiedAt).toBeGreaterThan(1);
    });
    expect(screen.getByText("Path points")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Point 2 Y percent" })).toHaveValue("28");
    expect(
      screen.getByRole("spinbutton", { name: "Point 1 X percent" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Opacity value" }));
    const opacityInput = screen.getByRole("textbox", { name: "Opacity value" });
    fireEvent.change(opacityInput, { target: { value: "42%" } });
    fireEvent.keyDown(opacityInput, { key: "Enter" });

    await waitFor(() => {
      expect(engine.getMasksForClip(CLIP_ID)[0]?.opacity).toBe(0.42);
      expect(useProjectStore.getState().project.masks?.[0]?.opacity).toBe(0.42);
    });

    fireEvent.click(screen.getByRole("button", { name: "Duplicate Mask" }));
    await waitFor(() => {
      const masks = engine.getMasksForClip(CLIP_ID);
      expect(masks).toHaveLength(2);
      expect(masks[1]).toMatchObject({ type: "drawn", opacity: 0.42 });
      expect(useProjectStore.getState().project.masks).toHaveLength(2);
    });
  });

  it("refreshes the form after one Undo and Redo without reopening it", async () => {
    render(<MaskSection clipId={CLIP_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add custom path mask" }));
    await waitFor(() => expect(useProjectStore.getState().project.masks).toHaveLength(1));
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(screen.getByText("No masks on this clip")).toBeInTheDocument();
    await act(async () => { await useProjectStore.getState().redo(); });
    expect(screen.getByText("Masks (1)")).toBeInTheDocument();
  });

  it("keeps the form idle through unrelated project updates", async () => {
    const commits = vi.fn();
    render(<Profiler id="masks" onRender={commits}><MaskSection clipId={CLIP_ID} /></Profiler>);
    await act(async () => { await Promise.resolve(); });
    commits.mockClear();
    for (let i = 0; i < 60; i++) act(() => useProjectStore.setState(state => ({ project: { ...state.project, modifiedAt: i + 10 } })));
    expect(commits).not.toHaveBeenCalled();
  });

  function savedMask(): Mask {
    const mask = createEditorMask(CLIP_ID, "drawn");
    mask.path.points[0].handleIn = { x: .1, y: .2 };
    mask.keyframes = [{ id: "path-key", time: 1, easing: "ease-in-out", path: structuredClone(mask.path) }];
    return mask;
  }
  function seed(mask: Mask, extra: Mask[] = []) {
    useProjectStore.setState(state => ({ project: { ...state.project, masks: [mask, ...extra] } }));
  }

  it("reads saved masks even when the shared engine is displaying another clip", async () => {
    seed(savedMask());
    engine.loadMasks([createEditorMask("other-clip", "ellipse")]);
    render(<MaskSection clipId={CLIP_ID} />);
    expect(screen.getByText("Masks (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand mask" }));
    expect(screen.getByRole("spinbutton", { name: "Point 1 X percent" })).toHaveValue("50");
    expect(screen.getByText("1 keyframes")).toBeInTheDocument();
  });

  it("stages a point coordinate, preserves handles and animated paths, and restores one Undo", async () => {
    const mask = savedMask(); seed(mask);
    render(<MaskSection clipId={CLIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand mask" }));
    const input = screen.getByRole("spinbutton", { name: "Point 1 X percent" });
    fireEvent.focus(input); fireEvent.change(input, { target: { value: "-" } });
    expect(useProjectStore.getState().project.masks?.[0]).toEqual(mask);
    fireEvent.change(input, { target: { value: "0" } });
    expect(useProjectStore.getState().project.masks?.[0]).toEqual(mask);
    fireEvent.blur(input);
    await waitFor(() => expect(useProjectStore.getState().project.masks?.[0].path.points[0].x).toBe(0));
    expect(useProjectStore.getState().project.masks?.[0]).toEqual({ ...mask, path: { ...mask.path, points: mask.path.points.map((point, i) => i ? point : { ...point, x: 0 }) } });
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().project.masks?.[0]).toEqual(mask);
    expect(screen.getByRole("spinbutton", { name: "Point 1 X percent" })).toHaveValue("50");
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("keeps saved coordinate precision when focusing and blurring its rounded display", () => {
    const mask = savedMask(); mask.path.points[0].x = .12345678901234568; seed(mask);
    render(<MaskSection clipId={CLIP_ID} />); fireEvent.click(screen.getByRole("button", { name: "Expand mask" }));
    const input = screen.getByRole("spinbutton", { name: "Point 1 X percent" });
    expect(input).toHaveValue("12.3456789012"); fireEvent.focus(input); fireEvent.blur(input);
    expect(useProjectStore.getState().project.masks?.[0]).toEqual(mask);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("duplicates complete mask paths and keys without aliasing and clears only this clip", async () => {
    const mask = savedMask(), other = createEditorMask("other-clip", "rectangle"); seed(mask, [other]);
    render(<MaskSection clipId={CLIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Mask" }));
    await waitFor(() => expect(useProjectStore.getState().project.masks).toHaveLength(3));
    const copy = useProjectStore.getState().project.masks![2];
    expect(copy).toEqual({ ...mask, id: copy.id, keyframes: [{ ...mask.keyframes[0], id: copy.keyframes[0].id }] });
    expect(copy.id).not.toBe(mask.id); expect(copy.path).not.toBe(mask.path);
    expect(copy.keyframes[0].id).not.toBe(mask.keyframes[0].id);
    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    await waitFor(() => expect(useProjectStore.getState().project.masks).toEqual([other]));
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().project.masks).toEqual([mask, other, copy]);
    expect(screen.getByText("Masks (2)")).toBeInTheDocument();
  });

  it("preserves every matte channel, source and animated path through selection and Undo", async () => {
    const second = { ...clip(), id: "source-clip", mediaId: "source-media" };
    useProjectStore.setState(state => ({ project: { ...state.project, timeline: { ...state.project.timeline, tracks: state.project.timeline.tracks.map(track => ({ ...track, clips: [...track.clips, second] })) } } }));
    const mask = { ...savedMask(), type: "track-matte" as const, sourceClipId: "missing", matteSource: "alpha" as const }; seed(mask);
    render(<MaskSection clipId={CLIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand mask" }));
    expect(screen.getByRole("combobox", { name: "Matte source" })).toHaveTextContent("Missing clip");
    await selectOption(screen.getByRole("combobox", { name: "Matte source" }), "Video • source-m");
    await waitFor(() => expect(useProjectStore.getState().project.masks?.[0].sourceClipId).toBe(second.id));
    for (const channel of ["bounds", "alpha", "luminance"] as const) {
      fireEvent.click(screen.getByRole("radio", { name: channel }));
      await waitFor(() => expect(useProjectStore.getState().project.masks?.[0].matteSource).toBe(channel));
      expect(useProjectStore.getState().project.masks?.[0].keyframes).toEqual(mask.keyframes);
      expect(useProjectStore.getState().project.masks?.[0].path).toEqual(mask.path);
    }
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(screen.getByRole("radio", { name: "alpha" })).toHaveAttribute("aria-checked", "true");
  });

  it("unmounts collapsed path controls and keeps disclosure/action buttons independent", () => {
    seed(savedMask()); render(<MaskSection clipId={CLIP_ID} />);
    const group = screen.getByRole("group", { name: "Mask 1: Drawn Mask" });
    const expand = within(group).getByRole("button", { name: "Expand mask" });
    expect(expand).toHaveAttribute("aria-expanded", "false"); fireEvent.click(expand);
    expect(within(group).getByRole("button", { name: "Collapse mask" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Collapse mask" }));
    expect(screen.queryByRole("spinbutton", { name: "Point 1 X percent" })).not.toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Duplicate Mask" })).toBeEnabled();
  });

  it("rejects stale, locked, exporting and processing edits at invocation", async () => {
    const scope = { projectId: useProjectStore.getState().project.id, clipId: CLIP_ID, history: useProjectStore.getState().actionHistory };
    const add = (masks: readonly Mask[]) => [...masks, savedMask()];
    useProjectStore.setState(state => ({ project: { ...state.project, timeline: { ...state.project.timeline, tracks: state.project.timeline.tracks.map(track => ({ ...track, locked: true })) } } }));
    expect(await editClipMasks(scope, add)).toBe(false);
    useProjectStore.setState(state => ({ project: { ...state.project, timeline: { ...state.project.timeline, tracks: state.project.timeline.tracks.map(track => ({ ...track, locked: false })) } } }));
    useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: true } });
    expect(await editClipMasks(scope, add)).toBe(false);
    useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
    useTimelineStore.setState({ playbackLockedReason: "Processing" }); expect(await editClipMasks(scope, add)).toBe(false);
    useTimelineStore.setState({ playbackLockedReason: null });
    useProjectStore.getState().loadProject({ ...useProjectStore.getState().project });
    expect(await editClipMasks(scope, add)).toBe(false);
    expect(useProjectStore.getState().project.masks ?? []).toEqual([]);
  });

  it("retains the complete shaded title and concurrent project edits while changing a mask", async () => {
    const raw = useProjectStore.getState().createTextClip("mask-track", 0, "Retained shade", 5, { shader: { shaderId: "paper-mesh-gradient", params: { color1: "#ee44aa" }, progress: .37 } })!;
    const title = { ...raw, keyframes: Array.from({ length: 33 }, (_, i) => ({ id: `tracking-${i}`, time: i / 24, property: "position.x", value: i / 100, easing: "linear" as const })) };
    useEngineStore.getState().titleEngine!.loadTextClips([title]);
    const mask = savedMask();
    useProjectStore.setState(state => ({ project: { ...state.project, textClips: [title], masks: [mask] } }));
    const state = useProjectStore.getState(); state.actionHistory.clear();
    const pending = editClipMasks({ projectId: state.project.id, clipId: CLIP_ID, history: state.actionHistory }, masks => masks.map(current => ({ ...current, opacity: 0 })));
    useProjectStore.setState(current => ({ project: { ...current.project, settings: { ...current.project.settings, width: 1280 } } }));
    await pending;
    expect(useProjectStore.getState().project.settings.width).toBe(1280);
    expect(useProjectStore.getState().getFullProject().textClips).toEqual([title]);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().project.masks).toEqual([mask]);
    expect(useProjectStore.getState().project.settings.width).toBe(1280);
    expect(useProjectStore.getState().getFullProject().textClips).toEqual([title]);
  });

  it("does not replace a newly opened project when an earlier mask action completes", async () => {
    const state = useProjectStore.getState();
    const pending = editClipMasks({ projectId: state.project.id, clipId: CLIP_ID, history: state.actionHistory }, masks => [...masks, savedMask()]);
    const replacement = { ...project(), id: "replacement-project", name: "Replacement", masks: [] };
    useProjectStore.getState().loadProject(replacement);
    expect(await pending).toBe(false);
    expect(useProjectStore.getState().project).toMatchObject({ id: replacement.id, name: "Replacement", masks: [] });
  });

  it.each(["Rectangle", "Ellipse", "Polygon"])("retains the %s shape and its zero-value settings through one Undo", async name => {
    render(<MaskSection clipId={CLIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(useProjectStore.getState().project.masks).toHaveLength(1));
    expect(useProjectStore.getState().project.masks?.[0]).toMatchObject({ type: "shape", feathering: 0, expansion: 0, opacity: 1, inverted: false, keyframes: [], path: { closed: true } });
    expect(useProjectStore.getState().project.masks?.[0].path.points).toHaveLength(4);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(screen.getByText("No masks on this clip")).toBeInTheDocument();
  });
});
