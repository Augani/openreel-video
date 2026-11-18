import React, { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@openreel/ui";
import { ChevronRight, Copy, Edit3, Layers, Plus, Trash2 } from "@/icons/lucide-compat";
import {
  countSequenceInstances,
  ensureSequences,
  sequenceContentDuration,
  type Sequence,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useProjectPanelStore } from "../../../stores/project-panel-store";
import { formatFrameTimecode } from "../../../utils/frame-timecode";
import {
  deleteSequenceCommand,
  duplicateSequenceCommand,
  newSequence,
  openSequence,
  renameSequenceCommand,
} from "../../../services/sequence-commands";
import { SEQUENCE_IDS_MIME } from "./dnd";
import type { ProjectPanelData } from "./useProjectPanelData";

const RowNameEditor: React.FC<{ sequence: Sequence; onDone: () => void }> = ({ sequence, onDone }) => {
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
      data-testid="sequence-row-input"
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
      className="h-[18px] min-w-0 flex-1 rounded-[3px] border border-accent bg-bg-0 px-1 text-[11.5px] text-fg outline-none"
    />
  );
};

/**
 * Sequences in the Project panel (filed into bins like media). Double-click
 * opens one in a tab; dragging one onto a timeline lane nests it; dragging
 * onto a bin files it.
 */
export const SequencesSection: React.FC<{ data: ProjectPanelData; trailing?: React.ReactNode }> = ({ data, trailing }) => {
  const { sequences: storedSequences, activeSequenceId, openSequenceIds, timeline, settings, compounds } = useProjectStore(
    useShallow((s) => ({
      sequences: s.project.sequences,
      activeSequenceId: s.project.activeSequenceId,
      openSequenceIds: s.project.openSequenceIds,
      timeline: s.project.timeline,
      settings: s.project.settings,
      compounds: s.project.compoundClips,
    })),
  );
  const query = useProjectPanelStore((s) => s.query);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const bins = useMemo(() => new Set(data.bins.map((bin) => bin.id)), [data.bins]);
  const project = useMemo(
    () => ensureSequences({ sequences: storedSequences, activeSequenceId, openSequenceIds, timeline, settings, compoundClips: compounds } as never),
    [storedSequences, activeSequenceId, openSequenceIds, timeline, settings, compounds],
  );
  const rows = useMemo(() => {
    const all = project.sequences ?? [];
    const needle = query.trim().toLowerCase();
    return all.filter((sequence) => {
      const home = sequence.binId && bins.has(sequence.binId) ? sequence.binId : null;
      return data.searching ? sequence.name.toLowerCase().includes(needle) : home === data.currentBinId;
    });
  }, [project, bins, data.currentBinId, data.searching, query]);

  // A lone sequence is already open in the timeline, so its row stays folded and
  // the media grid keeps the height; with two or more the list opens by itself.
  const collapsed = userCollapsed ?? rows.length <= 1;

  return (
    <section data-testid="sequences-section" className="shrink-0 border-b border-border/60 px-2 py-1.5">
      <div className="flex h-5 items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-fg-muted">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sequences" : "Collapse sequences"}
          onClick={() => setUserCollapsed(!collapsed)}
          className="flex items-center gap-1 hover:text-fg"
        >
          <ChevronRight size={11} aria-hidden className={collapsed ? "" : "rotate-90"} />
          Sequences
          <span className="font-normal normal-case text-fg-3">{rows.length}</span>
        </button>
        {trailing && <div className="ml-auto min-w-0">{trailing}</div>}
        <button
          type="button"
          aria-label="New sequence"
          data-testid="sequence-panel-new"
          onClick={() => void newSequence()}
          className={`${trailing ? "" : "ml-auto "}flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] hover:bg-bg-2 hover:text-fg`}
        >
          <Plus size={11} aria-hidden />
        </button>
      </div>
      {!collapsed && (
        <ul className="mt-0.5 flex flex-col gap-px" aria-label="Sequences">
          {rows.map((sequence) => {
            const active = sequence.id === project.activeSequenceId;
            const instances = countSequenceInstances(project, sequence.id);
            const duration = sequenceContentDuration(sequence.id === project.activeSequenceId ? project.timeline : sequence.timeline);
            return (
              <li key={sequence.id}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div
                      role="button"
                      tabIndex={0}
                      draggable={renamingId !== sequence.id}
                      data-testid="sequence-row"
                      data-sequence-id={sequence.id}
                      data-active={active}
                      aria-label={`Sequence ${sequence.name}`}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(SEQUENCE_IDS_MIME, JSON.stringify([sequence.id]));
                        event.dataTransfer.setData("application/json", JSON.stringify({ sequenceId: sequence.id }));
                        event.dataTransfer.effectAllowed = "copyMove";
                      }}
                      onDoubleClick={() => void openSequence(sequence.id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter") void openSequence(sequence.id);
                        else if (event.key === "F2") setRenamingId(sequence.id);
                      }}
                      className={`flex h-[26px] cursor-pointer items-center gap-2 rounded-[4px] px-1.5 text-[11.5px] ${
                        active ? "bg-accent-soft text-fg" : "text-fg-2 hover:bg-bg-2 hover:text-fg"
                      }`}
                    >
                      <span
                        className="flex h-[16px] w-[22px] shrink-0 items-center justify-center rounded-[3px] bg-bg-3"
                        style={sequence.color ? { color: sequence.color } : undefined}
                      >
                        <Layers size={11} aria-hidden />
                      </span>
                      {renamingId === sequence.id ? (
                        <RowNameEditor sequence={sequence} onDone={() => setRenamingId(null)} />
                      ) : (
                        <span className="min-w-0 flex-1 truncate" title={sequence.name}>{sequence.name}</span>
                      )}
                      <span className="shrink-0 font-mono text-[10px] text-fg-muted">{formatFrameTimecode(duration, sequence.id === project.activeSequenceId ? settings.frameRate : sequence.settings.frameRate)}</span>
                      {instances > 0 && (
                        <span className="shrink-0 rounded-[3px] bg-bg-3 px-1 text-[9.5px] text-fg-3" title={`Nested ${instances} time${instances === 1 ? "" : "s"}`}>
                          ×{instances}
                        </span>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-[200px] [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:text-xs" data-testid="sequence-row-menu">
                    <ContextMenuItem onSelect={() => void openSequence(sequence.id)}><Layers size={13} aria-hidden />Open in timeline</ContextMenuItem>
                    <ContextMenuItem onSelect={() => setRenamingId(sequence.id)}><Edit3 size={13} aria-hidden />Rename</ContextMenuItem>
                    <ContextMenuItem onSelect={() => void duplicateSequenceCommand(sequence.id)}><Copy size={13} aria-hidden />Duplicate</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem disabled={(project.sequences?.length ?? 0) <= 1} onSelect={() => void deleteSequenceCommand(sequence.id)}><Trash2 size={13} aria-hidden />Delete</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
