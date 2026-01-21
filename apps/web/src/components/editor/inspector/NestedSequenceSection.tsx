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
} from "lucide-react";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import type { CompoundClip } from "@openreel/core";

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

  const allCompoundClips = useMemo(() => {
    return nestedSequenceEngine?.getAllCompoundClips() || [];
  }, [nestedSequenceEngine]);

  const currentInstance = useMemo(() => {
    if (!nestedSequenceEngine) return null;
    return nestedSequenceEngine.getInstance(clipId);
  }, [nestedSequenceEngine, clipId]);

  const currentCompound = useMemo(() => {
    if (!nestedSequenceEngine || !currentInstance) return null;
    return nestedSequenceEngine.getCompoundClip(currentInstance.compoundClipId);
  }, [nestedSequenceEngine, currentInstance]);

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

  const handleCreateCompound = useCallback(() => {
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

    useProjectStore.setState((state) => ({
      project: { ...state.project, modifiedAt: Date.now() },
    }));

    setExpandedCompound(compound.id);
  }, [
    nestedSequenceEngine,
    selectedClips,
    selectedClipIds,
    project.timeline.tracks,
  ]);

  const handleFlatten = useCallback(() => {
    if (!nestedSequenceEngine || !clipId) return;

    const result = nestedSequenceEngine.flattenInstance(clipId);
    if (result) {
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    }
  }, [nestedSequenceEngine, clipId]);

  const handleDuplicate = useCallback(
    (compoundId: string) => {
      if (!nestedSequenceEngine) return;

      nestedSequenceEngine.duplicateCompoundClip(compoundId);
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [nestedSequenceEngine],
  );

  const handleDelete = useCallback(
    (compoundId: string) => {
      if (!nestedSequenceEngine) return;

      const success = nestedSequenceEngine.deleteCompoundClip(compoundId);
      if (success) {
        useProjectStore.setState((state) => ({
          project: { ...state.project, modifiedAt: Date.now() },
        }));
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
    useProjectStore.setState((state) => ({
      project: { ...state.project, modifiedAt: Date.now() },
    }));
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
        <div className="flex-1">
          <span className="text-[11px] font-medium text-text-primary">
            Nested Sequences
          </span>
          <p className="text-[9px] text-text-muted">
            Create compound clips from selections
          </p>
        </div>
      </div>

      {currentCompound && (
        <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="text-primary" />
            <span className="text-[11px] font-medium text-text-primary">
              {currentCompound.name}
            </span>
          </div>
          <div className="flex gap-2 text-[9px] text-text-muted">
            <span>{currentCompound.content.clips.length} clips</span>
            <span>•</span>
            <span>{formatDuration(currentCompound.content.duration)}</span>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleFlatten}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-background-tertiary rounded text-[10px] text-text-secondary hover:text-text-primary transition-colors"
            >
              <Maximize2 size={10} />
              Flatten
            </button>
            <button
              onClick={() => handleDuplicate(currentCompound.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-background-tertiary rounded text-[10px] text-text-secondary hover:text-text-primary transition-colors"
            >
              <Copy size={10} />
              Duplicate
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-text-secondary">
            Create Compound Clip
          </span>
          <span className="text-[9px] text-text-muted">
            {selectedClips.length} clips selected
          </span>
        </div>
        <button
          onClick={handleCreateCompound}
          disabled={selectedClips.length < 2}
          className={`w-full py-2.5 rounded-lg text-[11px] font-medium flex items-center justify-center gap-2 transition-colors ${
            selectedClips.length >= 2
              ? "bg-primary/20 border border-primary/30 text-primary hover:bg-primary/20"
              : "bg-background-tertiary text-text-muted cursor-not-allowed"
          }`}
        >
          <Plus size={14} />
          Create Compound Clip
        </button>
        {selectedClips.length < 2 && (
          <p className="text-[9px] text-text-muted text-center">
            Select 2+ clips to create a compound clip
          </p>
        )}
      </div>

      {allCompoundClips.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-medium text-text-secondary">
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
                  className="bg-background-tertiary rounded-lg overflow-hidden"
                >
                  <div
                    className="flex items-center gap-2 p-2 cursor-pointer hover:bg-background-secondary transition-colors"
                    onClick={() =>
                      setExpandedCompound(isExpanded ? null : compound.id)
                    }
                  >
                    <ChevronRight
                      size={12}
                      className={`text-text-muted transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                    <div
                      className="w-3 h-3 rounded"
                      style={{ backgroundColor: compound.color }}
                    />
                    {isRenaming ? (
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleConfirmRename();
                          if (e.key === "Escape") handleCancelRename();
                        }}
                        className="flex-1 bg-background-secondary px-1.5 py-0.5 rounded text-[10px] text-text-primary outline-none border border-primary"
                        autoFocus
                      />
                    ) : (
                      <span className="flex-1 text-[10px] text-text-primary truncate">
                        {compound.name}
                      </span>
                    )}
                    <span className="text-[9px] text-text-muted">
                      {instanceCount} instance{instanceCount !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="px-2 pb-2 space-y-2">
                      <div className="flex gap-2 text-[9px] text-text-muted pl-5">
                        <span>{compound.content.clips.length} clips</span>
                        <span>•</span>
                        <span>{formatDuration(compound.content.duration)}</span>
                        <span>•</span>
                        <span>{compound.content.tracks.length} tracks</span>
                      </div>

                      <div className="flex gap-1 pl-5">
                        {isRenaming ? (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConfirmRename();
                              }}
                              className="p-1.5 bg-green-500/20 rounded text-green-400 hover:bg-green-500/30 transition-colors"
                            >
                              <Check size={10} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCancelRename();
                              }}
                              className="p-1.5 bg-red-500/20 rounded text-red-400 hover:bg-red-500/30 transition-colors"
                            >
                              <X size={10} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartRename(compound);
                              }}
                              className="p-1.5 bg-background-secondary rounded text-text-muted hover:text-text-primary transition-colors"
                              title="Rename"
                            >
                              <Edit3 size={10} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicate(compound.id);
                              }}
                              className="p-1.5 bg-background-secondary rounded text-text-muted hover:text-text-primary transition-colors"
                              title="Duplicate"
                            >
                              <Copy size={10} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(compound.id);
                              }}
                              disabled={instanceCount > 0}
                              className={`p-1.5 rounded transition-colors ${
                                instanceCount > 0
                                  ? "bg-background-secondary text-text-muted cursor-not-allowed opacity-50"
                                  : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                              }`}
                              title={
                                instanceCount > 0
                                  ? "Cannot delete - has instances"
                                  : "Delete"
                              }
                            >
                              <Trash2 size={10} />
                            </button>
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
        <p className="text-[9px] text-text-muted text-center">
          Group clips into reusable compound clips
        </p>
      </div>
    </div>
  );
};

export default NestedSequenceSection;
