import React, { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@openreel/ui";
import { Copy, Edit3, Layers, Plus, Trash2, X } from "@/icons/lucide-compat";
import { ensureSequences, type Sequence } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import {
  closeSequenceTabCommand,
  deleteSequenceCommand,
  duplicateSequenceCommand,
  newSequence,
  newSequenceFromMedia,
  makeSubsequenceCommand,
  nestSelectedClips,
  openSequence,
  renameSequenceCommand,
  reorderSequenceTab,
} from "../../../services/sequence-commands";

const TAB_MIME = "application/x-openreel-sequence-tab";

const PRESETS: ReadonlyArray<{ label: string; width: number; height: number }> = [
  { label: "1080p HD", width: 1920, height: 1080 },
  { label: "4K UHD", width: 3840, height: 2160 },
  { label: "Vertical 1080×1920", width: 1080, height: 1920 },
  { label: "Square 1080", width: 1080, height: 1080 },
];

/** Everything the tab strip renders, derived once per project change that matters to it. */
function useSequenceTabs() {
  const { sequences, activeSequenceId, openSequenceIds, timeline, settings } = useProjectStore(
    useShallow((s) => ({
      sequences: s.project.sequences,
      activeSequenceId: s.project.activeSequenceId,
      openSequenceIds: s.project.openSequenceIds,
      timeline: s.project.timeline,
      settings: s.project.settings,
    })),
  );
  return useMemo(() => {
    const ready = ensureSequences({ sequences, activeSequenceId, openSequenceIds, timeline, settings } as never);
    const byId = new Map<string, Sequence>((ready.sequences ?? []).map((sequence) => [sequence.id, sequence]));
    const tabs = (ready.openSequenceIds ?? []).flatMap((id) => (byId.has(id) ? [byId.get(id) as Sequence] : []));
    return { tabs, activeId: ready.activeSequenceId as string, total: byId.size };
  }, [sequences, activeSequenceId, openSequenceIds, timeline, settings]);
}

const SequenceNameEditor: React.FC<{ sequence: Sequence; onDone: () => void }> = ({ sequence, onDone }) => {
  const [value, setValue] = useState(sequence.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && value.trim() && value.trim() !== sequence.name) void renameSequenceCommand(sequence.id, value);
    onDone();
  };
  return (
    <input
      ref={ref}
      data-testid="sequence-name-input"
      aria-label={`Rename sequence ${sequence.name}`}
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
      className="h-[18px] w-[120px] min-w-0 rounded-[3px] border border-accent bg-bg-0 px-1 text-[11.5px] text-fg outline-none"
    />
  );
};

export const NewSequenceDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const settings = useProjectStore((s) => s.project.settings);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState(-1);
  const [fps, setFps] = useState(String(settings.frameRate));
  useEffect(() => {
    if (open) {
      setName("");
      setPreset(-1);
      setFps(String(settings.frameRate));
    }
  }, [open, settings.frameRate]);
  const chosen = preset >= 0 ? PRESETS[preset] : { width: settings.width, height: settings.height };
  const submit = async () => {
    const frameRate = Number(fps);
    const result = await newSequence({
      name: name.trim() || undefined,
      settings: { width: chosen.width, height: chosen.height, ...(frameRate > 0 ? { frameRate } : {}) },
    });
    if (result.ok) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[380px]" data-testid="new-sequence-dialog">
        <DialogHeader>
          <DialogTitle>New sequence</DialogTitle>
          <DialogDescription>Opens in its own tab. It starts empty with a video and an audio track.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2.5 text-xs">
          <label className="flex flex-col gap-1">
            Name
            <Input data-testid="new-sequence-name" value={name} placeholder="Sequence" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void submit()} />
          </label>
          <label className="flex flex-col gap-1">
            Settings
            <select
              data-testid="new-sequence-preset"
              value={preset}
              onChange={(event) => setPreset(Number(event.target.value))}
              className="h-8 rounded-md border border-border bg-bg-2 px-2 text-xs text-fg"
            >
              <option value={-1}>Same as current ({settings.width}×{settings.height})</option>
              {PRESETS.map((item, index) => (
                <option key={item.label} value={index}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Frame rate
            <Input data-testid="new-sequence-fps" inputMode="decimal" value={fps} onChange={(event) => setFps(event.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button data-testid="new-sequence-create" onClick={() => void submit()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Sequence tabs above the timeline: open, close, rename (double-click),
 * reorder (drag). Closing a tab never deletes the sequence; it stays in the
 * Project panel.
 */
export const SequenceTabs: React.FC = React.memo(function SequenceTabs() {
  const { tabs, activeId, total } = useSequenceTabs();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const library = useProjectStore((s) => s.project.mediaLibrary.items);
  const libraryIds = useMemo(() => new Set(library.map((item) => item.id)), [library]);
  // Primitive selectors: a timeline clip selection does not change either, so the tab strip skips that render.
  const selectedMediaId = useUIStore((s) => s.selectedItems.find((item) => libraryIds.has(item.id))?.id);
  const hasSelectedClips = useUIStore((s) => s.selectedItems.length > 0);

  return (
    <div
      role="tablist"
      aria-label="Sequences"
      data-testid="sequence-tabs"
      className="workspace-sequence-tabs flex h-[26px] shrink-0 items-stretch gap-px overflow-x-auto overflow-y-hidden border-b border-border bg-bg-0 px-1 scrollbar-none"
    >
      {tabs.map((sequence, index) => {
        const active = sequence.id === activeId;
        return (
          <ContextMenu key={sequence.id}>
            <ContextMenuTrigger asChild>
              <div
                role="tab"
                aria-selected={active}
                tabIndex={0}
                data-testid="sequence-tab"
                data-sequence-id={sequence.id}
                data-active={active}
                draggable={renamingId !== sequence.id}
                onDragStart={(event) => {
                  event.dataTransfer.setData(TAB_MIME, sequence.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(TAB_MIME)) return;
                  event.preventDefault();
                  setDragOver(sequence.id);
                }}
                onDragLeave={() => setDragOver((current) => (current === sequence.id ? null : current))}
                onDrop={(event) => {
                  setDragOver(null);
                  const id = event.dataTransfer.getData(TAB_MIME);
                  if (!id || id === sequence.id) return;
                  event.preventDefault();
                  void reorderSequenceTab(id, index);
                }}
                onClick={() => !active && void openSequence(sequence.id)}
                onDoubleClick={() => setRenamingId(sequence.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (!active) void openSequence(sequence.id);
                  } else if (event.key === "F2") setRenamingId(sequence.id);
                }}
                className={`group flex max-w-[190px] shrink-0 cursor-pointer select-none items-center gap-1.5 border-x border-t px-2 text-[11.5px] transition-colors ${
                  active
                    ? "border-border border-b-transparent bg-tl-bg text-fg shadow-[inset_0_2px_0_0_var(--accent,#10b981)]"
                    : "border-transparent text-fg-3 hover:bg-bg-2 hover:text-fg"
                } ${dragOver === sequence.id ? "ring-1 ring-inset ring-accent/70" : ""}`}
              >
                <Layers size={12} aria-hidden className={active ? "text-accent" : "text-fg-muted"} />
                {renamingId === sequence.id ? (
                  <SequenceNameEditor sequence={sequence} onDone={() => setRenamingId(null)} />
                ) : (
                  <span className="min-w-0 truncate" title={sequence.name} data-testid="sequence-tab-name">{sequence.name}</span>
                )}
                {tabs.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Close sequence ${sequence.name}`}
                    data-testid="sequence-tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeSequenceTabCommand(sequence.id);
                    }}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-fg-muted opacity-60 hover:bg-bg-3 hover:text-fg group-hover:opacity-100"
                  >
                    <X size={10} aria-hidden />
                  </button>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-[190px] [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:text-xs" data-testid="sequence-tab-menu">
              <ContextMenuItem onSelect={() => setRenamingId(sequence.id)}><Edit3 size={13} aria-hidden />Rename</ContextMenuItem>
              <ContextMenuItem onSelect={() => void duplicateSequenceCommand(sequence.id)}><Copy size={13} aria-hidden />Duplicate</ContextMenuItem>
              <ContextMenuItem disabled={tabs.length <= 1} onSelect={() => void closeSequenceTabCommand(sequence.id)}><X size={13} aria-hidden />Close tab</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={total <= 1} onSelect={() => void deleteSequenceCommand(sequence.id)}><Trash2 size={13} aria-hidden />Delete sequence</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="New sequence"
            data-testid="sequence-tab-new"
            className="my-auto ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-fg-3 hover:bg-bg-2 hover:text-fg"
          >
            <Plus size={12} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[230px] [&_[role=menuitem]]:text-xs" data-testid="sequence-new-menu">
          <DropdownMenuItem onSelect={() => void newSequence()}>New sequence</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>New sequence with settings…</DropdownMenuItem>
          <DropdownMenuItem disabled={!selectedMediaId} onSelect={() => selectedMediaId && void newSequenceFromMedia(selectedMediaId)}>
            New sequence from selected media
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!hasSelectedClips} onSelect={() => void nestSelectedClips()}>Nest selected clips</DropdownMenuItem>
          <DropdownMenuItem data-testid="make-subsequence" onSelect={() => void makeSubsequenceCommand()}>Make subsequence from In/Out or selection</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewSequenceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
});
