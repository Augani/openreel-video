import React, { useState, useRef, useEffect } from "react";
import { Eye, EyeOff, Volume2, VolumeX, Lock, Trash2, Pencil, AlignLeft } from "@/icons/lucide-compat";
import {
  ToolcraftContextMenu as ContextMenu,
  type ToolcraftContextMenuOption as ContextMenuOption,
} from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import type { Track } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { getTrackInfo } from "./utils";

interface TrackHeaderProps {
  track: Track;
  index: number;
  onDragStart: (e: React.DragEvent, trackId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetTrackId: string) => void;
  onDragEnd: () => void;
  keyframeCount?: number;
}

export const TrackHeader: React.FC<TrackHeaderProps> = ({
  track,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) => {
  const {
    lockTrack,
    hideTrack,
    muteTrack,
    soloTrack,
    removeTrack,
    renameTrack,
    consolidateTrack,
    project,
  } = useProjectStore();
  const { getTrackHeight } = useTimelineStore();

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(track.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const trackInfo = getTrackInfo(track, index);
  const isVisual =
    track.type === "video" ||
    track.type === "image" ||
    track.type === "text" ||
    track.type === "graphics";
  const isAudio = track.type === "audio";
  const hasSoloedAudioTrack = project.timeline.tracks.some(
    (candidate) => candidate.type === "audio" && candidate.solo,
  );
  const effectivelyMuted =
    isAudio && (track.muted || (hasSoloedAudioTrack && !track.solo));

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

  const menuItems: ContextMenuOption[] = [
    {
      label: "Rename Track",
      icon: <Pencil size={14} aria-hidden />,
      onClick: startRename,
    },
    {
      label: "Remove Gaps",
      icon: <AlignLeft size={14} aria-hidden />,
      isDisabled: !hasGaps,
      onClick: handleRemoveGaps,
    },
    { type: "divider" },
    {
      label: "Delete Track",
      icon: <Trash2 size={14} aria-hidden />,
      onClick: handleRemoveTrack,
    },
  ];

  return (
    <ContextMenu items={menuItems} menuWidth={180} size="sm">
      <div
        draggable={!isRenaming}
        onDragStart={(e) => onDragStart(e, track.id)}
        onDragOver={onDragOver}
        onDrop={(e) => onDrop(e, track.id)}
        onDragEnd={onDragEnd}
        style={{ height: getTrackHeight(track.id, track.type) }}
        className={`border-b border-border flex items-center gap-2.5 px-4 relative group transition-colors cursor-grab active:cursor-grabbing ${
          track.hidden || effectivelyMuted ? "opacity-60" : ""
        } ${
          track.locked ? "bg-bg-2/50" : "bg-bg-1"
        }`}
      >
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <ToolcraftTextInputControl
                ref={inputRef}
                label="Track name"
                isLabelHidden
                size="sm"
                width="100%"
                value={renameValue}
                onChange={setRenameValue}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") cancelRename();
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="block truncate text-[13px] font-semibold text-fg-2 cursor-grab active:cursor-grabbing"
                onDoubleClick={startRename}
              >
                {track.name || trackInfo.label}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {isVisual && (
              <button
                type="button"
                aria-label={track.hidden ? "Show track" : "Hide track"}
                className="text-fg-muted hover:text-fg-2 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  hideTrack(track.id, !track.hidden);
                }}
              >
                {track.hidden ? (
                  <EyeOff size={15} strokeWidth={1.7} aria-hidden />
                ) : (
                  <Eye size={15} strokeWidth={1.7} aria-hidden />
                )}
              </button>
            )}
            {isAudio && (
              <>
                <button
                  type="button"
                  aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                  aria-pressed={track.muted}
                  title={track.muted ? "Unmute track" : "Mute track"}
                  className={`transition-colors ${
                    track.muted ? "text-destructive" : "text-fg-muted hover:text-fg-2"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    muteTrack(track.id, !track.muted);
                  }}
                >
                  {track.muted ? (
                    <VolumeX size={15} strokeWidth={1.7} aria-hidden />
                  ) : (
                    <Volume2 size={15} strokeWidth={1.7} aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={track.solo ? `Clear solo ${track.name}` : `Solo ${track.name}`}
                  aria-pressed={track.solo}
                  title={track.solo ? "Clear solo" : "Solo track"}
                  className={`flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 text-[9px] font-black transition-colors ${
                    track.solo
                      ? "bg-status-warning text-black"
                      : "text-fg-muted hover:bg-hover hover:text-fg-2"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    soloTrack(track.id, !track.solo);
                  }}
                >
                  S
                </button>
              </>
            )}
            <button
              type="button"
              aria-label={track.locked ? "Unlock" : "Lock"}
              className={`transition-colors ${
                track.locked ? "text-fg-2" : "text-fg-muted hover:text-fg-2"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                lockTrack(track.id, !track.locked);
              }}
            >
              <Lock size={13} strokeWidth={1.8} aria-hidden />
            </button>
          </div>
      </div>
    </ContextMenu>
  );
};
