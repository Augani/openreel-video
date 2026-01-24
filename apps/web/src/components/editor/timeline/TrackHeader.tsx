import React from "react";
import { Eye, EyeOff, Volume2, Lock, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import type { Track } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { getTrackInfo } from "./utils";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
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
  const { lockTrack, hideTrack, muteTrack, removeTrack } = useProjectStore();
  const { isTrackExpanded, toggleTrackExpanded } = useTimelineStore();
  const isExpanded = isTrackExpanded(track.id);

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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable
          onDragStart={(e) => onDragStart(e, track.id)}
          onDragOver={onDragOver}
          onDrop={(e) => onDrop(e, track.id)}
          className={`h-20 border-b border-border flex flex-col justify-between py-2 px-3 relative group transition-colors cursor-grab active:cursor-grabbing ${
            track.hidden ? "opacity-50" : ""
          } ${
            track.locked ? "bg-background-secondary/50" : "bg-background-tertiary"
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
            <div className={`w-5 h-5 rounded flex items-center justify-center ${trackInfo.bgLight}`}>
              <TrackIcon size={12} className={trackInfo.textColor} />
            </div>
            <span className={`text-[11px] font-semibold truncate max-w-[70px] ${trackInfo.textColor}`}>
              {track.name || trackInfo.label}
            </span>
            {keyframeCount > 0 && (
              <span className="text-[8px] text-text-muted bg-background-elevated px-1 py-0.5 rounded">
                {keyframeCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 text-text-secondary">
            {isVisual && (
              <button
                onClick={(e) => { e.stopPropagation(); hideTrack(track.id, !track.hidden); }}
                className={`p-1 rounded transition-colors ${
                  track.hidden
                    ? "text-yellow-500 bg-yellow-500/10"
                    : "text-text-muted hover:bg-background-elevated hover:text-text-primary"
                }`}
                title={track.hidden ? "Show track" : "Hide track"}
              >
                {track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); muteTrack(track.id, !track.muted); }}
              className={`p-1 rounded transition-colors ${
                track.muted
                  ? "text-red-500 bg-red-500/10"
                  : "text-text-muted hover:bg-background-elevated hover:text-text-primary"
              }`}
              title={track.muted ? "Unmute" : "Mute"}
            >
              <Volume2 size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); lockTrack(track.id, !track.locked); }}
              className={`p-1 rounded transition-colors ${
                track.locked
                  ? "text-yellow-500 bg-yellow-500/10"
                  : "text-text-muted hover:bg-background-elevated hover:text-text-primary"
              }`}
              title={track.locked ? "Unlock" : "Lock"}
            >
              <Lock size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleRemoveTrack(); }}
              className="p-1 rounded transition-colors hover:bg-red-500/20 text-red-400/50 hover:text-red-400"
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
