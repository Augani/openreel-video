import React from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@openreel/ui";
import {
  MEDIA_LABELS,
  binPath,
  binsOf,
  getMediaLabel,
  type MediaItem,
  type MediaLabelId,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useProjectPanelStore } from "../../../stores/project-panel-store";
import { useSourceMonitorStore } from "../../../stores/source-monitor-store";
import {
  makeSubclipFromSource,
  moveToBin,
  newBinFromSelection,
  runOrganize,
  setGoodTake,
  setMediaLabel,
  setSubclipRestrictTrims,
} from "../../../services/project-panel-commands";
import { toast } from "../../../stores/notification-store";

/** Small label colour square used in bins, lists and menus. */
export const LabelChip: React.FC<{ label?: MediaLabelId | null; className?: string }> = ({ label, className }) => {
  const def = getMediaLabel(label);
  return (
    <span
      data-testid="label-chip"
      data-label={def?.id ?? "none"}
      title={def?.name ?? "No label"}
      className={`inline-block size-2.5 shrink-0 rounded-[3px] ${def ? "" : "border border-border-strong"} ${className ?? ""}`}
      style={def ? { backgroundColor: def.color } : undefined}
    />
  );
};

/** The media ids a menu action applies to: the whole selection when the item is in it. */
export function actionTargetIds(itemId: string): string[] {
  const library = new Set(useProjectStore.getState().project.mediaLibrary.items.map((i) => i.id));
  const selected = useUIStore.getState().selectedItems.map((s) => s.id).filter((id) => library.has(id));
  return selected.includes(itemId) ? selected : [itemId];
}

type MenuKind = "context" | "dropdown";

const Item = ({ kind, ...props }: { kind: MenuKind } & React.ComponentProps<typeof ContextMenuItem>) =>
  kind === "context" ? <ContextMenuItem {...props} /> : <DropdownMenuItem {...(props as React.ComponentProps<typeof DropdownMenuItem>)} />;
const Separator = ({ kind }: { kind: MenuKind }) => (kind === "context" ? <ContextMenuSeparator /> : <DropdownMenuSeparator />);
const Sub = ({ kind, title, children, testId }: { kind: MenuKind; title: string; children: React.ReactNode; testId?: string }) =>
  kind === "context" ? (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid={testId}>{title}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-[320px] overflow-auto">{children}</ContextMenuSubContent>
    </ContextMenuSub>
  ) : (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid={testId}>{title}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[320px] overflow-auto">{children}</DropdownMenuSubContent>
    </DropdownMenuSub>
  );

/** Label colour picker entries, shared by media, bin and clip menus. */
export const LabelPickerItems: React.FC<{
  kind: MenuKind;
  current?: MediaLabelId | null;
  onPick: (label: MediaLabelId | null) => void;
  /** Extra "Inherit from media" entry (timeline clips). */
  onInherit?: () => void;
}> = ({ kind, current, onPick, onInherit }) => (
  <>
    {MEDIA_LABELS.map((label) => (
      <Item key={label.id} kind={kind} data-testid={`label-${label.id}`} onSelect={() => onPick(label.id)}>
        <LabelChip label={label.id} />
        <span className="ml-2">{label.name}</span>
        {current === label.id && <span className="ml-auto pl-3 text-accent">✓</span>}
      </Item>
    ))}
    <Separator kind={kind} />
    <Item kind={kind} data-testid="label-none" onSelect={() => onPick(null)}>
      <LabelChip label={null} />
      <span className="ml-2">None</span>
    </Item>
    {onInherit && (
      <Item kind={kind} data-testid="label-inherit" onSelect={onInherit}>
        <span className="ml-[22px]">Inherit from media</span>
      </Item>
    )}
  </>
);

/** Organise entries for a media item: label, move, subclip, rename, notes. */
export const MediaOrganizeItems: React.FC<{ item: MediaItem; kind: MenuKind }> = ({ item, kind }) => {
  const bins = useProjectStore((s) => s.project.bins);
  const allBins = React.useMemo(() => binsOf({ bins }), [bins]);
  const sourceMarks = useSourceMonitorStore((s) => s.marks[item.id]);
  const hasMarks = sourceMarks?.in !== undefined && sourceMarks?.out !== undefined;
  const canSubclip = item.type !== "image";
  const onLabel = (label: MediaLabelId | null) => void runOrganize("Set label", setMediaLabel(actionTargetIds(item.id), label));
  const onMove = (binId: string | null) => void runOrganize("Move to bin", moveToBin(actionTargetIds(item.id), [], binId));
  const openDialog = useProjectPanelStore.getState().openDialog;
  return (
    <>
      <Separator kind={kind} />
      <Sub kind={kind} title="Label" testId="menu-label">
        <LabelPickerItems kind={kind} current={item.label} onPick={onLabel} />
      </Sub>
      <Sub kind={kind} title="Move to bin" testId="menu-move">
        <Item kind={kind} data-testid="move-root" onSelect={() => onMove(null)}>
          Project root
        </Item>
        {allBins.map((bin) => (
          <Item key={bin.id} kind={kind} data-testid={`move-${bin.id}`} onSelect={() => onMove(bin.id)}>
            {binPath(allBins, bin.id).map((b) => b.name).join(" / ")}
          </Item>
        ))}
      </Sub>
      <Item kind={kind} data-testid="menu-new-bin-from-selection" onSelect={() => { if (!useUIStore.getState().isSelected(item.id)) useUIStore.getState().select({ type: "clip", id: item.id }); void newBinFromSelection(); }}>
        New bin from selection
      </Item>
      {canSubclip && (
        <Item
          kind={kind}
          data-testid="menu-make-subclip"
          disabled={!hasMarks}
          onSelect={() => {
            if (!hasMarks) return;
            // Marks live per media in the Source monitor store.
            void makeSubclipFromSource({}, item.id).then((outcome) => {
              if (!outcome.success) toast.warning("Make Subclip", outcome.message);
            });
          }}
        >
          Make Subclip from Source marks
        </Item>
      )}
      {item.subclip && kind === "context" && (
        <ContextMenuCheckboxItem
          checked={item.subclip.restrictTrims}
          onCheckedChange={(checked) => void runOrganize("Restrict trims", setSubclipRestrictTrims(item.id, checked === true))}
        >
          Restrict trims to subclip
        </ContextMenuCheckboxItem>
      )}
      {item.subclip && kind === "dropdown" && (
        <DropdownMenuItem onSelect={() => void runOrganize("Restrict trims", setSubclipRestrictTrims(item.id, !item.subclip!.restrictTrims))}>
          {item.subclip.restrictTrims ? "Allow trims beyond subclip" : "Restrict trims to subclip"}
        </DropdownMenuItem>
      )}
      <Separator kind={kind} />
      <Item kind={kind} onSelect={() => openDialog({ kind: "rename-media", mediaId: item.id })}>Rename…</Item>
      <Item kind={kind} onSelect={() => openDialog({ kind: "comment", mediaId: item.id })}>Comment…</Item>
      <Item kind={kind} onSelect={() => openDialog({ kind: "description", mediaId: item.id })}>Description…</Item>
      {item.type !== "audio" && (
        <Item kind={kind} data-testid="menu-interpret-footage" onSelect={() => openDialog({ kind: "interpret-footage", mediaId: item.id })}>
          Interpret Footage…
        </Item>
      )}
      {item.raw && (
        <Item kind={kind} data-testid="menu-raw-settings" onSelect={() => openDialog({ kind: "raw-settings", mediaId: item.id })}>
          RAW Source Settings…
        </Item>
      )}
      <Sub kind={kind} title="Log" testId="menu-log">
        <Item kind={kind} data-testid="menu-good-take" onSelect={() => void runOrganize("Good take", setGoodTake(actionTargetIds(item.id), !item.goodTake))}>
          {item.goodTake ? "Clear good take" : "Mark as good take"}
        </Item>
        <Item kind={kind} onSelect={() => openDialog({ kind: "scene", mediaId: item.id })}>Scene…</Item>
        <Item kind={kind} onSelect={() => openDialog({ kind: "shot", mediaId: item.id })}>Shot…</Item>
        <Item kind={kind} onSelect={() => openDialog({ kind: "take", mediaId: item.id })}>Take…</Item>
      </Sub>
    </>
  );
};

/** Right-click menu around any media tile or list row. */
export const MediaItemContextMenu: React.FC<{
  item: MediaItem;
  children: React.ReactNode;
  onOpenInSource: () => void;
  onAddToTimeline: () => void;
  onDelete: () => void;
}> = ({ item, children, onOpenInSource, onAddToTimeline, onDelete }) => (
  <ContextMenu
    onOpenChange={(open) => {
      // Right-clicking an unselected item selects it first, like a file browser.
      if (open && !useUIStore.getState().isSelected(item.id)) useUIStore.getState().select({ type: "clip", id: item.id });
    }}
  >
    <ContextMenuTrigger asChild><div className="contents">{children}</div></ContextMenuTrigger>
    <ContextMenuContent className="w-[230px] [&_[role=menuitem]]:text-xs" data-testid="media-context-menu">
      <ContextMenuItem onSelect={onOpenInSource}>Open in Source monitor</ContextMenuItem>
      <ContextMenuItem onSelect={onAddToTimeline}>Add to timeline</ContextMenuItem>
      <MediaOrganizeItems item={item} kind="context" />
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onDelete}>Delete</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
);
