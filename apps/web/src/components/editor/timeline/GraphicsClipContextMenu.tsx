import React from "react";
import {
  Layers,
  Trash2,
  Shapes,
  Type,
} from "lucide-react";
import type { ShapeClip, SVGClip, StickerClip, TextClip } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuLabel,
} from "@openreel/ui";

type GraphicsClipType = ShapeClip | SVGClip | StickerClip | TextClip;

interface GraphicsClipContextMenuProps {
  clip: GraphicsClipType;
  clipType: "shape" | "svg" | "sticker" | "emoji" | "text";
  onClose?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}

export const GraphicsClipContextMenu: React.FC<GraphicsClipContextMenuProps> = ({
  clip,
  clipType,
  onClose,
  onDelete,
  onDuplicate,
}) => {
  const {
    deleteShapeClip,
    deleteSVGClip,
    deleteStickerClip,
    deleteTextClip,
  } = useProjectStore();

  const handleDelete = () => {
    if (onDelete) {
      onDelete();
    } else {
      switch (clipType) {
        case "shape":
          deleteShapeClip(clip.id);
          break;
        case "svg":
          deleteSVGClip(clip.id);
          break;
        case "sticker":
        case "emoji":
          deleteStickerClip(clip.id);
          break;
        case "text":
          deleteTextClip(clip.id);
          break;
      }
    }
    onClose?.();
  };

  const handleDuplicate = () => {
    onDuplicate?.();
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
        return <Type className="mr-2 h-3 w-3 text-amber-400" />;
      default:
        return <Shapes className="mr-2 h-3 w-3 text-green-400" />;
    }
  };

  return (
    <ContextMenuContent className="min-w-[200px]">
      <ContextMenuLabel className="flex items-center text-[10px] text-text-muted">
        {getClipTypeIcon()}
        {getClipTypeLabel()} Clip
      </ContextMenuLabel>
      <ContextMenuSeparator />

      {onDuplicate && (
        <>
          <ContextMenuItem onClick={handleDuplicate}>
            <Layers className="mr-2 h-4 w-4" />
            Duplicate
            <ContextMenuShortcut>⌘D</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}

      <ContextMenuItem onClick={handleDelete} className="text-red-400">
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  );
};
