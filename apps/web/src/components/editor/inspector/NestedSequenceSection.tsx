import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Badge,
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
} from "@openreel/ui";
import {
  Layers,
  FolderOpen,
  Plus,
  Copy,
  Trash2,
  Edit3,
  Maximize2,
  ChevronRight,
  Check,
  X,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { toast } from "../../../stores/notification-store";
import {
  createEditorCompound,
  editEditorCompound,
  flattenEditorCompound,
  ownsAdvancedLayerScope,
  type AdvancedLayerScope,
} from "../../../services/advanced-layer-edit";
import type { CompoundClip, CompoundClipInstance } from "@openreel/core";

const EMPTY_COMPOUNDS: CompoundClip[] = [],
  EMPTY_INSTANCES: CompoundClipInstance[] = [];
interface NestedSequenceSectionProps {
  clipId: string;
}
export const NestedSequenceSection: React.FC<NestedSequenceSectionProps> = ({
  clipId,
}) => {
  const compounds = useProjectStore(
    (state) => state.project.compoundClips ?? EMPTY_COMPOUNDS,
  );
  const instances = useProjectStore(
    (state) => state.project.nestedInstances ?? EMPTY_INSTANCES,
  );
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const projectId = useProjectStore((state) => state.project.id),
    executor = useProjectStore((state) => state.actionExecutor);
  const hasProject = useProjectStore((state) => state.hasOpenProject);
  const selection = useUIStore((state) =>
    JSON.stringify(state.getSelectedClipIds()),
  );
  const selected = useMemo(
    () => new Set(JSON.parse(selection) as string[]),
    [selection],
  );
  const clips = useMemo(
    () =>
      tracks
        .flatMap((track) => track.clips)
        .filter((clip) => selected.has(clip.id)),
    [tracks, selected],
  );
  const locked = useMemo(
    () =>
      new Set(tracks.filter((track) => track.locked).map((track) => track.id)),
    [tracks],
  );
  const exporting = useUIStore((state) => state.exportState.isExporting),
    processing = useUIStore((state) => state.effectApplicationClipId !== null);
  const playbackLocked = useTimelineStore(
    (state) => !!state.playbackLockedReason,
  );
  const session = useMemo(
    () => ({ key: crypto.randomUUID(), scope: { projectId, executor } }),
    [projectId, executor],
  );
  return (
    <NestedControls
      key={`${session.key}:${clipId}`}
      scope={session.scope}
      clipId={clipId}
      compounds={compounds}
      instances={instances}
      selectedClipIds={clips.map((clip) => clip.id)}
      selection={selection}
      selectionLocked={clips.some((clip) => locked.has(clip.trackId))}
      lockedTracks={locked}
      disabled={!hasProject || exporting || processing || playbackLocked}
    />
  );
};

function NestedControls({
  scope,
  clipId,
  compounds,
  instances,
  selectedClipIds,
  selection,
  selectionLocked,
  lockedTracks,
  disabled,
}: {
  scope: AdvancedLayerScope;
  clipId: string;
  compounds: CompoundClip[];
  instances: CompoundClipInstance[];
  selectedClipIds: string[];
  selection: string;
  selectionLocked: boolean;
  lockedTracks: Set<string>;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null),
    [name, setName] = useState("");
  const [busy, setBusy] = useState(false),
    busyRef = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = instances.find((instance) => instance.id === clipId),
    compound = compounds.find((item) => item.id === current?.compoundClipId);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const instance of instances)
      map.set(
        instance.compoundClipId,
        (map.get(instance.compoundClipId) ?? 0) + 1,
      );
    return map;
  }, [instances]);
  const unavailable = disabled || busy;
  const run = useCallback(
    async (operation: () => Promise<void>) => {
      if (busyRef.current || disabled || !ownsAdvancedLayerScope(scope)) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await operation();
      } catch (error) {
        if (mounted.current && ownsAdvancedLayerScope(scope))
          toast.error(
            "Compound edit failed",
            error instanceof Error
              ? error.message
              : "The edit could not be applied.",
          );
      } finally {
        busyRef.current = false;
        if (mounted.current && ownsAdvancedLayerScope(scope)) setBusy(false);
      }
    },
    [disabled, scope],
  );
  const visible = () => mounted.current && ownsAdvancedLayerScope(scope);
  const create = () =>
    void run(async () => {
      const result = await createEditorCompound(scope, selectedClipIds);
      if (!result || !ownsAdvancedLayerScope(scope)) return;
      if (visible()) setExpanded(result.compoundId);
      if (
        JSON.stringify(useUIStore.getState().getSelectedClipIds()) === selection
      )
        useUIStore.getState().select({ id: result.instanceId, type: "clip" });
    });
  const duplicate = (id: string) =>
    void run(async () => {
      const copied = await editEditorCompound(scope, id, { type: "duplicate" });
      if (copied && visible()) setExpanded(copied);
    });
  const confirm = () => {
    if (!renaming || !name.trim()) return;
    const id = renaming;
    void run(async () => {
      await editEditorCompound(scope, id, { type: "rename", name });
      if (visible()) {
        setRenaming(null);
        setName("");
      }
    });
  };
  const duration = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0")}`;
  return (
    <div className="space-y-3" aria-busy={busy}>
      <Card className="flex items-center gap-2 rounded-[7px] border-primary/30 bg-primary/10 p-2 shadow-none">
        <Layers size={16} aria-hidden className="text-primary" />
        <div>
          <span className="block text-[11px] font-medium text-fg">
            Nested Sequences
          </span>
          <span className="block text-[9px] text-fg-3">
            Create compound clips from selections
          </span>
        </div>
      </Card>
      {compound && (
        <Card className="space-y-2 rounded-[7px] border-primary/20 bg-primary/10 p-3 shadow-none">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} aria-hidden className="text-primary" />
            <span className="text-[11px] font-medium text-fg">
              {compound.name}
            </span>
          </div>
          <p className="text-[9px] text-fg-3">
            {compound.content.clips.length} clips ·{" "}
            {duration(compound.content.duration)}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={
                unavailable || (!!current && lockedTracks.has(current.trackId))
              }
              onClick={() =>
                void run(async () => {
                  const before = new Set(
                    useProjectStore
                      .getState()
                      .project.timeline.tracks.flatMap((track) =>
                        track.clips.map((clip) => clip.id),
                      ),
                  );
                  const selected = JSON.stringify(
                    useUIStore.getState().getSelectedClipIds(),
                  );
                  const applied = await flattenEditorCompound(scope, clipId);
                  if (
                    applied &&
                    ownsAdvancedLayerScope(scope) &&
                    JSON.stringify(
                      useUIStore.getState().getSelectedClipIds(),
                    ) === selected
                  ) {
                    const clips = useProjectStore
                      .getState()
                      .project.timeline.tracks.flatMap((track) => track.clips)
                      .filter((clip) => !before.has(clip.id));
                    useUIStore.getState().selectMultiple(
                      clips.map((clip) => ({
                        type: "clip",
                        id: clip.id,
                        trackId: clip.trackId,
                      })),
                    );
                  }
                })
              }
            >
              <Maximize2 size={10} aria-hidden />
              Flatten
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              aria-label="Duplicate current compound"
              disabled={unavailable}
              onClick={() => duplicate(compound.id)}
            >
              <Copy size={10} aria-hidden />
              Duplicate
            </Button>
          </div>
        </Card>
      )}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-fg-2">
            Create Compound Clip
          </span>
          <Badge variant="secondary" className="text-[9px] font-normal">
            {selectedClipIds.length} clips selected
          </Badge>
        </div>
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={
            unavailable || selectionLocked || selectedClipIds.length < 2
          }
          onClick={create}
        >
          <Plus size={14} aria-hidden />
          Create Compound Clip
        </Button>
        {selectedClipIds.length < 2 && (
          <p className="text-center text-[9px] text-fg-3">
            Select 2+ clips to create a compound clip
          </p>
        )}
      </div>
      {compounds.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-medium text-fg-2">
            Compound Clips Library
          </span>
          <div className="space-y-1.5">
            {compounds.map((item) => {
              const count = counts.get(item.id) ?? 0,
                open = expanded === item.id,
                editing = renaming === item.id;
              return (
                <Collapsible
                  key={item.id}
                  open={open}
                  onOpenChange={(value) => setExpanded(value ? item.id : null)}
                >
                  <Card className="overflow-hidden rounded-[7px] border-transparent bg-bg-2 p-0 shadow-none">
                    <div className="flex items-center gap-2 p-2">
                      <CollapsibleTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size={editing ? "icon-sm" : "sm"}
                          aria-label={`${open ? "Collapse" : "Expand"} ${item.name}`}
                          className={
                            editing
                              ? "shrink-0"
                              : "h-auto min-w-0 flex-1 justify-start gap-2 p-0 text-[10px] font-normal"
                          }
                        >
                          <ChevronRight
                            size={12}
                            aria-hidden
                            className={open ? "rotate-90" : ""}
                          />
                          {!editing && (
                            <>
                              <span
                                aria-hidden
                                className="h-3 w-3 shrink-0 rounded"
                                style={{ backgroundColor: item.color }}
                              />
                              <span className="truncate">{item.name}</span>
                            </>
                          )}
                        </Button>
                      </CollapsibleTrigger>
                      {editing && (
                        <Input
                          autoFocus
                          aria-label="Compound clip name"
                          value={name}
                          disabled={busy}
                          onChange={(event) => setName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              confirm();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              setRenaming(null);
                              setName("");
                            }
                          }}
                          className="h-7 min-w-0 flex-1 text-[10px] md:text-[10px]"
                        />
                      )}
                      <span className="shrink-0 text-[9px] text-fg-3">
                        {count} instance{count !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <CollapsibleContent className="space-y-2 px-2 pb-2">
                      <p className="pl-5 text-[9px] text-fg-3">
                        {item.content.clips.length} clips ·{" "}
                        {duration(item.content.duration)} ·{" "}
                        {item.content.tracks.length} tracks
                      </p>
                      <div className="flex gap-1 pl-5">
                        {editing ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Confirm rename"
                              disabled={unavailable || !name.trim()}
                              onClick={confirm}
                            >
                              <Check size={10} aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Cancel rename"
                              disabled={busy}
                              onClick={() => {
                                setRenaming(null);
                                setName("");
                              }}
                            >
                              <X size={10} aria-hidden />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Rename ${item.name}`}
                              disabled={unavailable}
                              onClick={() => {
                                setRenaming(item.id);
                                setName(item.name);
                              }}
                            >
                              <Edit3 size={10} aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Duplicate ${item.name}`}
                              disabled={unavailable}
                              onClick={() => duplicate(item.id)}
                            >
                              <Copy size={10} aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={
                                count > 0
                                  ? "Cannot delete - has instances"
                                  : `Delete ${item.name}`
                              }
                              disabled={unavailable || count > 0}
                              className="text-red-400"
                              onClick={() =>
                                void run(async () => {
                                  const deleted = await editEditorCompound(
                                    scope,
                                    item.id,
                                    { type: "delete" },
                                  );
                                  if (deleted && visible()) setExpanded(null);
                                })
                              }
                            >
                              <Trash2 size={10} aria-hidden />
                            </Button>
                          </>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>
        </div>
      )}
      <p className="border-t border-border pt-2 text-center text-[9px] text-fg-3">
        Group clips into reusable compound clips
      </p>
    </div>
  );
}
