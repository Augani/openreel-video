import "../test/install-local-storage-mock";
import { describe, expect, it } from "vitest";
import { applyRunStyle, clipRuns, titleEngine } from "@openreel/core";
import { useProjectStore } from "./project-store";
import { useEngineStore } from "./engine-store";
import { createEmptyProject } from "./project/project-helpers";

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
const read = (id: string) => useProjectStore.getState().project.textClips?.find((c) => c.id === id);

describe("rich text edits go through the undo history", () => {
  it("styles a selection, follows a text edit, and undoes each step back to single-style text", async () => {
    titleEngine.initialize(1920, 1080);
    useEngineStore.setState({ titleEngine });
    const base = createEmptyProject("Rich");
    useProjectStore.getState().loadProject({
      ...base,
      timeline: { ...base.timeline, tracks: [{ id: "tt", name: "Text", type: "text", hidden: false, locked: false, muted: false, solo: false, transitions: [], clips: [] }] },
    });
    const clip = useProjectStore.getState().createTextClip("tt", 0, "Big Win", 5)!;
    const id = clip.id;
    expect(read(id)?.runs).toBeUndefined();

    const store = useProjectStore.getState();
    store.updateTextRuns(id, applyRunStyle(clipRuns(read(id)!), 4, 7, { fontWeight: 700, color: "#ff0000" }));
    await flush();
    expect(read(id)?.runs?.map((r) => r.text)).toEqual(["Big ", "Win"]);

    store.updateTextContent(id, "Big Wins");
    expect(read(id)?.runs?.map((r) => [r.text, r.style.color])).toEqual([["Big ", undefined], ["Wins", "#ff0000"]]);

    store.updateTextStyle(id, { strokes: [{ color: "#000000", width: 4 }, { color: "#ff9900", width: 12 }], fill: { type: "radial", stops: [{ offset: 0, color: "#fff" }, { offset: 1, color: "#000" }] } });
    expect(read(id)?.style.strokes).toHaveLength(2);

    await useProjectStore.getState().undo();
    expect(read(id)?.style.strokes).toBeUndefined();
    await useProjectStore.getState().undo();
    expect(read(id)?.text).toBe("Big Win");
    await useProjectStore.getState().undo();
    expect(read(id)?.runs).toBeUndefined();
    await useProjectStore.getState().redo();
    expect(read(id)?.runs?.[1]).toMatchObject({ text: "Win", style: { fontWeight: 700 } });

    store.updateTextRuns(id, undefined);
    expect(read(id)?.runs).toBeUndefined();
    await useProjectStore.getState().undo();
    expect(read(id)?.runs).toHaveLength(2);
  });
});
