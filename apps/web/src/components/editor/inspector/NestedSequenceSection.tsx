import React, { useState, useCallback, useMemo, useEffect } from "react";
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
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import type { Clip, CompoundClip } from "@openreel/core";

interface NestedSequenceSectionProps {
  clipId: string;
}

export const NestedSequenceSection: React.FC<NestedSequenceSectionProps> = ({
  clipId,
}) => {
  const getNestedSequenceEngine = useEngineStore(
    (state) => state.getNestedSequenceEngine,
  );
  const project = useProjectStore((state) => state.project);
  const selectedClipIds = useUIStore((state) => state.getSelectedClipIds());

  const [expandedCompound, setExpandedCompound] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [nestedSequenceEngine, setNestedSequenceEngine] =
    useState<import("@openreel/core").NestedSequenceEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadEngine = async () => {
      const engine = await getNestedSequenceEngine();
      if (!cancelled) {
        setNestedSequenceEngine(engine);
      }
    };
    loadEngine();
    return () => {
      cancelled = true;
    };
  }, [getNestedSequenceEngine]);

  useEffect(() => {
    nestedSequenceEngine?.loadState(
      project.compoundClips ?? [],
      project.nestedInstances ?? [],
    );
  }, [nestedSequenceEngine, project.compoundClips, project.nestedInstances]);

  const allCompoundClips = project.compoundClips ?? [];

  const currentInstance = useMemo(() => {
    return (project.nestedInstances ?? []).find((instance) => instance.id === clipId) ?? null;
  }, [project.nestedInstances, clipId]);

  const currentCompound = useMemo(() => {
    if (!currentInstance) return null;
    return allCompoundClips.find((compound) => compound.id === currentInstance.compoundClipId) ?? null;
  }, [allCompoundClips, currentInstance]);

  const selectedClips = useMemo(() => {
    const clips: Array<{
      id: string;
      trackId: string;
      startTime: number;
      duration: number;
    }> = [];
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (selectedClipIds.includes(clip.id)) {
          clips.push({
            id: clip.id,
            trackId: track.id,
            startTime: clip.startTime,
            duration: clip.duration,
          });
        }
      }
    }
    return clips;
  }, [project.timeline.tracks, selectedClipIds]);

  const handleCreateCompound = useCallback(async () => {
    if (!nestedSequenceEngine || selectedClips.length < 2) return;

    const fullClips = [];
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (selectedClipIds.includes(clip.id)) {
          fullClips.push(clip);
        }
      }
    }

    if (fullClips.length < 2) return;

    const compound = nestedSequenceEngine.createCompoundClip(
      fullClips,
      project.timeline.tracks,
    );
    const firstClip = [...fullClips].sort(
      (left, right) => left.startTime - right.startTime,
    )[0];
    const instance = nestedSequenceEngine.createInstance(
      compound.id,
      firstClip.trackId,
      firstClip.startTime,
    );
    if (!instance) return;
    const instanceClip: Clip = {
      id: instance.id,
      mediaId: `compound:${compound.id}`,
      trackId: instance.trackId,
      startTime: instance.startTime,
      duration: instance.duration,
      inPoint: instance.inPoint,
      outPoint: instance.outPoint,
      transform: instance.transform,
      volume: instance.volume,
      effects: [],
      audioEffects: [],
      keyframes: [],
      metadata: {
        compoundClipId: compound.id,
        compoundClipName: compound.name,
        compoundClipColor: compound.color,
      },
    };

    const store = useProjectStore.getState();
    store.beginHistoryGroup("Create compound clip");
    try {
      for (const selectedId of selectedClipIds) {
        await useProjectStore.getState().executeAction({
          type: "clip/remove",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: { clipId: selectedId },
        });
      }
      await useProjectStore.getState().executeAction({
        type: "nested/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: {
          compoundClips: nestedSequenceEngine.getAllCompoundClips(),
          instances: nestedSequenceEngine.getAllInstances(),
        },
      });
      await useProjectStore.getState().executeAction({
        type: "clip/restore",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clip: instanceClip },
      });
    } finally {
      useProjectStore.getState().endHistoryGroup();
    }

    setExpandedCompound(compound.id);
    useUIStore.getState().select({ id: instance.id, type: "clip" });
  }, [
    nestedSequenceEngine,
    selectedClips,
    selectedClipIds,
    project.timeline.tracks,
  ]);

  const handleFlatten = useCallback(async () => {
    if (!nestedSequenceEngine || !clipId) return;

    const result = nestedSequenceEngine.flattenInstance(clipId);
    if (result) {
      useProjectStore.getState().beginHistoryGroup("Flatten compound clip");
      try {
        await useProjectStore.getState().executeAction({
          type: "clip/remove",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: { clipId },
        });
        for (const flattened of result.clips) {
          await useProjectStore.getState().executeAction({
            type: "clip/add",
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            params: {
              trackId: flattened.trackId,
              mediaId: flattened.mediaId,
              startTime: flattened.startTime,
              sourceClip: flattened,
            },
          });
        }
        await useProjectStore.getState().executeAction({
          type: "nested/setAll",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: {
            compoundClips: nestedSequenceEngine.getAllCompoundClips(),
            instances: nestedSequenceEngine.getAllInstances(),
          },
        });
      } finally {
        useProjectStore.getState().endHistoryGroup();
      }
    }
  }, [nestedSequenceEngine, clipId]);

  const handleDuplicate = useCallback(
    (compoundId: string) => {
      if (!nestedSequenceEngine) return;

      nestedSequenceEngine.duplicateCompoundClip(compoundId);
      void useProjectStore.getState().executeAction({
        type: "nested/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: {
          compoundClips: nestedSequenceEngine.getAllCompoundClips(),
          instances: nestedSequenceEngine.getAllInstances(),
        },
      });
    },
    [nestedSequenceEngine],
  );

  const handleDelete = useCallback(
    (compoundId: string) => {
      if (!nestedSequenceEngine) return;

      const success = nestedSequenceEngine.deleteCompoundClip(compoundId);
      if (success) {
        void useProjectStore.getState().executeAction({
          type: "nested/setAll",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: {
            compoundClips: nestedSequenceEngine.getAllCompoundClips(),
            instances: nestedSequenceEngine.getAllInstances(),
          },
        });
        if (expandedCompound === compoundId) {
          setExpandedCompound(null);
        }
      }
    },
    [nestedSequenceEngine, expandedCompound],
  );

  const handleStartRename = useCallback((compound: CompoundClip) => {
    setRenamingId(compound.id);
    setRenameValue(compound.name);
  }, []);

  const handleConfirmRename = useCallback(() => {
    if (!nestedSequenceEngine || !renamingId) return;

    nestedSequenceEngine.renameCompoundClip(renamingId, renameValue.trim());
    void useProjectStore.getState().executeAction({
      type: "nested/setAll",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      params: {
        compoundClips: nestedSequenceEngine?.getAllCompoundClips() ?? [],
        instances: nestedSequenceEngine?.getAllInstances() ?? [],
      },
    });
    setRenamingId(null);
    setRenameValue("");
  }, [nestedSequenceEngine, renamingId, renameValue]);

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-2 bg-gradient-to-r bg-primary/10 rounded-lg border border-primary/30">
        <Layers size={16} className="text-primary" />
        <div className="flex-1 flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-fg">
            Nested Sequences
          </span>
          <Text type="supporting" color="secondary" className="text-[9px] text-fg-3">
            Create compound clips from selections
          </Text>
        </div>
      </div>

      {currentCompound && (
        <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="text-primary" />
            <span className="text-[11px] font-medium text-fg">
              {currentCompound.name}
            </span>
          </div>
          <div className="flex gap-2 text-[9px] text-fg-3">
            <span>{currentCompound.content.clips.length} clips</span>
            <span>•</span>
            <span>{formatDuration(currentCompound.content.duration)}</span>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              label="Flatten"
              variant="ghost"
              icon={<Maximize2 size={10} />}
              onClick={handleFlatten}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-bg-2 rounded text-[10px] text-fg-2 hover:text-fg transition-colors"
            />
            <Button
              label="Duplicate"
              variant="ghost"
              icon={<Copy size={10} />}
              onClick={() => handleDuplicate(currentCompound.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-bg-2 rounded text-[10px] text-fg-2 hover:text-fg transition-colors"
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-fg-2">
            Create Compound Clip
          </span>
          <span className="text-[9px] text-fg-3">
            {selectedClips.length} clips selected
          </span>
        </div>
        <Button
          label="Create Compound Clip"
          variant="ghost"
          icon={<Plus size={14} />}
          onClick={handleCreateCompound}
          isDisabled={selectedClips.length < 2}
          className={`w-full py-2.5 rounded-lg text-[11px] font-medium flex items-center justify-center gap-2 transition-colors ${
            selectedClips.length >= 2
              ? "bg-primary/20 border border-primary/30 text-primary hover:bg-primary/20"
              : "bg-bg-2 text-fg-3 cursor-not-allowed"
          }`}
        />
        {selectedClips.length < 2 && (
          <Text type="supporting" color="secondary" className="text-[9px] text-fg-3 text-center">
            Select 2+ clips to create a compound clip
          </Text>
        )}
      </div>

      {allCompoundClips.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-medium text-fg-2">
            Compound Clips Library
          </span>
          <div className="space-y-1.5">
            {allCompoundClips.map((compound) => {
              const instanceCount =
                nestedSequenceEngine?.getInstanceCount(compound.id) || 0;
              const isExpanded = expandedCompound === compound.id;
              const isRenaming = renamingId === compound.id;

              return (
                <div
                  key={compound.id}
                  className="bg-bg-2 rounded-lg overflow-hidden"
                >
                  <div
                    className="flex items-center gap-2 p-2 cursor-pointer hover:bg-bg-1 transition-colors"
                    onClick={() =>
                      setExpandedCompound(isExpanded ? null : compound.id)
                    }
                  >
                    <ChevronRight
                      size={12}
                      className={`text-fg-3 transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                    <div
                      className="w-3 h-3 rounded"
                      style={{ backgroundColor: compound.color }}
                    />
                    {isRenaming ? (
                      <ToolcraftTextInputControl
                        label="Compound clip name"
                        isLabelHidden
                        value={renameValue}
                        onChange={setRenameValue}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleConfirmRename();
                          if (e.key === "Escape") handleCancelRename();
                        }}
                        className="flex-1 bg-bg-1 px-1.5 py-0.5 rounded text-[10px] text-fg outline-none border border-primary"
                        hasAutoFocus
                      />
                    ) : (
                      <span className="flex-1 text-[10px] text-fg truncate">
                        {compound.name}
                      </span>
                    )}
                    <span className="text-[9px] text-fg-3">
                      {instanceCount} instance{instanceCount !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="px-2 pb-2 space-y-2">
                      <div className="flex gap-2 text-[9px] text-fg-3 pl-5">
                        <span>{compound.content.clips.length} clips</span>
                        <span>•</span>
                        <span>{formatDuration(compound.content.duration)}</span>
                        <span>•</span>
                        <span>{compound.content.tracks.length} tracks</span>
                      </div>

                      <div className="flex gap-1 pl-5">
                        {isRenaming ? (
                          <>
                            <IconButton
                              label="Confirm rename"
                              icon={<Check size={10} />}
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConfirmRename();
                              }}
                              className="p-1.5 bg-green-500/20 rounded text-green-400 hover:bg-green-500/30 transition-colors"
                            />
                            <IconButton
                              label="Cancel rename"
                              icon={<X size={10} />}
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCancelRename();
                              }}
                              className="p-1.5 bg-red-500/20 rounded text-red-400 hover:bg-red-500/30 transition-colors"
                            />
                          </>
                        ) : (
                          <>
                            <IconButton
                              label="Rename"
                              icon={<Edit3 size={10} />}
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartRename(compound);
                              }}
                              className="p-1.5 bg-bg-1 rounded text-fg-3 hover:text-fg transition-colors"
                            />
                            <IconButton
                              label="Duplicate"
                              icon={<Copy size={10} />}
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicate(compound.id);
                              }}
                              className="p-1.5 bg-bg-1 rounded text-fg-3 hover:text-fg transition-colors"
                            />
                            <IconButton
                              label={
                                instanceCount > 0
                                  ? "Cannot delete - has instances"
                                  : "Delete"
                              }
                              icon={<Trash2 size={10} />}
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(compound.id);
                              }}
                              isDisabled={instanceCount > 0}
                              className={`p-1.5 rounded transition-colors ${
                                instanceCount > 0
                                  ? "bg-bg-1 text-fg-3 cursor-not-allowed opacity-50"
                                  : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                              }`}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <Text type="supporting" color="secondary" className="text-[9px] text-fg-3 text-center">
          Group clips into reusable compound clips
        </Text>
      </div>
    </div>
  );
};

export default NestedSequenceSection;
