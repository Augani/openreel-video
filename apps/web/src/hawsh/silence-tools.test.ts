import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "@openreel/agent";
import { useProjectStore } from "../stores/project-store";
import { EditingSession } from "../services/agent/editing-session";
import { editingToolDefs, editingToolReadOnly, executeEditingTool } from "../services/agent/editing-tools";
import { SILENCE_DEFAULTS, silenceRegions } from "./silence-tools";

const opts = SILENCE_DEFAULTS; // -40 dB, 0.5 s minimum, 0.1 s padding

describe("silenceRegions", () => {
  const clip = { startTime: 10, duration: 8, inPoint: 2 }; // source 2..10 on timeline 10..18

  it("maps source silences inside the clip to padded timeline ranges", () => {
    expect(silenceRegions(clip, [{ start: 4, end: 5 }], opts)).toEqual([{ start: 12.1, end: 12.9 }]);
  });
  it("clips to the source window and does not pad at the clip edges", () => {
    expect(silenceRegions(clip, [{ start: 0, end: 3 }, { start: 9, end: 12 }], opts)).toEqual([
      { start: 10, end: 10.9 },
      { start: 17.1, end: 18 },
    ]);
  });
  it("drops pauses shorter than the minimum (after padding) and ones outside the clip", () => {
    expect(silenceRegions(clip, [{ start: 4, end: 4.6 }, { start: 11, end: 13 }], opts)).toEqual([]);
  });
});

function ok(result: ToolResult): Record<string, unknown> {
  expect(result.ok, result.error?.message).toBe(true);
  return result.data as Record<string, unknown>;
}

/** 10 s of "speech" at 48 kHz with silence at 2–3.5 s and 6–8 s (amplitude 0 vs 0.5). */
function fakeAudio(): AudioBuffer {
  const rate = 48000;
  const data = new Float32Array(rate * 10).fill(0.5);
  data.fill(0, 2 * rate, 3.5 * rate);
  data.fill(0, 6 * rate, 8 * rate);
  return { sampleRate: rate, duration: 10, numberOfChannels: 1, length: data.length, getChannelData: () => data } as unknown as AudioBuffer;
}

describe("detect_silence / cut_silence tools", () => {
  beforeEach(() => {
    vi.spyOn(window.AudioContext.prototype, "decodeAudioData").mockImplementation(() => Promise.resolve(fakeAudio()));
    useProjectStore.getState().createNewProject("Silence");
    const { project } = useProjectStore.getState();
    useProjectStore.setState({ project: { ...project, mediaLibrary: { items: [{
      id: "talk", name: "talk.mp4", type: "video", blob: Object.assign(new Blob(["fixture"]), { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
      fileHandle: null, thumbnailUrl: null, waveformData: null,
      metadata: { duration: 10, width: 640, height: 360, frameRate: 24, codec: "avc", sampleRate: 48000, channels: 1, fileSize: 7 },
    }] } } });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  async function setup() {
    const session = new EditingSession(); session.beginTransaction();
    const { trackId } = ok(await executeEditingTool("add_track", { trackType: "video" }, session));
    const { clipId } = ok(await executeEditingTool("add_clip", { trackId, mediaId: "talk", startTime: 0 }, session));
    return { session, trackId: trackId as string, clipId: clipId as string };
  }

  it("are offered to the model, detect is read-only", () => {
    const names = editingToolDefs("openai").map((d) => (d as { function: { name: string } }).function.name);
    expect(names).toEqual(expect.arrayContaining(["detect_silence", "cut_silence"]));
    expect(editingToolReadOnly("detect_silence")).toBe(true);
    expect(editingToolReadOnly("cut_silence")).toBe(false);
  });

  it("detect_silence reports the pauses without changing the timeline", async () => {
    const { session, clipId } = await setup();
    const data = ok(await executeEditingTool("detect_silence", { clipId }, session));
    expect(data.regions).toEqual([{ start: 2.1, end: 3.4 }, { start: 6.1, end: 7.9 }]);
    expect(data.totalSec).toBe(3.1);
    expect(session.getProject().timeline.tracks.flatMap((t) => t.clips)).toHaveLength(1);
  });

  it("cut_silence removes the pauses and closes the gaps", async () => {
    const { session, trackId } = await setup();
    const clipId = session.getProject().timeline.tracks.find((t) => t.id === trackId)!.clips[0].id;
    const data = ok(await executeEditingTool("cut_silence", { clipId }, session));
    expect(data).toMatchObject({ removed: 2, totalSec: 3.1 });
    const clips = session.getProject().timeline.tracks.find((t) => t.id === trackId)!.clips
      .slice().sort((a, b) => a.startTime - b.startTime)
      .map((c) => ({ start: +c.startTime.toFixed(3), dur: +c.duration.toFixed(3), in: +c.inPoint.toFixed(3) }));
    // Kept source: 0–2.1, 3.4–6.1, 7.9–10 → back to back on the timeline (6.9 s in total).
    expect(clips).toEqual([
      { start: 0, dur: 2.1, in: 0 },
      { start: 2.1, dur: 2.7, in: 3.4 },
      { start: 4.8, dur: 2.1, in: 7.9 },
    ]);
  });

  it("refuses sped-up clips", async () => {
    const { session, clipId } = await setup();
    ok(await executeEditingTool("set_clip_speed", { clipId, speed: 2 }, session));
    const r = await executeEditingTool("cut_silence", { clipId }, session);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/speed/);
  });
});
