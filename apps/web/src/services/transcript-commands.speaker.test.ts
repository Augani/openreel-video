import { describe, expect, it, vi } from "vitest";

const cue = (id: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({
  id, text: id, startTime: start, endTime: end, words: [], ...extra,
});
const state = {
  project: {
    speakers: [] as unknown[],
    timeline: {
      tracks: [],
      subtitles: [
        cue("a", 0, 2, { speaker: "Ann" }),
        cue("b", 2, 4, { speaker: "Ann" }),
        cue("fa", 0, 2, { captionTrackId: "fr", hidden: true, speaker: "Ann" }),
        cue("fb", 2, 4, { captionTrackId: "fr", hidden: true, speaker: "Ann" }),
      ],
    },
  },
  executeAction: vi.fn(async () => ({ success: true })),
};
vi.mock("../stores/project-store", () => ({ useProjectStore: { getState: () => state } }));
vi.mock("../stores/timeline-store", () => ({ useTimelineStore: { getState: () => ({}) } }));

import { setCaptionSpeaker } from "./transcript-commands";

describe("setCaptionSpeaker", () => {
  it("reassigns the matching cues on translated tracks too", async () => {
    const outcome = await setCaptionSpeaker(["b"], "Bob");
    expect(outcome.success).toBe(true);
    const call = state.executeAction.mock.calls[0] as unknown as [
      { params: { subtitles: Array<{ id: string; speaker?: string }> } },
    ];
    const speakers = Object.fromEntries(call[0].params.subtitles.map((c) => [c.id, c.speaker]));
    expect(speakers).toEqual({ a: "Ann", b: "Bob", fa: "Ann", fb: "Bob" });
  });
});
