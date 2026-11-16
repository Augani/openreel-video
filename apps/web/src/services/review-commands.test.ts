import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { ActionExecutor } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import {
  addReviewComment,
  buildReviewExport,
  deleteComment,
  editCommentText,
  goToNextComment,
  goToPreviousComment,
  importReviewCsvText,
  replyToComment,
  resolveAllComments,
  setCommentStatus,
  setReviewAuthor,
} from "./review-commands";

const state = () => useProjectStore.getState();
const markers = () => state().project.timeline.markers;
const undoSize = () => state().actionExecutor.getHistory().getUndoStackSize();

beforeEach(() => {
  const base = createEmptyProject("Review cut");
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project: { ...base, settings: { ...base.settings, frameRate: 30 } },
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
    hasOpenProject: true,
    clipUndoStack: [],
    clipRedoStack: [],
    templateUndoStack: [],
    templateRedoStack: [],
    redoJournal: [],
  });
  useTimelineStore.setState({ playheadPosition: 0 });
  setReviewAuthor("Ana");
});

describe("review comment commands", () => {
  it("adds a comment at the playhead with author, open status and a creation time", async () => {
    useTimelineStore.setState({ playheadPosition: 4.5 });
    const id = await addReviewComment("  Cut is too early  ");
    expect(id).toBeTruthy();
    expect(markers()).toHaveLength(1);
    expect(markers()[0]).toMatchObject({ time: 4.5, comment: "Cut is too early", author: "Ana", status: "open", kind: "comment" });
    expect(typeof markers()[0].createdAt).toBe("number");
    expect(await addReviewComment("   ")).toBeNull();
  });

  it("replies, resolves, reopens, edits and deletes; each is one undo step", async () => {
    const id = (await addReviewComment("Fix the logo", { time: 2 }))!;
    const base = undoSize();

    expect(await replyToComment(id, "On it", "Ben")).toBe(true);
    expect(markers()[0].replies?.map((r) => [r.author, r.text])).toEqual([["Ben", "On it"]]);
    expect(await setCommentStatus(id, "resolved")).toBe(true);
    expect(markers()[0].status).toBe("resolved");
    expect(await setCommentStatus(id, "open")).toBe(true);
    expect(await editCommentText(id, "Fix the logo size")).toBe(true);
    expect(markers()[0].comment).toBe("Fix the logo size");
    expect(undoSize()).toBe(base + 4);

    await state().undo();
    expect(markers()[0].comment).toBe("Fix the logo");
    await state().undo();
    await state().undo();
    expect(markers()[0].status).toBe("open");
    await state().undo();
    expect(markers()[0].replies).toBeUndefined();

    expect(await deleteComment(id)).toBe(true);
    expect(markers()).toHaveLength(0);
    await state().undo();
    expect(markers()).toHaveLength(1);
  });

  it("resolves every open comment as a single undo step", async () => {
    await addReviewComment("one", { time: 1 });
    await addReviewComment("two", { time: 2 });
    const done = (await addReviewComment("three", { time: 3 }))!;
    await setCommentStatus(done, "resolved");
    expect(await resolveAllComments()).toBe(2);
    expect(markers().every((m) => m.status === "resolved")).toBe(true);
    await state().undo();
    expect(markers().filter((m) => m.status === "open")).toHaveLength(2);
  });

  it("navigates between comments, optionally open ones only", async () => {
    await addReviewComment("a", { time: 1 });
    const b = (await addReviewComment("b", { time: 2 }))!;
    await addReviewComment("c", { time: 3 });
    await setCommentStatus(b, "resolved");
    useTimelineStore.setState({ playheadPosition: 1 });
    expect(goToNextComment(true)).toBe(true);
    expect(useTimelineStore.getState().playheadPosition).toBe(3);
    expect(goToPreviousComment(false)).toBe(true);
    expect(useTimelineStore.getState().playheadPosition).toBe(2);
    expect(goToNextComment(false)).toBe(true);
    expect(goToNextComment(false)).toBe(false);
  });
});

describe("import and export", () => {
  it("imports a Frame.io-style CSV as one undo step with threads and statuses", async () => {
    const csv = [
      "Timecode,Author,Comment,Status",
      "00:00:05:15,Jo,Tighten this,open",
      "00:00:10:00,Kim,\"Color, pop\",resolved",
      "bad,Lee,Skipped,open",
    ].join("\n");
    const result = await importReviewCsvText(csv);
    expect(result).toEqual({ added: 2, skipped: 1 });
    expect(markers().map((m) => [m.time, m.author, m.comment, m.status])).toEqual([
      [5.5, "Jo", "Tighten this", "open"],
      [10, "Kim", "Color, pop", "resolved"],
    ]);
    await state().undo();
    expect(markers()).toHaveLength(0);
  });

  it("exports a CSV that the importer reads back", async () => {
    const id = (await addReviewComment("Needs music", { time: 8 }))!;
    await replyToComment(id, "Added", "Ben");
    const file = buildReviewExport("csv");
    expect(file.filename).toBe("Review_cut_comments.csv");
    expect(file.content.split("\n")[0]).toBe("Timecode,Author,Comment,Status,Created,Replies");

    useProjectStore.setState({ project: { ...state().project, timeline: { ...state().project.timeline, markers: [] } } });
    await importReviewCsvText(file.content);
    expect(markers()[0]).toMatchObject({ time: 8, author: "Ana", comment: "Needs music" });
    expect(markers()[0].replies?.[0]).toMatchObject({ author: "Ben", text: "Added" });
  });

  it("exports marker-compatible Premiere CSV and EDL locators with the author in the name", async () => {
    await addReviewComment("Needs music", { time: 8 });
    await state().addMarker(1, "Plain marker", "#fff");
    const premiere = buildReviewExport("premiere");
    expect(premiere.content).toContain("Ana: Needs music");
    expect(premiere.content).not.toContain("Plain marker");
    const edl = buildReviewExport("edl");
    expect(edl.content).toContain("* LOC: 01:00:08:00");
    expect(edl.content).toContain("Ana: Needs music");
    expect(edl.content).not.toContain("Plain marker");
  });
});
