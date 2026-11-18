import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "@openreel/core";
import { projectLiveDuckingSignature } from "./live-ducking-sync";

const clip = (id: string, trackId: string, startTime: number, duration: number, extra: Partial<Clip> = {}) =>
  ({ id, mediaId: id, trackId, startTime, duration, inPoint: 0, outPoint: duration, volume: 1, effects: [], audioEffects: [], keyframes: [], ...extra }) as unknown as Clip;
const track = (id: string, role: Track["role"], clips: Clip[]) =>
  ({ id, type: "audio", role, name: id, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false }) as unknown as Track;
const project = (dialogueStart: number): Pick<Project, "timeline"> => ({
  timeline: {
    tracks: [
      track("dlg", "dialogue", [clip("d", "dlg", dialogueStart, 4)]),
      track("mus", "music", [
        clip("m", "mus", 0, 30, { metadata: { liveDucking: { enabled: true, amountDb: 12, attackMs: 100, releaseMs: 100, holdMs: 100 } } }),
      ]),
    ],
  } as unknown as Project["timeline"],
});

describe("projectLiveDuckingSignature", () => {
  it("is empty when no clip is live-ducked", () => {
    const p = project(5);
    const plain = { timeline: { ...p.timeline, tracks: p.timeline.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, metadata: undefined })) })) } };
    expect(projectLiveDuckingSignature(plain as Pick<Project, "timeline">)).toBe("");
  });

  it("changes when the dialogue clip moves and is stable otherwise", () => {
    expect(projectLiveDuckingSignature(project(5))).toBe(projectLiveDuckingSignature(project(5)));
    expect(projectLiveDuckingSignature(project(5))).not.toBe(projectLiveDuckingSignature(project(9)));
  });
});
