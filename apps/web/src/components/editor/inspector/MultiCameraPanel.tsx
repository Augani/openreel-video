import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Video,
  Camera,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Check,
  Link,
} from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import type { MultiCamGroup, CameraAngle } from "@openreel/core";

interface MultiCameraPanelProps {
  onClose?: () => void;
}

const AngleCard: React.FC<{
  angle: CameraAngle;
  isActive: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onOffsetChange: (offset: number) => void;
}> = ({ angle, isActive, onSelect, onRename, onRemove, onOffsetChange }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(angle.name);

  const handleSave = () => {
    onRename(editName);
    setIsEditing(false);
  };

  return (
    <div
      className={`p-2 rounded-lg border transition-colors cursor-pointer ${
        isActive
          ? "bg-primary/20 border-primary"
          : "bg-background-tertiary border-border hover:border-primary/50"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: angle.color }}
        />
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 px-1 py-0.5 text-[10px] bg-background-secondary rounded border border-primary focus:outline-none"
            autoFocus
          />
        ) : (
          <span
            className="flex-1 text-[10px] font-medium text-text-primary"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            {angle.name}
          </span>
        )}
        {isActive && <Check size={12} className="text-primary" />}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1 text-text-muted hover:text-red-400 transition-colors"
        >
          <Trash2 size={10} />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span className="text-[8px] text-text-muted">Offset:</span>
        <input
          type="number"
          value={angle.offset.toFixed(2)}
          onChange={(e) => onOffsetChange(parseFloat(e.target.value) || 0)}
          onClick={(e) => e.stopPropagation()}
          className="w-16 px-1 py-0.5 text-[8px] bg-background-secondary rounded border border-border focus:border-primary focus:outline-none"
          step="0.1"
        />
        <span className="text-[8px] text-text-muted">sec</span>
      </div>
    </div>
  );
};

const GroupSection: React.FC<{
  group: MultiCamGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectAngle: (angleId: string) => void;
  onRemoveAngle: (angleId: string) => void;
  onRenameAngle: (angleId: string, name: string) => void;
  onOffsetChange: (angleId: string, offset: number) => void;
  onSync: () => void;
  onDelete: () => void;
}> = ({
  group,
  isExpanded,
  onToggle,
  onSelectAngle,
  onRemoveAngle,
  onRenameAngle,
  onOffsetChange,
  onSync,
  onDelete,
}) => (
  <div className="border border-border rounded-lg overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 p-2 bg-background-tertiary hover:bg-background-secondary transition-colors"
    >
      {isExpanded ? (
        <ChevronDown size={12} className="text-text-muted" />
      ) : (
        <ChevronRight size={12} className="text-text-muted" />
      )}
      <Camera size={12} className="text-primary" />
      <span className="flex-1 text-left text-[10px] font-medium text-text-primary">
        {group.name}
      </span>
      <span className="text-[9px] text-text-muted">
        {group.angles.length} angles
      </span>
    </button>
    {isExpanded && (
      <div className="p-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {group.angles.map((angle) => (
            <AngleCard
              key={angle.id}
              angle={angle}
              isActive={angle.id === group.activeAngleId}
              onSelect={() => onSelectAngle(angle.id)}
              onRename={(name) => onRenameAngle(angle.id, name)}
              onRemove={() => onRemoveAngle(angle.id)}
              onOffsetChange={(offset) => onOffsetChange(angle.id, offset)}
            />
          ))}
        </div>
        <div className="flex gap-1 pt-2 border-t border-border">
          <button
            onClick={onSync}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] text-text-secondary hover:text-text-primary bg-background-tertiary rounded transition-colors"
          >
            <Link size={10} />
            Sync Audio
          </button>
          <button
            onClick={onDelete}
            className="flex items-center justify-center gap-1 px-2 py-1.5 text-[9px] text-red-400 hover:bg-red-400/10 rounded transition-colors"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>
    )}
  </div>
);

export const MultiCameraPanel: React.FC<MultiCameraPanelProps> = () => {
  const project = useProjectStore((state) => state.project);
  const getMultiCamEngine = useEngineStore((state) => state.getMultiCamEngine);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedClips, setSelectedClips] = useState<string[]>([]);
  const [multiCamEngine, setMultiCamEngine] =
    useState<import("@openreel/core").MultiCamEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadEngine = async () => {
      const engine = await getMultiCamEngine();
      if (!cancelled) {
        setMultiCamEngine(engine);
      }
    };
    loadEngine();
    return () => {
      cancelled = true;
    };
  }, [getMultiCamEngine]);

  const groups = useMemo(() => {
    return multiCamEngine?.getAllGroups() || [];
  }, [multiCamEngine, project.modifiedAt]);

  const availableClips = useMemo(() => {
    const clips: { id: string; name: string; trackName: string }[] = [];
    for (const track of project.timeline.tracks) {
      if (track.type === "video" || track.type === "image") {
        for (const clip of track.clips) {
          clips.push({
            id: clip.id,
            name: `Clip ${clip.id.slice(-6)}`,
            trackName: track.name || `Track ${track.id.slice(-4)}`,
          });
        }
      }
    }
    return clips;
  }, [project]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleCreateGroup = useCallback(() => {
    if (!multiCamEngine || selectedClips.length < 2) return;

    const group = multiCamEngine.createGroup(
      `Multi-Cam ${groups.length + 1}`,
      selectedClips,
    );

    setExpandedGroups((prev) => new Set([...prev, group.id]));
    setSelectedClips([]);

    useProjectStore.setState((state) => ({
      project: { ...state.project, modifiedAt: Date.now() },
    }));
  }, [multiCamEngine, selectedClips, groups.length]);

  const handleSelectAngle = useCallback(
    (groupId: string, angleId: string) => {
      if (!multiCamEngine) return;
      multiCamEngine.setActiveAngle(groupId, angleId);
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [multiCamEngine],
  );

  const handleRemoveAngle = useCallback(
    (groupId: string, angleId: string) => {
      if (!multiCamEngine) return;
      multiCamEngine.removeAngle(groupId, angleId);
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [multiCamEngine],
  );

  const handleRenameAngle = useCallback(
    (groupId: string, angleId: string, name: string) => {
      if (!multiCamEngine) return;
      multiCamEngine.renameAngle(groupId, angleId, name);
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [multiCamEngine],
  );

  const handleOffsetChange = useCallback(
    (groupId: string, angleId: string, offset: number) => {
      if (!multiCamEngine) return;
      multiCamEngine.setAngleOffset(groupId, angleId, offset);
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [multiCamEngine],
  );

  const handleSyncAudio = useCallback(
    async (_groupId: string) => {
      if (!multiCamEngine) return;
    },
    [multiCamEngine],
  );

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      if (!multiCamEngine) return;
      multiCamEngine.deleteGroup(groupId);
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [multiCamEngine],
  );

  const toggleClipSelection = (clipId: string) => {
    setSelectedClips((prev) =>
      prev.includes(clipId)
        ? prev.filter((id) => id !== clipId)
        : [...prev, clipId],
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Video size={16} className="text-primary" />
        <div className="flex-1">
          <span className="text-[11px] font-medium text-text-primary">
            Multi-Camera Editing
          </span>
          <p className="text-[9px] text-text-muted">
            Sync and switch between camera angles
          </p>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-medium text-text-secondary">
            Camera Groups
          </span>
          {groups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              isExpanded={expandedGroups.has(group.id)}
              onToggle={() => toggleGroup(group.id)}
              onSelectAngle={(angleId) => handleSelectAngle(group.id, angleId)}
              onRemoveAngle={(angleId) => handleRemoveAngle(group.id, angleId)}
              onRenameAngle={(angleId, name) =>
                handleRenameAngle(group.id, angleId, name)
              }
              onOffsetChange={(angleId, offset) =>
                handleOffsetChange(group.id, angleId, offset)
              }
              onSync={() => handleSyncAudio(group.id)}
              onDelete={() => handleDeleteGroup(group.id)}
            />
          ))}
        </div>
      )}

      <div className="space-y-2 pt-2 border-t border-border">
        <span className="text-[10px] font-medium text-text-secondary">
          Create New Group
        </span>
        <p className="text-[9px] text-text-muted">
          Select 2+ video clips to create a multi-camera group
        </p>

        {availableClips.length === 0 ? (
          <div className="text-center py-4">
            <Video
              size={24}
              className="mx-auto mb-2 text-text-muted opacity-50"
            />
            <p className="text-[10px] text-text-muted">
              Import video clips to use multi-camera editing
            </p>
          </div>
        ) : (
          <>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {availableClips.map((clip) => (
                <button
                  key={clip.id}
                  onClick={() => toggleClipSelection(clip.id)}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${
                    selectedClips.includes(clip.id)
                      ? "bg-primary/20 border border-primary"
                      : "bg-background-tertiary border border-transparent hover:border-primary/30"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center ${
                      selectedClips.includes(clip.id)
                        ? "bg-primary border-primary"
                        : "border-border"
                    }`}
                  >
                    {selectedClips.includes(clip.id) && (
                      <Check size={10} className="text-white" />
                    )}
                  </div>
                  <div className="flex-1">
                    <span className="text-[10px] text-text-primary">
                      {clip.name}
                    </span>
                    <span className="text-[8px] text-text-muted ml-1">
                      ({clip.trackName})
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={handleCreateGroup}
              disabled={selectedClips.length < 2}
              className={`w-full flex items-center justify-center gap-2 py-2 text-[10px] rounded-lg transition-colors ${
                selectedClips.length >= 2
                  ? "bg-primary text-white hover:bg-primary/90"
                  : "bg-background-tertiary text-text-muted cursor-not-allowed"
              }`}
            >
              <Plus size={12} />
              Create Group ({selectedClips.length} selected)
            </button>
          </>
        )}
      </div>

      <p className="text-[9px] text-text-muted text-center">
        Switch angles during playback to create cuts
      </p>
    </div>
  );
};

export default MultiCameraPanel;
