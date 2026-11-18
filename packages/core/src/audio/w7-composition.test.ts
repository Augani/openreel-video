import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import type { AudioBus, Clip, Track } from "../types/timeline";
import { exportBusStems } from "../export/stem-export";
import { MixdownCache, renderMixdownCached, type MixChunk } from "./mixdown-cache";
import type { MixdownRenderer } from "./loudness/project-loudness";

/**
 * Wave 7 composition: bus routing, the mixdown cache and the stem export agree. A stem is the
 * ordinary export mixdown of the isolated bus, so it carries the bus's effect rack, and the
 * cache re-renders it exactly when (and only when) that rack, fader or routing changes.
 */

const clip = (id: string, trackId: string): Clip =>
  ({
    id, mediaId: "m1", trackId, startTime: 0, duration: 4, inPoint: 0, outPoint: 4, effects: [], audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
    volume: 1, keyframes: [],
  }) as Clip;
const track = (id: string, extra: Partial<Track> = {}): Track =>
  ({ id, type: "audio", name: id, clips: [clip(`c-${id}`, id)], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;

const bus = (id: string, extra: Partial<AudioBus> = {}): AudioBus => ({ id, name: id, muted: false, solo: false, ...extra });
const reverbRack = (decay: number): AudioBus["rack"] => ({
  effects: [{ id: "fx", type: "reverb", params: { decay }, bypassed: false }],
}) as AudioBus["rack"];

const project = (buses: AudioBus[]): Project =>
  ({
    id: "p", name: "P", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 8000, channels: 2 },
    timeline: { duration: 4, markers: [], subtitles: [], tracks: [track("d", { output: "dlg" }), track("m", { output: "mus" })], audioBuses: buses },
    mediaLibrary: { items: [{ id: "m1", name: "a.wav", type: "audio", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 4 } }] },
  }) as unknown as Project;

function harness() {
  const cache = new MixdownCache();
  const rendered: Project[] = [];
  const inner: MixdownRenderer = {
    isInitialized: () => true,
    initialize: async () => undefined,
    renderAudio: async (p) => {
      rendered.push(p);
      return { buffer: undefined as never };
    },
  };
  // The real export wrapper (createCachedMixdownRenderer) with PCM stand-ins for AudioBuffer.
  const pcm = (): { numberOfChannels: number; sampleRate: number; getChannelData: (c: number) => Float32Array } => ({
    numberOfChannels: 2, sampleRate: 8000, getChannelData: () => new Float32Array(8000 * 10),
  });
  const cached: MixdownRenderer = {
    isInitialized: () => true,
    initialize: async () => undefined,
    renderAudio: async (p, start, duration) => {
      const buffer = await renderMixdownCached(
        p, start, duration,
        async () => {
          await inner.renderAudio(p, start, duration);
          return pcm();
        },
        (chunk: MixChunk) => ({ numberOfChannels: chunk.channels.length, sampleRate: chunk.sampleRate, getChannelData: (c: number) => chunk.channels[c] }),
        cache,
      );
      return { buffer: buffer as unknown as AudioBuffer };
    },
  };
  return { cached, rendered };
}

describe("stems, bus routing and the mixdown cache", () => {
  it("every stem is rendered from the isolated bus, with that bus's effect rack and nothing of the others", async () => {
    const { cached, rendered } = harness();
    const stems = await exportBusStems(project([bus("dlg", { rack: reverbRack(2) }), bus("mus")]), cached, { busIds: ["dlg"] });
    expect(stems.map((s) => s.busId)).toEqual(["dlg"]);
    expect(rendered).toHaveLength(1);
    const isolated = rendered[0];
    expect(isolated.timeline.audioBuses?.find((b) => b.id === "dlg")?.rack?.effects[0]?.type).toBe("reverb");
    expect(isolated.timeline.tracks.find((t) => t.id === "m")?.muted).toBe(true);
    expect(isolated.timeline.masterAudioRack).toBeUndefined();
  });

  it("an unchanged project re-exports from the cache; a bus effect edit re-renders only the affected stem", async () => {
    const { cached, rendered } = harness();
    const before = project([bus("dlg", { rack: reverbRack(2) }), bus("mus")]);
    await exportBusStems(before, cached);
    expect(rendered).toHaveLength(2);

    await exportBusStems(project([bus("dlg", { rack: reverbRack(2) }), bus("mus")]), cached);
    expect(rendered).toHaveLength(2);

    await exportBusStems(project([bus("dlg", { rack: reverbRack(5) }), bus("mus")]), cached);
    // Only the dialogue stem sees the edited rack; the music stem is isolated from it.
    expect(rendered).toHaveLength(3);
    expect(rendered[2].timeline.audioBuses?.find((b) => b.id === "dlg")?.rack?.effects[0]?.params).toMatchObject({ decay: 5 });
  });
});
