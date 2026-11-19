import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types/project";
import type { Clip, Track } from "../types/timeline";
import { AudioEngine } from "./audio-engine";
import { audioRangeFingerprint } from "./mixdown-cache";
import { RealtimeAudioGraph } from "./realtime-audio-graph";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import {
  computeTrackAudibility,
  hasAnySoloedTrack,
  isTrackAudible,
  isTrackSoloSuppressed,
  type TrackAudibilityInput,
} from "./track-audibility";

const BOOLS = [false, true] as const;

/** Independent restatement of the rule: the table the UI and the export both have to honour. */
function expected(muted: boolean, solo: boolean, soloSafe: boolean, anySolo: boolean): boolean {
  if (muted) return false; // mute always wins
  if (!anySolo) return true; // nothing soloed: everything unmuted plays
  if (solo) return true; // soloed tracks play
  return soloSafe; // others are silenced unless solo-safe
}

describe("solo / solo-safe mute matrix", () => {
  for (const muted of BOOLS) for (const solo of BOOLS) for (const soloSafe of BOOLS) for (const anySolo of BOOLS) {
    // anySolo=false with solo=true is impossible (the track itself would be a solo).
    if (solo && !anySolo) continue;
    it(`muted=${muted} solo=${solo} soloSafe=${soloSafe} anySolo=${anySolo}`, () => {
      expect(isTrackAudible({ muted, solo, soloSafe }, anySolo)).toBe(expected(muted, solo, soloSafe, anySolo));
    });
  }

  it("treats a missing soloSafe (older projects) as off", () => {
    expect(isTrackAudible({ muted: false, solo: false }, true)).toBe(false);
    expect(isTrackAudible({ muted: false, solo: false }, false)).toBe(true);
  });

  it("solo-safe alone never counts as a solo", () => {
    expect(hasAnySoloedTrack([{ solo: false }, { solo: false }])).toBe(false);
    expect(hasAnySoloedTrack([{ solo: false }, { solo: true }])).toBe(true);
  });

  it("reports which tracks are being silenced by someone else's solo", () => {
    expect(isTrackSoloSuppressed({ muted: false, solo: false }, true)).toBe(true);
    expect(isTrackSoloSuppressed({ muted: false, solo: false, soloSafe: true }, true)).toBe(false);
    expect(isTrackSoloSuppressed({ muted: false, solo: true }, true)).toBe(false);
    expect(isTrackSoloSuppressed({ muted: true, solo: false }, true)).toBe(false);
    expect(isTrackSoloSuppressed({ muted: false, solo: false }, false)).toBe(false);
  });

  it("computes a whole timeline: dialogue soloed, music solo-safe, fx muted-and-safe, rest silenced", () => {
    const tracks = [
      { id: "dialogue", muted: false, solo: true },
      { id: "music", muted: false, solo: false, soloSafe: true },
      { id: "fx", muted: true, solo: false, soloSafe: true },
      { id: "ambience", muted: false, solo: false },
    ];
    const audibility = computeTrackAudibility(tracks);
    expect([...audibility.entries()]).toEqual([
      ["dialogue", true],
      ["music", true],
      ["fx", false],
      ["ambience", false],
    ]);
    // Clear the solo: everything unmuted plays again, solo-safe or not.
    const cleared = computeTrackAudibility(tracks.map((t) => ({ ...t, solo: false })));
    expect(cleared.get("ambience")).toBe(true);
    expect(cleared.get("fx")).toBe(false);
  });

  it("matches the exhaustive matrix for every pair of tracks", () => {
    const states: TrackAudibilityInput[] = [];
    for (const muted of BOOLS) for (const solo of BOOLS) for (const soloSafe of BOOLS) states.push({ muted, solo, soloSafe });
    for (const a of states) for (const b of states) {
      const anySolo = a.solo || b.solo;
      const result = computeTrackAudibility([{ id: "a", ...a }, { id: "b", ...b }]);
      expect(result.get("a")).toBe(expected(a.muted, a.solo, a.soloSafe === true, anySolo));
      expect(result.get("b")).toBe(expected(b.muted, b.solo, b.soloSafe === true, anySolo));
    }
  });
});

const clip = (id: string, trackId: string): Clip => ({
  id, mediaId: "m1", trackId, startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
  effects: [], audioEffects: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  volume: 1, keyframes: [],
});
const track = (id: string, over: Partial<Track> = {}): Track => ({
  id, type: "audio", name: id, clips: [clip(`${id}-c`, id)], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...over,
});
const project = (tracks: Track[]): Project => ({
  id: "p", name: "P", createdAt: 0, modifiedAt: 0,
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
  timeline: { duration: 60, markers: [], subtitles: [], tracks },
  mediaLibrary: { items: [{ id: "m1", name: "a.wav", type: "audio", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 60 } }] },
} as unknown as Project);

describe("export mixdown honours solo-safe", () => {
  const engine = new AudioEngine();
  const internals = engine as unknown as {
    getAudioTracksAtTime(project: Project, start: number, duration: number, preview: boolean): Array<{ trackId: string; muted: boolean; solo: boolean; soloSafe?: boolean }>;
  };
  const decide = (p: Project): Record<string, boolean> => {
    const infos = internals.getAudioTracksAtTime(p, 0, 5, false);
    const anySolo = p.timeline.tracks.some((t) => !t.hidden && t.solo);
    return Object.fromEntries(infos.map((info) => [info.trackId, !engine.isTrackMuted(info as unknown as Parameters<typeof engine.isTrackMuted>[0], anySolo)]));
  };

  it("keeps a solo-safe track in the mix while another track is soloed", () => {
    const p = project([track("dialogue", { solo: true }), track("music", { soloSafe: true }), track("ambience")]);
    expect(decide(p)).toEqual({ dialogue: true, music: true, ambience: false });
  });

  it("without solo-safe the unsoloed tracks are silenced, exactly as before", () => {
    const p = project([track("dialogue", { solo: true }), track("music"), track("ambience")]);
    expect(decide(p)).toEqual({ dialogue: true, music: false, ambience: false });
  });

  it("mute beats solo-safe", () => {
    const p = project([track("dialogue", { solo: true }), track("music", { soloSafe: true, muted: true })]);
    expect(decide(p)).toEqual({ dialogue: true, music: false });
  });

  it("agrees with getEffectiveTrackAudibility (the mixer's view of the same state)", () => {
    const tracks = [track("a", { solo: true }), track("b", { soloSafe: true }), track("c")];
    const view = engine.getEffectiveTrackAudibility(tracks);
    expect(Object.fromEntries(view)).toEqual({ a: true, b: true, c: false });
  });

  it("plays everything when nothing is soloed regardless of solo-safe", () => {
    const p = project([track("a", { soloSafe: true }), track("b")]);
    expect(decide(p)).toEqual({ a: true, b: true });
  });

  it("changes the mixdown cache fingerprint when solo-safe is toggled", () => {
    const base = project([track("a", { solo: true }), track("b")]);
    const safe = project([track("a", { solo: true }), track("b", { soloSafe: true })]);
    expect(audioRangeFingerprint(safe, 0, 10)).not.toBe(audioRangeFingerprint(base, 0, 10));
  });
});

describe("live graph honours solo-safe", () => {
  function graphFixture() {
    const param = () => ({ value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const context = {
      currentTime: 5,
      destination: node(),
      createGain: () => ({ ...node(), gain: param() }),
      createStereoPanner: () => ({ ...node(), pan: param() }),
      createDynamicsCompressor: () => node(),
      createBiquadFilter: () => ({ ...node(), frequency: param(), Q: param(), gain: param() }),
      createAnalyser: () => node(),
      createBufferSource: () => ({ ...node(), start: vi.fn(), stop: vi.fn(), playbackRate: param() }),
      createChannelMerger: () => node(),
      createChannelSplitter: () => node(),
      audioWorklet: { addModule: () => Promise.resolve() },
      state: "running",
    };
    const clock = { getAudioContext: () => context, currentTime: 0, isPlaying: false } as unknown as MasterTimelineClock;
    return new RealtimeAudioGraph(clock);
  }
  const lastGain = (graph: RealtimeAudioGraph, id: string): number | undefined => {
    const out = graph.getTrackOutputGain(id) as unknown as { gain: { setValueAtTime: ReturnType<typeof vi.fn> } } | null;
    return out?.gain.setValueAtTime.mock.calls.at(-1)?.[0] as number | undefined;
  };

  it("keeps a solo-safe track audible while another is soloed, and silences the rest", () => {
    const graph = graphFixture();
    graph.syncTrackStates([
      { trackId: "dialogue", muted: false, solo: true },
      { trackId: "music", muted: false, solo: false, soloSafe: true },
      { trackId: "ambience", muted: false, solo: false },
      { trackId: "fx", muted: true, solo: false, soloSafe: true },
    ]);
    expect(lastGain(graph, "dialogue")).toBe(1);
    expect(lastGain(graph, "music")).toBe(1);
    expect(lastGain(graph, "ambience")).toBe(0);
    expect(lastGain(graph, "fx")).toBe(0);
    graph.dispose();
  });

  it("follows solo-safe toggled live, and clearing the solo restores everyone", () => {
    const graph = graphFixture();
    graph.syncTrackStates([
      { trackId: "dialogue", muted: false, solo: true },
      { trackId: "music", muted: false, solo: false },
    ]);
    expect(lastGain(graph, "music")).toBe(0);
    graph.setTrackSoloSafe("music", true);
    expect(lastGain(graph, "music")).toBe(1);
    graph.setTrackSoloSafe("music", false);
    expect(lastGain(graph, "music")).toBe(0);
    graph.syncTrackStates([
      { trackId: "dialogue", muted: false, solo: false },
      { trackId: "music", muted: false, solo: false },
    ]);
    expect(lastGain(graph, "music")).toBe(1);
    graph.dispose();
  });
});

describe("track/setSoloSafe action (saved with the project)", () => {
  it("toggles the flag as one undoable action, survives a JSON round-trip and rejects bad params", async () => {
    const { ActionExecutor } = await import("../actions/action-executor");
    const p = project([track("a"), track("b")]);
    const executor = new ActionExecutor();
    const set = (soloSafe: unknown, trackId = "b") =>
      executor.execute({ type: "track/setSoloSafe", id: "s", timestamp: 1, params: { trackId, soloSafe } } as never, p);
    expect((await set(true)).success).toBe(true);
    expect(p.timeline.tracks[1].soloSafe).toBe(true);
    expect(p.timeline.tracks[0].soloSafe).toBeUndefined();
    const saved = JSON.parse(JSON.stringify(p)) as Project;
    expect(saved.timeline.tracks[1].soloSafe).toBe(true);
    expect((await executor.undo(p)).success).toBe(true);
    expect(p.timeline.tracks[1].soloSafe).toBeUndefined();
    expect((await executor.redo(p)).success).toBe(true);
    expect(p.timeline.tracks[1].soloSafe).toBe(true);
    expect((await set("yes")).success).toBe(false);
    expect((await set(true, "missing")).success).toBe(false);
  });
});
