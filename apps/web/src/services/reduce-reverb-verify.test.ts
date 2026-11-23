import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ backend: null as unknown, cache: null as unknown }));

vi.mock("../utils/decode-clip-audio", () => ({
  decodeClipAudioBuffer: vi.fn(async () => {
    const data = Float32Array.from({ length: 8000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 300 * i) / 8000));
    return { failed: false, buffer: { numberOfChannels: 1, sampleRate: 8000, length: data.length, duration: 1, getChannelData: () => data } };
  }),
}));
vi.mock("@openreel/core", async () => {
  const actual = await vi.importActual<typeof import("@openreel/core")>("@openreel/core");
  const makeBuffer = (channels: Float32Array[], sampleRate: number) =>
    ({ numberOfChannels: channels.length, sampleRate, length: channels[0].length, duration: channels[0].length / sampleRate, getChannelData: (c: number) => channels[c] }) as unknown as AudioBuffer;
  return {
    ...actual,
    getRealtimeAudioGraph: () => ({
      getAudioContext: () => ({ createBuffer: (c: number, length: number, rate: number) => makeBuffer(Array.from({ length: c }, () => new Float32Array(length)), rate) }),
      prepareSpectralRepair: async (buffer: AudioBuffer, effects: unknown[]) => ({ buffer, effects, key: "" }),
      getReduceReverbCache: () => {
        hoisted.cache ??= new actual.ReduceReverbCache({ backend: hoisted.backend as never, makeBuffer });
        return hoisted.cache as InstanceType<typeof actual.ReduceReverbCache>;
      },
    }),
  };
});

import { ProjectSerializer, ReverbCancelledError, type Clip, type ReverbBackend } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { setReduceReverb, useReduceReverbStore } from "./reduce-reverb";

const fixture = JSON.parse(readFileSync(join(__dirname, "..", "test", "fixtures", "compat", "w8-audio-repair.openreel.json"), "utf8"));
const serializer = new ProjectSerializer({} as never);
const clipOf = (id: string): Clip => useProjectStore.getState().getClip(id)!;
const reverbOf = (id: string) => clipOf(id).audioEffects.find((e) => e.type === "reduceReverb");
const statusOf = (id: string) => useReduceReverbStore.getState().statuses[id];

function openProject(lockTrack = false, twoClips = false): string {
  const doc = structuredClone(fixture);
  const tracks = doc.project.timeline.tracks as Array<{ name: string; locked?: boolean; clips: Array<Record<string, unknown>> }>;
  const music = tracks.find((t) => t.name === "Music")!;
  const dialogueTrack = tracks.find((t) => t.name === "Dialogue")!;
  dialogueTrack.clips = [{ ...music.clips[0], id: "clip-dialogue", trackId: (dialogueTrack as unknown as { id: string }).id, volume: 1, audioEffects: [] }];
  if (twoClips) dialogueTrack.clips.push({ ...dialogueTrack.clips[0], id: "clip-dialogue-2", startTime: 20 });
  dialogueTrack.locked = lockTrack;
  useProjectStore.getState().loadProject(serializer.importFromJson(JSON.stringify(doc)));
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: { ...project, mediaLibrary: { ...project.mediaLibrary, items: project.mediaLibrary.items.map((item) => ({ ...item, blob: new Blob(["x"]) })) } },
  });
  return "clip-dialogue";
}

/** A backend that halves the signal, finishing when the test lets it (or at once). */
const makeBackend = (manual = false) => {
  const pending: Array<() => void> = [];
  const backend: ReverbBackend = {
    reduce: (channels, _rate, _params, options) =>
      new Promise((resolve, reject) => {
        const finish = () => resolve({ channels: channels.map((c) => c.map((v) => v * 0.5)), rt60: 0.7, confidence: 1 });
        options?.onProgress?.(0.4);
        options?.signal?.addEventListener("abort", () => reject(new ReverbCancelledError()));
        if (manual) pending.push(finish);
        else finish();
      }),
  };
  return { backend, pending };
};

describe("Reduce Reverb service: independent checks", () => {
  beforeEach(() => {
    hoisted.cache = null;
    useReduceReverbStore.setState({ statuses: {} });
  });

  it("two clips of one media at Amounts 25 and 65: both processed, each peeks its own result without replay; re-setting one clip leaves the other's job alone", async () => {
    const { backend, pending } = makeBackend(true);
    const calls: number[] = [];
    const aborted: number[] = [];
    const inner = backend.reduce.bind(backend);
    hoisted.backend = {
      reduce: (channels, rate, params, options) => {
        calls.push(params.amount);
        options?.signal?.addEventListener("abort", () => aborted.push(params.amount));
        return inner(channels, rate, params, options);
      },
    } satisfies ReverbBackend;
    const first = openProject(false, true);
    const second = "clip-dialogue-2";
    await setReduceReverb(first, { amount: 25 });
    await setReduceReverb(second, { amount: 65 });
    await vi.waitFor(() => expect(calls.sort((a, b) => a - b)).toEqual([25, 65]));
    // Supersede only the first clip's setting while both are still running.
    await setReduceReverb(first, { amount: 45 });
    await vi.waitFor(() => expect(calls).toContain(45));
    expect(aborted).not.toContain(65);
    for (let i = 0; i < 20 && statusOf(second)?.state !== "ready"; i += 1) {
      pending.splice(0).forEach((finish) => finish());
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await vi.waitFor(() => expect(statusOf(second)?.state).toBe("ready"));
    await vi.waitFor(() => expect(statusOf(first)?.state).toBe("ready"));
    expect(reverbOf(first)?.params).toMatchObject({ amount: 45 });
    expect(reverbOf(second)?.params).toMatchObject({ amount: 65 });
  });
});
