import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Clip, Project, TextClip } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useEngineStore } from "../../stores/engine-store";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { InspectorPanel } from "./InspectorPanel";

const TRACK_ID = "batch-track";
const CLIP_IDS = ["batch-a", "batch-b"];
const TEXT_CLIP_IDS = ["batch-text-a", "batch-text-b"];

function clip(id: string, startTime: number, x: number): Clip {
  return {
    id,
    mediaId: `media-${id}`,
    trackId: TRACK_ID,
    startTime,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x, y: 40 },
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
  const empty = createEmptyProject("Batch inspector");
  return {
    ...empty,
    timeline: {
      ...empty.timeline,
      duration: 6,
      tracks: [
        {
          id: TRACK_ID,
          type: "video",
          name: "Video",
          clips: [clip(CLIP_IDS[0], 0, 0), clip(CLIP_IDS[1], 2, 100)],
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

function selectBoth(): void {
  useUIStore.getState().selectMultiple(
    CLIP_IDS.map((id) => ({ type: "clip" as const, id, trackId: TRACK_ID })),
  );
}

function storedClips(): readonly Clip[] {
  return useProjectStore.getState().project.timeline.tracks[0]?.clips ?? [];
}

function textClip(id: string, x: number): TextClip {
  return {
    id,
    trackId: "text-track",
    startTime: 0,
    duration: 5,
    text: id,
    style: {
      fontFamily: "Inter",
      fontSize: 72,
      fontWeight: "bold",
      fontStyle: "normal",
      color: "#ffffff",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    transform: {
      position: { x, y: 0.5 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    keyframes: [],
  };
}

describe("InspectorPanel multi-clip workflow", () => {
  beforeEach(() => {
    useEngineStore.getState().getTitleEngine()?.clear();
    useProjectStore.setState({ hasOpenProject: true, project: project() });
    selectBoth();
  });

  afterEach(() => {
    cleanup();
    useEngineStore.getState().getTitleEngine()?.clear();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("shows the batch inspector instead of the empty state", () => {
    render(<InspectorPanel />);

    expect(screen.getAllByText("2 clips selected").length).toBeGreaterThan(0);
    expect(screen.getByText("Batch Transform")).toBeInTheDocument();
    expect(screen.queryByText("No selection")).toBeNull();
  });

  it("nudges every selected visual clip", async () => {
    render(<InspectorPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Nudge clips right" }));

    await waitFor(() => {
      expect(storedClips().map((entry) => entry.transform.position.x)).toEqual([
        10, 110,
      ]);
    });
  });

  it("aligns timeline clip positions to the canvas center", async () => {
    render(<InspectorPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: "Align positions center" }),
    );

    await waitFor(() => {
      expect(storedClips().map((entry) => entry.transform.position.x)).toEqual([
        0, 0,
      ]);
    });
  });

  it("nudges text overlays in normalized canvas coordinates without changing scale", async () => {
    const textClips = [textClip(TEXT_CLIP_IDS[0], 0.25), textClip(TEXT_CLIP_IDS[1], 0.75)];
    useEngineStore.getState().getTitleEngine()?.loadTextClips(textClips);
    useProjectStore.setState((state) => ({
      project: { ...state.project, textClips },
    }));
    useUIStore.getState().selectMultiple(
      TEXT_CLIP_IDS.map((id) => ({ type: "text-clip" as const, id, trackId: "text-track" })),
    );
    render(<InspectorPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Nudge clips right" }));

    await waitFor(() => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      expect(
        TEXT_CLIP_IDS.map((id) => titleEngine?.getTextClip(id)?.transform.position.x),
      ).toEqual([0.25 + 10 / 1920, 0.75 + 10 / 1920]);
      expect(
        TEXT_CLIP_IDS.map((id) => titleEngine?.getTextClip(id)?.transform.scale.x),
      ).toEqual([1, 1]);
    });
  });

  it("aligns normalized overlay positions to the canvas edge", async () => {
    const textClips = [textClip(TEXT_CLIP_IDS[0], 0.25), textClip(TEXT_CLIP_IDS[1], 0.75)];
    useEngineStore.getState().getTitleEngine()?.loadTextClips(textClips);
    useProjectStore.setState((state) => ({
      project: { ...state.project, textClips },
    }));
    useUIStore.getState().selectMultiple(
      TEXT_CLIP_IDS.map((id) => ({ type: "text-clip" as const, id, trackId: "text-track" })),
    );
    render(<InspectorPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: "Align positions left" }),
    );

    await waitFor(() => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      expect(
        TEXT_CLIP_IDS.map((id) => titleEngine?.getTextClip(id)?.transform.position.x),
      ).toEqual([0, 0]);
    });
  });

  it("applies batch text properties to every selected caption clip", async () => {
    const textClips = [
      textClip(TEXT_CLIP_IDS[0], 0.25),
      {
        ...textClip(TEXT_CLIP_IDS[1], 0.75),
        style: {
          ...textClip(TEXT_CLIP_IDS[1], 0.75).style,
          fontSize: 48,
          fontWeight: "normal" as const,
          textAlign: "right" as const,
        },
      },
    ];
    useEngineStore.getState().getTitleEngine()?.loadTextClips(textClips);
    useProjectStore.setState((state) => ({
      project: { ...state.project, textClips },
    }));
    useUIStore.getState().selectMultiple(
      TEXT_CLIP_IDS.map((id) => ({ type: "text-clip" as const, id, trackId: "text-track" })),
    );
    render(<InspectorPanel />);

    expect(screen.getByText("Batch Text")).toBeInTheDocument();
    expect(screen.queryByLabelText("Text Content")).toBeNull();
    expect(screen.getByText("Text Material")).toBeInTheDocument();
    expect(screen.getByText("3D Text")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    fireEvent.click(screen.getByRole("button", { name: "Left" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Preview and select Glyph Dissolve" }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "3D Text" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Size" }), {
      target: { value: "36" },
    });

    await waitFor(() => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const updated = TEXT_CLIP_IDS.map((id) => titleEngine?.getTextClip(id));
      expect(updated.map((entry) => entry?.style.fontWeight)).toEqual(["bold", "bold"]);
      expect(updated.map((entry) => entry?.style.textAlign)).toEqual(["left", "left"]);
      expect(updated.map((entry) => entry?.style.fontSize)).toEqual([36, 36]);
      expect(updated.map((entry) => entry?.style.shader?.shaderId)).toEqual([
        "glyph-dissolve",
        "glyph-dissolve",
      ]);
      expect(updated.map((entry) => entry?.text3d?.enabled)).toEqual([true, true]);
      expect(updated.map((entry) => entry?.text)).toEqual(TEXT_CLIP_IDS);
    });
  });

  it("duplicates text overlays with shader styling and transforms intact", async () => {
    const textClips = [textClip(TEXT_CLIP_IDS[0], 0.25), textClip(TEXT_CLIP_IDS[1], 0.75)].map(
      (entry) => ({
        ...entry,
        style: {
          ...entry.style,
          shader: {
            shaderId: "paper-riso",
            params: { intensity: 0.8 },
          },
        },
      }),
    );
    useEngineStore.getState().getTitleEngine()?.loadTextClips(textClips);
    useProjectStore.setState((state) => ({
      project: { ...state.project, textClips },
    }));
    useUIStore.getState().selectMultiple(
      TEXT_CLIP_IDS.map((id) => ({ type: "text-clip" as const, id, trackId: "text-track" })),
    );
    render(<InspectorPanel />);

    expect(screen.queryByText("Compound Clip")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate 2 selected clips" }),
    );

    await waitFor(() => {
      const allTextClips =
        useEngineStore.getState().getTitleEngine()?.getAllTextClips() ?? [];
      expect(allTextClips).toHaveLength(4);
      const duplicates = allTextClips.filter(
        (entry) => !TEXT_CLIP_IDS.includes(entry.id),
      );
      expect(duplicates.map((entry) => entry.transform.position.x)).toEqual([
        0.25, 0.75,
      ]);
      expect(duplicates.map((entry) => entry.style.shader?.shaderId)).toEqual([
        "paper-riso",
        "paper-riso",
      ]);
      expect(useProjectStore.getState().project.textClips).toHaveLength(4);
    });
  });

  it("queues rapid shared opacity edits and keeps the final value", async () => {
    render(<InspectorPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Opacity value" }));
    let input = screen.getByRole("textbox", { name: "Opacity value" });
    fireEvent.change(input, { target: { value: "70%" } });
    fireEvent.blur(input);

    fireEvent.click(screen.getByRole("button", { name: "Edit Opacity value" }));
    input = screen.getByRole("textbox", { name: "Opacity value" });
    fireEvent.change(input, { target: { value: "35%" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(storedClips().map((entry) => entry.transform.opacity)).toEqual([
        0.35, 0.35,
      ]);
    });
  });

  it("copies and replaces effect stacks across selected visual layers", async () => {
    await useProjectStore
      .getState()
      .replaceVideoEffects(CLIP_IDS[0], [
        {
          id: "source-glow",
          type: "glow",
          enabled: true,
          params: { intensity: 0.75, radius: 24 },
          order: 0,
        },
      ]);
    await useProjectStore
      .getState()
      .replaceVideoEffects(CLIP_IDS[1], [
        {
          id: "old-blur",
          type: "blur",
          enabled: true,
          params: { radius: 8 },
          order: 0,
        },
      ]);
    render(<InspectorPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: "Copy first effect stack" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Replace effects on selection" }),
    );

    await waitFor(() => {
      const stacks = CLIP_IDS.map((id) =>
        useProjectStore.getState().getVideoEffects(id),
      );
      expect(stacks.map((effects) => effects.map((effect) => effect.type))).toEqual([
        ["glow"],
        ["glow"],
      ]);
      expect(stacks[0]?.[0]?.params).toEqual({ intensity: 0.75, radius: 24 });
      expect(stacks[1]?.[0]?.params).toEqual({ intensity: 0.75, radius: 24 });
      expect(stacks[0]?.[0]?.id).not.toBe("source-glow");
      expect(stacks[1]?.[0]?.id).not.toBe("source-glow");
      expect(stacks[0]?.[0]?.id).not.toBe(stacks[1]?.[0]?.id);
    });
  });

  it("deletes the complete selection and clears inspector selection", async () => {
    render(<InspectorPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: "Delete selected clips" }),
    );

    await waitFor(() => {
      expect(storedClips()).toHaveLength(0);
      expect(useUIStore.getState().getSelectedClipIds()).toEqual([]);
    });
  });
});
