import { useMemo, useRef, useState } from "react";
import { reviewComments, reviewSummary, type Marker } from "@openreel/core";
import { Button, Input } from "@openreel/ui";
import { Check, ChevronLeft, ChevronRight, Download, MessageCircle, Trash2, Upload } from "@/icons/lucide-compat";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { formatFrameTimecode } from "../../utils/frame-timecode";
import { seekToMarker } from "../../services/marker-commands";
import {
  addReviewComment,
  deleteComment,
  editCommentText,
  exportReviewComments,
  getReviewAuthor,
  goToNextComment,
  goToPreviousComment,
  importReviewCsvText,
  replyToComment,
  resolveAllComments,
  setCommentStatus,
  setReviewAuthor,
  type ReviewExportKind,
} from "../../services/review-commands";

type Filter = "all" | "open" | "resolved";

const formatWhen = (ms: number | undefined): string => {
  if (ms === undefined) return "";
  try {
    return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

const stop = (event: React.KeyboardEvent) => event.stopPropagation();

function CommentCard({ marker, fps, selected }: { marker: Marker; fps: number; selected: boolean }) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const setSelectedId = useEditorWorkspaceStore((s) => s.setSelectedMarkerId);
  const resolved = marker.status === "resolved";
  const text = marker.comment?.trim() || marker.label;

  const sendReply = async () => {
    if (await replyToComment(marker.id, reply)) {
      setReply("");
      setReplying(false);
    }
  };
  const saveEdit = async () => {
    if (await editCommentText(marker.id, draft)) setEditing(false);
  };

  return (
    <li
      data-testid="comment-row"
      data-marker-id={marker.id}
      data-status={resolved ? "resolved" : "open"}
      aria-current={selected || undefined}
      className={`border-b border-border/60 px-3 py-2.5 ${selected ? "bg-bg-2" : ""} ${resolved ? "opacity-70" : ""}`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded bg-bg-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="comment-timecode"
          aria-label={`Go to ${formatFrameTimecode(marker.time, fps)}`}
          onClick={() => {
            setSelectedId(marker.id);
            seekToMarker(marker);
          }}
        >
          {formatFrameTimecode(marker.time, fps)}
        </button>
        <span className="truncate text-[12px] font-medium" data-testid="comment-author">
          {marker.author ?? "Unknown"}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-fg-muted">{formatWhen(marker.createdAt)}</span>
      </div>

      {editing ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <Input
            aria-label="Edit comment"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              stop(event);
              if (event.key === "Enter") void saveEdit();
              if (event.key === "Escape") setEditing(false);
            }}
            className="h-7 text-[12px]"
          />
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => void saveEdit()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-fg" data-testid="comment-text">
          {text}
        </p>
      )}

      {(marker.replies?.length ?? 0) > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-border pl-2" aria-label="Replies">
          {marker.replies!.map((r) => (
            <li key={r.id} data-testid="comment-reply" className="text-[12px]">
              <span className="font-medium">{r.author}</span>
              <span className="ml-1.5 text-[11px] text-fg-muted">{formatWhen(r.createdAt)}</span>
              <p className="whitespace-pre-wrap break-words text-fg-2">{r.text}</p>
            </li>
          ))}
        </ul>
      )}

      {replying && (
        <div className="mt-2 flex gap-1.5">
          <Input
            aria-label="Reply"
            placeholder="Write a reply"
            data-testid="comment-reply-input"
            value={reply}
            autoFocus
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={(event) => {
              stop(event);
              if (event.key === "Enter") void sendReply();
              if (event.key === "Escape") setReplying(false);
            }}
            className="h-7 flex-1 text-[12px]"
          />
          <Button size="sm" className="h-7 px-2 text-[11px]" data-testid="comment-reply-send" disabled={!reply.trim()} onClick={() => void sendReply()}>
            Reply
          </Button>
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px]"
          data-testid="comment-resolve"
          aria-pressed={resolved}
          onClick={() => void setCommentStatus(marker.id, resolved ? "open" : "resolved")}
        >
          <Check size={11} aria-hidden />
          {resolved ? "Reopen" : "Resolve"}
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" data-testid="comment-reply-toggle" onClick={() => setReplying((open) => !open)}>
          Reply
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px]"
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto h-6 w-6"
          aria-label={`Delete comment at ${formatFrameTimecode(marker.time, fps)}`}
          onClick={() => void deleteComment(marker.id)}
        >
          <Trash2 size={12} aria-hidden />
        </Button>
      </div>
    </li>
  );
}

/** Review comments: timecoded, with author, status and replies. Mirrors the markers drawn on the ruler. */
export function CommentsPanel() {
  const markers = useProjectStore((s) => s.project.timeline.markers);
  const fps = useProjectStore((s) => s.project.settings.frameRate) || 30;
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const selectedId = useEditorWorkspaceStore((s) => s.selectedMarkerId);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState(getReviewAuthor);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => reviewSummary(markers), [markers]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reviewComments(markers).filter((m) => {
      if (filter !== "all" && (m.status === "resolved" ? "resolved" : "open") !== filter) return false;
      if (!needle) return true;
      const thread = (m.replies ?? []).map((r) => `${r.author} ${r.text}`).join(" ");
      return `${m.author ?? ""} ${m.comment ?? ""} ${m.label} ${thread}`.toLowerCase().includes(needle);
    });
  }, [markers, filter, query]);

  const submit = async () => {
    if (!text.trim()) return;
    setReviewAuthor(author);
    const id = await addReviewComment(text, { author });
    if (id) {
      setText("");
      useEditorWorkspaceStore.getState().setSelectedMarkerId(id);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    await importReviewCsvText(await file.text());
  };

  const exportButton = (kind: ReviewExportKind, label: string, title: string) => (
    <Button
      key={kind}
      variant="secondary"
      size="sm"
      className="h-7 gap-1 px-2 text-[12px]"
      title={title}
      disabled={summary.total === 0}
      data-testid={`comments-export-${kind}`}
      onClick={() => exportReviewComments(kind)}
    >
      <Download size={12} aria-hidden />
      {label}
    </Button>
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col text-fg" aria-label="Comments" data-testid="comments-panel">
      <header className="flex flex-col gap-2 border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <MessageCircle size={14} aria-hidden />
            Comments
            <span className="rounded-full bg-bg-2 px-1.5 text-[11px] font-normal text-fg-muted" data-testid="comments-count">
              {summary.open} open / {summary.resolved} resolved
            </span>
          </h2>
          <div className="flex gap-0.5">
            <Button variant="ghost" size="icon-sm" className="h-7 w-7" aria-label="Previous open comment" onClick={() => goToPreviousComment(true)}>
              <ChevronLeft size={14} aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-sm" className="h-7 w-7" aria-label="Next open comment" data-testid="comments-next" onClick={() => goToNextComment(true)}>
              <ChevronRight size={14} aria-hidden />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <Input
              aria-label="Your name"
              placeholder="Your name"
              data-testid="comment-author-input"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              onBlur={() => setReviewAuthor(author)}
              onKeyDown={stop}
              className="h-7 w-28 text-[12px]"
            />
            <span className="self-center font-mono text-[11px] text-fg-muted" data-testid="comment-at">
              at {formatFrameTimecode(playhead, fps)}
            </span>
          </div>
          <div className="flex gap-1.5">
            <Input
              aria-label="Add a comment at the playhead"
              placeholder="Add a comment at the playhead"
              data-testid="comment-text-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                stop(event);
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
              className="h-7 flex-1 text-[12px]"
            />
            <Button size="sm" className="h-7 px-2.5 text-[12px]" data-testid="comment-add" disabled={!text.trim()} onClick={() => void submit()}>
              Comment
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Input
            aria-label="Search comments"
            placeholder="Search comments"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={stop}
            className="h-7 flex-1 text-[12px]"
          />
          <select
            aria-label="Filter by status"
            data-testid="comments-filter"
            className="h-7 rounded-md border border-border bg-bg-2 px-1.5 text-[12px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={filter}
            onChange={(event) => setFilter(event.target.value as Filter)}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {summary.total === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-fg-muted" data-testid="comments-empty">
            No comments yet. Type one above to pin it to the playhead, or import a Frame.io-style CSV.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-fg-muted">No comments match.</p>
        ) : (
          <ul aria-label="Comment list">
            {rows.map((marker) => (
              <CommentCard key={marker.id} marker={marker} fps={fps} selected={selectedId === marker.id} />
            ))}
          </ul>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 gap-1 px-2 text-[12px]"
          data-testid="comments-import"
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={12} aria-hidden />
          Import CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="sr-only"
          aria-label="Import comments CSV"
          data-testid="comments-import-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void onFile(file);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[12px]"
          disabled={summary.open === 0}
          data-testid="comments-resolve-all"
          onClick={() => void resolveAllComments()}
        >
          Resolve all
        </Button>
        <span className="ml-auto text-[11px] text-fg-muted">Export</span>
        {exportButton("csv", "CSV", "Frame.io-style: Timecode, Author, Comment, Status, Replies")}
        {exportButton("premiere", "Markers", "Premiere marker CSV with the author in the name")}
        {exportButton("edl", "EDL", "EDL locators")}
      </footer>
    </section>
  );
}
