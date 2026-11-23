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
      // Reduce Reverb runs before Enhance Speech; these clips carry none, so the source passes straight through.
      prepareReduceReverb: async (buffer: AudioBuffer) => ({ buffer, effects: [], key: "" }),
      getEnhanceSpeechCache: () => {
        hoisted.cache ??= new actual.EnhanceSpeechCache({ backend: hoisted.backend as never, makeBuffer });
        return hoisted.cache as InstanceType<typeof actual.EnhanceSpeechCache>;
      },
    }),
  };
});

import { EnhanceCancelledError, ProjectSerializer, type Clip, type EnhanceBackend } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import {
  applyEnhanceSpeech,
  cancelEnhanceSpeech,
  isPreviewingOriginal,
  removeEnhanceSpeech,
  setEnhancePreviewOriginal,
  setEnhanceSpeechBalance,
  setEnhanceSpeechMix,
  startEnhanceJob,
  useEnhanceSpeechStore,
} from "./enhance-speech";

const fixture = JSON.parse(readFileSync(join(__dirname, "..", "test", "fixtures", "compat", "w8-audio-repair.openreel.json"), "utf8"));
const serializer = new ProjectSerializer({} as never);
const clipOf = (id: string): Clip => useProjectStore.getState().getClip(id)!;
const steps = () => useProjectStore.getState().actionHistory.getDisplayHistory().length;
const enhanceOf = (id: string) => clipOf(id).audioEffects.find((e) => e.type === "enhanceSpeech");
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Dialogue clip whose media has a blob (the decode is mocked) so the service finds audio to enhance. */
function openProject(lockTrack = false): string {
  const doc = structuredClone(fixture);
  const tracks = doc.project.timeline.tracks as Array<{ name: string; locked?: boolean; clips: Array<Record<string, unknown>> }>;
  const music = tracks.find((t) => t.name === "Music")!;
  const dialogueTrack = tracks.find((t) => t.name === "Dialogue")!;
  dialogueTrack.clips = [{ ...music.clips[0], id: "clip-dialogue", trackId: (dialogueTrack as unknown as { id: string }).id, volume: 1, audioEffects: [] }];
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
  const backend: EnhanceBackend = {
    enhance: (channels, _rate, options) =>
      new Promise((resolve, reject) => {
        const finish = () => resolve(channels.map((c) => c.map((v) => v * 0.5)));
        options?.onProgress?.(0.4);
        options?.signal?.addEventListener("abort", () => reject(new EnhanceCancelledError()));
        if (manual) pending.push(finish);
        else finish();
      }),
  };
  return { backend, pending };
};

describe("Enhance Speech service", () => {
  beforeEach(() => {
    hoisted.cache = null;
    useEnhanceSpeechStore.setState({ statuses: {} });
  });

  it("adds the effect at Mix 100 in ONE undo step, runs the job, and undo takes it off again", async () => {
    hoisted.backend = makeBackend().backend;
    const id = openProject();
    const before = steps();
    const outcome = await applyEnhanceSpeech([id]);
    expect(outcome).toEqual({ applied: [id], skipped: [] });
    expect(steps()).toBe(before + 1);
    expect(enhanceOf(id)?.params).toEqual({ mix: 100 });
    await vi.waitFor(() => expect(useEnhanceSpeechStore.getState().statuses[id]?.state).toBe("ready"));
    await useProjectStore.getState().undo();
    expect(enhanceOf(id)).toBeUndefined();
    expect(steps()).toBe(before);
  });

  it("applying twice changes nothing, and Mix edits replace the one effect without another model run", async () => {
    const { backend } = makeBackend();
    const run = vi.spyOn(backend, "enhance");
    hoisted.backend = backend;
    const id = openProject();
    await applyEnhanceSpeech([id]);
    await vi.waitFor(() => expect(useEnhanceSpeechStore.getState().statuses[id]?.state).toBe("ready"));
    const afterFirst = steps();
    await applyEnhanceSpeech([id]);
    expect(steps()).toBe(afterFirst);
    await setEnhanceSpeechMix(id, 35);
    expect(clipOf(id).audioEffects.filter((e) => e.type === "enhanceSpeech")).toHaveLength(1);
    expect(enhanceOf(id)?.params).toEqual({ mix: 35 });
    expect(steps()).toBe(afterFirst + 1);
    await startEnhanceJob(id);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("sets the Speech / Background balance as one undo step per change without another model run, and keeps old params untouched until used", async () => {
    const { backend } = makeBackend();
    const run = vi.spyOn(backend, "enhance");
    hoisted.backend = backend;
    const id = openProject();
    await applyEnhanceSpeech([id]);
    await vi.waitFor(() => expect(useEnhanceSpeechStore.getState().statuses[id]?.state).toBe("ready"));
    expect(enhanceOf(id)?.params).toEqual({ mix: 100 });
    const before = steps();
    await setEnhanceSpeechBalance(id, 30);
    expect(enhanceOf(id)?.params).toEqual({ mix: 100, balance: 30 });
    expect(steps()).toBe(before + 1);
    await setEnhanceSpeechBalance(id, 30);
    expect(steps(), "an unchanged balance is not an undo step").toBe(before + 1);
    await setEnhanceSpeechMix(id, 60);
    expect(enhanceOf(id)?.params).toEqual({ mix: 60, balance: 30 });
    await setEnhanceSpeechBalance(id, 100);
    expect(enhanceOf(id)?.params).toEqual({ mix: 60 });
    await useProjectStore.getState().undo();
    expect(enhanceOf(id)?.params).toEqual({ mix: 60, balance: 30 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("skips clips on locked tracks and says why; throws when nothing with audio is selected", async () => {
    hoisted.backend = makeBackend().backend;
    const id = openProject(true);
    const outcome = await applyEnhanceSpeech([id]);
    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped[0]).toMatchObject({ clipId: id });
    expect(outcome.skipped[0].reason).toMatch(/locked/);
    expect(enhanceOf(id)).toBeUndefined();
    await expect(applyEnhanceSpeech(["no-such-clip"])).rejects.toThrow(/Select a clip with audio/);
  });

  it("before/after is a preview-only switch stored on the effect", async () => {
    hoisted.backend = makeBackend().backend;
    const id = openProject();
    await applyEnhanceSpeech([id]);
    expect(isPreviewingOriginal(clipOf(id))).toBe(false);
    expect(setEnhancePreviewOriginal(id, true)).toBe(true);
    expect(isPreviewingOriginal(clipOf(id))).toBe(true);
    expect(enhanceOf(id)?.enabled).toBe(true);
    expect(setEnhancePreviewOriginal(id, false)).toBe(true);
    expect(isPreviewingOriginal(clipOf(id))).toBe(false);
    expect(setEnhancePreviewOriginal("nope", true)).toBe(false);
  });

  it("reports progress while the job runs, and Cancel stops it and removes the effect", async () => {
    const { backend, pending } = makeBackend(true);
    hoisted.backend = backend;
    const id = openProject();
    await applyEnhanceSpeech([id]);
    await vi.waitFor(() => expect(useEnhanceSpeechStore.getState().statuses[id]).toMatchObject({ state: "running", fraction: 0.4 }));
    expect(pending).toHaveLength(1);
    await cancelEnhanceSpeech(id);
    await flush();
    expect(enhanceOf(id)).toBeUndefined();
    expect(useEnhanceSpeechStore.getState().statuses[id]?.state).toBe("idle");
  });

  it("shows a failed job with the reason and lets it be retried", async () => {
    let fail = true;
    hoisted.backend = { enhance: async (channels: Float32Array[]) => { if (fail) throw new Error("model missing"); return channels; } } satisfies EnhanceBackend;
    const id = openProject();
    await applyEnhanceSpeech([id]);
    await vi.waitFor(() => expect(useEnhanceSpeechStore.getState().statuses[id]).toMatchObject({ state: "failed", error: "model missing" }));
    expect(enhanceOf(id)).toBeDefined();
    fail = false;
    useEnhanceSpeechStore.getState().set(id, { state: "idle", fraction: 0 });
    hoisted.cache = null;
    expect(await startEnhanceJob(id)).toBe(true);
  });

  it("removeEnhanceSpeech is one undoable step", async () => {
    hoisted.backend = makeBackend().backend;
    const id = openProject();
    await applyEnhanceSpeech([id]);
    const before = steps();
    await removeEnhanceSpeech(id);
    expect(enhanceOf(id)).toBeUndefined();
    expect(steps()).toBe(before + 1);
  });

  it("reports the job to the background-task panel with progress, Cancel and a retryable failure", async () => {
    backgroundTasks.clearFinished();
    const manual = makeBackend(true);
    hoisted.backend = manual.backend;
    const id = openProject();
    await applyEnhanceSpeech([id]);
    const taskId = `enhance-speech:${id}`;
    await vi.waitFor(() => expect(backgroundTasks.get(taskId)?.status).toBe("running"));
    expect(backgroundTasks.get(taskId)?.title).toMatch(/^Enhance Speech/);
    expect(backgroundTasks.getSnapshot().find((t) => t.id === taskId)?.can.cancel).toBe(true);
    backgroundTasks.cancel(taskId);
    await vi.waitFor(() => expect(backgroundTasks.get(taskId)?.status).toBe("cancelled"));

    hoisted.cache = null;
    hoisted.backend = { enhance: async () => { throw new Error("Model failed to load"); } } satisfies EnhanceBackend;
    await startEnhanceJob(id);
    expect(backgroundTasks.get(taskId)).toMatchObject({ status: "failed", error: "Model failed to load" });
    expect(backgroundTasks.getSnapshot().find((t) => t.id === taskId)?.can.retry).toBe(true);

    hoisted.cache = null;
    hoisted.backend = makeBackend().backend;
    backgroundTasks.retry(taskId);
    await vi.waitFor(() => expect(backgroundTasks.get(taskId)?.status).toBe("completed"));
  });
});
