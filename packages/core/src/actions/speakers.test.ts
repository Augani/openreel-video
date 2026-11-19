import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";

const makeProject = (): Project =>
  ({
    id: "p1",
    name: "Speakers",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 10, tracks: [], markers: [], subtitles: [{ id: "c1", text: "hi", startTime: 0, endTime: 1, speaker: "Ann" }] },
    mediaLibrary: { items: [] },
  }) as unknown as Project;

let n = 0;
const act = (params: Record<string, unknown>): Action =>
  ({ id: `s${++n}`, type: "speaker/apply", timestamp: Date.now() + n * 1000, params }) as unknown as Action;

describe("speaker/apply", () => {
  it("sets cues and profiles together; undo and redo restore both", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const result = await executor.execute(
      act({
        subtitles: [{ id: "c1", text: "hi", startTime: 0, endTime: 1, speaker: "Speaker 1" }],
        profiles: [{ name: "Speaker 1", color: "#4F9DFF", position: "top" }],
      }),
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.subtitles[0].speaker).toBe("Speaker 1");
    expect(project.speakers).toEqual([{ name: "Speaker 1", color: "#4F9DFF", position: "top" }]);

    expect((await executor.undo(project)).success).toBe(true);
    expect(project.timeline.subtitles[0].speaker).toBe("Ann");
    expect(project.speakers).toEqual([]);
    expect((await executor.redo(project)).success).toBe(true);
    expect(project.speakers?.[0].name).toBe("Speaker 1");
  });

  it("rejects duplicate or malformed profiles", async () => {
    const executor = new ActionExecutor();
    const dup = await executor.execute(act({ profiles: [{ name: "A", color: "#1" }, { name: "A", color: "#2" }] }), makeProject());
    expect(dup.success).toBe(false);
    expect((await executor.execute(act({}), makeProject())).success).toBe(false);
  });
});
