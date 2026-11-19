import { useMemo, useState } from "react";
import { flattenClipMarkers, type Clip, type Marker } from "@openreel/core";
import { Button, Input } from "@openreel/ui";
import { Trash2 } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { formatFrameTimecode } from "../../utils/frame-timecode";
import { removeClipMarker, seekToClipMarker, updateClipMarker } from "../../services/clip-marker-commands";

/**
 * Clip and master-clip markers of the timeline's clips. A master-clip marker (set in the Source
 * monitor) is listed once per timeline instance, each at its own offset; editing it edits the
 * shared marker. Rows of selected clips are highlighted.
 */
export function ClipMarkersList() {
  const tracks = useProjectStore((s) => s.project.timeline.tracks);
  const items = useProjectStore((s) => s.project.mediaLibrary.items);
  const fps = useProjectStore((s) => s.project.settings.frameRate) || 30;
  const selectedItems = useUIStore((s) => s.selectedItems);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [name, setName] = useState("");

  const selectedIds = useMemo(
    () => new Set(selectedItems.filter((i) => i.type === "clip").map((i) => i.id)),
    [selectedItems],
  );

  const rows = useMemo(() => {
    const clips: Clip[] = [];
    for (const track of tracks) for (const clip of track.clips) clips.push(clip);
    const byId = new Map(items.map((i) => [i.id, i]));
    const names = new Map(clips.map((c) => [c.id, byId.get(c.mediaId)?.name ?? "Clip"]));
    return flattenClipMarkers(clips, (id) => byId.get(id)).map((r) => ({
      ...r,
      clip: clips.find((c) => c.id === r.clipId)!,
      clipName: names.get(r.clipId) ?? "Clip",
    }));
  }, [tracks, items]);

  const targetOf = (row: (typeof rows)[number]) =>
    row.scope === "master" ? { mediaId: row.clip.mediaId } : { clipId: row.clip.id };

  const commit = (row: (typeof rows)[number]) => {
    const label = name.trim();
    setEditingKey(null);
    if (label && label !== row.marker.label) void updateClipMarker(targetOf(row), row.marker.id, { label } as Partial<Marker>);
  };

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[12px] text-fg-muted" data-testid="clip-markers-empty">
        No clip markers yet. Press M in the Source monitor to mark the source clip, or Alt+Shift+M on the timeline to mark a clip.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60 text-[12px]" aria-label="Clip marker list" data-testid="clip-marker-list">
      {rows.map((row) => {
        const key = `${row.clipId}:${row.scope}:${row.marker.id}`;
        const editing = editingKey === key;
        return (
          <li
            key={key}
            data-testid="clip-marker-row"
            data-scope={row.scope}
            data-clip-id={row.clipId}
            aria-selected={selectedIds.has(row.clipId)}
            className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-bg-2 ${selectedIds.has(row.clipId) ? "bg-bg-2" : ""}`}
            onClick={() => seekToClipMarker(row.clip, row.marker)}
            onDoubleClick={() => {
              setName(row.marker.label);
              setEditingKey(key);
            }}
          >
            <span className="h-3 w-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: row.marker.color }} />
            <div className="min-w-0 flex-1">
              {editing ? (
                <Input
                  autoFocus
                  aria-label="Marker name"
                  value={name}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() => commit(row)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") commit(row);
                    if (event.key === "Escape") setEditingKey(null);
                  }}
                  className="h-6 text-[12px]"
                />
              ) : (
                <div className="truncate font-medium" data-testid="clip-marker-name">
                  {row.marker.label || <span className="text-fg-muted">Untitled</span>}
                </div>
              )}
              <div className="truncate text-[11px] text-fg-muted">
                {row.clipName} <span className="uppercase tracking-wide">· {row.scope === "master" ? "Master" : "Clip"}</span>
              </div>
            </div>
            <span className="font-mono text-[11px] text-fg-2" data-testid="clip-marker-time">
              {formatFrameTimecode(row.timelineTime, fps)}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6"
              aria-label={`Delete ${row.scope === "master" ? "master clip" : "clip"} marker ${row.marker.label || "Untitled"}`}
              onClick={(event) => {
                event.stopPropagation();
                void removeClipMarker(targetOf(row), row.marker.id);
              }}
            >
              <Trash2 size={12} aria-hidden />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
