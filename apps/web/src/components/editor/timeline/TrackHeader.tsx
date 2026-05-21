import React, { useState, useRef, useEffect } from "react";
import { Eye, EyeOff, Volume2, Lock, Trash2, ChevronDown, ChevronRight, Pencil, AlignLeft } from "lucide-react";
import type { Track } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { getTrackInfo } from "./utils";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@openreel/ui";

interface TrackHeaderProps {
  track: Track;
  index: number;
  onDragStart: (e: React.DragEvent, trackId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetTrackId: string) => void;
  keyframeCount?: number;
}

export const TrackHeader: React.FC<TrackHeaderProps> = ({
  track,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  keyframeCount = 0,
}) => {
  const { lockTrack, hideTrack, muteTrack, removeTrack, renameTrack, consolidateTrack } = useProjectStore();
  const { isTrackExpanded, toggleTrackExpanded, getTrackHeight } = useTimelineStore();
  const isExpanded = isTrackExpanded(track.id);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(track.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const trackInfo = getTrackInfo(track, index);
  const TrackIcon = trackInfo.icon;
  const isVisual =
    track.type === "video" ||
    track.type === "image" ||
    track.type === "text" ||
    track.type === "graphics";

  const handleRemoveTrack = async () => {
    await removeTrack(track.id);
  };

  const handleRemoveGaps = async () => {
    await consolidateTrack(track.id);
  };

  // Only enable "Remove Gaps" if there's actually a gap on this track.
  const hasGaps = React.useMemo(() => {
    if (track.clips.length === 0) return false;
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    if (sorted[0].startTime > 0.0001) return true;
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].startTime + sorted[i - 1].duration;
      if (sorted[i].startTime - prevEnd > 0.0001) return true;
    }
    return false;
  }, [track.clips]);

  const startRename = () => {
    setRenameValue(track.name);
    setIsRenaming(true);
  };

  const commitRename = () => {
    renameTrack(track.id, renameValue || track.name);
    setIsRenaming(false);
  };

  const cancelRename = () => {
    setRenameValue(track.name);
    setIsRenaming(false);
  };

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable={!isRenaming}
          onDragStart={(e) => onDragStart(e, track.id)}
          onDragOver={onDragOver}
          onDrop={(e) => onDrop(e, track.id)}
          style={{ height: getTrackHeight(track.id) }}
          className={`border-b border-border flex flex-col justify-between py-1.5 px-2.5 relative group transition-colors cursor-grab active:cursor-grabbing ${
            track.hidden ? "opacity-60" : ""
          } ${
            track.locked ? "bg-bg-2/50" : "bg-bg-1"
          }`}
        >
          <div className="flex items-center gap-2">
            {keyframeCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleTrackExpanded(track.id); }}
                className="p-0.5 rounded transition-colors hover:bg-background-elevated text-text-muted"
                title={isExpanded ? "Collapse keyframes" : "Expand keyframes"}
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            )}
            <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${trackInfo.bgLight}`}>
              <TrackIcon size={12} className={trackInfo.textColor} />
            </div>
            {isRenaming ? (
              <input
                ref={inputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") cancelRename();
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] font-semibold bg-background-elevated border border-primary/50 rounded px-1 w-[70px] outline-none text-text-primary"
              />
            ) : (
              <span
                className={`text-[11px] font-semibold truncate max-w-[70px] ${trackInfo.textColor}`}
                onDoubleClick={startRename}
              >
                {track.name || trackInfo.label}
              </span>
            )}
            {keyframeCount > 0 && (
              <span className="text-[8px] text-text-muted bg-background-elevated px-1 py-0.5 rounded">
                {keyframeCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-px text-fg-3">
            {isVisual && (
              <button
                onClick={(e) => { e.stopPropagation(); hideTrack(track.id, !track.hidden); }}
                className={`w-[22px] h-[22px] grid place-items-center rounded transition-colors ${
                  track.hidden
                    ? "text-status-error"
                    : "text-fg-3 hover:bg-hover hover:text-fg"
                }`}
                title={track.hidden ? "Show track" : "Hide track"}
              >
                {track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            )}
            {track.type !== "image" && track.type !== "text" && track.type !== "graphics" && (
              <button
                onClick={(e) => { e.stopPropagation(); muteTrack(track.id, !track.muted); }}
                className={`w-[22px] h-[22px] grid place-items-center rounded transition-colors ${
                  track.muted
                    ? "text-status-error"
                    : "text-fg-3 hover:bg-hover hover:text-fg"
                }`}
                title={track.muted ? "Unmute" : "Mute"}
              >
                <Volume2 size={12} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); lockTrack(track.id, !track.locked); }}
              className={`w-[22px] h-[22px] grid place-items-center rounded transition-colors ${
                track.locked
                  ? "text-accent"
                  : "text-fg-3 hover:bg-hover hover:text-fg"
              }`}
              title={track.locked ? "Unlock" : "Lock"}
            >
              <Lock size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleRemoveTrack(); }}
              className="w-[22px] h-[22px] grid place-items-center rounded transition-colors text-fg-muted hover:bg-hover hover:text-status-error"
              title="Delete track"
            >
              <Trash2 size={12} />
            </button>
          </div>

          <div
            className={`absolute left-0 top-0 w-1 h-full ${trackInfo.color} opacity-60 group-hover:opacity-100 transition-opacity`}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[160px]">
        <ContextMenuItem onClick={startRename}>
          <Pencil className="mr-2 h-4 w-4" />
          Rename Track
        </ContextMenuItem>
        <ContextMenuItem onClick={handleRemoveGaps} disabled={!hasGaps}>
          <AlignLeft className="mr-2 h-4 w-4" />
          Remove Gaps
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={handleRemoveTrack}
          className="text-red-400 focus:text-red-400 hover:text-red-400"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Track
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
