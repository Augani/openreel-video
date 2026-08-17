import React from "react";
import type { ToolcraftContextMenuOption as ContextMenuOption } from "@openreel/ui";
import {
  Layers,
  Trash2,
  Shapes,
  Type,
} from "@/icons/lucide-compat";
import type { ShapeClip, SVGClip, StickerClip, TextClip } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { t } from "../../../i18n";

type GraphicsClipType = ShapeClip | SVGClip | StickerClip | TextClip;

interface GraphicsClipContextMenuProps {
  clip: GraphicsClipType;
  clipType: "shape" | "svg" | "sticker" | "emoji" | "text";
  onClose?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}

export function useGraphicsClipContextMenuItems({
  clip,
  clipType,
  onClose,
  onDelete,
  onDuplicate,
}: GraphicsClipContextMenuProps): ContextMenuOption[] {
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
        return <Type size={14} className="text-amber-400" aria-hidden />;
      default:
        return <Shapes size={14} className="text-green-400" aria-hidden />;
    }
  };

  const items: ContextMenuOption[] = [
    {
      type: "section",
      title: `${getClipTypeLabel()} Clip`,
      items: [
        {
          label: `${getClipTypeLabel()} Clip`,
          icon: getClipTypeIcon(),
          isDisabled: true,
        },
      ],
    },
    { type: "divider" },
  ];

  if (onDuplicate) {
    items.push(
      {
        label: t("Duplicate"),
        icon: <Layers size={14} aria-hidden />,
        onClick: handleDuplicate,
      },
      { type: "divider" },
    );
  }

  items.push({
    label: t("Delete"),
    icon: <Trash2 size={14} aria-hidden />,
    onClick: handleDelete,
  });

  return items;
}

export const GraphicsClipContextMenu: React.FC<GraphicsClipContextMenuProps> = (props) => {
  useGraphicsClipContextMenuItems(props);
  return null;
};
