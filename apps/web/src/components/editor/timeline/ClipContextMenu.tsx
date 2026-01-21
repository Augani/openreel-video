import React from "react";
import { Copy, Clipboard, Trash2, Scissors, Music } from "lucide-react";
import type { Clip, Track } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@openreel/ui";

interface ClipContextMenuProps {
  clip: Clip;
  track: Track;
  onClose?: () => void;
}

export const ClipContextMenu: React.FC<ClipContextMenuProps> = ({
  clip,
  track,
  onClose,
}) => {
  const {
    copyClips,
    duplicateClip,
    removeClip,
    rippleDeleteClip,
    splitClip,
    separateAudio,
    getMediaItem,
  } = useProjectStore();
  const { playheadPosition } = useTimelineStore();

  const isPlayheadOnClip =
    playheadPosition >= clip.startTime &&
    playheadPosition <= clip.startTime + clip.duration;

  const mediaItem = getMediaItem(clip.mediaId);
  const isVideoWithAudio =
    track.type === "video" &&
    mediaItem?.type === "video" &&
    mediaItem?.metadata?.channels &&
    mediaItem.metadata.channels > 0;

  const handleCopy = () => {
    copyClips([clip.id]);
    onClose?.();
  };

  const handleDuplicate = async () => {
    await duplicateClip(clip.id);
    onClose?.();
  };

  const handleDelete = async () => {
    await removeClip(clip.id);
    onClose?.();
  };

  const handleRippleDelete = async () => {
    await rippleDeleteClip(clip.id);
    onClose?.();
  };

  const handleSplit = async () => {
    if (isPlayheadOnClip) {
      await splitClip(clip.id, playheadPosition);
    }
    onClose?.();
  };

  const handleSeparateAudio = async () => {
    await separateAudio(clip.id);
    onClose?.();
  };

  return (
    <ContextMenuContent className="min-w-[200px]">
      <ContextMenuItem onClick={handleCopy}>
        <Copy className="mr-2 h-4 w-4" />
        Copy
        <ContextMenuShortcut>⌘C</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleDuplicate}>
        <Clipboard className="mr-2 h-4 w-4" />
        Duplicate
        <ContextMenuShortcut>⌘D</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleRippleDelete}>
        <Trash2 className="mr-2 h-4 w-4" />
        Ripple Delete
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleDelete}>
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleSplit} disabled={!isPlayheadOnClip}>
        <Scissors className="mr-2 h-4 w-4" />
        Split at Playhead
        <ContextMenuShortcut>S</ContextMenuShortcut>
      </ContextMenuItem>
      {isVideoWithAudio && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleSeparateAudio}>
            <Music className="mr-2 h-4 w-4" />
            Separate Audio
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
};
