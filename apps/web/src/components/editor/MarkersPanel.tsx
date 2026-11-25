import { useEffect, useMemo, useRef, useState } from "react";
import { MARKER_KINDS, sortMarkers, type Marker, type MarkerKind } from "@openreel/core";
import { Button, Input } from "@openreel/ui";
import { Bookmark, Download, Plus, Trash2 } from "@/icons/lucide-compat";
import { ClipMarkersList } from "./ClipMarkersList";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { formatFrameTimecode, parseFrameTimecode } from "../../utils/frame-timecode";
import {
  MARKER_COLORS,
  MARKER_KIND_LABELS,
  addMarkerAtPlayhead,
  clearAllMarkers,
  exportMarkers,
  copyYouTubeChapters,
  seekToMarker,
  type MarkerExportKind,
} from "../../services/marker-commands";

interface Draft {
  label: string;
  comment: string;
  time: string;
  duration: string;
  kind: MarkerKind;
  color: string;
}

const kindOf = (marker: Marker): MarkerKind => marker.kind ?? "comment";

const toDraft = (marker: Marker, fps: number): Draft => ({
  label: marker.label,
  comment: marker.comment ?? "",
  time: formatFrameTimecode(marker.time, fps),
  duration: marker.duration ? formatFrameTimecode(marker.duration, fps) : "",
  kind: kindOf(marker),
  color: marker.color,
});

const SELECT_CLASS =
  "h-7 rounded-md border border-border bg-bg-2 px-1.5 text-[12px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Review list for every marker: sorted by time, filterable, editable in place and exportable. */
export function MarkersPanel() {
  const markers = useProjectStore((s) => s.project.timeline.markers);
  const fps = useProjectStore((s) => s.project.settings.frameRate) || 30;
  const updateMarker = useProjectStore((s) => s.updateMarker);
  const removeMarker = useProjectStore((s) => s.removeMarker);
  const editingRequest = useEditorWorkspaceStore((s) => s.editingMarkerId);
  const setEditingRequest = useEditorWorkspaceStore((s) => s.setEditingMarkerId);
  const selectedId = useEditorWorkspaceStore((s) => s.selectedMarkerId);
  const setSelectedId = useEditorWorkspaceStore((s) => s.setSelectedMarkerId);
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const scope = useEditorWorkspaceStore((s) => s.markerScope);
  const setScope = useEditorWorkspaceStore((s) => s.setMarkerScope);

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<MarkerKind | "all">("all");
  const [colorFilter, setColorFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const beginEdit = (marker: Marker) => {
    setEditingId(marker.id);
    setDraft(toDraft(marker, fps));
    setError(null);
  };

  // "Edit Marker" (Alt+M, M twice, ruler context menu) asks for a row to open.
  useEffect(() => {
    if (!editingRequest) return;
    const target = markers.find((m) => m.id === editingRequest);
    setEditingRequest(null);
    if (!target) return;
    setSelectedId(target.id);
    beginEdit(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRequest]);

  useEffect(() => {
    if (editingId) nameRef.current?.focus();
  }, [editingId]);

  const colors = useMemo(() => [...new Set(markers.map((m) => m.color))], [markers]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortMarkers(markers).filter((m) => {
      if (kindFilter !== "all" && kindOf(m) !== kindFilter) return false;
      if (colorFilter !== "all" && m.color !== colorFilter) return false;
      if (!needle) return true;
      return `${m.label} ${m.comment ?? ""}`.toLowerCase().includes(needle);
    });
  }, [markers, query, kindFilter, colorFilter]);

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
    setError(null);
  };

  const commitEdit = (marker: Marker) => {
    if (!draft) return;
    const updates: { -readonly [K in keyof Marker]?: Marker[K] } = {};
    const label = draft.label.trim();
    if (label && label !== marker.label) updates.label = label;
    if (draft.comment !== (marker.comment ?? "")) updates.comment = draft.comment || undefined;
    if (draft.color !== marker.color) updates.color = draft.color;
    if (draft.kind !== kindOf(marker)) updates.kind = draft.kind;
    const time = parseFrameTimecode(draft.time, fps);
    if (time === null) {
      setError("Enter the in point as HH:MM:SS:FF or seconds.");
      return;
    }
    if (Math.abs(time - marker.time) > 1e-6) updates.time = time;
    const durationText = draft.duration.trim();
    const duration = durationText === "" ? 0 : parseFrameTimecode(durationText, fps);
    if (duration === null) {
      setError("Enter the duration as HH:MM:SS:FF or seconds.");
      return;
    }
    if (Math.abs(duration - (marker.duration ?? 0)) > 1e-6) updates.duration = duration || undefined;
    cancelEdit();
    if (Object.keys(updates).length > 0) void updateMarker(marker.id, updates);
  };

  const onEditKey = (event: React.KeyboardEvent, marker: Marker) => {
    // The editor owns single-key shortcuts; typing in a field must never trigger them.
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit(marker);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  };

  const select = (marker: Marker) => {
    setSelectedId(marker.id);
    seekToMarker(marker);
  };

  const field = (key: keyof Draft, value: string) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  const exportButton = (kind: MarkerExportKind, label: string) => (
    <Button
      key={kind}
      variant="secondary"
      size="sm"
      className="h-7 gap-1 px-2 text-[12px]"
      disabled={markers.length === 0}
      data-testid={`markers-export-${kind}`}
      onClick={() => exportMarkers(kind)}
    >
      <Download size={12} aria-hidden />
      {label}
    </Button>
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col text-fg" aria-label="Markers" data-testid="markers-panel">
      <header className="flex flex-col gap-2 border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Bookmark size={14} aria-hidden />
            Markers
            <span className="rounded-full bg-bg-2 px-1.5 text-[11px] font-normal text-fg-muted" data-testid="markers-count">
              {markers.length}
            </span>
          </h2>
          <div className={`flex gap-1 ${scope === "clips" ? "hidden" : ""}`}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[12px]"
              aria-label="Add marker at playhead"
              onClick={() => void addMarkerAtPlayhead()}
            >
              <Plus size={12} aria-hidden />
              Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[12px]"
              aria-label="Clear all markers"
              disabled={markers.length === 0}
              onClick={() => void clearAllMarkers()}
            >
              <Trash2 size={12} aria-hidden />
              Clear
            </Button>
          </div>
        </div>
        <div role="tablist" aria-label="Marker scope" className="flex gap-1 rounded-md bg-bg-2 p-0.5">
          {(["sequence", "clips"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              data-testid={`markers-scope-${value}`}
              onClick={() => setScope(value)}
              className={`h-6 flex-1 rounded px-2 text-[12px] ${scope === value ? "bg-bg-1 font-medium text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`}
            >
              {value === "sequence" ? "Sequence" : "Clips"}
            </button>
          ))}
        </div>
        {scope === "sequence" && <Input
          aria-label="Search markers"
          placeholder="Search names and comments"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          className="h-7 text-[12px]"
        />}
        {scope === "sequence" && <div className="flex gap-2">
          <select
            aria-label="Filter by type"
            className={`${SELECT_CLASS} flex-1`}
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value as MarkerKind | "all")}
          >
            <option value="all">All types</option>
            {MARKER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {MARKER_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by colour"
            className={`${SELECT_CLASS} flex-1`}
            value={colorFilter}
            onChange={(event) => setColorFilter(event.target.value)}
          >
            <option value="all">All colours</option>
            {colors.map((color) => (
              <option key={color} value={color}>
                {MARKER_COLORS.find((c) => c.value === color)?.name ?? color}
              </option>
            ))}
          </select>
        </div>}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {scope === "clips" ? (
          <ClipMarkersList />
        ) : markers.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-fg-muted" data-testid="markers-empty">
            No markers yet. Press M to drop one at the playhead, or Alt-drag the ruler for a range.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-fg-muted">No markers match the filters.</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-[12px]" aria-label="Marker list">
            <colgroup>
              <col style={{ width: 28 }} />
              <col />
              <col style={{ width: 88 }} />
              <col style={{ width: 80 }} />
              <col />
              <col style={{ width: 28 }} />
            </colgroup>
            <thead className="sticky top-0 bg-bg-1 text-[11px] uppercase tracking-wide text-fg-muted">
              <tr>
                <th scope="col" className="px-2 py-1.5">
                  <span className="sr-only">Colour</span>
                </th>
                <th scope="col" className="px-1 py-1.5 font-medium">Name</th>
                <th scope="col" className="px-1 py-1.5 font-medium">In</th>
                <th scope="col" className="px-1 py-1.5 font-medium">Duration</th>
                <th scope="col" className="px-1 py-1.5 font-medium">Comment</th>
                <th scope="col" className="px-1 py-1.5">
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((marker) => {
                const editing = editingId === marker.id && draft !== null;
                const selected = selectedId === marker.id;
                const atPlayhead = Math.abs(marker.time - playhead) < 0.5 / fps;
                return (
                  <tr
                    key={marker.id}
                    data-testid="marker-row"
                    data-marker-id={marker.id}
                    aria-selected={selected}
                    data-at-playhead={atPlayhead || undefined}
                    className={`cursor-pointer border-t border-border/60 align-top hover:bg-bg-2 ${selected ? "bg-bg-2" : ""}`}
                    onClick={() => select(marker)}
                    onDoubleClick={() => beginEdit(marker)}
                  >
                    <td className="px-2 py-1.5">
                      {editing ? (
                        <select
                          aria-label="Marker colour"
                          className="h-6 w-5 appearance-none rounded-full border border-border p-0 text-transparent"
                          style={{ backgroundColor: draft.color }}
                          value={draft.color}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => onEditKey(event, marker)}
                          onChange={(event) => field("color", event.target.value)}
                        >
                          {[...new Set([draft.color, ...MARKER_COLORS.map((c) => c.value)])].map((value) => (
                            <option key={value} value={value}>
                              {MARKER_COLORS.find((c) => c.value === value)?.name ?? value}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="mt-0.5 block h-3 w-3 rounded-full border border-border"
                          style={{ backgroundColor: marker.color }}
                          data-testid="marker-swatch"
                          title={kindOf(marker) === "comment" ? undefined : MARKER_KIND_LABELS[kindOf(marker)]}
                        />
                      )}
                    </td>
                    {editing ? (
                      <>
                        <td className="px-1 py-1" colSpan={4}>
                          <div className="flex flex-col gap-1.5" onClick={(event) => event.stopPropagation()}>
                            <Input
                              ref={nameRef}
                              aria-label="Marker name"
                              value={draft.label}
                              onChange={(event) => field("label", event.target.value)}
                              onKeyDown={(event) => onEditKey(event, marker)}
                              className="h-7 text-[12px]"
                            />
                            <div className="grid grid-cols-2 gap-1.5">
                              <Input
                                aria-label="Marker in point"
                                value={draft.time}
                                onChange={(event) => field("time", event.target.value)}
                                onKeyDown={(event) => onEditKey(event, marker)}
                                className="h-7 font-mono text-[12px]"
                              />
                              <Input
                                aria-label="Marker duration"
                                placeholder="Duration"
                                value={draft.duration}
                                onChange={(event) => field("duration", event.target.value)}
                                onKeyDown={(event) => onEditKey(event, marker)}
                                className="h-7 font-mono text-[12px]"
                              />
                            </div>
                            <select
                              aria-label="Marker type"
                              className={SELECT_CLASS}
                              value={draft.kind}
                              onKeyDown={(event) => onEditKey(event, marker)}
                              onChange={(event) => field("kind", event.target.value)}
                            >
                              {MARKER_KINDS.map((kind) => (
                                <option key={kind} value={kind}>
                                  {MARKER_KIND_LABELS[kind]}
                                </option>
                              ))}
                            </select>
                            <Input
                              aria-label="Marker comment"
                              placeholder="Comment"
                              value={draft.comment}
                              onChange={(event) => field("comment", event.target.value)}
                              onKeyDown={(event) => onEditKey(event, marker)}
                              className="h-7 text-[12px]"
                            />
                            {error && (
                              <p role="alert" className="text-[11px] text-red-400">
                                {error}
                              </p>
                            )}
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={cancelEdit}>
                                Cancel
                              </Button>
                              <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => commitEdit(marker)}>
                                Save
                              </Button>
                            </div>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="break-words px-1 py-1.5 font-medium" data-testid="marker-name">
                          {marker.label || <span className="text-fg-muted">Untitled</span>}
                        </td>
                        <td className="px-1 py-1.5 font-mono text-[11px] text-fg-2" data-testid="marker-in">
                          {formatFrameTimecode(marker.time, fps)}
                        </td>
                        <td className="px-1 py-1.5 font-mono text-[11px] text-fg-2" data-testid="marker-duration">
                          {marker.duration ? formatFrameTimecode(marker.duration, fps) : "—"}
                        </td>
                        <td className="break-words px-1 py-1.5 text-fg-muted" data-testid="marker-comment">
                          {marker.comment}
                        </td>
                      </>
                    )}
                    <td className="px-1 py-1">
                      {!editing && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-6 w-6"
                          aria-label={`Delete marker ${marker.label || "Untitled"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void removeMarker(marker.id);
                          }}
                        >
                          <Trash2 size={12} aria-hidden />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {scope === "sequence" && <footer className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
        <span className="mr-auto text-[11px] text-fg-muted">Export</span>
        {exportButton("chapters", "Chapters")}
        {exportButton("webvtt", "VTT")}
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2 text-[12px]"
          disabled={markers.length === 0}
          data-testid="markers-copy-youtube"
          title="Copy the chapter list for a YouTube description"
          onClick={() => void copyYouTubeChapters()}
        >
          Copy YouTube
        </Button>
        {exportButton("csv", "CSV")}
        {exportButton("edl", "EDL")}
      </footer>}
    </section>
  );
}
