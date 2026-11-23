/**
 * Track-rack stems against the multi-clip ripple speed / duration edit (planClipSpeedEdit): the REAL audio fingerprint decides
 * whether a cached stem is reused. An edit that cannot change a track's dry signal (another track's retime, even one that
 * lengthens or shortens the whole timeline) must hit the cache; any change to that track's clip timing must re-render it.
 */
import { describe, expect, it, vi } from "vitest";
import { planClipSpeedEdit } from "../../editing/clip-speed-edit";
import { applyTimelineToolEdits } from "../../editing/timeline-tool-edit";
import type { Clip, Project, Track } from "../../types";
import { audioRangeFingerprint } from "../mixdown-cache";
import { planAddRackPlugin } from "./native-plugin-rack";
import { RackStemCache, resolveRackStems, type RackStemDeps } from "./rack-stems";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id, mediaId: "media", trackId, startTime, duration, inPoint: 0, outPoint: duration, effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const DELAY = { id: "vst3:0CDBB66985D548A9BFD8371909D24BB3", format: "vst3" as const, name: "ADelay", vendor: "Steinberg" };
const rack = () => planAddRackPlugin({ id: "x" }, DELAY, { actionId: "a", effectId: "fx1" })!.params.rack as NonNullable<Track["pluginRack"]>;
const audioTrack = (id: string, name: string, clips: Clip[], extra: Partial<Track> = {}): Track =>
  ({ id, name, type: "audio", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;

const project = (drums: Clip[] = [clip("d1", "drums", 0, 4), clip("d2", "drums", 4, 4)], syncLock = false): Project =>
  ({
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 8000, channels: 2 },
    mediaLibrary: { items: [{ id: "media", name: "m.wav", type: "audio", blob: null, metadata: { duration: 60 } }] },
    timeline: {
      duration: 30, markers: [], subtitles: [],
      tracks: [
        audioTrack("drums", "Drums", drums, { pluginRack: rack(), syncLock }),
        audioTrack("music", "Music", [clip("m1", "music", 0, 6), clip("m2", "music", 6, 24)], { syncLock }),
      ],
    },
  }) as unknown as Project;

const fakeBuffer = (tag: string): AudioBuffer => ({ tag, numberOfChannels: 2, length: 8, sampleRate: 8000 }) as unknown as AudioBuffer;
function setup() {
  const renderStem = vi.fn(async (_p: Project, _s: number) => fakeBuffer("dry"));
  const runChain = vi.fn(async (_b: AudioBuffer, _steps: unknown, _label: string) => ({ buffer: fakeBuffer("wet"), bypassed: new Map<string, string>() }));
  const deps: RackStemDeps<Project> = {
    renderStem, runChain, fingerprint: (p, s) => audioRangeFingerprint(p, 0, s), hasHost: true, audibility: new Map(), preview: false,
  };
  return { deps, renderStem, runChain, cache: new RackStemCache() };
}
const ripple = (p: Project, ids: string[], edit: Parameters<typeof planClipSpeedEdit>[2]): Project => {
  const plan = planClipSpeedEdit(p, ids, edit, { ripple: true }, "op");
  return applyTimelineToolEdits(p, plan.edits);
};

describe("track-rack stems and multi-clip ripple speed", () => {
  it("reports the track name so the background-task row can say what is rendering", async () => {
    const { deps, runChain, cache } = setup();
    await resolveRackStems(project(), deps, cache);
    expect(runChain.mock.calls[0][2]).toBe("Track Drums");
  });

  it("a ripple speed-up on ANOTHER track (which moves its later clips and shortens the timeline) does not invalidate the stem", async () => {
    const { deps, renderStem, runChain, cache } = setup();
    const before = project();
    const first = await resolveRackStems(before, deps, cache);
    expect(renderStem).toHaveBeenCalledTimes(1);
    const after = ripple(before, ["m1"], { speed: 2 });
    expect(after.timeline.tracks[1].clips.map((c) => c.startTime), "the ripple really moved the other track's clips").toEqual([0, 3]);
    expect(after.timeline.tracks[0].clips, "and left the rack track's clips untouched").toEqual(before.timeline.tracks[0].clips);
    const again = await resolveRackStems(after, deps, cache);
    expect(again.get("drums")).toBe(first.get("drums"));
    expect(renderStem).toHaveBeenCalledTimes(1);
    expect(runChain).toHaveBeenCalledTimes(1);
  });

  it("a ripple slow-down on another track that LENGTHENS the timeline does not invalidate it either", async () => {
    const { deps, renderStem, cache } = setup();
    const before = project();
    await resolveRackStems(before, deps, cache);
    const after = ripple(before, ["m2"], { speed: 0.5 });
    expect(after.timeline.tracks[1].clips[1].duration).toBe(48);
    await resolveRackStems(after, deps, cache);
    expect(renderStem).toHaveBeenCalledTimes(1);
  });

  it("a ripple speed change that touches the rack track's own clips re-renders it (a multi-track selection too)", async () => {
    const { deps, renderStem, cache } = setup();
    const before = project();
    await resolveRackStems(before, deps, cache);
    const own = ripple(before, ["d1"], { speed: 2 });
    expect(own.timeline.tracks[0].clips.map((c) => [c.startTime, c.duration])).toEqual([[0, 2], [2, 4]]);
    await resolveRackStems(own, deps, cache);
    expect(renderStem, "retimed clip and the rippled neighbour").toHaveBeenCalledTimes(2);

    const both = ripple(before, ["d2", "m1"], { durationScale: 0.5 });
    await resolveRackStems(both, deps, cache);
    expect(renderStem, "a selection spanning both tracks").toHaveBeenCalledTimes(3);
  });

  it("a sync-locked ripple elsewhere that SHIFTS the rack track's clips does invalidate it", async () => {
    const { deps, renderStem, cache } = setup();
    const before = project([clip("d1", "drums", 7, 4), clip("d2", "drums", 11, 4)], true);
    await resolveRackStems(before, deps, cache);
    const after = ripple(before, ["m1"], { speed: 2 });
    expect(after.timeline.tracks[0].clips.map((c) => c.startTime), "the follower track moved with the ripple").toEqual([4, 8]);
    await resolveRackStems(after, deps, cache);
    expect(renderStem).toHaveBeenCalledTimes(2);
  });

  it("the stem window follows the track's own end, not the timeline's", async () => {
    const { deps, renderStem, cache } = setup();
    await resolveRackStems(project(), deps, cache);
    const seconds = renderStem.mock.calls[0][1];
    expect(seconds, "8 s of clips + the plugin tail, not the 30 s timeline").toBeLessThan(30);
    expect(seconds).toBeGreaterThan(8);
  });
});
