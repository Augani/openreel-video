import { beforeEach, describe, expect, it } from "vitest";
import { runTurn, type LLMClient } from "@openreel/agent";
import { useProjectStore } from "../../stores/project-store";
import { EditingSession } from "./editing-session";
import { executeEditingTool } from "./editing-tools";
import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";

describe("atomic editing sessions on the real engine", () => {
  beforeEach(() => useProjectStore.getState().createNewProject("Atomic"));
  it("keeps pending actions invisible, commits once, and uses ordinary undo/redo", async () => {
    const store = useProjectStore.getState(); const before = JSON.stringify(store.project.timeline);
    const session = new EditingSession(); const txn = session.beginTransaction();
    expect((await executeEditingTool("add_track", { trackType: "image" }, session)).ok).toBe(true);
    expect(JSON.stringify(store.project.timeline)).toBe(before);
    await session.commitTransaction(txn, "AI edit");
    // Published React snapshots must stay immutable while the async executor runs.
    expect(JSON.stringify(store.project.timeline)).toBe(before);
    const committed = JSON.stringify(useProjectStore.getState().project.timeline);
    expect(committed).not.toBe(before);
    await useProjectStore.getState().undo(); expect(JSON.stringify(useProjectStore.getState().project.timeline)).toBe(before);
    await useProjectStore.getState().redo(); expect(JSON.stringify(useProjectStore.getState().project.timeline)).toBe(committed);
  });
  it("rejects stale project state and preserves the user's intervening edit", async () => {
    const session = new EditingSession(); const txn = session.beginTransaction();
    await executeEditingTool("add_track", { trackType: "audio" }, session);
    await useProjectStore.getState().renameProject("User's edit");
    await expect(session.commitTransaction(txn, "AI edit")).rejects.toThrow(/project changed/);
    expect(useProjectStore.getState().project.name).toBe("User's edit");
    expect(useProjectStore.getState().project.timeline.tracks.some((t) => t.type === "audio")).toBe(false);
  });
  it.each(["failure", "cancel", "budget"])("discards an entire turn after %s", async (kind) => {
    const before = JSON.stringify(editSnapshot(useProjectStore.getState().project));
    const controller = new AbortController(); let step = 0;
    const llm: LLMClient = { complete: async () => { step++; if (step === 1) return { text: "", stopReason: "tool_use", toolUses: [{ id: "call-1", name: "add_track", input: { trackType: "image" } }] }; if (kind === "cancel") controller.abort(); return { text: "", stopReason: "tool_use", toolUses: [{ id: "call-2", name: "move_clip", input: { clipId: "missing", startTime: 0 } }] }; } };
    const result = await runTurn({ host: new EditingSession(controller.signal), llm, tools: [], messages: [{ role: "user", content: "edit" }], execute: executeEditingTool, atomic: true, signal: controller.signal, limits: { maxSteps: kind === "budget" ? 1 : 3 } });
    expect(result.committed).toBe(false);
    expect(JSON.stringify(editSnapshot(useProjectStore.getState().project))).toBe(before);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
  it("rejects unknown tools, invalid values, ambiguous references and arbitrary scripts", async () => {
    const session = new EditingSession(); session.beginTransaction();
    for (const [name, args] of [["eval", { code: "alert(1)" }], ["set_clip_volume", { clipIndex: 0, volume: 1 }], ["add_track", { trackType: "bad" }], ["set_clip_transform", { clipId: "x", transform: { opacity: -1 } }]] as const) expect((await executeEditingTool(name, args, session)).ok).toBe(false);
  });
  it("edits typed audio effects and retains disabled preset effects with fresh IDs", async () => {
    const store = useProjectStore.getState();
    useProjectStore.setState({ project: { ...store.project, mediaLibrary: { items: [{ id: "fixture-media", name: "fixture.mp4", type: "video", blob: new Blob(["fixture"]), fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 4, width: 640, height: 360, frameRate: 24, codec: "avc", sampleRate: 48000, channels: 2, fileSize: 7 } }] } } });
    const session = new EditingSession(); session.beginTransaction();
    await executeEditingTool("add_track", { trackType: "video" }, session);
    const trackId = session.getProject().timeline.tracks[0].id;
    expect((await executeEditingTool("add_clip", { trackId, mediaId: "fixture-media", startTime: 0 }, session)).ok).toBe(true);
    const clipId = session.getProject().timeline.tracks[0].clips[0].id;
    expect((await executeEditingTool("add_audio_effect", { clipId, effect: { type: "eq", params: { bands: [{ type: "peaking", frequency: 1000, gain: -3, q: 1 }] } } }, session)).ok).toBe(true);
    expect((await executeEditingTool("add_audio_effect", { clipId, effect: { type: "gain", params: { value: 2 } } }, session)).ok).toBe(true);
    expect((await executeEditingTool("add_audio_effect", { clipId, effect: { type: "pan", params: { value: 2 } } }, session)).ok).toBe(false);
    expect((await executeEditingTool("apply_edit_preset", { clipId, preset: { format: "openreel-preset", version: 1, name: "Disabled look", effects: [{ id: "shared-effect", type: "brightness", params: { value: 0.1 }, enabled: false }] } }, session)).ok).toBe(true);
    const effect = session.getProject().timeline.tracks[0].clips[0].effects[0];
    expect(effect.enabled).toBe(false); expect(effect.id).not.toBe("shared-effect");
  });
});
