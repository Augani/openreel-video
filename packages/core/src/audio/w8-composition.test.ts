import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import type { AudioBus, Clip, Track } from "../types/timeline";
import { exportBusStems } from "../export/stem-export";
import { MixdownCache, audioRangeFingerprint, renderMixdownCached, type MixChunk } from "./mixdown-cache";
import type { MixdownRenderer } from "./loudness/project-loudness";
import { AUDIO_RACK_EFFECT_DEFINITIONS, AUDIO_RACK_EFFECT_TYPES, createRackEffect, sanitizeAudioRack } from "./track-audio-rack";
import { REPAIR_EFFECT_DEFINITIONS, REPAIR_EFFECT_TYPES } from "./repair";

/**
 * Wave 8 composition: the audio repair effects (DeHum, DeClick, DeClip, DeEss, DeReverb, Gate) are
 * ordinary rack effects. They are valid in bus racks, the stem export renders the isolated bus with
 * that rack, and the mixdown cache re-renders exactly when a repair parameter changes.
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
const humRack = (frequency: number): AudioBus["rack"] => ({
  effects: [createRackEffect("deHum", { id: "hum", params: { frequency, harmonics: 4, q: 30, depth: 1 } })],
});

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
  const pcm = () => ({ numberOfChannels: 2, sampleRate: 8000, getChannelData: () => new Float32Array(8000 * 10) });
  const cached: MixdownRenderer = {
    isInitialized: () => true,
    initialize: async () => undefined,
    renderAudio: async (p, start, duration) => {
      const buffer = await renderMixdownCached(
        p, start, duration,
        async () => {
          rendered.push(p);
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

describe("audio repair effects in bus racks (wave 8 x wave 7)", () => {
  it("every repair effect is a registered rack effect with a definition and sane defaults", () => {
    for (const type of REPAIR_EFFECT_TYPES) {
      expect(AUDIO_RACK_EFFECT_TYPES, type).toContain(type);
      const rackDefinition = AUDIO_RACK_EFFECT_DEFINITIONS[type];
      expect(rackDefinition.repair, type).toBe(true);
      expect(rackDefinition.params.map((p) => p.key), type).toEqual(REPAIR_EFFECT_DEFINITIONS[type].params.map((p) => p.key));
      const effect = createRackEffect(type);
      for (const spec of rackDefinition.params) {
        expect(effect.params[spec.key], `${type}.${spec.key}`).toBe(spec.default);
      }
    }
  });

  it("a bus rack with repair effects survives the rack sanitizer used on project load, unchanged", () => {
    const rack = { effects: REPAIR_EFFECT_TYPES.slice(0, 5).map((type) => createRackEffect(type)) };
    const sanitized = sanitizeAudioRack(JSON.parse(JSON.stringify(rack)));
    expect(sanitized?.effects.map((e) => e.type)).toEqual(rack.effects.map((e) => e.type));
    expect(sanitized?.effects.map((e) => e.params)).toEqual(rack.effects.map((e) => e.params));
  });

  it("the mixdown fingerprint changes when (and only when) a repair parameter or bypass changes", () => {
    const base = audioRangeFingerprint(project([bus("dlg", { rack: humRack(60) }), bus("mus")]), 0, 4);
    expect(audioRangeFingerprint(project([bus("dlg", { rack: humRack(60) }), bus("mus")]), 0, 4)).toBe(base);
    expect(audioRangeFingerprint(project([bus("dlg", { rack: humRack(50) }), bus("mus")]), 0, 4)).not.toBe(base);
    const bypassed = { effects: humRack(60)!.effects.map((e) => ({ ...e, bypassed: true })) };
    expect(audioRangeFingerprint(project([bus("dlg", { rack: bypassed }), bus("mus")]), 0, 4)).not.toBe(base);
    expect(audioRangeFingerprint(project([bus("dlg"), bus("mus")]), 0, 4)).not.toBe(base);
  });

  it("stems render each bus with its own repair rack; a DeHum edit re-renders only that stem", async () => {
    const { cached, rendered } = harness();
    await exportBusStems(project([bus("dlg", { rack: humRack(60) }), bus("mus")]), cached);
    expect(rendered).toHaveLength(2);
    const dialogue = rendered.find((p) => p.timeline.audioBuses?.find((b) => b.id === "dlg")?.rack?.effects[0]?.type === "deHum");
    expect(dialogue, "the dialogue stem carries the DeHum rack").toBeDefined();
    expect(dialogue!.timeline.tracks.find((t) => t.id === "m")?.muted).toBe(true);

    await exportBusStems(project([bus("dlg", { rack: humRack(60) }), bus("mus")]), cached);
    expect(rendered, "unchanged: served from the cache").toHaveLength(2);

    await exportBusStems(project([bus("dlg", { rack: humRack(50) }), bus("mus")]), cached);
    expect(rendered).toHaveLength(3);
    expect(rendered[2].timeline.audioBuses?.find((b) => b.id === "dlg")?.rack?.effects[0]?.params).toMatchObject({ frequency: 50 });
  });
});
