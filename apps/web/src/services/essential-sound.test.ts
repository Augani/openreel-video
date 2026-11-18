import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  integrated: -30,
  duckLane: [
    { time: 0, value: 0.8 },
    { time: 1, value: 0.1 },
    { time: 2, value: 0.1 },
    { time: 3, value: 0.8 },
  ],
}));

vi.mock("./loudness", async () => {
  const { useProjectStore } = await import("../stores/project-store");
  return {
    measureTimelineClipLoudness: vi.fn(async (clipId: string) => {
      const clip = useProjectStore.getState().getClip(clipId)!;
      return { clipId, measured: { integrated: hoisted.integrated, truePeak: -12 }, source: clip };
    }),
  };
});
vi.mock("./audio-ducking-buffer", () => ({ buildTriggerTrackBuffer: vi.fn(async () => ({})) }));
vi.mock("@openreel/core", async () => {
  const actual = await vi.importActual<typeof import("@openreel/core")>("@openreel/core");
  class FakeDucker {
    generateDuckingKeyframes() {
      return hoisted.duckLane.map((point) => ({ ...point }));
    }
  }
  return { ...actual, AudioDucker: FakeDucker };
});

import { ProjectSerializer, resolveClipVolumeAutomation, type Clip, type Project } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { applyEssentialSound, clearEssentialSound, essentialSoundStatus } from "./essential-sound";

const fixture = JSON.parse(readFileSync(join(__dirname, "..", "test", "fixtures", "compat", "w8-audio-repair.openreel.json"), "utf8"));
const serializer = new ProjectSerializer({} as never);

/** Music clip over a dialogue clip, on tracks whose roles are music and dialogue. */
function openProject(): { music: Clip; dialogue: Clip } {
  const doc = structuredClone(fixture);
  const tracks = doc.project.timeline.tracks as Array<{ name: string; clips: Array<Record<string, unknown>> }>;
  const music = tracks.find((t) => t.name === "Music")!;
  const dialogueTrack = tracks.find((t) => t.name === "Dialogue")!;
  dialogueTrack.clips = [{ ...music.clips[0], id: "clip-dialogue", trackId: (dialogueTrack as unknown as { id: string }).id, volume: 1, audioEffects: [] }];
  music.clips[0] = { ...music.clips[0], audioEffects: [] };
  useProjectStore.getState().loadProject(serializer.importFromJson(JSON.stringify(doc)));
  const project = useProjectStore.getState().project;
  return { music: useProjectStore.getState().getClip("clip-tone")!, dialogue: findIn(project, "clip-dialogue") };
}
const findIn = (project: Project, id: string) => project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
const clipOf = (id: string) => useProjectStore.getState().getClip(id)!;
const steps = () => useProjectStore.getState().actionHistory.getDisplayHistory().length;

describe("Essential Sound service", () => {
  beforeEach(() => {
    hoisted.integrated = -30;
  });

  it("tags a clip as Dialogue and matches it to -16 LUFS in ONE undo step, then undo restores the clip exactly", async () => {
    const { dialogue } = openProject();
    hoisted.integrated = -26;
    const original = structuredClone(clipOf(dialogue.id));
    const before = steps();
    const [result] = await applyEssentialSound([dialogue.id], "dialogue", { loudness: true, clarity: true, repair: true });
    expect(steps()).toBe(before + 1);
    expect(result).toMatchObject({ audioType: "dialogue", silent: false, beforeLufs: -26, clamped: false });
    expect(result.afterLufs).toBeCloseTo(-16);

    const applied = clipOf(dialogue.id);
    expect(applied.audioType).toBe("dialogue");
    expect(applied.volume).toBeCloseTo(Math.pow(10, 10 / 20), 4);
    expect(applied.audioEffects.map((e) => e.metadata?.essentialSound?.key)).toEqual([
      "rumble",
      "noise",
      "dialogue-eq",
      "dialogue-compressor",
    ]);
    expect(applied.metadata?.essentialSound?.loudness).toMatchObject({ targetLufs: -16, beforeLufs: -26, previousVolume: 1 });

    await useProjectStore.getState().undo();
    expect(clipOf(dialogue.id)).toEqual(original);
    expect(steps()).toBe(before);
  });

  it("reports when the +12 dB clip gain limit stops short of the target", async () => {
    const { dialogue } = openProject();
    const [result] = await applyEssentialSound([dialogue.id], "dialogue", { loudness: true, clarity: false });
    expect(result.clamped).toBe(true);
    expect(result.afterLufs).toBeCloseTo(-17.96, 1);
    expect(clipOf(dialogue.id).volume).toBe(4);
  });

  it("applying twice does not stack duplicate effects or change the gain again", async () => {
    const { dialogue } = openProject();
    await applyEssentialSound([dialogue.id], "dialogue", { clarity: true });
    const once = structuredClone(clipOf(dialogue.id));
    hoisted.integrated = -16; // the clip now measures at the target
    await applyEssentialSound([dialogue.id], "dialogue", { clarity: true });
    const twice = clipOf(dialogue.id);
    expect(twice.audioEffects).toHaveLength(once.audioEffects.length);
    expect(twice.audioEffects.map((e) => e.id)).toEqual(once.audioEffects.map((e) => e.id));
    expect(twice.audioEffects).toEqual(once.audioEffects);
  });

  it("switching an option off removes only the effects the panel added", async () => {
    const { dialogue } = openProject();
    const own = { id: "my-reverb", type: "reverb", enabled: true, params: { roomSize: 0.4, damping: 0.5, wetLevel: 0.2 } };
    await useProjectStore.getState().addAudioEffect(dialogue.id, own);
    await applyEssentialSound([dialogue.id], "dialogue", { clarity: true, loudness: true });
    expect(clipOf(dialogue.id).audioEffects).toHaveLength(3);
    await applyEssentialSound([dialogue.id], "dialogue", { clarity: false });
    expect(clipOf(dialogue.id).audioEffects.map((e) => e.id)).toEqual(["my-reverb"]);
    // The match it did earlier is untouched by the clarity toggle.
    expect(clipOf(dialogue.id).volume).toBeGreaterThan(1);
  });

  it("Clear returns the clip to the pre-panel chain and keeps what the user added", async () => {
    const { dialogue } = openProject();
    const own = { id: "my-reverb", type: "reverb", enabled: true, params: { roomSize: 0.4, damping: 0.5, wetLevel: 0.2 } };
    await useProjectStore.getState().addAudioEffect(dialogue.id, own);
    const prepanel = structuredClone(clipOf(dialogue.id));
    await applyEssentialSound([dialogue.id], "dialogue", { clarity: true, loudness: true, repair: true });
    await clearEssentialSound([dialogue.id]);
    expect(clipOf(dialogue.id)).toEqual(prepanel);
  });

  it("never overwrites an effect the user edited after the panel added it", async () => {
    const { music } = openProject();
    await applyEssentialSound([music.id], "music", { clarity: true, clarityAmount: 0.2, loudness: false, ducking: false });
    const mine = clipOf(music.id).audioEffects[0];
    const bands = [{ type: "peaking", frequency: 900, gain: -9, q: 1 }];
    await useProjectStore.getState().updateAudioEffect(music.id, mine.id, { bands });
    const [result] = await applyEssentialSound([music.id], "music", { clarityAmount: 1 });
    expect(clipOf(music.id).audioEffects[0].params).toEqual({ bands });
    expect(result.notes.join(" ")).toMatch(/Kept your edits/);
  });

  it("ducks a music clip under the Dialogue track live, as one undo step, with no keyframes baked", async () => {
    const { music } = openProject();
    const original = structuredClone(clipOf(music.id));
    const before = steps();
    const [result] = await applyEssentialSound([music.id], "music", { clarity: true, loudness: true, ducking: true, duckAmountDb: 12 });
    expect(steps()).toBe(before + 1);
    expect(result.duckingReason).toBeNull();
    const ducked = clipOf(music.id);
    expect(ducked.automation?.volume).toBeUndefined();
    expect(ducked.metadata?.liveDucking).toMatchObject({ enabled: true, amountDb: 12 });
    expect(ducked.metadata?.essentialSound?.ducking).toEqual({ live: true });
    // The dip is computed from the dialogue clip, so it is in the resolved lane.
    const lane = resolveClipVolumeAutomation(ducked, useProjectStore.getState().project.timeline);
    expect(Math.min(...lane.map((point) => point.value))).toBeCloseTo(ducked.volume * Math.pow(10, -12 / 20), 3);
    await useProjectStore.getState().undo();
    expect(clipOf(music.id)).toEqual(original);

    await applyEssentialSound([music.id], "music", { ducking: true });
    await applyEssentialSound([music.id], "music", { ducking: false });
    expect(clipOf(music.id).automation).toBeUndefined();
    expect(clipOf(music.id).metadata?.liveDucking).toBeUndefined();
  });

  it("recomputes the duck when the dialogue clip moves, without touching the music clip", async () => {
    const { music, dialogue } = openProject();
    await applyEssentialSound([music.id], "music", { ducking: true, loudness: false, clarity: false });
    const musicBefore = structuredClone(clipOf(music.id));
    const lowest = () => {
      const clip = clipOf(music.id);
      return Math.min(1, ...resolveClipVolumeAutomation(clip, useProjectStore.getState().project.timeline).map((point) => point.value / clip.volume));
    };
    expect(lowest()).toBeLessThan(0.3);
    await useProjectStore.getState().executeAction({
      id: "mv", timestamp: Date.now(), type: "clip/move", params: { clipId: dialogue.id, startTime: 500 },
    } as never);
    expect(lowest()).toBe(1);
    expect(clipOf(music.id)).toEqual(musicBefore);
    await useProjectStore.getState().undo();
    expect(lowest()).toBeLessThan(0.3);
  });

  it("dialogue clips never get ducking", async () => {
    const { dialogue } = openProject();
    const [result] = await applyEssentialSound([dialogue.id], "dialogue", { ducking: true, loudness: false });
    expect(clipOf(dialogue.id).automation).toBeUndefined();
    expect(result.duckingReason).toMatch(/never ducked/i);
  });

  it("explains why ducking is off when no track has the Dialogue role", async () => {
    const { music } = openProject();
    const dialogueTrack = useProjectStore.getState().project.timeline.tracks.find((t) => t.role === "dialogue")!;
    await useProjectStore.getState().executeAction({
      id: "r", timestamp: Date.now(), type: "track/setRole", params: { trackId: dialogueTrack.id, role: "general" },
    } as never).catch(() => undefined);
    const mutable = useProjectStore.getState().project.timeline.tracks.find((t) => t.id === dialogueTrack.id) as { role?: string };
    mutable.role = "general";
    const [result] = await applyEssentialSound([music.id], "music", { ducking: true, loudness: false });
    expect(result.duckingReason).toMatch(/no track has the Dialogue role/);
    expect(clipOf(music.id).automation).toBeUndefined();
  });

  it("reports a silent clip instead of changing its gain", async () => {
    const { dialogue } = openProject();
    hoisted.integrated = -Infinity;
    const [result] = await applyEssentialSound([dialogue.id], "dialogue", { loudness: true, clarity: false });
    expect(result.silent).toBe(true);
    expect(result.notes.join(" ")).toMatch(/Silent clip/);
    expect(clipOf(dialogue.id).volume).toBe(1);
  });

  it("refuses a locked track with the usual message and changes nothing", async () => {
    const { dialogue } = openProject();
    const track = useProjectStore.getState().project.timeline.tracks.find((t) => t.id === dialogue.trackId) as { locked: boolean };
    track.locked = true;
    const before = steps();
    await expect(applyEssentialSound([dialogue.id], "dialogue", { clarity: true })).rejects.toThrow(/is locked/);
    expect(steps()).toBe(before);
    track.locked = false;
  });

  it("applies to several clips as one undo step", async () => {
    const { music, dialogue } = openProject();
    const before = steps();
    const results = await applyEssentialSound([music.id, dialogue.id], "sfx", { clarity: true, loudness: true, ducking: false });
    expect(results).toHaveLength(2);
    expect(steps()).toBe(before + 1);
    expect(clipOf(music.id).audioType).toBe("sfx");
    expect(clipOf(dialogue.id).audioType).toBe("sfx");
    await useProjectStore.getState().undo();
    expect(clipOf(music.id).audioType).toBeUndefined();
    expect(clipOf(dialogue.id).audioType).toBeUndefined();
  });

  it("infers the type from the track role when the clip has no tag", () => {
    const { music } = openProject();
    const status = essentialSoundStatus(clipOf(music.id), useProjectStore.getState().project);
    expect(status).toMatchObject({ audioType: "music", inferred: true, state: null });
  });

  it("round-trips audioType and the tagged chain through project save and load; older projects still load", async () => {
    const { music } = openProject();
    await applyEssentialSound([music.id], "ambience", { clarity: true, loudness: true, ducking: true });
    const saved = serializer.exportToJson(useProjectStore.getState().getFullProject());
    useProjectStore.getState().loadProject(serializer.importFromJson(saved));
    const loaded = clipOf(music.id);
    expect(loaded.audioType).toBe("ambience");
    expect(loaded.audioEffects[0].metadata?.essentialSound).toMatchObject({ block: "clarity", key: "ambience-lowpass" });
    expect(loaded.metadata?.essentialSound?.loudness?.targetLufs).toBe(-28);
    expect(loaded.metadata?.liveDucking).toMatchObject({ enabled: true });
    // Reconciling the loaded project finds nothing to change: the tags survived intact.
    const effectIds = loaded.audioEffects.map((e) => e.id);
    hoisted.integrated = -28;
    await applyEssentialSound([music.id], "ambience", {});
    expect(clipOf(music.id).audioEffects.map((e) => e.id)).toEqual(effectIds);

    // A project saved before the feature has neither field and loads as before.
    useProjectStore.getState().loadProject(serializer.importFromJson(JSON.stringify(fixture)));
    const old = clipOf("clip-tone");
    expect(old.audioType).toBeUndefined();
    expect(old.metadata?.essentialSound).toBeUndefined();
  });
});
