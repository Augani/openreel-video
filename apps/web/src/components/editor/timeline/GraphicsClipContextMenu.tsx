import { useRef } from "react";

import { ContextMenuContent, ContextMenuLabel, ContextMenuItem, ContextMenuSeparator } from "@openreel/ui";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { getEditableTimelineSelection, getLinkedTimelineSelection } from "../../../utils/linked-timeline-selection";
import { editTimelineSelection } from "../../../services/linked-timeline-edit";
import {
  Copy,
  Layers,
  Trash2,
  Shapes,
  Type,
  ListChecks,
} from "@/icons/lucide-compat";
import type { ShapeClip, SVGClip, StickerClip, TextClip } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { getTimelineTrackSelection } from "../../../utils/timeline-item-actions";
import { replaceSelectionWithLinkedComposition } from "../../../services/linked-comp-commands";

type GraphicsClipType = ShapeClip | SVGClip | StickerClip | TextClip;

interface GraphicsClipContextMenuProps {
  clip: GraphicsClipType;
  clipType: "shape" | "svg" | "sticker" | "emoji" | "text";
  onClose?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}

export function GraphicsClipContextMenu({
  clip,
  clipType,
  onClose,
  onDelete,
  onDuplicate,
}: GraphicsClipContextMenuProps) {
  const selectMultiple = useUIStore((state) => state.selectMultiple);
  const project = useProjectStore((state) => state.project);
  const ownerProjectId = useRef(project.id);
  const linkedSelection = useEditorWorkspaceStore(state => state.linkedSelection);
  const exporting = useUIStore(state => state.exportState.isExporting);
  const operationLocked = useTimelineStore(state => Boolean(state.playbackLockedReason));
  const editingDisabled = exporting || operationLocked || !getEditableTimelineSelection(project, [clip.id], linkedSelection).ids.includes(clip.id);
  const canAct = (edit = false) => {
    const state = useProjectStore.getState();
    if (state.project.id !== ownerProjectId.current || !getTimelineTrackSelection(state.getFullProject(), clip.trackId).some(item => item.id === clip.id)) return false;
    return !edit || (!useUIStore.getState().exportState.isExporting
      && !useTimelineStore.getState().playbackLockedReason
      && getEditableTimelineSelection(state.getFullProject(), [clip.id], useEditorWorkspaceStore.getState().linkedSelection).ids.includes(clip.id));
  };
  const isCaption =
    clipType === "text" &&
    (project.timeline.tracks.some(
      (track) =>
        track.id === clip.trackId &&
        (track.role === "captions" ||
          track.name.trim().toLowerCase() === "captions"),
    ) ||
      ("metadata" in clip &&
        typeof clip.metadata?.captionSource === "string"));

  const handleDelete = async () => {
    if (!canAct(true)) return;
    if (onDelete) onDelete();
    else await editTimelineSelection([clip.id], "delete");
    onClose?.();
  };

  const handleDuplicate = async () => {
    if (!canAct(true)) return;
    if (onDuplicate) onDuplicate();
    else await editTimelineSelection([clip.id], "duplicate");
    onClose?.();
  };

  const handleCopy = () => {
    if (!canAct()) return;
    const state = useProjectStore.getState();
    state.copyClips(getLinkedTimelineSelection(state.getFullProject(), [clip.id], useEditorWorkspaceStore.getState().linkedSelection));
    onClose?.();
  };

  const handleSelectTrackClips = () => {
    if (!canAct()) return;
    const project = useProjectStore.getState().getFullProject();
    selectMultiple(getTimelineTrackSelection(project, clip.trackId));
    onClose?.();
  };

  const getClipTypeLabel = () => {
    switch (clipType) {
      case "shape":
        return "Shape";
      case "svg":
        return "SVG";
      case "sticker":
        return "Sticker";
      case "emoji":
        return "Emoji";
      case "text":
        return "Text";
      default:
        return "Graphics";
    }
  };

  const getClipTypeIcon = () => {
    switch (clipType) {
      case "text":
        return <Type size={14} className="text-amber-400" aria-hidden />;
      default:
        return <Shapes size={14} className="text-green-400" aria-hidden />;
    }
  };

  return (
    <ContextMenuContent className="w-[200px] [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:text-xs"
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
      onMouseUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <ContextMenuLabel className="flex items-center gap-2 text-xs">{getClipTypeIcon()}{getClipTypeLabel()} Clip</ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={handleCopy}><Copy size={14} aria-hidden />Copy Clip</ContextMenuItem>
      <ContextMenuItem disabled={editingDisabled} onSelect={() => void handleDuplicate()}><Layers size={14} aria-hidden />Duplicate</ContextMenuItem>
      <ContextMenuItem onSelect={handleSelectTrackClips}><ListChecks size={14} aria-hidden />{isCaption ? "Select All Captions" : "Select All Clips on Track"}</ContextMenuItem>
      {(clipType === "text" || clipType === "shape" || clipType === "svg") && !isCaption && (
        <ContextMenuItem
          data-testid="replace-with-linked-composition"
          disabled={editingDisabled}
          onSelect={() => {
            if (!canAct(true)) return;
            if (!useUIStore.getState().getSelectedClipIds().includes(clip.id)) useUIStore.getState().select({ type: "clip", id: clip.id });
            void replaceSelectionWithLinkedComposition();
            onClose?.();
          }}
        ><Layers size={14} aria-hidden />Replace with Linked Composition</ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem disabled={editingDisabled} onSelect={() => void handleDelete()}><Trash2 size={14} aria-hidden />Delete</ContextMenuItem>
    </ContextMenuContent>
  );
}
