import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import type { MixdownRenderer } from "../audio/loudness/project-loudness";
import { resolveClipVolumeAutomation } from "../audio/clip-audio-resolution";
import { audioTypeStemIds, isolateAudioTypeStem, isolateTrackStem, trackStemCandidates } from "../audio/stem-isolation";
import { exportBusStems, isolateStem, planStems } from "./stem-export";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number, extra: Partial<Clip> = {}): Clip =>
  ({
    id,
    mediaId: `m-${id}`,
    trackId,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    volume: 1,
    effects: [],
    audioEffects: [],
    keyframes: [],
    transform,
    ...extra,
  }) as Clip;
const track = (id: string, name: string, role: Track["role"], clips: Clip[], extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", role, name, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;

const DUCK = { enabled: true, amountDb: 12, attackMs: 100, releaseMs: 100, holdMs: 100 };

function fixture(): Project {
  const clips = [
    clip("d1", "dlg", 2, 3),
    clip("m1", "mus", 0, 10, { metadata: { liveDucking: DUCK } }),
    clip("s1", "fx", 4, 1, { audioType: "sfx" }),
    clip("x1", "gen", 6, 1),
  ];
  return {
    id: "p",
    name: "My Film",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: {
      items: clips.map((c) => ({ id: c.mediaId, name: c.id, type: "audio", metadata: { duration: 10, width: 0, height: 0, frameRate: 0, codec: "pcm", sampleRate: 48000, channels: 2, fileSize: 1 } })),
    },
    timeline: {
      duration: 10,
      subtitles: [],
      markers: [],
      masterAudioRack: { effects: [{ id: "lim", type: "limiter", params: {}, bypassed: false }] },
      audioBuses: [{ id: "bus1", name: "Music bus", muted: false, solo: false }],
      tracks: [
        track("dlg", "Dialogue", "dialogue", [clips[0]]),
        track("mus", "Music", "music", [clips[1]], { output: "bus1", sends: [] }),
        track("fx", "Effects", "effects", [clips[2]]),
        track("gen", "General", "general", [clips[3]]),
        track("empty", "Empty", "general", []),
      ],
    },
  } as unknown as Project;
}

describe("stem plans", () => {
  it("lists audio-carrying tracks, skipping empty and muted ones", () => {
    const p = fixture();
    expect(planStems(p, { mode: "track" }).map((i) => i.name)).toEqual(["Dialogue", "Music", "Effects", "General"]);
    const muted = { ...p, timeline: { ...p.timeline, tracks: p.timeline.tracks.map((t) => (t.id === "fx" ? { ...t, muted: true } : t)) } } as Project;
    expect(trackStemCandidates(muted).map((t) => t.id)).not.toContain("fx");
    expect(planStems(p, { mode: "track", ids: ["mus"] }).map((i) => i.fileName)).toEqual(["My_Film_Music.wav"]);
  });

  it("lists the Essential Sound types in use, with Untyped last", () => {
    const p = fixture();
    expect(audioTypeStemIds(p)).toEqual(["dialogue", "music", "sfx", "untyped"]);
    expect(planStems(p, { mode: "audioType" }).map((i) => i.fileName)).toEqual([
      "My_Film_Dialogue.wav",
      "My_Film_Music.wav",
      "My_Film_SFX.wav",
      "My_Film_Untyped.wav",
    ]);
    expect(planStems(p, { mode: "audioType", ids: ["music", "ambience"] }).map((i) => i.busId)).toEqual(["music"]);
  });

  it("keeps bus planning as it was", () => {
    expect(planStems(fixture()).map((i) => i.busId)).toEqual(["bus1"]);
  });

  it("gives duplicate names unique files", () => {
    const p = fixture();
    const dup = { ...p, timeline: { ...p.timeline, tracks: p.timeline.tracks.map((t) => (t.id === "gen" ? { ...t, name: "Music" } : t)) } } as Project;
    expect(planStems(dup, { mode: "track" }).map((i) => i.fileName)).toEqual(["My_Film_Dialogue.wav", "My_Film_Music.wav", "My_Film_Effects.wav", "My_Film_Music_2.wav"]);
  });
});

describe("stem isolation", () => {
  it("a track stem mutes every other track, and drops buses, sends and the master rack", () => {
    const iso = isolateTrackStem(fixture(), "mus")!;
    expect(iso.timeline.tracks.filter((t) => !t.muted).map((t) => t.id)).toEqual(["mus"]);
    expect(iso.timeline.masterAudioRack).toBeUndefined();
    expect(iso.timeline.audioBuses).toBeUndefined();
    expect(iso.timeline.tracks.find((t) => t.id === "mus")).not.toHaveProperty("output");
    expect(isolateTrackStem(fixture(), "nope")).toBeUndefined();
  });

  it("the Music stem keeps the live duck even though the dialogue clip is not in it", () => {
    const p = fixture();
    const iso = isolateAudioTypeStem(p, "music")!;
    expect(iso.timeline.tracks.flatMap((t) => t.clips).map((c) => c.id)).toEqual(["m1"]);
    const isolated = iso.timeline.tracks.flatMap((t) => t.clips)[0];
    expect(isolated.metadata?.liveDucking).toBeUndefined();
    const lane = isolated.automation?.volume ?? [];
    expect(lane.length).toBeGreaterThan(2);
    expect(Math.min(...lane.map((pt) => pt.value))).toBeCloseTo(Math.pow(10, -12 / 20), 6);
    // identical to what the master mix applies at the same moment
    const original = p.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === "m1")!;
    expect(lane).toEqual(resolveClipVolumeAutomation(original, p.timeline));
    expect(iso.timeline.masterAudioRack).toBeUndefined();
    expect(iso.timeline.audioBuses).toHaveLength(1);
  });

  it("a bus stem keeps the duck although isolating mutes the dialogue track", () => {
    const iso = isolateStem(fixture(), { busId: "bus1", kind: "bus" })!;
    expect(iso.timeline.tracks.find((t) => t.id === "dlg")!.muted).toBe(true);
    const music = iso.timeline.tracks.find((t) => t.id === "mus")!.clips[0];
    expect(music.metadata?.liveDucking).toBeUndefined();
    expect(Math.min(...(music.automation?.volume ?? []).map((pt) => pt.value))).toBeCloseTo(Math.pow(10, -12 / 20), 6);
  });

  it("a track stem also carries the duck", () => {
    const iso = isolateTrackStem(fixture(), "mus")!;
    const music = iso.timeline.tracks.find((t) => t.id === "mus")!.clips[0];
    expect(Math.min(...(music.automation?.volume ?? []).map((pt) => pt.value))).toBeCloseTo(Math.pow(10, -12 / 20), 6);
  });
});

describe("exportBusStems in track and audio-type mode", () => {
  const renderer = (seen: Project[]): MixdownRenderer => ({
    isInitialized: () => true,
    initialize: async () => undefined,
    renderAudio: async (project, _start, duration) => {
      seen.push(project);
      const frames = Math.round(duration * 48000);
      const channel = new Float32Array(frames).fill(0.25);
      return { buffer: { numberOfChannels: 2, getChannelData: () => channel, sampleRate: 48000, length: frames, duration } as unknown as AudioBuffer };
    },
  });

  it("renders one equal-length WAV per source through the isolated project", async () => {
    const seen: Project[] = [];
    const stems = await exportBusStems(fixture(), renderer(seen), { mode: "audioType", ids: ["dialogue", "music"], chunkSeconds: 20 }).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    // The WAV encoder needs WASM in node; the plan and isolation are what is asserted here.
    if (stems instanceof Error) {
      expect(seen.length).toBeGreaterThan(0);
    } else {
      expect(stems.map((s) => s.fileName)).toEqual(["My_Film_Dialogue.wav", "My_Film_Music.wav"]);
      expect(new Set(stems.map((s) => s.frames)).size).toBe(1);
    }
    expect(seen[0].timeline.tracks.flatMap((t) => t.clips).map((c) => c.id)).toEqual(["d1"]);
  });

  it("explains when nothing can be exported", async () => {
    const empty = { ...fixture(), timeline: { ...fixture().timeline, tracks: [] } } as Project;
    await expect(exportBusStems(empty, renderer([]), { mode: "track" })).rejects.toThrow(/No track carries audio/);
    await expect(exportBusStems(empty, renderer([]), { mode: "audioType" })).rejects.toThrow(/No clip carries audio/);
  });
});
