import { v4 as uuidv4 } from "uuid";
import {
  appendReply,
  commentTitle,
  markerFrameRate,
  markersCsv,
  markersEdlLocs,
  nextReviewComment,
  parseReviewCsv,
  prevReviewComment,
  reviewComments,
  reviewCommentsCsv,
  type Marker,
  type ReviewImportResult,
  type ReviewStatus,
} from "@openreel/core";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { toast } from "../stores/notification-store";
import { download, seekToMarker, type MarkerExportFile } from "./marker-commands";

/**
 * Review comments are timeline markers with an author and a status (see
 * @openreel/core review/review-comments). Every command goes through the marker
 * actions, so each one is a single undo step and is saved with the project.
 */

/** Open comments are amber, resolved ones green: visible on the ruler at a glance. */
export const OPEN_COMMENT_COLOR = "#f59e0b";
export const RESOLVED_COMMENT_COLOR = "#22c55e";

const AUTHOR_KEY = "openreel.review.author";
const DEFAULT_AUTHOR = "Me";

export function getReviewAuthor(): string {
  try {
    return window.localStorage.getItem(AUTHOR_KEY)?.trim() || DEFAULT_AUTHOR;
  } catch {
    return DEFAULT_AUTHOR;
  }
}

export function setReviewAuthor(name: string): void {
  try {
    window.localStorage.setItem(AUTHOR_KEY, name.trim() || DEFAULT_AUTHOR);
  } catch {
    // Private windows can refuse storage; the name then lasts for this session only.
  }
}

const markers = (): readonly Marker[] => useProjectStore.getState().project.timeline.markers;
const playhead = (): number => useTimelineStore.getState().playheadPosition;

/** Open the Comments panel. */
export function showCommentsPanel(): void {
  useEditorWorkspaceStore.getState().setSection("comments");
  useUIStore.getState().setPanelVisible("agentChat", false);
}

export async function addReviewComment(text: string, options: { time?: number; author?: string } = {}): Promise<string | null> {
  const body = text.trim();
  if (!body) return null;
  const time = Math.max(0, options.time ?? playhead());
  const before = new Set(markers().map((m) => m.id));
  const result = await useProjectStore.getState().addMarker(time, commentTitle(body), OPEN_COMMENT_COLOR, {
    comment: body,
    kind: "comment",
    author: options.author?.trim() || getReviewAuthor(),
    status: "open",
    createdAt: Date.now(),
  });
  if (!result.success) {
    toast.warning("Could not add the comment", result.error?.message);
    return null;
  }
  return markers().find((m) => !before.has(m.id))?.id ?? null;
}

export async function replyToComment(markerId: string, text: string, author?: string): Promise<boolean> {
  const body = text.trim();
  const marker = markers().find((m) => m.id === markerId);
  if (!marker || !body) return false;
  const replies = appendReply(marker, { author: author?.trim() || getReviewAuthor(), text: body }, uuidv4);
  const result = await useProjectStore.getState().updateMarker(markerId, { replies });
  return result.success;
}

export async function setCommentStatus(markerId: string, status: ReviewStatus): Promise<boolean> {
  const marker = markers().find((m) => m.id === markerId);
  if (!marker) return false;
  const result = await useProjectStore.getState().updateMarker(markerId, {
    status,
    color: status === "resolved" ? RESOLVED_COMMENT_COLOR : OPEN_COMMENT_COLOR,
  });
  return result.success;
}

export async function editCommentText(markerId: string, text: string): Promise<boolean> {
  const body = text.trim();
  if (!body || !markers().some((m) => m.id === markerId)) return false;
  const result = await useProjectStore.getState().updateMarker(markerId, { comment: body, label: commentTitle(body) });
  return result.success;
}

export async function deleteComment(markerId: string): Promise<boolean> {
  const result = await useProjectStore.getState().removeMarker(markerId);
  return result.success;
}

/** Resolve every open comment as one undo step. */
export async function resolveAllComments(): Promise<number> {
  const open = reviewComments(markers()).filter((m) => m.status !== "resolved");
  if (open.length === 0) return 0;
  const store = useProjectStore.getState();
  store.beginHistoryGroup("Resolve all comments");
  try {
    for (const marker of open) await setCommentStatus(marker.id, "resolved");
  } finally {
    useProjectStore.getState().endHistoryGroup();
  }
  return open.length;
}

export function goToNextComment(openOnly = false): boolean {
  const next = nextReviewComment(markers(), playhead(), openOnly);
  if (!next) return false;
  seekToMarker(next);
  useEditorWorkspaceStore.getState().setSelectedMarkerId(next.id);
  return true;
}

export function goToPreviousComment(openOnly = false): boolean {
  const prev = prevReviewComment(markers(), playhead(), openOnly);
  if (!prev) return false;
  seekToMarker(prev);
  useEditorWorkspaceStore.getState().setSelectedMarkerId(prev.id);
  return true;
}

// ---------------------------------------------------------------------------
// Export / import

export type ReviewExportKind = "csv" | "premiere" | "edl";

const safeName = (name: string): string => name.replace(/[^\w.-]+/g, "_") || "project";

/** Build one comment export. `csv` is the Frame.io-style file; `premiere` and `edl` are marker-compatible. */
export function buildReviewExport(kind: ReviewExportKind): MarkerExportFile {
  const { project } = useProjectStore.getState();
  const list = reviewComments(project.timeline.markers);
  const base = safeName(project.name);
  const fps = project.settings.frameRate || 30;
  if (kind === "csv") {
    return { filename: `${base}_comments.csv`, mimeType: "text/csv", content: reviewCommentsCsv(list, fps), warnings: [] };
  }
  if (kind === "premiere") {
    // Premiere's marker CSV has no author column: put it in front of the text so nothing is lost.
    const labelled = list.map((m) => ({
      ...m,
      label: m.author ? `${m.author}: ${m.comment?.trim() || m.label}` : m.label,
      comment: [m.status === "resolved" ? "[Resolved]" : "", ...(m.replies ?? []).map((r) => `${r.author}: ${r.text}`)].filter(Boolean).join(" | "),
    }));
    return { filename: `${base}_comments_markers.csv`, mimeType: "text/csv", content: markersCsv(labelled, fps), warnings: [] };
  }
  const fcm = markerFrameRate(fps).dropFrame ? "DROP FRAME" : "NON-DROP FRAME";
  const locs = markersEdlLocs(
    list.map((m) => ({ ...m, label: m.author ? `${m.author}: ${m.comment?.trim() || m.label}` : m.label })),
    fps,
  );
  return {
    filename: `${base}_comments.edl`,
    mimeType: "text/plain",
    content: [`TITLE: ${project.name || "SEQUENCE"}`, `FCM: ${fcm}`, "", ...locs, ""].join("\n"),
    warnings: [],
  };
}

export function exportReviewComments(kind: ReviewExportKind): MarkerExportFile | null {
  if (reviewComments(markers()).length === 0) {
    toast.info("No comments to export", "Add a comment at the playhead first.");
    return null;
  }
  const file = buildReviewExport(kind);
  download(file);
  toast.success("Comments exported", file.filename);
  return file;
}

/** Add parsed comments as ONE undo step. */
export async function addImportedComments(parsed: ReviewImportResult): Promise<number> {
  if (parsed.comments.length === 0) return 0;
  const store = useProjectStore.getState();
  store.beginHistoryGroup("Import comments");
  let added = 0;
  try {
    for (const comment of parsed.comments) {
      const now = Date.now();
      const result = await useProjectStore.getState().addMarker(comment.time, commentTitle(comment.text), comment.status === "resolved" ? RESOLVED_COMMENT_COLOR : OPEN_COMMENT_COLOR, {
        comment: comment.text,
        kind: "comment",
        author: comment.author,
        status: comment.status,
        createdAt: comment.createdAt ?? now,
        replies: comment.replies.map((reply) => ({
          id: uuidv4(),
          author: reply.author || comment.author,
          text: reply.text,
          createdAt: now,
        })),
      });
      if (result.success) added++;
    }
  } finally {
    useProjectStore.getState().endHistoryGroup();
  }
  return added;
}

/** Import a Frame.io-style CSV (Timecode, Author, Comment). Returns how many comments were added. */
export async function importReviewCsvText(text: string): Promise<{ added: number; skipped: number }> {
  const fps = useProjectStore.getState().project.settings.frameRate || 30;
  const parsed = parseReviewCsv(text, fps);
  const added = await addImportedComments(parsed);
  if (added === 0) {
    toast.warning("No comments imported", parsed.skipped[0]?.reason ?? "The file has no comment rows.");
  } else if (parsed.skipped.length > 0) {
    toast.warning(`Imported ${added} comments`, `${parsed.skipped.length} rows were skipped (row ${parsed.skipped[0].row}: ${parsed.skipped[0].reason}).`);
  } else {
    toast.success(`Imported ${added} comment${added === 1 ? "" : "s"}`);
  }
  return { added, skipped: parsed.skipped.length };
}
