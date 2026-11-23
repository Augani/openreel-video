import { describe, expect, it, vi } from "vitest";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";

const state = {
  project: {
    speakers: [],
    mediaLibrary: { items: [{ id: "m1", type: "video", metadata: { hasAudio: false, audioTrackCount: 0 } }] },
    timeline: {
      tracks: [{ clips: [{ id: "c1", mediaId: "m1", startTime: 0, duration: 10, inPoint: 0 }] }],
      subtitles: [{ id: "s1", text: "hello there", startTime: 1, endTime: 3, words: [] }],
    },
  },
  executeAction: vi.fn(),
};

vi.mock("../stores/project-store", () => ({ useProjectStore: { getState: () => state } }));
vi.mock("../utils/load-audio-buffer", () => ({ loadAudioBuffer: vi.fn() }));

import { diarizeCaptions } from "./diarization";

describe("diarizeCaptions", () => {
  it("says the clip has no audio instead of claiming decoding failed", async () => {
    const outcome = await diarizeCaptions();
    expect(outcome.success).toBe(false);
    expect(outcome.message).toMatch(/no audio track/i);
    expect(state.executeAction).not.toHaveBeenCalled();
  });

  it("reports a failed detection as a retryable task while keeping the resolved outcome", async () => {
    const outcome = await diarizeCaptions();
    expect(outcome.success).toBe(false);
    const row = backgroundTasks.getSnapshot().find((t) => t.source === "diarization");
    expect(row).toMatchObject({ kind: "analysis", status: "failed", title: "Speaker detection" });
    expect(row?.error).toMatch(/no audio track/i);
    expect(row?.can.retry).toBe(true);
  });

  it("rejects with an AbortError and marks the row cancelled when the caller aborts first", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(diarizeCaptions({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(backgroundTasks.getSnapshot().find((t) => t.source === "diarization" && t.status === "cancelled")).toBeTruthy();
  });
});
