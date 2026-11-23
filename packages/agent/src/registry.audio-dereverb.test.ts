import { describe, it, expect } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

function setup() {
  const history = new ActionHistory();
  const host = new HeadlessHost(makeProjectWithClip(), { history });
  return { host, history };
}
const effectsOf = (host: HeadlessHost) => host.getProject().timeline.tracks[0].clips[0].audioEffects ?? [];
const paramsOf = (host: HeadlessHost, type: string) => effectsOf(host).find((e) => e.type === type)?.params as Record<string, number> | undefined;

describe("reduce_reverb agent tool", () => {
  it("adds the effect with defaults as ONE undo step, updates it, and removes it", async () => {
    const { host, history } = setup();
    expect(getTool("reduce_reverb")?.readOnly).toBe(false);
    const before = history.getDisplayHistory().length;
    const added = await executeTool("reduce_reverb", { clipId: "c1" }, host);
    expect(added.ok).toBe(true);
    expect(paramsOf(host, "reduceReverb")).toEqual({ amount: 60, sensitivity: 50 });
    expect(history.getDisplayHistory().length).toBe(before + 1);

    const updated = await executeTool("reduce_reverb", { clipIds: ["c1"], amount: 80 }, host);
    expect(updated.ok).toBe(true);
    expect(paramsOf(host, "reduceReverb")).toEqual({ amount: 80, sensitivity: 50 });
    expect(effectsOf(host).filter((e) => e.type === "reduceReverb")).toHaveLength(1);

    const steps = history.getDisplayHistory().length;
    expect((await executeTool("reduce_reverb", { clipId: "c1", amount: 80 }, host)).ok).toBe(true);
    expect(history.getDisplayHistory().length, "an unchanged setting is not an undo step").toBe(steps);

    // One undo step takes the whole last change back.
    await executeTool("reduce_reverb", { clipId: "c1", sensitivity: 20 }, host);
    expect(paramsOf(host, "reduceReverb")?.sensitivity).toBe(20);
    expect((await new ActionExecutor(history).undo(host.getProject())).success).toBe(true);
    expect(paramsOf(host, "reduceReverb")?.sensitivity, "one undo takes the whole change back").toBe(50);

    const removed = await executeTool("reduce_reverb", { clipId: "c1", remove: true }, host);
    expect(removed.ok).toBe(true);
    expect(paramsOf(host, "reduceReverb")).toBeUndefined();
  });

  it("clamps, and rejects bad input and unknown clips", async () => {
    const { host } = setup();
    expect((await executeTool("reduce_reverb", {}, host)).ok).toBe(false);
    expect((await executeTool("reduce_reverb", { clipId: "nope" }, host)).error?.code).toBe("CLIP_NOT_FOUND");
    expect((await executeTool("reduce_reverb", { clipId: "c1", amount: "lots" }, host)).error?.code).toBe("INVALID_PARAMS");
    await executeTool("reduce_reverb", { clipId: "c1", amount: 900, sensitivity: -4 }, host);
    expect(paramsOf(host, "reduceReverb")).toEqual({ amount: 100, sensitivity: 0 });
  });
});

describe("set_speech_background_balance agent tool", () => {
  it("adds Enhance Speech when missing, stores the balance only when it is not the default, and keeps the mix", async () => {
    const { host, history } = setup();
    const before = history.getDisplayHistory().length;
    const set = await executeTool("set_speech_background_balance", { clipId: "c1", balance: 30 }, host);
    expect(set.ok).toBe(true);
    expect(paramsOf(host, "enhanceSpeech")).toEqual({ mix: 100, balance: 30 });
    expect(history.getDisplayHistory().length).toBe(before + 1);

    await executeTool("enhance_speech", { clipId: "c1", mix: 70 }, host);
    expect(paramsOf(host, "enhanceSpeech")).toEqual({ mix: 70, balance: 30 });

    const steps = history.getDisplayHistory().length;
    await executeTool("set_speech_background_balance", { clipId: "c1", balance: 30 }, host);
    expect(history.getDisplayHistory().length, "an unchanged balance is not an undo step").toBe(steps);

    await executeTool("set_speech_background_balance", { clipId: "c1", balance: 100 }, host);
    expect(paramsOf(host, "enhanceSpeech"), "the default balance leaves the params as they always were").toEqual({ mix: 70 });
  });

  it("rejects bad input", async () => {
    const { host } = setup();
    expect((await executeTool("set_speech_background_balance", { balance: 50 }, host)).ok).toBe(false);
    expect((await executeTool("set_speech_background_balance", { clipId: "c1" }, host)).error?.code).toBe("INVALID_PARAMS");
    expect((await executeTool("set_speech_background_balance", { clipId: "nope", balance: 50 }, host)).error?.code).toBe("CLIP_NOT_FOUND");
  });
});
