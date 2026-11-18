import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MaskEngine, TitleEngine, type Clip, type Project } from "@openreel/core";
import { createEditorMask } from "../../../services/clip-masks";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { MaskSection } from "./MaskSection";

const CLIP_ID = "mask-combine-clip";

function project(): Project {
  const empty = createEmptyProject("Mask combine");
  const clip: Clip = {
    id: CLIP_ID, mediaId: "m", trackId: "mask-track", startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
    effects: [], audioEffects: [], volume: 1, keyframes: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  };
  return {
    ...empty,
    masks: [createEditorMask(CLIP_ID, "rectangle"), createEditorMask(CLIP_ID, "ellipse")],
    timeline: {
      ...empty.timeline,
      duration: 5,
      tracks: [{ id: "mask-track", type: "video", name: "Video", clips: [clip], transitions: [], locked: false, hidden: false, muted: false, solo: false }],
    },
  };
}

describe("MaskSection combine modes", () => {
  let originalGetMaskEngine: ReturnType<typeof useEngineStore.getState>["getMaskEngine"];
  let originalTitleEngine: ReturnType<typeof useEngineStore.getState>["titleEngine"];

  beforeEach(() => {
    const engine = new MaskEngine({ width: 1920, height: 1080 });
    originalGetMaskEngine = useEngineStore.getState().getMaskEngine;
    originalTitleEngine = useEngineStore.getState().titleEngine;
    useEngineStore.setState({ getMaskEngine: async () => engine, titleEngine: new TitleEngine() });
    useProjectStore.setState({ hasOpenProject: true, project: project() });
    useProjectStore.getState().actionHistory.clear();
    useProjectStore.getState().actionHistory.setAutoGroupWindow(0);
    useTimelineStore.setState({ playbackLockedReason: null });
    useUIStore.setState({ effectApplicationClipId: null, exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  });

  afterEach(() => {
    cleanup();
    useEngineStore.setState({ getMaskEngine: originalGetMaskEngine, titleEngine: originalTitleEngine });
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Reset") });
  });

  it("offers combine modes only from the second mask and saves the choice undoably", async () => {
    render(<MaskSection clipId={CLIP_ID} />);
    for (const button of screen.getAllByRole("button", { name: "Expand mask" })) fireEvent.click(button);
    const groups = screen.getAllByRole("group", { name: /^Mask \d/ });
    expect(groups).toHaveLength(2);
    expect(screen.getAllByLabelText("Mask combine mode")).toHaveLength(1);

    fireEvent.click(screen.getByRole("radio", { name: "Combine mode subtract" }));
    await waitFor(() => expect(useProjectStore.getState().project.masks?.[1]?.combine).toBe("subtract"));
    expect(useProjectStore.getState().project.masks?.[0]?.combine).toBeUndefined();

    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().project.masks?.[1]?.combine).toBeUndefined();
  });
});
