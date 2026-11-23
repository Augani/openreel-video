import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";

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
import { applyReduceReverb, cancelReduceReverb, removeReduceReverb, setReduceReverb, startReverbJob, useReduceReverbStore } from "./reduce-reverb";

const fixture = JSON.parse(readFileSync(join(__dirname, "..", "test", "fixtures", "compat", "w8-audio-repair.openreel.json"), "utf8"));
const serializer = new ProjectSerializer({} as never);
const clipOf = (id: string): Clip => useProjectStore.getState().getClip(id)!;
const steps = () => useProjectStore.getState().actionHistory.getDisplayHistory().length;
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

describe("Reduce Reverb service", () => {
  beforeEach(() => {
    hoisted.cache = null;
    useReduceReverbStore.setState({ statuses: {} });
  });

  it("adds the effect with the defaults in ONE undo step, runs the job, reports the estimate, and undo takes it off", async () => {
    hoisted.backend = makeBackend().backend;
    const id = openProject();
    const before = steps();
    const outcome = await applyReduceReverb([id]);
    expect(outcome).toEqual({ applied: [id], skipped: [] });
    expect(steps()).toBe(before + 1);
    expect(reverbOf(id)?.params).toEqual({ amount: 60, sensitivity: 50 });
    await vi.waitFor(() => expect(statusOf(id)).toMatchObject({ state: "ready", rt60: 0.7, confidence: 1 }));
    await useProjectStore.getState().undo();
    expect(reverbOf(id)).toBeUndefined();
    expect(steps()).toBe(before);
  });

  it("applying twice changes nothing; each setting change is one undo step and starts the job for the new setting", async () => {
    const { backend } = makeBackend();
    const run = vi.spyOn(backend, "reduce");
    hoisted.backend = backend;
    const id = openProject();
    await applyReduceReverb([id]);
    await vi.waitFor(() => expect(statusOf(id)?.state).toBe("ready"));
    const afterFirst = steps();
    await applyReduceReverb([id]);
    expect(steps()).toBe(afterFirst);
    await setReduceReverb(id, { amount: 90 });
    expect(reverbOf(id)?.params).toEqual({ amount: 90, sensitivity: 50 });
    expect(steps()).toBe(afterFirst + 1);
    await setReduceReverb(id, { sensitivity: 10 });
    expect(reverbOf(id)?.params).toEqual({ amount: 90, sensitivity: 10 });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    expect(clipOf(id).audioEffects.filter((e) => e.type === "reduceReverb")).toHaveLength(1);
  });

  it("two clips of one file with different Amounts both finish: a new setting on one clip never cancels the other's job", async () => {
    const { backend, pending } = makeBackend(true);
    const reduce = vi.spyOn(backend, "reduce");
    hoisted.backend = backend;
    const id = openProject(false, true);
    const other = "clip-dialogue-2";
    await setReduceReverb(id, { amount: 40 });
    await setReduceReverb(other, { amount: 80 });
    await vi.waitFor(() => expect(reduce).toHaveBeenCalledTimes(2));
    expect(statusOf(id)?.state).toBe("running");
    expect(statusOf(other)?.state).toBe("running");
    pending.splice(0).forEach((finish) => finish());
    await vi.waitFor(() => expect(statusOf(id)?.state).toBe("ready"));
    await vi.waitFor(() => expect(statusOf(other)?.state).toBe("ready"));
    const cache = hoisted.cache as InstanceType<typeof import("@openreel/core").ReduceReverbCache>;
    expect(statusOf(id)?.state).toBe("ready");
    expect(cache).toBeTruthy();
  });

  it("skips clips on locked tracks and says why; throws when nothing with audio is selected", async () => {
    hoisted.backend = makeBackend().backend;
    const id = openProject(true);
    const outcome = await applyReduceReverb([id]);
    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped[0].reason).toMatch(/locked/);
    expect(reverbOf(id)).toBeUndefined();
    await expect(applyReduceReverb(["no-such-clip"])).rejects.toThrow(/Select a clip with audio/);
  });

  it("reports progress while the job runs, and Cancel stops it and removes the effect", async () => {
    const { backend, pending } = makeBackend(true);
    hoisted.backend = backend;
    const id = openProject();
    await applyReduceReverb([id]);
    await vi.waitFor(() => expect(statusOf(id)).toMatchObject({ state: "running", fraction: 0.4 }));
    expect(pending).toHaveLength(1);
    await cancelReduceReverb(id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reverbOf(id)).toBeUndefined();
    expect(statusOf(id)?.state).toBe("idle");
  });

  it("shows a failed job with the reason, and removeReduceReverb is one undoable step", async () => {
    hoisted.backend = { reduce: async () => { throw new Error("worker missing"); } } satisfies ReverbBackend;
    const id = openProject();
    await applyReduceReverb([id]);
    await vi.waitFor(() => expect(statusOf(id)).toMatchObject({ state: "failed", error: "worker missing" }));
    expect(reverbOf(id)).toBeDefined();
    const before = steps();
    await removeReduceReverb(id);
    expect(reverbOf(id)).toBeUndefined();
    expect(steps()).toBe(before + 1);
    expect(await startReverbJob(id)).toBe(false);
  });

  it("reports the job to the background-task panel with progress and Cancel", async () => {
    backgroundTasks.clearFinished();
    const manual = makeBackend(true);
    hoisted.backend = manual.backend;
    const id = openProject();
    await applyReduceReverb([id]);
    const taskId = `reduce-reverb:${id}`;
    await vi.waitFor(() => expect(backgroundTasks.get(taskId)?.status).toBe("running"));
    expect(backgroundTasks.get(taskId)?.title).toMatch(/^Reduce Reverb/);
    expect(backgroundTasks.getSnapshot().find((t) => t.id === taskId)?.can.cancel).toBe(true);
    backgroundTasks.cancel(taskId);
    await vi.waitFor(() => expect(backgroundTasks.get(taskId)?.status).toBe("cancelled"));
  });
});
