import React, { useEffect, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@openreel/ui";
import { Folder } from "@/icons/lucide-compat";
import { getMediaLabel, type MediaBin } from "@openreel/core";
import { useProjectPanelStore } from "../../../stores/project-panel-store";
import { useUIStore } from "../../../stores/ui-store";
import { moveToBin, renameBin, runOrganize, setBinLabel, createBin } from "../../../services/project-panel-commands";
import { moveSequencesToBinCommand } from "../../../services/sequence-commands";
import { LabelChip, LabelPickerItems } from "./ProjectPanelMenus";
import { hasPanelPayload, readPanelPayload, writeBinDrag } from "./dnd";

/** Make an element a bin drop target (null = project root). */
export function useBinDropTarget(binId: string | null) {
  const [isOver, setIsOver] = useState(false);
  return {
    isOver,
    handlers: {
      onDragOver: (event: React.DragEvent) => {
        if (!hasPanelPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setIsOver(true);
      },
      onDragLeave: (event: React.DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsOver(false);
      },
      onDrop: (event: React.DragEvent) => {
        setIsOver(false);
        if (!hasPanelPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const payload = readPanelPayload(event.dataTransfer);
        if (payload.sequenceIds.length) void moveSequencesToBinCommand(payload.sequenceIds, binId);
        if (payload.mediaIds.length || payload.binIds.length) void runOrganize("Move to bin", moveToBin(payload.mediaIds, payload.binIds, binId));
      },
    },
  };
}

/** Inline bin-name editor: Enter/blur commits, Escape cancels. */
export const BinNameEditor: React.FC<{ bin: MediaBin; className?: string }> = ({ bin, className }) => {
  const [value, setValue] = useState(bin.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    useProjectPanelStore.getState().setRenamingBin(null);
    if (commit) void runOrganize("Rename bin", renameBin(bin.id, value));
  };
  return (
    <input
      ref={ref}
      aria-label={`Rename bin ${bin.name}`}
      data-testid="bin-name-input"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(true);
        else if (event.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      className={`min-w-0 rounded-[4px] border border-accent bg-bg-0 px-1 text-[11.5px] text-fg outline-none ${className ?? ""}`}
    />
  );
};

/** Right-click menu for a bin (tile or list row). */
export const BinContextMenu: React.FC<{ bin: MediaBin; children: React.ReactNode }> = ({ bin, children }) => {
  const openBin = useProjectPanelStore((s) => s.openBin);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-[200px] [&_[role=menuitem]]:text-xs" data-testid="bin-context-menu">
        <ContextMenuItem onSelect={() => openBin(bin.id)}>Open</ContextMenuItem>
        <ContextMenuItem onSelect={() => useProjectPanelStore.getState().setRenamingBin(bin.id)}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={() => void createBin({ parentId: bin.id }).then(({ binId }) => binId && useProjectPanelStore.getState().setRenamingBin(binId))}>
          New bin inside
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Label</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-[320px] overflow-auto">
            <LabelPickerItems kind="context" current={bin.label} onPick={(label) => void runOrganize("Set label", setBinLabel(bin.id, label))} />
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem data-testid="bin-delete" onSelect={() => useProjectPanelStore.getState().openDialog({ kind: "delete-bin", binId: bin.id })}>
          Delete bin…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

/** Grid-view bin tile. */
export const BinTile: React.FC<{ bin: MediaBin; itemCount: number }> = ({ bin, itemCount }) => {
  const renaming = useProjectPanelStore((s) => s.renamingBinId === bin.id);
  const selected = useProjectPanelStore((s) => s.selectedBinIds.includes(bin.id));
  const drop = useBinDropTarget(bin.id);
  return (
    <BinContextMenu bin={bin}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Bin ${bin.name}`}
        data-testid="bin-tile"
        data-bin-id={bin.id}
        draggable={!renaming}
        onDragStart={(event) => writeBinDrag(event.dataTransfer, bin.id, useProjectPanelStore.getState().selectedBinIds)}
        onClick={(event) => {
          useUIStore.getState().clearSelection();
          const current = useProjectPanelStore.getState().selectedBinIds;
          useProjectPanelStore.getState().setSelectedBins(
            event.metaKey || event.ctrlKey ? (current.includes(bin.id) ? current.filter((id) => id !== bin.id) : [...current, bin.id]) : [bin.id],
          );
        }}
        onDoubleClick={() => useProjectPanelStore.getState().openBin(bin.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter") useProjectPanelStore.getState().openBin(bin.id);
          else if (event.key === "F2") useProjectPanelStore.getState().setRenamingBin(bin.id);
        }}
        {...drop.handlers}
        className="workspace-media-tile group relative flex cursor-pointer flex-col"
      >
        <div
          className={`workspace-media-thumbnail relative flex items-center justify-center border bg-bg-2 transition-colors ${
            drop.isOver ? "border-accent bg-accent-soft ring-1 ring-accent/50" : selected ? "border-accent ring-1 ring-accent/40" : "border-border hover:border-border-strong"
          }`}
        >
          <Folder size={34} className="text-fg-3" fill="currentColor" fillOpacity={0.18} style={{ color: getMediaLabel(bin.label)?.color }} aria-hidden />
          {bin.label && <LabelChip label={bin.label} className="absolute left-1.5 top-1.5" />}
          <span className="workspace-media-duration">{itemCount} {itemCount === 1 ? "item" : "items"}</span>
        </div>
        <div className="workspace-media-filename truncate text-fg-2" title={bin.name}>
          {renaming ? <BinNameEditor bin={bin} className="w-full" /> : bin.name}
        </div>
      </div>
    </BinContextMenu>
  );
};
