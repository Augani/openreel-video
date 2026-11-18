import { Button } from "@openreel/ui";
import { Circle, Film, Plus } from "lucide-react";
import type { MediaItem } from "@openreel/core";

/** Projects recorded before takes carried provenance have only the Screen_/Webcam_<timestamp>.webm name. */
const TAKE_NAME = /^(Screen|Webcam)_\d{8}T\d{6}\.webm$/;

/** A take is anything the in-app recorder imported (tagged in metadata, so renaming never hides it). */
export function isRecordingTake(item: Pick<MediaItem, "name" | "type"> & { metadata?: Partial<MediaItem["metadata"]> }): boolean {
  if (item.type !== "video") return false;
  return !!item.metadata?.recordedTake || TAKE_NAME.test(item.name);
}

function formatTake(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function takeLabel(name: string): string {
  const match = /^(Screen|Webcam)_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.webm$/.exec(name);
  if (!match) return name;
  const [, kind, y, mo, d, h, mi] = match;
  const when = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  const stamp = Number.isNaN(when.getTime())
    ? ""
    : when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${kind}${stamp ? ` · ${stamp}` : ""}`;
}

export function RecordingsPanel({
  items,
  onRecord,
  onAddToTimeline,
  onOpenInSource,
}: {
  items: readonly MediaItem[];
  onRecord: () => void;
  onAddToTimeline: (item: MediaItem) => void;
  onOpenInSource: (item: MediaItem) => void;
}) {
  const takes = items.filter(isRecordingTake).reverse();
  return (
    <div className="workspace-recordings" data-testid="recordings-panel">
      <div className="px-2.5 pb-2.5 pt-2.5">
        <Button variant="secondary" className="h-[30px] w-full gap-1.5 text-[13px]" onClick={onRecord}>
          <Circle size={12} className="fill-red-500 text-red-500" aria-hidden />
          New recording
        </Button>
      </div>
      {takes.length ? (
        <div className="workspace-recordings-list" aria-label="Recorded takes">
          {takes.map((item) => (
            <div key={item.id} className="workspace-recording-row" onDoubleClick={() => onOpenInSource(item)}>
              <div className="thumb">
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt="" />
                ) : (
                  <div className="workspace-media-skeleton" />
                )}
              </div>
              <div className="min-w-0">
                <strong title={item.name}>{takeLabel(item.name)}</strong>
                <small>
                  {formatTake(item.metadata.duration)}
                  {item.metadata.width ? ` · ${item.metadata.width}×${item.metadata.height}` : ""}
                </small>
              </div>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label={`Add ${takeLabel(item.name)} to timeline`}
                title="Add to timeline"
                onClick={() => onAddToTimeline(item)}
              >
                <Plus size={14} />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 pb-8 text-center text-[12px] text-fg-muted">
          <Film size={20} aria-hidden />
          <strong className="text-fg-2">No recordings yet</strong>
          <span>Screen and webcam takes you record appear here.</span>
        </div>
      )}
    </div>
  );
}
