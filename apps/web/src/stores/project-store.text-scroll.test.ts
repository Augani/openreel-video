import "../test/install-local-storage-mock";
import { describe, expect, it } from "vitest";
import { titleEngine } from "@openreel/core";
import { useProjectStore } from "./project-store";
import { useEngineStore } from "./engine-store";
import { createEmptyProject } from "./project/project-helpers";

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("text scroll survives engine-backed edits", () => {
  it("keeps scroll after an in-place text edit and restores it on undo", async () => {
    titleEngine.initialize(1920, 1080);
    useEngineStore.setState({ titleEngine });
    const base = createEmptyProject("Scroll");
    useProjectStore.getState().loadProject({
      ...base,
      timeline: {
        ...base.timeline,
        tracks: [
          {
            id: "text-track",
            name: "Text",
            type: "text",
            hidden: false,
            locked: false,
            muted: false,
            solo: false,
            transitions: [],
            clips: [],
          },
        ],
      },
    });
    const clip = useProjectStore.getState().createTextClip("text-track", 0, "Credits", 5);
    expect(clip).not.toBeNull();
    const clipId = clip!.id;
    const scroll = { mode: "roll" as const, startOffscreen: true, endOffscreen: true };

    const res = await useProjectStore.getState().executeAction({
      type: "text/update",
      id: "scroll-1",
      timestamp: Date.now(),
      params: { clipId, updates: { scroll } },
    });
    expect(res.success).toBe(true);
    await flush();

    useProjectStore.getState().updateTextContent(clipId, "Edited credits");
    const after = useProjectStore.getState().project.textClips?.find((c) => c.id === clipId);
    expect(after?.text).toBe("Edited credits");
    expect(after?.scroll).toMatchObject(scroll);

    await useProjectStore.getState().undo();
    const undone = useProjectStore.getState().project.textClips?.find((c) => c.id === clipId);
    expect(undone?.text).toBe("Credits");
    expect(undone?.scroll).toMatchObject(scroll);
  });
});
