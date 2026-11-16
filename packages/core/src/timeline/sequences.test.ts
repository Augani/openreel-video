import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import { editSnapshot } from "../actions/handlers/edit-snapshot";
import {
  ProjectSerializer,
  MULTI_SEQUENCE_CAPABILITY,
  normalizeProjectStoredFields,
} from "../storage/project-serializer";
import type { Clip, Project, Track } from "../types";
import type { CompoundClip } from "./nested-sequence-engine";
import { createTimelineClipCapabilityResolver } from "./timeline-items";
import {
  MAIN_SEQUENCE_ID,
  activateSequence,
  closeSequenceTab,
  countSequenceInstances,
  createSequence,
  deleteSequence,
  descendantSequenceIds,
  duplicateSequence,
  ensureSequences,
  getSequence,
  insertSequenceAsNest,
  nestClips,
  projectForSequence,
  renameSequence,
  reorderOpenSequences,
  syncActiveSequence,
  wouldCreateSequenceCycle,
} from "./sequences";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  rotation: 0,
  opacity: 1,
};
const clip = (id: string, trackId: string, startTime: number, duration: number, mediaId = "m1"): Clip => ({
  id, mediaId, trackId, startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const track = (id: string, type: Track["type"], clips: Clip[] = []): Track => ({
  id, type, name: id, mode: "standard", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
const media = (id: string, type: "video" | "audio" = "video") => ({
  id, name: `${id}.mp4`, type, blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  metadata: { duration: 10, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 48000, channels: 2, fileSize: 1 },
});
function legacyProject(): Project {
  return {
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media("m1"), media("m2")] as unknown as Project["mediaLibrary"]["items"] },
    timeline: {
      tracks: [track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4, "m2")]), track("a1", "audio")],
      subtitles: [], duration: 8, markers: [{ id: "mk", time: 2, label: "x", color: "#fff" } as never],
    },
  };
}

describe("migration to sequences", () => {
  it("wraps an old project's timeline in one sequence and leaves project.timeline untouched", () => {
    const old = legacyProject();
    const next = ensureSequences(old);
    expect(next.sequences).toHaveLength(1);
    expect(next.activeSequenceId).toBe(MAIN_SEQUENCE_ID);
    expect(next.openSequenceIds).toEqual([MAIN_SEQUENCE_ID]);
    expect(next.sequences?.[0].timeline).toBe(old.timeline);
    expect(next.timeline).toBe(old.timeline);
    expect(next.sequences?.[0].timeline.markers).toHaveLength(1);
    expect(next.compoundClips ?? []).toEqual([]);
  });

  it("is idempotent and referentially stable", () => {
    const once = ensureSequences(legacyProject());
    expect(ensureSequences(once)).toBe(once);
  });

  it("turns legacy compound clips into sequences that keep their id so existing nest clips still resolve", () => {
    const old = legacyProject();
    const inner = [clip("i1", "t1", 0, 3)];
    const compound: CompoundClip = {
      id: "compound_legacy", name: "Legacy", color: "#fff", createdAt: 1, modifiedAt: 1,
      content: { clips: inner, tracks: [track("t1", "video", inner)], duration: 3 },
    };
    const nest = { ...clip("n", "v1", 8, 3, "compound:compound_legacy"), metadata: { compoundClipId: "compound_legacy" } };
    const project: Project = {
      ...old, compoundClips: [compound],
      timeline: { ...old.timeline, tracks: [{ ...old.timeline.tracks[0], clips: [...old.timeline.tracks[0].clips, nest] }, old.timeline.tracks[1]] },
    };
    const next = ensureSequences(project);
    expect(next.sequences?.map((s) => s.id)).toEqual([MAIN_SEQUENCE_ID, "compound_legacy"]);
    expect(getSequence(next, "compound_legacy")?.timeline.tracks[0].clips).toEqual(inner);
    expect(next.compoundClips?.map((c) => c.id)).toEqual(["compound_legacy"]);
    expect(next.compoundClips?.[0].content.duration).toBe(3);
    // The old nest clip is untouched and now openable.
    expect(next.timeline.tracks[0].clips.at(-1)).toBe(nest);
    expect(wouldCreateSequenceCycle(next, "compound_legacy", MAIN_SEQUENCE_ID)).toBe(true); // main already nests it
    expect(wouldCreateSequenceCycle(next, MAIN_SEQUENCE_ID, "compound_legacy")).toBe(false);
  });

  it("repairs dangling active and tab ids", () => {
    const base = ensureSequences(legacyProject());
    const broken = { ...base, activeSequenceId: "ghost", openSequenceIds: ["ghost", "ghost", MAIN_SEQUENCE_ID] };
    const fixed = ensureSequences(broken);
    expect(fixed.activeSequenceId).toBe(MAIN_SEQUENCE_ID);
    expect(fixed.openSequenceIds).toEqual([MAIN_SEQUENCE_ID]);
  });

  it("runs as part of stored-field normalization", () => {
    expect(normalizeProjectStoredFields(legacyProject()).sequences).toHaveLength(1);
  });
});

describe("active sequence invariant", () => {
  it("mirrors the live timeline and keeps stored copies of inactive sequences", () => {
    const created = createSequence(ensureSequences(legacyProject()), { name: "B" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const b = created.project;
    expect(getSequence(b, b.activeSequenceId as string)?.name).toBe("B");
    expect(b.timeline).toBe(getSequence(b, b.activeSequenceId as string)?.timeline);
    // Main is parked with its two clips.
    expect(getSequence(b, MAIN_SEQUENCE_ID)?.timeline.tracks[0].clips).toHaveLength(2);
    expect(b.openSequenceIds).toEqual([MAIN_SEQUENCE_ID, b.activeSequenceId]);
  });

  it("a live edit is flushed into the stored sequence before it is read or switched away from", () => {
    const base = ensureSequences(legacyProject());
    const edited: Project = { ...base, timeline: { ...base.timeline, tracks: [{ ...base.timeline.tracks[0], clips: [] }, base.timeline.tracks[1]] } };
    expect(base.sequences?.[0].timeline.tracks[0].clips).toHaveLength(2); // stale until flushed
    expect(syncActiveSequence(edited).sequences?.[0].timeline.tracks[0].clips).toHaveLength(0);
    const switched = createSequence(edited, { name: "B" });
    if (!switched.ok) throw new Error(switched.message);
    expect(getSequence(switched.project, MAIN_SEQUENCE_ID)?.timeline.tracks[0].clips).toHaveLength(0);
  });

  it("swaps project.settings with the active sequence", () => {
    const base = ensureSequences(legacyProject());
    const created = createSequence(base, { name: "Vertical", settings: { width: 1080, height: 1920, frameRate: 24 } });
    if (!created.ok) throw new Error(created.message);
    expect(created.project.settings).toMatchObject({ width: 1080, height: 1920, frameRate: 24, sampleRate: 48000 });
    const back = activateSequence(created.project, MAIN_SEQUENCE_ID);
    if (!back.ok) throw new Error(back.message);
    expect(back.project.settings.width).toBe(1920);
  });

  it("rejects invalid settings", () => {
    expect(createSequence(ensureSequences(legacyProject()), { settings: { width: 0 } }).ok).toBe(false);
  });
});

describe("nesting", () => {
  function nested() {
    const base = ensureSequences(legacyProject());
    const result = nestClips(base, ["a", "b"], "Nest 1");
    if (!result.ok) throw new Error(result.message);
    return result;
  }

  it("moves the selected clips into a new sequence and leaves one nest clip over the same span", () => {
    const { project, sequenceId, clipId } = nested();
    const nest = project.timeline.tracks[0].clips.find((c) => c.id === clipId) as Clip;
    expect(project.timeline.tracks[0].clips).toHaveLength(1);
    expect([nest.startTime, nest.duration]).toEqual([0, 8]);
    expect(nest.mediaId).toBe(`compound:${sequenceId}`);
    const inner = getSequence(project, sequenceId as string);
    expect(inner?.timeline.tracks.flatMap((t) => t.clips).map((c) => [c.id, c.startTime])).toEqual([["a", 0], ["b", 4]]);
    expect(project.nestedInstances?.map((i) => i.id)).toEqual([clipId]);
    expect(project.timeline.duration).toBe(8);
  });

  it("does not carry the parent's bus routing into the nested sequence", () => {
    const legacy = legacyProject();
    const routed = {
      ...legacy,
      timeline: {
        ...legacy.timeline,
        audioBuses: [{ id: "bus1", name: "Music", muted: false, solo: false }],
        tracks: legacy.timeline.tracks.map((t) =>
          t.id === "v1" ? { ...t, output: "bus1", sends: [{ id: "s", busId: "bus1", level: 1, preFader: false }] } : t),
      },
    } as Project;
    const result = nestClips(ensureSequences(routed), ["a", "b"], "Nest 1");
    if (!result.ok) throw new Error(result.message);
    const inner = getSequence(result.project, result.sequenceId as string);
    for (const t of inner?.timeline.tracks ?? []) {
      expect(t.output).toBeUndefined();
      expect(t.sends).toBeUndefined();
    }
    // the parent keeps its routing
    expect(result.project.timeline.tracks.find((t) => t.id === "v1")?.output).toBe("bus1");
  });

  it("normalizes inner start times when the selection does not start at zero", () => {
    const base = ensureSequences(legacyProject());
    const result = nestClips(base, ["b"]);
    if (!result.ok) throw new Error(result.message);
    expect(getSequence(result.project, result.sequenceId as string)?.timeline.tracks[0].clips[0].startTime).toBe(0);
    const nest = result.project.timeline.tracks[0].clips.find((c) => c.id === result.clipId) as Clip;
    expect(nest.startTime).toBe(4);
  });

  it("refuses locked tracks, empty selections and overlaps with unselected clips", () => {
    const base = ensureSequences(legacyProject());
    expect(nestClips(base, []).ok).toBe(false);
    const locked = { ...base, timeline: { ...base.timeline, tracks: [{ ...base.timeline.tracks[0], locked: true }, base.timeline.tracks[1]] } };
    expect(nestClips(locked, ["a"]).ok).toBe(false);
    const withMiddle = { ...base, timeline: { ...base.timeline, tracks: [{ ...base.timeline.tracks[0], clips: [clip("a", "v1", 0, 2), clip("mid", "v1", 2, 2), clip("c", "v1", 4, 2)] }, base.timeline.tracks[1]] } };
    const blocked = nestClips(withMiddle, ["a", "c"]);
    expect(blocked.ok).toBe(false);
  });

  it("projects the nested sequence so render, audio and capability resolution see its content", () => {
    const { project, sequenceId } = nested();
    expect(project.compoundClips?.map((c) => c.id)).toEqual([sequenceId]);
    expect(project.compoundClips?.[0].content.duration).toBe(8);
    const nest = project.timeline.tracks[0].clips[0];
    const caps = createTimelineClipCapabilityResolver(project.mediaLibrary, project.compoundClips)(nest);
    expect(caps.visual).toBe(true);
  });

  it("editing inside a nest (open it, trim) changes the projection every parent instance renders", () => {
    const { project, sequenceId } = nested();
    const opened = activateSequence(project, sequenceId as string);
    if (!opened.ok) throw new Error(opened.message);
    // Inside the nest: trim clip b to 1s. Parent is parked; its nest comes from the projection.
    const inside = opened.project;
    const trimmed: Project = {
      ...inside,
      timeline: { ...inside.timeline, tracks: inside.timeline.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === "b" ? { ...c, duration: 1, outPoint: 1 } : c)) })) },
    };
    const back = activateSequence(trimmed, MAIN_SEQUENCE_ID);
    if (!back.ok) throw new Error(back.message);
    const definition = back.project.compoundClips?.find((c) => c.id === sequenceId);
    expect(definition?.content.duration).toBe(5);
    expect(definition?.content.tracks[0].clips.find((c) => c.id === "b")?.duration).toBe(1);
    // A second instance elsewhere sees the same definition.
    const twice = insertSequenceAsNest(back.project, sequenceId as string, { startTime: 20 });
    expect(twice.ok).toBe(true);
    expect(countSequenceInstances(twice.ok ? twice.project : back.project, sequenceId as string)).toBe(2);
  });

  it("insertSequenceAsNest places a nest at the drop time on a free track", () => {
    const base = ensureSequences(legacyProject());
    const other = createSequence(base, { name: "Other", activate: false });
    if (!other.ok) throw new Error(other.message);
    const populated = nestClips(other.project, ["a"], "Chunk");
    if (!populated.ok) throw new Error(populated.message);
    const dropped = insertSequenceAsNest(populated.project, populated.sequenceId as string, { trackId: "v1", startTime: 30 });
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    const placed = dropped.project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === dropped.clipId) as Clip;
    expect(placed.startTime).toBe(30);
    expect(placed.duration).toBe(4);
  });

  it("refuses to nest an empty sequence", () => {
    const base = ensureSequences(legacyProject());
    const created = createSequence(base, { name: "Empty", activate: false });
    if (!created.ok) throw new Error(created.message);
    const result = insertSequenceAsNest(created.project, created.sequenceId as string, { startTime: 0 });
    expect(result.ok).toBe(false);
  });
});

describe("cycle detection", () => {
  function chain() {
    // main contains nest of A; A contains nest of B.
    const base = ensureSequences(legacyProject());
    const a = nestClips(base, ["a"], "A");
    if (!a.ok) throw new Error(a.message);
    const opened = activateSequence(a.project, a.sequenceId as string);
    if (!opened.ok) throw new Error(opened.message);
    const b = nestClips(opened.project, ["a"], "B");
    if (!b.ok) throw new Error(b.message);
    return { project: b.project, a: a.sequenceId as string, bId: b.sequenceId as string };
  }

  it("blocks a sequence nesting itself", () => {
    const base = ensureSequences(legacyProject());
    expect(wouldCreateSequenceCycle(base, MAIN_SEQUENCE_ID, MAIN_SEQUENCE_ID)).toBe(true);
    const direct = insertSequenceAsNest(base, MAIN_SEQUENCE_ID, { startTime: 0 });
    expect(direct.ok).toBe(false);
    expect(!direct.ok && direct.message).toMatch(/cannot be nested inside itself/);
  });

  it("blocks indirect cycles and explains which sequences are involved", () => {
    const { project, a, bId } = chain();
    expect(descendantSequenceIds(project, MAIN_SEQUENCE_ID)).toEqual(new Set([a, bId]));
    expect(wouldCreateSequenceCycle(project, bId, MAIN_SEQUENCE_ID)).toBe(true);
    expect(wouldCreateSequenceCycle(project, bId, a)).toBe(true);
    expect(wouldCreateSequenceCycle(project, a, bId)).toBe(false);
    // B is active; dropping main (an ancestor) into it must be refused.
    const refused = insertSequenceAsNest(project, MAIN_SEQUENCE_ID, { startTime: 0 });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.message).toMatch(/already contains/);
    const refusedA = insertSequenceAsNest(project, a, { startTime: 0 });
    expect(refusedA.ok).toBe(false);
  });

  it("allows diamonds (the same sequence nested twice)", () => {
    const { project, bId } = chain();
    const main = activateSequence(project, MAIN_SEQUENCE_ID);
    if (!main.ok) throw new Error(main.message);
    expect(insertSequenceAsNest(main.project, bId, { startTime: 50 }).ok).toBe(true);
  });
});

describe("structural operations", () => {
  it("rename updates the cached name on every nest clip, in every sequence", () => {
    const base = ensureSequences(legacyProject());
    const nested = nestClips(base, ["a"], "Old");
    if (!nested.ok) throw new Error(nested.message);
    const renamed = renameSequence(nested.project, nested.sequenceId as string, "  Fresh  ");
    if (!renamed.ok) throw new Error(renamed.message);
    expect(getSequence(renamed.project, nested.sequenceId as string)?.name).toBe("Fresh");
    expect(renamed.project.timeline.tracks[0].clips.find((c) => c.id === nested.clipId)?.metadata?.compoundClipName).toBe("Fresh");
    expect(renamed.project.compoundClips?.[0].name).toBe("Fresh");
    expect(renameSequence(nested.project, nested.sequenceId as string, " ").ok).toBe(false);
  });

  it("duplicate remaps track, clip and transition ids", () => {
    const base = ensureSequences(legacyProject());
    const copy = duplicateSequence(base, MAIN_SEQUENCE_ID);
    if (!copy.ok) throw new Error(copy.message);
    const original = getSequence(copy.project, MAIN_SEQUENCE_ID);
    const dup = getSequence(copy.project, copy.sequenceId as string);
    expect(dup?.name).toBe("Sequence 1 (Copy)");
    const ids = new Set([...(original?.timeline.tracks ?? []).flatMap((t) => [t.id, ...t.clips.map((c) => c.id)])]);
    for (const t of dup?.timeline.tracks ?? []) {
      expect(ids.has(t.id)).toBe(false);
      for (const c of t.clips) {
        expect(ids.has(c.id)).toBe(false);
        expect(c.trackId).toBe(t.id);
      }
    }
    expect(copy.project.sequences?.map((s) => s.id)).toEqual([MAIN_SEQUENCE_ID, copy.sequenceId]);
  });

  it("delete is blocked while nested and for the last sequence; deleting the active one activates a neighbour", () => {
    const base = ensureSequences(legacyProject());
    expect(deleteSequence(base, MAIN_SEQUENCE_ID).ok).toBe(false);
    const nested = nestClips(base, ["a"], "N");
    if (!nested.ok) throw new Error(nested.message);
    const blocked = deleteSequence(nested.project, nested.sequenceId as string);
    expect(!blocked.ok && blocked.message).toMatch(/nested 1 time/);
    const extra = createSequence(nested.project, { name: "Extra" });
    if (!extra.ok) throw new Error(extra.message);
    const gone = deleteSequence(extra.project, extra.sequenceId as string);
    if (!gone.ok) throw new Error(gone.message);
    expect(gone.project.activeSequenceId).toBe(MAIN_SEQUENCE_ID);
    expect(gone.project.sequences).toHaveLength(2);
    expect(gone.project.openSequenceIds).not.toContain(extra.sequenceId);
  });

  it("tabs: close activates the neighbour, the last tab stays, reorder moves a tab", () => {
    let project = ensureSequences(legacyProject());
    const ids: string[] = [MAIN_SEQUENCE_ID];
    for (const name of ["B", "C"]) {
      const created = createSequence(project, { name });
      if (!created.ok) throw new Error(created.message);
      project = created.project;
      ids.push(created.sequenceId as string);
    }
    expect(project.openSequenceIds).toEqual(ids);
    const reordered = reorderOpenSequences(project, ids[2], 0);
    expect(reordered.ok && reordered.project.openSequenceIds).toEqual([ids[2], ids[0], ids[1]]);
    const closed = closeSequenceTab(project, ids[2]);
    if (!closed.ok) throw new Error(closed.message);
    expect(closed.project.activeSequenceId).toBe(ids[1]);
    expect(closed.project.openSequenceIds).toEqual([ids[0], ids[1]]);
    // Closing a tab never deletes the sequence.
    expect(closed.project.sequences).toHaveLength(3);
    const single = closeSequenceTab(ensureSequences(legacyProject()), MAIN_SEQUENCE_ID);
    expect(single.ok).toBe(false);
  });

  it("projectForSequence lets a non-active sequence be rendered or exported without opening it", () => {
    const base = ensureSequences(legacyProject());
    const nested = nestClips(base, ["a", "b"], "N");
    if (!nested.ok) throw new Error(nested.message);
    const view = projectForSequence(nested.project, nested.sequenceId as string);
    expect(view?.timeline.tracks[0].clips.map((c) => c.id)).toEqual(["a", "b"]);
    expect(view?.timeline.duration).toBe(8);
    expect(nested.project.activeSequenceId).toBe(MAIN_SEQUENCE_ID);
  });
});

describe("history and persistence", () => {
  async function commit(executor: ActionExecutor, target: Project, next: Project) {
    const result = await executor.execute(
      { type: "project/applyEditSnapshot", id: crypto.randomUUID(), timestamp: Date.now(), params: { snapshot: editSnapshot(next) } },
      target,
    );
    expect(result.success).toBe(true);
  }
  const view = (project: Project) => JSON.stringify(editSnapshot(ensureSequences(project)));

  it("undo restores a nest exactly and redo reapplies it", async () => {
    const executor = new ActionExecutor();
    const target = ensureSequences(legacyProject());
    const before = view(target);
    const nested = nestClips(target, ["a", "b"], "N");
    if (!nested.ok) throw new Error(nested.message);
    await commit(executor, target, nested.project);
    const after = view(target);
    expect(after).not.toBe(before);
    expect(target.compoundClips).toHaveLength(1);
    expect((await executor.undo(target)).success).toBe(true);
    expect(view(target)).toBe(before);
    expect(target.compoundClips ?? []).toHaveLength(0);
    expect((await executor.redo(target)).success).toBe(true);
    expect(view(target)).toBe(after);
    expect(target.compoundClips).toHaveLength(1);
  });

  it("undo/redo across a sequence switch restores the exact sequence and its timeline", async () => {
    const executor = new ActionExecutor();
    const target = ensureSequences(legacyProject());
    const nested = nestClips(target, ["a", "b"], "N");
    if (!nested.ok) throw new Error(nested.message);
    await commit(executor, target, nested.project); // step 1: nest
    const nestId = nested.sequenceId as string;
    const opened = activateSequence(target, nestId);
    if (!opened.ok) throw new Error(opened.message);
    const afterOpen = view(opened.project);
    await commit(executor, target, opened.project); // step 2: open the nest tab
    expect(target.activeSequenceId).toBe(nestId);
    // step 3: trim inside through a real action on the live timeline
    const trim = await executor.execute({ type: "clip/trim", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: "b", outPoint: 1 } }, target);
    expect(trim.success).toBe(true);
    const inside = target.timeline.tracks[0].clips.find((c) => c.id === "b") as Clip;
    expect(inside.duration).toBe(1);
    // Switch back to the parent, then undo: the trim, and the open, are reverted in order.
    const parent = activateSequence(target, MAIN_SEQUENCE_ID);
    if (!parent.ok) throw new Error(parent.message);
    await commit(executor, target, parent.project); // step 4
    expect(target.activeSequenceId).toBe(MAIN_SEQUENCE_ID);
    expect(target.compoundClips?.find((c) => c.id === nestId)?.content.duration).toBe(5);
    await executor.undo(target); // back inside the nest
    expect(target.activeSequenceId).toBe(nestId);
    expect(target.timeline.tracks[0].clips.find((c) => c.id === "b")?.duration).toBe(1);
    await executor.undo(target); // undo the trim, as the live timeline it belongs to
    expect(target.timeline.tracks[0].clips.find((c) => c.id === "b")?.duration).toBe(4);
    expect(view(target)).toBe(afterOpen);
    await executor.redo(target);
    expect(target.timeline.tracks[0].clips.find((c) => c.id === "b")?.duration).toBe(1);
    await executor.redo(target);
    expect(target.activeSequenceId).toBe(MAIN_SEQUENCE_ID);
    expect(target.compoundClips?.find((c) => c.id === nestId)?.content.duration).toBe(5);
  });

  it("serializes every sequence (parked and live), flags the multi-sequence capability and round-trips", () => {
    const serializer = new ProjectSerializer({} as never);
    const nested = nestClips(ensureSequences(legacyProject()), ["a", "b"], "N");
    if (!nested.ok) throw new Error(nested.message);
    const opened = activateSequence(nested.project, nested.sequenceId as string);
    if (!opened.ok) throw new Error(opened.message);
    // Live edit on the open nest that has not been flushed to the stored copy.
    const edited: Project = { ...opened.project, timeline: { ...opened.project.timeline, tracks: opened.project.timeline.tracks.map((t) => ({ ...t, clips: t.clips.slice(0, 1) })) } };
    const file = JSON.parse(serializer.exportToJson(edited)) as { minimumReaderVersion?: string; capabilities?: string[]; project: Project };
    expect(file.capabilities).toContain(MULTI_SEQUENCE_CAPABILITY);
    expect(file.minimumReaderVersion).toBe("1.4.0");
    expect(file.project.sequences).toHaveLength(2);
    const stored = file.project.sequences?.find((s) => s.id === nested.sequenceId);
    expect(stored?.timeline.tracks[0].clips).toHaveLength(1);
    const restored = serializer.importFromJson(JSON.stringify(file));
    expect(restored.activeSequenceId).toBe(nested.sequenceId);
    expect(restored.timeline.tracks[0].clips).toHaveLength(1);
    expect(restored.compoundClips?.map((c) => c.id)).toEqual([MAIN_SEQUENCE_ID]);
  });

  it("a nest gets its own track ids (so parent overlays never leak in) and remembers where its tracks came from", () => {
    const base = ensureSequences(legacyProject());
    const nested = nestClips(base, ["a"], "N");
    if (!nested.ok) throw new Error(nested.message);
    const inner = nested.project.sequences!.find((s) => s.id === nested.sequenceId)!;
    expect(inner.timeline.tracks.map((t) => t.id)).not.toContain("v1");
    expect(inner.timeline.tracks[0].clips[0].trackId).toBe(inner.timeline.tracks[0].id);
    expect(Object.values(inner.sourceTrackIds ?? {})).toEqual(["v1"]);
    const copy = duplicateSequence(nested.project, nested.sequenceId as string);
    if (!copy.ok) throw new Error(copy.message);
    const dup = copy.project.sequences!.find((s) => s.id === copy.sequenceId)!;
    expect(Object.keys(dup.sourceTrackIds ?? {})).toEqual([dup.timeline.tracks[0].id]);
  });

  it("an open nested sequence's duration ignores the parent's nest instance and overlays", async () => {
    const executor = new ActionExecutor();
    const target = ensureSequences(legacyProject());
    const lateParent: Project = { ...target, timeline: { ...target.timeline, tracks: target.timeline.tracks.map((t) => t.id === "v1" ? { ...t, clips: [clip("a", "v1", 10, 4)] } : t) } };
    const nested = nestClips(lateParent, ["a"], "Late");
    if (!nested.ok) throw new Error(nested.message);
    await commit(executor, target, nested.project);
    const opened = activateSequence(target, nested.sequenceId as string);
    if (!opened.ok) throw new Error(opened.message);
    await commit(executor, target, opened.project);
    // An overlay on the parent's track must not stretch the open sequence either.
    (target as { textClips?: unknown }).textClips = [{ id: "t1", trackId: "v1", startTime: 50, duration: 5 }];
    const trim = await executor.execute({ type: "clip/trim", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: "a", outPoint: 3 } }, target);
    expect(trim.success).toBe(true);
    expect(target.timeline.duration).toBe(3);
  });

  it("a single-sequence project stays readable by older readers", () => {
    const serializer = new ProjectSerializer({} as never);
    const file = JSON.parse(serializer.exportToJson(ensureSequences(legacyProject()))) as { minimumReaderVersion?: string; capabilities?: string[] };
    expect(file.capabilities).toBeUndefined();
    expect(file.minimumReaderVersion).toBeUndefined();
  });
});
