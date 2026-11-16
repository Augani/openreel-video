import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import type { Marker } from "../types/timeline";
import {
  REVIEW_CSV_COLUMNS,
  appendReply,
  isReviewComment,
  nextReviewComment,
  parseDelimited,
  parseReviewCsv,
  parseReviewTime,
  prevReviewComment,
  reviewCommentsCsv,
  reviewSummary,
} from "./review-comments";

const mk = (time: number, extra: Partial<Marker> = {}): Marker => ({
  id: `m${time}`,
  time,
  label: `M${time}`,
  color: "#3b82f6",
  ...extra,
});

const makeProject = (): Project =>
  ({
    id: "p1",
    name: "Review",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 60, tracks: [], subtitles: [], markers: [] },
    mediaLibrary: { items: [] },
  }) as unknown as Project;

let n = 0;
const act = (type: string, params: Record<string, unknown>): Action =>
  ({ id: `a${++n}`, type, timestamp: Date.now() + n * 1000, params }) as unknown as Action;

describe("review comment model", () => {
  it("only markers with an author or status are review comments", () => {
    expect(isReviewComment(mk(1))).toBe(false);
    expect(isReviewComment(mk(1, { author: "Ana" }))).toBe(true);
    expect(isReviewComment(mk(1, { status: "resolved" }))).toBe(true);
  });

  it("summarises open, resolved and replies", () => {
    const list = [
      mk(1),
      mk(2, { author: "A", replies: [{ id: "r", author: "B", text: "ok", createdAt: 1 }] }),
      mk(3, { author: "A", status: "resolved" }),
    ];
    expect(reviewSummary(list)).toEqual({ total: 2, open: 1, resolved: 1, replies: 1 });
  });

  it("navigates between comments, optionally skipping resolved ones", () => {
    const list = [mk(1, { author: "A" }), mk(2, { author: "A", status: "resolved" }), mk(3, { author: "A" }), mk(2.5)];
    expect(nextReviewComment(list, 1)?.time).toBe(2);
    expect(nextReviewComment(list, 1, true)?.time).toBe(3);
    expect(prevReviewComment(list, 3)?.time).toBe(2);
    expect(prevReviewComment(list, 3, true)?.time).toBe(1);
    expect(nextReviewComment(list, 3)).toBeNull();
  });

  it("appendReply returns a new thread and leaves the marker alone", () => {
    const marker = mk(1, { author: "A" });
    const replies = appendReply(marker, { author: "B", text: "done" }, () => "r1", 99);
    expect(replies).toEqual([{ id: "r1", author: "B", text: "done", createdAt: 99 }]);
    expect(marker.replies).toBeUndefined();
  });
});

describe("review comment actions", () => {
  it("adds, replies to, resolves and undoes through the action executor", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(
      act("marker/add", { time: 4, label: "Fix cut", color: "#ef4444", comment: "Cut too early", author: "Ana", status: "open", createdAt: 5 }),
      project,
    );
    const added = structuredClone(project.timeline.markers[0]);
    expect(added).toMatchObject({ author: "Ana", status: "open", createdAt: 5 });

    const replies = appendReply(added, { author: "Ben", text: "Fixed" }, () => "r1", 7);
    expect((await executor.execute(act("marker/update", { markerId: added.id, updates: { replies } }), project)).success).toBe(true);
    expect(project.timeline.markers[0].replies).toHaveLength(1);
    expect((await executor.execute(act("marker/update", { markerId: added.id, updates: { status: "resolved" } }), project)).success).toBe(true);
    expect(project.timeline.markers[0].status).toBe("resolved");

    await executor.undo(project);
    expect(project.timeline.markers[0].status).toBe("open");
    await executor.undo(project);
    expect(project.timeline.markers[0]).toEqual(added);
    expect("replies" in project.timeline.markers[0]).toBe(false);
  });

  it("rejects an invalid status or malformed replies", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const bad = await executor.execute(act("marker/add", { time: 1, label: "x", color: "#fff", status: "nope" }), project);
    expect(bad.success).toBe(false);
    await executor.execute(act("marker/add", { time: 1, label: "x", color: "#fff", author: "A" }), project);
    const id = project.timeline.markers[0].id;
    const badReplies = await executor.execute(act("marker/update", { markerId: id, updates: { replies: [{ nope: 1 }] } }), project);
    expect(badReplies.success).toBe(false);
  });
});

describe("review CSV", () => {
  const list = [
    mk(2, { author: "Ana", comment: 'Say "hello",\nthen cut', status: "resolved", createdAt: Date.UTC(2026, 0, 2) }),
    mk(1, { author: "Ben", label: "Logo", replies: [{ id: "r", author: "Ana", text: "Will do", createdAt: 1 }] }),
    mk(9),
  ];

  it("exports review comments only, ordered by time, with the thread flattened", () => {
    const csv = reviewCommentsCsv(list, 30);
    const rows = parseDelimited(csv, ",");
    expect(rows[0]).toEqual([...REVIEW_CSV_COLUMNS]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(["00:00:01:00", "Ben", "Logo", "open", "", "Ana: Will do"]);
    expect(rows[2].slice(0, 4)).toEqual(["00:00:02:00", "Ana", 'Say "hello",\nthen cut', "resolved"]);
    expect(rows[2][4]).toBe("2026-01-02T00:00:00.000Z");
  });

  it("includes plain markers on request", () => {
    expect(parseDelimited(reviewCommentsCsv(list, 30, { includeMarkers: true }), ",")).toHaveLength(4);
  });

  it("round-trips through the importer", () => {
    const { comments, skipped } = parseReviewCsv(reviewCommentsCsv(list, 30), 30);
    expect(skipped).toEqual([]);
    expect(comments.map((c) => [c.time, c.author, c.status])).toEqual([
      [1, "Ben", "open"],
      [2, "Ana", "resolved"],
    ]);
    expect(comments[0].replies).toEqual([{ author: "Ana", text: "Will do" }]);
    expect(comments[1].text).toBe('Say "hello",\nthen cut');
    expect(comments[1].createdAt).toBe(Date.UTC(2026, 0, 2));
  });
});

describe("Frame.io-style CSV import", () => {
  it("reads Timecode, Author, Comment with a header", () => {
    const text = "Timecode,Author,Comment\n00:00:05:15,Jo,Tighten this\n00:01:00:00,Kim,Color pop";
    const { comments, skipped } = parseReviewCsv(text, 30);
    expect(skipped).toEqual([]);
    expect(comments.map((c) => [c.time, c.author, c.text])).toEqual([
      [5.5, "Jo", "Tighten this"],
      [60, "Kim", "Color pop"],
    ]);
  });

  it("matches headers by alias and any order, and reads tab or semicolon files", () => {
    const tab = "Comment\tTime Code\tName\tCompleted\nFix\t00:00:01:00\tJo\ttrue";
    const r = parseReviewCsv(tab, 25);
    expect(r.comments).toEqual([{ time: 1, author: "Jo", text: "Fix", status: "resolved", replies: [] }]);
    expect(parseReviewCsv("Timecode;Author;Comment\n00:00:02:00;Jo;Hi", 30).comments[0].time).toBe(2);
  });

  it("without a header the columns are timecode, author, comment", () => {
    const { comments } = parseReviewCsv("00:00:03:00,Jo,Hello", 30);
    expect(comments).toEqual([{ time: 3, author: "Jo", text: "Hello", status: "open", replies: [] }]);
  });

  it("skips unreadable rows and reports them", () => {
    const text = "Timecode,Author,Comment\nnot-a-time,Jo,Hi\n00:00:01:00,Jo,\n00:00:02:00,,Ok";
    const { comments, skipped } = parseReviewCsv(text, 30);
    expect(comments).toHaveLength(1);
    expect(comments[0].author).toBe("Reviewer");
    expect(skipped.map((s) => s.row)).toEqual([2, 3]);
  });

  it("strips a BOM and handles CRLF", () => {
    const { comments } = parseReviewCsv("﻿Timecode,Author,Comment\r\n00:00:01:00,Jo,Hi\r\n", 30);
    expect(comments).toHaveLength(1);
  });

  it("parses assorted time formats", () => {
    expect(parseReviewTime("12.5", 30)).toBe(12.5);
    expect(parseReviewTime("1:30", 30)).toBe(90);
    expect(parseReviewTime("1:02:03", 30)).toBe(3723);
    expect(parseReviewTime("00:00:01.500", 30)).toBeCloseTo(1.5, 3);
    expect(parseReviewTime("garbage", 30)).toBeNull();
  });
});
