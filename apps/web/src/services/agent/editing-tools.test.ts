import { beforeEach, describe, expect, it } from "vitest";
import { runTurn, type AgentEvent, type LLMClient, type ToolResult } from "@openreel/agent";
import { createPortableEdit, VIDEO_EDIT_PARAM_SCHEMAS } from "@openreel/core/editing/portable-project";
import type { EditSchema } from "@openreel/core/editing/safe-json";
import { useProjectStore } from "../../stores/project-store";
import { EditingSession } from "./editing-session";
import { editingToolDefs, executeEditingTool, EDITING_SYSTEM } from "./editing-tools";

function data(result: ToolResult): Record<string, unknown> {
  expect(result.ok, result.error?.message).toBe(true);
  return result.data as Record<string, unknown>;
}

async function addFixtureClip(session: EditingSession) {
  const { trackId } = data(await executeEditingTool("add_track", { trackType: "video" }, session));
  const { clipId } = data(await executeEditingTool("add_clip", { trackId, mediaId: "source-video", startTime: 0 }, session));
  return { trackId, clipId };
}

describe("browser AI media and effect tools", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject("Media edits");
    const { project } = useProjectStore.getState();
    useProjectStore.setState({ project: { ...project, mediaLibrary: { items: [{
      id: "source-video", name: "source.mp4", type: "video", blob: new Blob(["fixture"]),
      fileHandle: null, thumbnailUrl: null, waveformData: null,
      metadata: { duration: 10, width: 640, height: 360, frameRate: 24, codec: "avc", sampleRate: 48000, channels: 2, fileSize: 7 },
    }] } } });
  });

  it.each(["openai", "anthropic"] as const)("advertises actual effect keys and ranges to %s", (provider) => {
    type Definition = { name: string; description: string; parameters: EditSchema; input_schema: EditSchema };
    const tools = editingToolDefs(provider).map((definition) => provider === "openai" ? (definition as { function: Definition }).function : definition as Definition);
    for (const name of ["add_video_effect", "update_video_effect"]) {
      const tool = tools.find((definition) => definition.name === name)!;
      const schema = provider === "openai" ? tool.parameters : tool.input_schema;
      expect(schema.properties!.params.properties!.amount.type).toBe("number");
      expect(schema.properties!.params.additionalProperties).toBe(false);
      expect(tool.description).toContain("vignette: amount (0..1)");
      expect(tool.description).not.toContain("list_motion_shaders");
    }
    expect(EDITING_SYSTEM).toContain("mediaId is not a clipId");
  });

  it("publishes the same per-effect schemas used by validation", async () => {
    const session = new EditingSession(); session.beginTransaction();
    expect(data(await executeEditingTool("get_capabilities", {}, session)).videoEffectParams).toEqual(VIDEO_EDIT_PARAM_SCHEMAS);
  });

  it("adds and trims library media in a complete AI turn using returned stable IDs, with undo/redo", async () => {
    const before = createPortableEdit(useProjectStore.getState().getFullProject());
    let step = 0;
    const llm: LLMClient = { complete: async ({ messages }) => {
      const previous = messages.at(-1);
      const result = previous?.role === "tool" ? JSON.parse(previous.results[0].content as string) : undefined;
      const calls = [
        { name: "list_media", input: {} },
        { name: "add_track", input: { trackType: "video" } },
        { name: "add_clip", input: { trackId: result?.data?.trackId, mediaId: "source-video", startTime: 0 } },
        { name: "trim_clip", input: { clipId: result?.data?.clipId, inPoint: 2, outPoint: 7 } },
      ];
      const call = calls[step++];
      return { text: call ? "" : "Trimmed to five seconds.", stopReason: call ? "tool_use" : "end_turn", toolUses: call ? [{ id: `call-${step}`, ...call }] : [] };
    } };
    const result = await runTurn({ host: new EditingSession(), llm, tools: editingToolDefs("openai"), system: EDITING_SYSTEM, messages: [{ role: "user", content: "Trim the uploaded video to seconds 2–7" }], execute: executeEditingTool, atomic: true });
    expect(result.committed).toBe(true);
    const after = createPortableEdit(useProjectStore.getState().getFullProject());
    expect(after.project.timeline.tracks.flatMap((track) => track.clips)).toEqual([expect.objectContaining({ mediaId: "source-video", inPoint: 2, outPoint: 7, duration: 5 })]);
    await useProjectStore.getState().undo();
    expect(createPortableEdit(useProjectStore.getState().getFullProject())).toEqual(before);
    await useProjectStore.getState().redo();
    expect(createPortableEdit(useProjectStore.getState().getFullProject())).toEqual(after);
  });

  it("inserts a source range directly and returns both clip IDs when cut", async () => {
    const session = new EditingSession(); const transaction = session.beginTransaction();
    const { trackId } = data(await executeEditingTool("add_track", { trackType: "video" }, session));
    const added = data(await executeEditingTool("add_clip", { trackId, mediaId: "source-video", startTime: 4, inPoint: 2, outPoint: 8 }, session));
    expect(added).toMatchObject({ clipId: expect.any(String), inPoint: 2, outPoint: 8, duration: 6 });
    const split = data(await executeEditingTool("split_clip", { clipId: added.clipId, time: 7 }, session));
    expect(split.clipIds).toEqual(session.getProject().timeline.tracks[0].clips.map((clip) => clip.id));
    expect(split.clipIds).toHaveLength(2);
    await session.commitTransaction(transaction, "Cut imported video");
    expect(useProjectStore.getState().project.timeline.tracks[0].clips.map((clip) => [clip.inPoint, clip.outPoint, clip.duration])).toEqual([[2, 5, 3], [5, 8, 3]]);
  });

  it("finds transition pairs in draft timeline order and normalizes reversed IDs and long durations", async () => {
    const session = new EditingSession(); const txn = session.beginTransaction();
    const { trackId } = data(await executeEditingTool("add_track", { trackType: "video" }, session));
    const a = data(await executeEditingTool("add_clip", { trackId, mediaId: "source-video", startTime: 0, outPoint: 2 }, session));
    const b = data(await executeEditingTool("add_clip", { trackId, mediaId: "source-video", startTime: 2, outPoint: 0.3 }, session));
    const project = session.getProject();
    session.replaceDraft({ ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map((track) => ({ ...track, clips: [...track.clips].reverse() })) } });
    const options = data(await executeEditingTool("get_transition_options", { clipId: a.clipId }, session));
    expect(options.pairs).toEqual([expect.objectContaining({ clipAId: a.clipId, clipBId: b.clipId, maxDuration: 0.3, cutTime: 2 })]);
    const result = await executeEditingTool("add_transition", { clipAId: b.clipId, clipBId: a.clipId, transitionType: "crossfade", duration: 1 }, session);
    expect(data(result)).toMatchObject({ clipAId: a.clipId, clipBId: b.clipId, duration: 0.3, requestedDuration: 1, reordered: true });
    expect(result.summary).toContain("shortened");
    expect(session.getProject().timeline.tracks[0].clips.map((clip) => clip.startTime)).toEqual([2, 0]);
    await session.commitTransaction(txn, "Transition");
    expect(useProjectStore.getState().project.timeline.tracks[0].transitions).toEqual([expect.objectContaining({ clipAId: a.clipId, clipBId: b.clipId, duration: 0.3 })]);
  });

  it.each(["gap", "overlap", "different-track", "missing", "same-clip"])("rejects a %s pair without moving or mutating any clip", async (kind) => {
    const session = new EditingSession(); session.beginTransaction();
    const { trackId } = data(await executeEditingTool("add_track", { trackType: "video" }, session));
    const a = data(await executeEditingTool("add_clip", { trackId, mediaId: "source-video", startTime: 0, outPoint: 2 }, session));
    const otherTrack = kind === "different-track" ? data(await executeEditingTool("add_track", { trackType: "video" }, session)).trackId : trackId;
    const b = data(await executeEditingTool("add_clip", { trackId: otherTrack, mediaId: "source-video", startTime: kind === "gap" ? 4 : kind === "overlap" ? 1 : 2, outPoint: 2 }, session));
    const before = createPortableEdit(session.getProject());
    const result = await executeEditingTool("add_transition", { clipAId: a.clipId, clipBId: kind === "missing" ? "missing" : kind === "same-clip" ? a.clipId : b.clipId, transitionType: "crossfade", duration: 1 }, session);
    expect(result).toMatchObject({ ok: false, error: { recoverable: true } });
    expect(createPortableEdit(session.getProject())).toEqual(before);
    if (kind === "gap") expect(result.error?.message).toContain("2s gap");
    if (kind === "overlap") expect(result.error?.message).toContain("overlap by 1s");
  });

  it("does not classify partially applied presets as mutation-free corrections", async () => {
    const session = new EditingSession(); session.beginTransaction();
    const { clipId, trackId } = await addFixtureClip(session);
    const b = data(await executeEditingTool("add_clip", { trackId, mediaId: "source-video", startTime: 12, outPoint: 2 }, session));
    const result = await executeEditingTool("apply_edit_preset", { clipId, nextClipId: b.clipId, preset: { format: "openreel-preset", version: 1, name: "Look and cut", effects: [{ id: "effect", type: "brightness", params: { value: 0.1 }, enabled: true }], transition: { type: "crossfade", duration: 1, params: {} } } }, session);
    expect(result).toMatchObject({ ok: false, error: { recoverable: false } });
  });

  it("repairs a rejected transition in the same atomic turn and commits one undoable edit", async () => {
    const before = createPortableEdit(useProjectStore.getState().getFullProject());
    let step = 0, trackId: unknown, a: unknown, b: unknown, retryOf: unknown;
    const events: AgentEvent[] = [];
    const llm: LLMClient = { complete: async ({ messages }) => {
      expect(useProjectStore.getState().project.timeline.tracks.flatMap((track) => track.clips)).toHaveLength(0);
      const previous = messages.at(-1);
      const result = previous?.role === "tool" ? JSON.parse(previous.results[0].content as string) : undefined;
      if (step === 1) trackId = result.data.trackId;
      if (step === 2) a = result.data.clipId;
      if (step === 3) b = result.data.clipId;
      if (step === 4) { expect(result.error.code).toBe("TRANSITION_NOT_ADJACENT"); retryOf = result.error.retryOf; }
      const calls = [
        { name: "add_track", input: { trackType: "video" } },
        { name: "add_clip", input: { trackId, mediaId: "source-video", startTime: 0, outPoint: 2 } },
        { name: "add_clip", input: { trackId, mediaId: "source-video", startTime: 4, outPoint: 2 } },
        { name: "add_transition", input: { clipAId: a, clipBId: b, transitionType: "crossfade", duration: 1 } },
        { name: "move_clip", input: { clipId: b, startTime: 2 } },
        { name: "get_transition_options", input: { clipId: a } },
        { name: "add_transition", input: { clipAId: a, clipBId: b, transitionType: "crossfade", duration: 1, retryOf } },
      ];
      const call = calls[step++];
      return { text: call ? "" : "Joined the clips and added the transition.", stopReason: call ? "tool_use" : "end_turn", toolUses: call ? [{ id: `call-${step}`, ...call }] : [] };
    } };
    const result = await runTurn({ host: new EditingSession(), llm, tools: editingToolDefs("openai"), system: EDITING_SYSTEM, messages: [{ role: "user", content: "Join two two-second cuts and add a transition" }], execute: executeEditingTool, atomic: true, onEvent: (event) => events.push(event) });
    expect(result.committed).toBe(true);
    expect(events).toContainEqual({ type: "tool_recovered", callIds: ["call-4"], repairedBy: "call-7" });
    const after = createPortableEdit(useProjectStore.getState().getFullProject());
    expect(after.project.timeline.tracks[0].clips.map((clip) => clip.startTime)).toEqual([0, 2]);
    expect(after.project.timeline.tracks[0].transitions).toHaveLength(1);
    await useProjectStore.getState().undo(); expect(createPortableEdit(useProjectStore.getState().getFullProject())).toEqual(before);
    await useProjectStore.getState().redo(); expect(createPortableEdit(useProjectStore.getState().getFullProject())).toEqual(after);
  });

  it("commits the reported vignette intensity call as amount and supports updating it", async () => {
    const session = new EditingSession(); const transaction = session.beginTransaction();
    const { clipId } = await addFixtureClip(session);
    const params = { intensity: 0.3 };
    const { effectId } = data(await executeEditingTool("add_video_effect", { clipId, effectType: "vignette", params }, session));
    expect(effectId).toEqual(expect.any(String));
    expect(params).toEqual({ intensity: 0.3 });
    expect(session.getProject().timeline.tracks[0].clips[0].effects[0].params).toEqual({ amount: 0.3 });
    data(await executeEditingTool("update_video_effect", { clipId, effectId, params: { intensity: 0.5, feather: 0.7 } }, session));
    await session.commitTransaction(transaction, "Vignette");
    expect(createPortableEdit(useProjectStore.getState().getFullProject()).project.timeline.tracks[0].clips[0].effects[0]).toMatchObject({ type: "vignette", params: { amount: 0.5, feather: 0.7 } });
  });

  it.each([
    { intensity: 2 }, { intensity: "0.3" }, { intensity: 0.3, amount: 0.8 }, { amount: 0.3, unknown: 1 },
  ])("rejects invalid or conflicting effect parameters before mutation: %j", async (params) => {
    const session = new EditingSession(); session.beginTransaction();
    const { clipId } = await addFixtureClip(session);
    const result = await executeEditingTool("add_video_effect", { clipId, effectType: "vignette", params }, session);
    expect(result.ok).toBe(false);
    expect(session.getProject().timeline.tracks[0].clips[0].effects).toHaveLength(0);
  });

  it.each([
    ["brightness", { value: 0.2 }], ["contrast", { value: 1.2 }], ["saturation", { value: 1.1 }],
    ["hue", { rotation: -15 }], ["blur", { radius: 3 }], ["sharpen", { amount: 0.5, threshold: 0.1 }],
    ["vignette", { amount: 0.3, midpoint: 0.5 }], ["grain", { amount: 0.2, size: 1 }],
  ])("adds and updates supported %s parameters without breaking portable edits", async (effectType, params) => {
    const session = new EditingSession(); const transaction = session.beginTransaction();
    const { clipId } = await addFixtureClip(session);
    const { effectId } = data(await executeEditingTool("add_video_effect", { clipId, effectType, params }, session));
    data(await executeEditingTool("update_video_effect", { clipId, effectId, params }, session));
    await session.commitTransaction(transaction, "Effect");
    expect(createPortableEdit(useProjectStore.getState().getFullProject()).project.timeline.tracks[0].clips[0].effects[0].params).toEqual(params);
  });

  it("retains strict validation and locked-track protection for effect updates and new clips", async () => {
    const session = new EditingSession(); session.beginTransaction();
    const { clipId, trackId } = await addFixtureClip(session);
    const { effectId } = data(await executeEditingTool("add_video_effect", { clipId, effectType: "vignette", params: { amount: 0.3 } }, session));
    expect((await executeEditingTool("update_video_effect", { clipId, effectId, params: { intensity: 2 } }, session)).ok).toBe(false);
    expect((await executeEditingTool("add_video_effect", { clipId, effectType: "blur", params: { intensity: 0.3 } }, session)).ok).toBe(false);
    await session.applyAction({ type: "track/lock", id: crypto.randomUUID(), timestamp: Date.now(), params: { trackId, locked: true } });
    expect((await executeEditingTool("add_clip", { trackId, mediaId: "source-video", startTime: 10 }, session)).ok).toBe(false);
    expect((await executeEditingTool("update_video_effect", { clipId, effectId, params: { intensity: 0.5 } }, session)).ok).toBe(false);
    expect(session.getProject().timeline.tracks[0].clips).toHaveLength(1);
    expect(session.getProject().timeline.tracks[0].clips[0].effects[0].params).toEqual({ amount: 0.3 });
  });

  it.each([{ inPoint: 8, outPoint: 2 }, { inPoint: 10 }, { outPoint: 11 }])("rejects invalid source ranges before adding a clip: %j", async (range) => {
    const session = new EditingSession(); session.beginTransaction();
    const { trackId } = data(await executeEditingTool("add_track", { trackType: "video" }, session));
    const result = await executeEditingTool("add_clip", { trackId, mediaId: "source-video", startTime: 0, ...range }, session);
    expect(result.ok).toBe(false);
    expect(session.getProject().timeline.tracks[0].clips).toHaveLength(0);
  });
});
