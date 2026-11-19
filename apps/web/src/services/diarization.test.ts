import { describe, expect, it, vi } from "vitest";

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
});
