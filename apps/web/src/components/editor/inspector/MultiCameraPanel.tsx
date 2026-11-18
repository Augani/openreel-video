import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import {
  Video,
  Camera,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Link,
  Sparkles,
} from "@/icons/lucide-compat";
import {
  Button,
  Card,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@openreel/ui";
import { useNumericDraft } from "./shell/useNumericDraft";

import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEngineStore } from "../../../stores/engine-store";
import { toast } from "../../../stores/notification-store";
import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import {
  MultiCamEngine,
  downloadBlob,
  analyzeMulticamActivity,
  analyzeSileroVad,
  calibrateMulticamBleed,
  createOrmaArtifact,
  extractMulticamSocialClips,
  incorporateMulticamReactionCues,
  MULTICAM_POLICY_PRESETS,
  planMulticamShots,
  parseMulticamManifest,
  serializeMulticamManifest,
  serializeMulticamOtio,
  serializeOrma,
  DEFAULT_MULTICAM_EDIT_POLICY,
  type CameraAngle,
  type MultiCamGroup,
  type MulticamEditPolicy,
  type MulticamDecisionStrategy,
} from "@openreel/core";
import {
  loadMulticamArtifact,
  saveMulticamArtifact,
} from "../../../services/multicam-analysis-store";
import { transcribeMulticamChannels } from "../../../services/multicam-transcription";
import { analyzeMulticamFaceReactions } from "../../../services/multicam-face-reactions";
import {
  createMulticamApplyEditAction,
  createMulticamApplyTracksAction,
  analyzeMulticamSyncInWorker,
  buildMulticamManifest,
  findMulticamCalibrationRanges,
  getMulticamAnalysisDuration,
  prepareMulticamAnalysisAudio,
  resolveMulticamSources,
  updateAlignedSourceOffsets,
} from "./multicam-workflow";

interface MultiCameraPanelProps {
  onClose?: () => void;
}

function CameraNumber({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => unknown;
  min?: number;
  max?: number;
  step?: number;
}) {
  const id = React.useId();
  const draft = useNumericDraft({
    value,
    onChange,
    min,
    max,
    step,
    live: false,
    parse: (raw) => (raw.trim() ? Number(raw) : null),
  });
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-[12px] text-fg-2">
        {label}
      </Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          {...draft}
          className="h-8 min-w-0 border-border bg-bg-1 text-[12px]"
        />
        <span className="text-[11px] text-fg-3">sec</span>
      </div>
    </div>
  );
}
function CameraSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { label: string; value: T }[];
}) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[12px] text-fg-2">
        {label}
      </Label>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger
          id={id}
          className="h-8 min-w-0 border-border bg-bg-1 text-[12px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
const AngleCard: React.FC<{
  angle: CameraAngle;
  isActive: boolean;
  onSelect: () => void;
  onRename: (name: string) => unknown;
  onRemove: () => void;
  onOffsetChange: (offset: number) => unknown;
}> = ({ angle, isActive, onSelect, onRename, onRemove, onOffsetChange }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(angle.name);
  const editing = useRef(false);
  const beginRename = () => {
    editing.current = true;
    setEditName(angle.name);
    setIsEditing(true);
  };
  const handleSave = () => {
    if (!editing.current) return;
    editing.current = false;
    setIsEditing(false);
    const name = editName.trim();
    if (name && name !== angle.name) onRename(name);
  };
  return (
    <Card
      className={cn(
        "min-w-0 space-y-3 rounded-[7px] border-border bg-bg-2 p-3 text-fg shadow-none",
        isActive && "border-accent bg-selected",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: angle.color }}
        />
        {isEditing ? (
          <Input
            autoFocus
            aria-label="Camera angle name"
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            onBlur={handleSave}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                handleSave();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                editing.current = false;
                setIsEditing(false);
              }
            }}
            className="h-7 min-w-0 flex-1 border-border bg-bg-1 px-1 text-[12px]"
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            aria-label={`Rename ${angle.name}`}
            onClick={beginRename}
            onDoubleClick={beginRename}
            className="h-7 min-w-0 flex-1 justify-start px-1 text-[12px] font-medium"
          >
            <span className="truncate">{angle.name}</span>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onSelect}
          aria-label={`Cut to ${angle.name} at playhead`}
          title={`Cut to ${angle.name} at playhead`}
          aria-current={isActive ? "true" : undefined}
          className={cn(
            "h-7 w-7 shrink-0 text-fg-2",
            isActive && "bg-accent text-accent-fg hover:bg-accent/90",
          )}
        >
          <Camera size={14} aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={`Remove ${angle.name}`}
          className="h-7 w-7 shrink-0 text-fg-3 hover:text-status-error"
        >
          <Trash2 size={14} aria-hidden />
        </Button>
      </div>
      <CameraNumber
        label={`Offset for ${angle.name}`}
        value={angle.offset}
        onChange={onOffsetChange}
      />
    </Card>
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
  onAutoEdit: () => void;
  onAcceptCut: (switchId: string) => void;
  onRejectCut: (switchId: string) => void;
  onNudgeCut: (switchId: string, deltaSeconds: number) => void;
  onExportOtio: () => void;
  onExportOrma: () => void;
  onFindSocialClips: () => void;
  onImportManifest: (file: File) => void;
  onExportManifest: () => void;
  onDelete: () => void;
  isProcessing: boolean;
  status?: string;
}> = ({
  group,
  isExpanded,
  onToggle,
  onSelectAngle,
  onRemoveAngle,
  onRenameAngle,
  onOffsetChange,
  onSync,
  onAutoEdit,
  onAcceptCut,
  onRejectCut,
  onNudgeCut,
  onExportOtio,
  onExportOrma,
  onFindSocialClips,
  onImportManifest,
  onExportManifest,
  onDelete,
  isProcessing,
  status,
}) => {
  const input = useRef<HTMLInputElement>(null);
  // Only an actual angle transition redraws this group during playback.
  const activeAngleId = useTimelineStore((state) => {
    const time = state.playheadPosition - group.syncPoint;
    let active = group.activeAngleId || group.angles[0]?.id;
    for (const cut of group.switches ?? []) {
      if (cut.time > time) break;
      active = cut.angleId;
    }
    return active;
  });
  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onToggle}
      className="overflow-hidden rounded-[7px] border border-border"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={group.name}
          className="h-10 w-full justify-start gap-2 rounded-none bg-bg-2 px-3 text-[12px] text-fg"
        >
          {isExpanded ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronRight size={14} aria-hidden />
          )}
          <Camera size={14} className="text-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left font-medium">
            {group.name}
          </span>
          <span className="text-[11px] font-normal text-fg-3">
            {group.angles.length} angles
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.angles.map((angle) => (
              <AngleCard
                key={angle.id}
                angle={angle}
                isActive={angle.id === activeAngleId}
                onSelect={() => onSelectAngle(angle.id)}
                onRename={(name) => onRenameAngle(angle.id, name)}
                onRemove={() => onRemoveAngle(angle.id)}
                onOffsetChange={(offset) => onOffsetChange(angle.id, offset)}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isProcessing}
              onClick={onSync}
              className="flex-1 gap-1.5 border-border text-[12px]"
            >
              <Link size={13} aria-hidden />
              Sync Audio
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={group.angles.length < 2 || isProcessing}
              onClick={onAutoEdit}
              className="flex-1 gap-1.5 bg-accent text-[12px] text-accent-fg hover:bg-accent/90"
            >
              <Sparkles size={13} aria-hidden />
              Auto Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onDelete}
              aria-label="Delete camera group"
              className="h-8 w-8 text-fg-3 hover:text-status-error"
            >
              <Trash2 size={14} aria-hidden />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              ref={input}
              className="hidden"
              type="file"
              accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
              aria-hidden
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onImportManifest(file);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => input.current?.click()}
              className="text-[12px] text-fg-2"
            >
              Import manifest
            </Button>
            {group.manifest && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onExportManifest}
                className="text-[12px] text-fg-2"
              >
                Export manifest
              </Button>
            )}
          </div>
          {status && (
            <p role="status" className="text-[12px] text-fg-2">
              {status}
            </p>
          )}
          {(group.switches?.length ?? 0) > 0 && (
            <Card className="space-y-2 rounded-[7px] border-border bg-bg-1 p-3 text-fg shadow-none">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium">Cut review</span>
                <span className="text-fg-3">
                  {Math.max(0, (group.switches?.length ?? 1) - 1)} cuts
                </span>
              </div>
              <div className="max-h-52 space-y-3 overflow-y-auto">
                {(group.switches ?? []).map((cut, index) => {
                  const angle = group.angles.find(
                    (item) => item.id === cut.angleId,
                  );
                  return (
                    <div
                      key={cut.id}
                      role="group"
                      aria-label={`Cut at ${cut.time.toFixed(2)} seconds`}
                      className="space-y-1.5 text-[11px]"
                    >
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="tabular-nums text-fg-3">
                          {cut.time.toFixed(2)}s
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {angle?.name ?? cut.angleId}
                        </span>
                        <span className="text-fg-3">
                          {cut.reason?.replaceAll("-", " ") ?? "manual"}
                          {cut.confidence !== undefined
                            ? ` · ${Math.round(cut.confidence * 100)}%`
                            : ""}
                        </span>
                      </div>
                      {index > 0 && (
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onNudgeCut(cut.id, -0.1)}
                            className="h-7 px-2 text-[11px]"
                          >
                            −100 ms
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onNudgeCut(cut.id, 0.1)}
                            className="h-7 px-2 text-[11px]"
                          >
                            +100 ms
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onRejectCut(cut.id)}
                            className="h-7 px-2 text-[11px] text-status-error"
                          >
                            Reject
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={cut.reviewStatus === "accepted"}
                            onClick={() => onAcceptCut(cut.id)}
                            className="h-7 px-2 text-[11px] text-accent"
                          >
                            {cut.reviewStatus === "accepted"
                              ? "Accepted"
                              : "Accept"}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-fg-3">
                The generated output track remains fully editable on the
                timeline.
              </p>
            </Card>
          )}
          {group.manifest && group.shotPlan && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onExportOtio}
                className="text-[12px] text-fg-2"
              >
                Export OTIO
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onExportOrma}
                className="text-[12px] text-fg-2"
              >
                Export .orma
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onFindSocialClips}
                className="text-[12px] text-fg-2"
              >
                Find clips
              </Button>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export const MultiCameraPanel: React.FC<MultiCameraPanelProps> = () => {
  const projectId = useProjectStore((state) => state.project.id);
  const executor = useProjectStore((state) => state.actionExecutor);
  const session = useMemo(
    () => ({ projectId, executor, key: crypto.randomUUID() }),
    [projectId, executor],
  );
  return <MultiCameraSession key={session.key} />;
};
const MultiCameraSession: React.FC = () => {
  const project = useProjectStore((state) => state.project);
  const getMultiCamEngine = useEngineStore((state) => state.getMultiCamEngine);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedClips, setSelectedClips] = useState<string[]>(() =>
    useUIStore
      .getState()
      .getSelectedClipIds()
      .filter((id) => {
        const clip = useProjectStore.getState().getClip(id);
        return (
          clip &&
          project.mediaLibrary.items.some(
            (media) => media.id === clip.mediaId && media.type === "video",
          )
        );
      }),
  );
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [syncBeforeAutoEdit, setSyncBeforeAutoEdit] = useState(true);
  const [processingGroupId, setProcessingGroupId] = useState<string | null>(
    null,
  );
  const [groupStatus, setGroupStatus] = useState<Record<string, string>>({});
  const [overlapStrategy, setOverlapStrategy] =
    useState<MulticamDecisionStrategy>("hold");
  const [overlapEscalation, setOverlapEscalation] =
    useState<Exclude<MulticamDecisionStrategy, "hold">>("wide");
  const [minShotSeconds, setMinShotSeconds] = useState(1.8);
  const [maxShotSeconds, setMaxShotSeconds] = useState(30);
  const [includeTranscripts, setIncludeTranscripts] = useState(false);
  const [includeVisualReactions, setIncludeVisualReactions] = useState(false);
  const [policyPreset, setPolicyPreset] = useState("custom");
  const [multiCamEngine, setMultiCamEngine] = useState<
    import("@openreel/core").MultiCamEngine | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    const loadEngine = async () => {
      const engine = await getMultiCamEngine();
      if (!cancelled) {
        engine.loadGroups(
          useProjectStore.getState().project.multicamGroups ?? [],
        );
        setMultiCamEngine(engine);
      }
    };
    void loadEngine().catch((error) => {
      if (!cancelled) toast.error("Camera tools could not load", String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [getMultiCamEngine]);

  const groups = project.multicamGroups ?? [];

  useEffect(() => {
    if (!processingGroupId)
      multiCamEngine?.loadGroups(project.multicamGroups ?? []);
  }, [multiCamEngine, project.id, project.multicamGroups, processingGroupId]);

  const editPolicy = useMemo<MulticamEditPolicy>(
    () => ({
      ...DEFAULT_MULTICAM_EDIT_POLICY,
      overlapStrategy: overlapStrategy === "hold" ? "hold" : "winner",
      minShotMs: Math.max(0, minShotSeconds) * 1_000,
      maxShotMs: Math.max(0, maxShotSeconds) * 1_000,
    }),
    [maxShotSeconds, minShotSeconds, overlapStrategy],
  );

  const availableClips = useMemo(() => {
    const clips: { id: string; name: string; trackName: string }[] = [];
    const mediaById = new Map(
      project.mediaLibrary.items.map((item) => [item.id, item]),
    );
    for (const track of project.timeline.tracks) {
      if (track.locked) continue;
      for (const clip of track.clips) {
        const media = mediaById.get(clip.mediaId);
        if (media?.type === "video" && !clip.metadata?.multicam) {
          clips.push({
            id: clip.id,
            name: media.name,
            trackName: track.name || `Track ${track.id.slice(-4)}`,
          });
        }
      }
    }
    return clips;
  }, [project.timeline.tracks, project.mediaLibrary.items]);

  useEffect(() => {
    const available = new Set(availableClips.map((clip) => clip.id));
    setSelectedClips((current) =>
      current.every((id) => available.has(id))
        ? current
        : current.filter((id) => available.has(id)),
    );
  }, [availableClips]);

  const captureOwner = useCallback(() => {
    const before = useProjectStore.getState();
    const sameSession = () =>
      mounted.current &&
      useProjectStore.getState().actionExecutor === before.actionExecutor &&
      useProjectStore.getState().project.id === before.project.id;
    const isCurrent = () =>
      sameSession() && useProjectStore.getState().project === before.project;
    const ensureCurrent = () => {
      if (!sameSession())
        throw new DOMException("Camera session closed", "AbortError");
      if (!isCurrent())
        throw new Error(
          "The project changed during analysis. Run the camera analysis again.",
        );
    };
    return {
      project: before.project,
      history: before.actionExecutor.getHistory(),
      sameSession,
      isCurrent,
      ensureCurrent,
    };
  }, []);

  const setStatus = useCallback((groupId: string, status: string) => {
    if (!mounted.current) return;
    setGroupStatus((current) => ({ ...current, [groupId]: status }));
  }, []);

  const persistGroups = useCallback(
    async (engine = multiCamEngine) => {
      if (!engine) return;
      const result = await useProjectStore.getState().executeAction({
        type: "multicam/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { groups: engine.getAllGroups() },
      });
      if (!result.success) {
        engine.loadGroups(
          useProjectStore.getState().project.multicamGroups ?? [],
        );
        throw new Error(
          result.error?.message ?? "Could not save the camera group.",
        );
      }
    },
    [multiCamEngine],
  );

  const decodeGroupAudio = useCallback(
    async (group: MultiCamGroup, owner: ReturnType<typeof captureOwner>) => {
      owner.ensureCurrent();
      const currentProject = owner.project;
      const sources = resolveMulticamSources(currentProject, group);
      const unsupportedSource = sources.find(
        (source) =>
          source.clip.reversed ||
          (source.clip.speed ?? 1) !== 1 ||
          source.clip.speedKeyframes?.length ||
          source.clip.freezeFrames?.length,
      );
      if (unsupportedSource) {
        throw new Error(
          `${unsupportedSource.angle.name} must use normal-speed, forward playback for audio analysis.`,
        );
      }
      const buffers = new Map<string, AudioBuffer>();
      const audioContext = new AudioContext();
      try {
        for (const source of sources) {
          owner.ensureCurrent();
          if (!source.media.blob) {
            throw new Error(
              `${source.angle.name} needs its source media relinked.`,
            );
          }
          setStatus(group.id, `Decoding ${source.angle.name}…`);
          const buffer = await loadAudioBuffer(
            audioContext,
            source.media.blob,
            {
              audioTrackIndex: source.clip.audioTrackIndex,
              onProgress: ({ message }) => {
                if (owner.isCurrent())
                  setStatus(group.id, `${source.angle.name}: ${message}`);
              },
            },
          );
          owner.ensureCurrent();
          if (!buffer) {
            throw new Error(`Could not decode audio for ${source.angle.name}.`);
          }
          buffers.set(source.angle.id, buffer);
        }
      } finally {
        await audioContext.close();
      }
      return { buffers, sources };
    },
    [setStatus],
  );

  const updateGroupSourceLayout = useCallback(
    (
      groupId: string,
      sources: ReturnType<typeof resolveMulticamSources>,
      engine = multiCamEngine,
    ) => {
      const liveGroup = engine?.getGroup(groupId);
      if (!liveGroup) throw new Error("Camera group is no longer available.");
      for (const source of sources) {
        const angle = liveGroup.angles.find(
          (item) => item.id === source.angle.id,
        );
        if (angle) angle.trackId = source.track.id;
      }
      liveGroup.syncPoint = Math.min(
        ...sources.map((source) => source.clip.startTime),
      );
      return liveGroup;
    },
    [multiCamEngine],
  );

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

  const handleCreateGroup = useCallback(async () => {
    if (!multiCamEngine || busyRef.current || selectedClips.length < 2) return;
    const owner = captureOwner();
    const available = new Set(availableClips.map((clip) => clip.id));
    const clips = selectedClips.filter((id) => available.has(id));
    if (clips.length < 2) return;
    busyRef.current = true;
    const group = multiCamEngine.createGroup(
      `Multi-Cam ${groups.length + 1}`,
      clips,
    );
    setProcessingGroupId(group.id);
    try {
      const sources = resolveMulticamSources(owner.project, group);
      updateGroupSourceLayout(group.id, sources);
      group.duration = Math.min(
        ...sources.map((source) => source.clip.duration),
      );
      await persistGroups();
      if (!owner.sameSession()) return;
      setExpandedGroups((prev) => new Set([...prev, group.id]));
      setSelectedClips([]);
    } catch (error) {
      if (!owner.sameSession()) return;
      multiCamEngine.loadGroups(
        useProjectStore.getState().project.multicamGroups ?? [],
      );
      toast.error(
        "Camera group failed",
        error instanceof Error
          ? error.message
          : "Could not create the camera group.",
      );
    } finally {
      busyRef.current = false;
      if (owner.sameSession()) setProcessingGroupId(null);
    }
  }, [
    availableClips,
    captureOwner,
    groups.length,
    multiCamEngine,
    persistGroups,
    selectedClips,
    updateGroupSourceLayout,
  ]);

  const handleRemoveAngle = useCallback(
    (groupId: string, angleId: string) => {
      if (!multiCamEngine) return;
      if (busyRef.current || !multiCamEngine.removeAngle(groupId, angleId))
        return;
      void persistGroups().catch((error) =>
        toast.error(
          "Could not remove angle",
          error instanceof Error ? error.message : undefined,
        ),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const handleRenameAngle = useCallback(
    (groupId: string, angleId: string, name: string) => {
      if (!multiCamEngine) return;
      if (
        busyRef.current ||
        !name.trim() ||
        multiCamEngine
          .getGroup(groupId)
          ?.angles.find((angle) => angle.id === angleId)?.name === name ||
        !multiCamEngine.renameAngle(groupId, angleId, name)
      )
        return;
      void persistGroups().catch((error) =>
        toast.error(
          "Could not rename angle",
          error instanceof Error ? error.message : undefined,
        ),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const handleOffsetChange = useCallback(
    (groupId: string, angleId: string, offset: number) => {
      if (!multiCamEngine) return;
      if (
        busyRef.current ||
        !Number.isFinite(offset) ||
        multiCamEngine
          .getGroup(groupId)
          ?.angles.find((angle) => angle.id === angleId)?.offset === offset ||
        !multiCamEngine.setAngleOffset(groupId, angleId, offset)
      )
        return;
      return persistGroups().catch((error) =>
        toast.error(
          "Could not save offset",
          error instanceof Error ? error.message : undefined,
        ),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const handleSyncAudio = useCallback(
    async (groupId: string) => {
      if (!multiCamEngine) return;
      const owner = captureOwner();
      const workingEngine = new MultiCamEngine();
      workingEngine.loadGroups(owner.project.multicamGroups ?? []);
      const group = workingEngine.getGroup(groupId);
      if (!group || busyRef.current) return;
      busyRef.current = true;
      setProcessingGroupId(groupId);
      const { ensureCurrent } = owner;
      const progress = (message: string) => {
        if (owner.isCurrent()) setStatus(groupId, message);
      };
      try {
        const { buffers, sources } = await decodeGroupAudio(group, owner);
        ensureCurrent();
        updateGroupSourceLayout(groupId, sources, workingEngine);
        progress("Synchronizing camera audio…");
        const { results } = await analyzeMulticamSyncInWorker(
          buffers,
          group.angles[0]?.id ?? "",
        );
        ensureCurrent();
        const liveGroup = workingEngine.getGroup(groupId);
        if (!liveGroup) throw new Error("Camera group is no longer available.");
        updateAlignedSourceOffsets(liveGroup, sources, results);
        const alignedSources = sources.map((source) => ({
          ...source,
          angle:
            liveGroup.angles.find((angle) => angle.id === source.angle.id) ??
            source.angle,
        }));
        liveGroup.duration = getMulticamAnalysisDuration(
          alignedSources,
          buffers,
        );
        ensureCurrent();
        await persistGroups(workingEngine);
        if (!owner.sameSession()) return;
        const confidences = [...results.values()].map(
          (result) => result.confidence,
        );
        const confidence = confidences.length
          ? confidences.reduce((sum, value) => sum + value, 0) /
            confidences.length
          : 0;
        setStatus(
          groupId,
          `Audio synchronized · ${Math.round(confidence * 100)}% confidence`,
        );
        toast.success("Camera audio synchronized", group.name);
      } catch (error) {
        if (!owner.sameSession()) return;
        multiCamEngine.loadGroups(
          useProjectStore.getState().project.multicamGroups ?? [],
        );
        const message =
          error instanceof Error ? error.message : "Audio sync failed.";
        setStatus(groupId, message);
        toast.error("Audio sync failed", message);
      } finally {
        busyRef.current = false;
        if (owner.sameSession()) setProcessingGroupId(null);
      }
    },
    [
      captureOwner,
      decodeGroupAudio,
      multiCamEngine,
      persistGroups,
      setStatus,
      updateGroupSourceLayout,
    ],
  );

  const handleAutoEdit = useCallback(
    async (groupId: string) => {
      if (!multiCamEngine || busyRef.current) return;
      const owner = captureOwner();
      const workingEngine = new MultiCamEngine();
      workingEngine.loadGroups(owner.project.multicamGroups ?? []);
      const group = workingEngine.getGroup(groupId);
      if (!group) return;
      busyRef.current = true;
      setProcessingGroupId(groupId);
      const { ensureCurrent } = owner;
      const progress = (message: string) => {
        if (owner.isCurrent()) setStatus(groupId, message);
      };
      try {
        const { buffers, sources } = await decodeGroupAudio(group, owner);
        ensureCurrent();
        updateGroupSourceLayout(groupId, sources, workingEngine);
        progress("Synchronizing camera audio…");
        const { results: syncResults, drift } = syncBeforeAutoEdit
          ? await analyzeMulticamSyncInWorker(
              buffers,
              group.angles[0]?.id ?? "",
            )
          : {
              results: null,
              drift: {} as Record<
                string,
                import("@openreel/core").MulticamDriftModel
              >,
            };

        ensureCurrent();
        const liveGroup = workingEngine.getGroup(groupId);
        if (!liveGroup) throw new Error("Camera group is no longer available.");
        if (syncResults)
          updateAlignedSourceOffsets(liveGroup, sources, syncResults);
        for (const angle of liveGroup.angles) {
          angle.driftSecondsPerSecond = drift[angle.id]?.secondsPerSecond ?? 0;
        }
        const alignedSources = sources.map((source) => ({
          ...source,
          angle:
            liveGroup.angles.find((angle) => angle.id === source.angle.id) ??
            source.angle,
        }));
        const duration = getMulticamAnalysisDuration(alignedSources, buffers);
        if (!Number.isFinite(duration) || duration <= 0.1) {
          throw new Error(
            "The camera recordings do not have enough overlapping audio.",
          );
        }

        setStatus(groupId, "Running local Silero voice detection…");
        const vadTracks = new Map<
          string,
          import("@openreel/core").MulticamVadTrack
        >();
        for (const source of alignedSources) {
          const buffer = buffers.get(source.angle.id);
          if (!buffer) continue;
          const vadAudio = prepareMulticamAnalysisAudio(buffer, 16_000);
          const vad = await analyzeSileroVad(
            vadAudio.samples,
            vadAudio.sampleRate,
            {
              onProgress: (completed, total) => {
                if (completed === total || completed % 100 === 0) {
                  progress(
                    `Voice detection · ${source.angle.name} · ${Math.round((completed / total) * 100)}%`,
                  );
                }
              },
            },
          );
          ensureCurrent();
          vadTracks.set(source.angle.id, vad);
        }
        setStatus(groupId, "Calibrating room noise and microphone bleed…");
        const calibrationWindows = findMulticamCalibrationRanges(vadTracks);
        const calibrationSources = alignedSources.map((source) => {
          const buffer = buffers.get(source.angle.id);
          if (!buffer)
            throw new Error(`Missing decoded audio for ${source.angle.name}.`);
          const analysisAudio = prepareMulticamAnalysisAudio(buffer);
          return { angleId: source.angle.id, ...analysisAudio };
        });
        const calibration = calibrateMulticamBleed(
          calibrationSources,
          calibrationWindows.ranges,
          calibrationWindows.silenceRange,
        );
        setStatus(groupId, "Analyzing speakers and microphone bleed…");
        const activity = analyzeMulticamActivity(
          alignedSources.map((source) => {
            const buffer = buffers.get(source.angle.id);
            if (!buffer)
              throw new Error(
                `Missing decoded audio for ${source.angle.name}.`,
              );
            const analysisAudio = prepareMulticamAnalysisAudio(buffer);
            return {
              angleId: source.angle.id,
              samples: analysisAudio.samples,
              sampleRate: analysisAudio.sampleRate,
              offsetSeconds: source.clip.inPoint + source.angle.offset,
              vad: vadTracks.get(source.angle.id),
            };
          }),
          { durationSeconds: duration, bleedCalibration: calibration },
        );
        ensureCurrent();
        const currentProject = owner.project;
        const manifest =
          liveGroup.manifest ??
          buildMulticamManifest(currentProject, liveGroup, alignedSources, {
            min_shot_ms: editPolicy.minShotMs,
            max_shot_ms: Math.max(editPolicy.minShotMs, editPolicy.maxShotMs),
            cut_lead_ms: editPolicy.cutLeadMs,
            reaction_shot_after_ms: editPolicy.reactionShotAfterMs,
            forbid_jump_cut_same_subject: editPolicy.forbidJumpCutSameSubject,
          });
        manifest.constraints = {
          ...manifest.constraints,
          min_shot_ms: editPolicy.minShotMs,
          max_shot_ms: Math.max(editPolicy.minShotMs, editPolicy.maxShotMs),
        };
        liveGroup.manifest = manifest;
        const reactions = includeVisualReactions
          ? await analyzeMulticamFaceReactions(
              alignedSources,
              manifest,
              duration,
              { onProgress: progress },
            )
          : [];
        ensureCurrent();
        const shotPlan = incorporateMulticamReactionCues(
          planMulticamShots(activity, manifest, {
            ...(policyPreset === "conversation" ||
            policyPreset === "energetic" ||
            policyPreset === "panel"
              ? MULTICAM_POLICY_PRESETS[policyPreset]
              : {}),
            strategy: overlapStrategy,
            escalateTo: overlapEscalation,
          }),
          manifest,
          reactions,
        );
        if (shotPlan.shots.length === 0) {
          throw new Error("No usable speaker activity was detected.");
        }
        liveGroup.shotPlan = shotPlan;
        workingEngine.applyAutomaticEdit(
          groupId,
          {
            duration: shotPlan.durationMs / 1_000,
            segments: shotPlan.shots.map((shot) => ({
              angleId:
                shot.layout.panels[0]?.cameraId ?? manifest.sync.reference,
              startTime: shot.startMs / 1_000,
              endTime: shot.endMs / 1_000,
              reason: shot.reason,
              confidence: shot.confidence,
            })),
          },
          editPolicy,
          activity.windowMs,
        );
        const artifact = createOrmaArtifact({
          manifest,
          media: alignedSources.map((source) => ({
            id: source.media.id,
            name: source.media.sourceFile?.name ?? source.media.name,
            size: source.media.sourceFile?.size ?? source.media.blob?.size ?? 0,
            lastModified: source.media.sourceFile?.lastModified ?? 0,
          })),
          activity,
          drift,
          calibration,
          reactions,
          transcripts: includeTranscripts
            ? await transcribeMulticamChannels(buffers, {
                onStatus: (angleId, message) => {
                  const angle = liveGroup.angles.find(
                    (entry) => entry.id === angleId,
                  );
                  progress(`${angle?.name ?? angleId}: ${message}`);
                },
              })
            : undefined,
        });
        ensureCurrent();
        liveGroup.analysisArtifactId = await saveMulticamArtifact(
          currentProject.id,
          groupId,
          artifact,
        );

        ensureCurrent();
        const outputTrackId =
          liveGroup.outputTrackId ?? `multicam-output-${groupId}`;
        const sourceClips = new Map(
          alignedSources.map((source) => [source.clip.id, source.clip]),
        );
        const outputTracks = workingEngine.buildShotPlanTracks(
          groupId,
          outputTrackId,
          sourceClips,
          currentProject.settings,
        );
        if (
          outputTracks.length === 0 ||
          outputTracks.every((track) => track.clips.length === 0)
        ) {
          throw new Error(
            "The detected cuts could not be mapped to source clips.",
          );
        }
        workingEngine.setOutputTracks(
          groupId,
          outputTracks.map((track) => track.id),
        );

        setStatus(
          groupId,
          `Applying ${Math.max(0, shotPlan.shots.length - 1)} cuts…`,
        );
        const updatedGroup = workingEngine.getGroup(groupId);
        if (!updatedGroup)
          throw new Error("Camera group is no longer available.");
        const applyAction = createMulticamApplyTracksAction({
          project: currentProject,
          group: updatedGroup,
          groups: workingEngine.getAllGroups(),
          outputTracks,
        });
        ensureCurrent();
        const result = await useProjectStore
          .getState()
          .executeAction(applyAction);
        if (!result.success) {
          throw new Error(
            result.error?.message ?? "Could not apply the automatic edit.",
          );
        }
        if (!owner.sameSession()) return;
        setStatus(
          groupId,
          `${shotPlan.shots.length} shots created on “${group.name} Auto Edit”`,
        );
        toast.success(
          "Automatic multicam edit created",
          `${Math.max(0, shotPlan.shots.length - 1)} cuts · one undo step`,
        );
      } catch (error) {
        if (!owner.sameSession()) return;
        multiCamEngine.loadGroups(
          useProjectStore.getState().project.multicamGroups ?? [],
        );
        const message =
          error instanceof Error ? error.message : "Automatic edit failed.";
        setStatus(groupId, message);
        toast.error("Automatic edit failed", message);
      } finally {
        busyRef.current = false;
        if (owner.sameSession()) setProcessingGroupId(null);
      }
    },
    [
      captureOwner,
      decodeGroupAudio,
      syncBeforeAutoEdit,
      editPolicy,
      includeTranscripts,
      includeVisualReactions,
      multiCamEngine,
      overlapEscalation,
      overlapStrategy,
      policyPreset,
      setStatus,
      updateGroupSourceLayout,
    ],
  );

  const downloadText = useCallback(
    (filename: string, contents: string, type: string) => {
      downloadBlob(new Blob([contents], { type }), filename);
    },
    [],
  );

  const handleExportOtio = useCallback(
    (groupId: string) => {
      const group = multiCamEngine?.getGroup(groupId);
      if (!group?.manifest || !group.shotPlan) return;
      downloadText(
        `${group.name.replace(/[^a-z0-9-_]+/gi, "-")}.otio`,
        serializeMulticamOtio(group.shotPlan, group.manifest, group.name),
        "application/json",
      );
    },
    [downloadText, multiCamEngine],
  );

  const handleExportOrma = useCallback(
    async (groupId: string) => {
      const owner = captureOwner();
      const group = multiCamEngine?.getGroup(groupId);
      if (!group) return;
      try {
        const artifact = await loadMulticamArtifact(owner.project.id, groupId);
        owner.ensureCurrent();
        if (!artifact)
          throw new Error("Run Auto Edit before exporting the .orma artifact.");
        downloadText(
          `${group.name.replace(/[^a-z0-9-_]+/gi, "-")}.orma`,
          serializeOrma(artifact),
          "application/vnd.openreel.activity+json",
        );
      } catch (error) {
        if (owner.sameSession())
          toast.error(
            "Analysis unavailable",
            error instanceof Error ? error.message : undefined,
          );
      }
    },
    [captureOwner, downloadText, multiCamEngine],
  );

  const handleImportManifest = useCallback(
    async (groupId: string, file: File) => {
      if (!multiCamEngine || busyRef.current) return;
      const owner = captureOwner();
      busyRef.current = true;
      setProcessingGroupId(groupId);
      try {
        const text = await file.text();
        owner.ensureCurrent();
        const parsed = parseMulticamManifest(text);
        const workingEngine = new MultiCamEngine();
        workingEngine.loadGroups(owner.project.multicamGroups ?? []);
        const group = workingEngine.getGroup(groupId);
        if (!group) throw new Error("Camera group is no longer available.");
        const sources = resolveMulticamSources(owner.project, group);
        const unusedAngles = [...group.angles];
        const cameras = parsed.cameras.map((camera) => {
          const matched =
            unusedAngles.find((angle) => {
              const source = sources.find(
                (entry) => entry.angle.id === angle.id,
              );
              return (
                camera.angleId === angle.id ||
                camera.id === angle.id ||
                camera.clipId === angle.clipId ||
                camera.file === source?.media.sourceFile?.name ||
                camera.file === source?.media.name
              );
            }) ?? unusedAngles[0];
          if (!matched)
            throw new Error(
              `Could not map camera ${camera.id} (${camera.file}) to a selected angle.`,
            );
          unusedAngles.splice(unusedAngles.indexOf(matched), 1);
          return { ...camera, clipId: matched.clipId, angleId: matched.id };
        });
        group.manifest = { ...parsed, cameras };
        owner.ensureCurrent();
        await persistGroups(workingEngine);
        if (owner.sameSession())
          toast.success(
            "Multicam manifest imported",
            `${parsed.participants.length} participants · ${parsed.cameras.length} cameras`,
          );
      } catch (error) {
        if (owner.sameSession())
          toast.error(
            "Manifest import failed",
            error instanceof Error ? error.message : undefined,
          );
      } finally {
        busyRef.current = false;
        if (owner.sameSession()) setProcessingGroupId(null);
      }
    },
    [captureOwner, multiCamEngine, persistGroups],
  );

  const handleExportManifest = useCallback(
    (groupId: string) => {
      const group = multiCamEngine?.getGroup(groupId);
      if (!group?.manifest) return;
      downloadText(
        `${group.name.replace(/[^a-z0-9-_]+/gi, "-")}.multicam.json`,
        serializeMulticamManifest(group.manifest),
        "application/json",
      );
    },
    [downloadText, multiCamEngine],
  );

  const handleFindSocialClips = useCallback(
    async (groupId: string) => {
      if (busyRef.current) return;
      const owner = captureOwner();
      busyRef.current = true;
      setProcessingGroupId(groupId);
      try {
        const artifact = await loadMulticamArtifact(owner.project.id, groupId);
        owner.ensureCurrent();
        if (!artifact)
          throw new Error("Run Auto Edit before finding social clips.");
        const candidates = extractMulticamSocialClips(artifact);
        const history = owner.history;
        let expectedProject = owner.project;
        history.beginGroup("Add multicam social clip candidates");
        try {
          for (const candidate of candidates) {
            if (!owner.sameSession())
              throw new DOMException("Camera session closed", "AbortError");
            if (useProjectStore.getState().project !== expectedProject)
              throw new Error(
                "The project changed while adding social clips. Run it again.",
              );
            const result = await useProjectStore.getState().executeAction({
              type: "marker/add",
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              params: {
                time: candidate.startMs / 1000,
                label: `Social · ${candidate.title ?? candidate.reason}`,
                color: "#f59e0b",
              },
            });
            if (!result.success)
              throw new Error(
                result.error?.message ??
                  "Could not add the social clip marker.",
              );
            expectedProject = useProjectStore.getState().project;
          }
        } finally {
          history.endGroup();
        }
        if (owner.sameSession())
          toast.success(
            "Social clip candidates added",
            `${candidates.length} timeline markers`,
          );
      } catch (error) {
        if (owner.sameSession())
          toast.error(
            "Analysis unavailable",
            error instanceof Error ? error.message : undefined,
          );
      } finally {
        busyRef.current = false;
        if (owner.sameSession()) setProcessingGroupId(null);
      }
    },
    [captureOwner],
  );

  const applyReviewedEdit = useCallback(
    async (groupId: string) => {
      if (!multiCamEngine) return;
      const group = multiCamEngine.getGroup(groupId);
      if (!group) return;
      const outputTrackId = group.outputTrackId ?? `multicam-output-${groupId}`;
      const currentProject = useProjectStore.getState().project;
      const sources = resolveMulticamSources(currentProject, group);
      const sourceClips = new Map(
        sources.map((source) => [source.clip.id, source.clip]),
      );
      const outputTracks = group.shotPlan
        ? multiCamEngine.buildShotPlanTracks(
            groupId,
            outputTrackId,
            sourceClips,
            currentProject.settings,
          )
        : [];
      multiCamEngine.setOutputTracks(
        groupId,
        outputTracks.length
          ? outputTracks.map((track) => track.id)
          : [outputTrackId],
      );
      const action = outputTracks.length
        ? createMulticamApplyTracksAction({
            project: currentProject,
            group,
            groups: multiCamEngine.getAllGroups(),
            outputTracks,
          })
        : createMulticamApplyEditAction({
            project: currentProject,
            group,
            groups: multiCamEngine.getAllGroups(),
            outputTrackId,
            sequence: multiCamEngine.buildSequenceClips(
              groupId,
              outputTrackId,
              sourceClips,
            ),
          });
      const result = await useProjectStore.getState().executeAction(action);
      if (!result.success)
        throw new Error(
          result.error?.message ?? "Could not update cut review.",
        );
    },
    [multiCamEngine],
  );

  const handleSelectAngle = useCallback(
    async (groupId: string, angleId: string) => {
      if (!multiCamEngine || busyRef.current) return;
      const group = multiCamEngine.getGroup(groupId);
      if (!group) return;
      const time =
        useTimelineStore.getState().playheadPosition - group.syncPoint;
      if (time < 0 || time >= group.duration) {
        toast.error(
          "Move the playhead inside the camera group",
          `Group range: ${group.syncPoint.toFixed(2)}s – ${(group.syncPoint + group.duration).toFixed(2)}s`,
        );
        return;
      }
      const owner = captureOwner();
      busyRef.current = true;
      setProcessingGroupId(groupId);
      try {
        if (!multiCamEngine.cutToAngle(groupId, angleId, time))
          throw new Error("This camera is unavailable at the playhead.");
        await applyReviewedEdit(groupId);
        if (!owner.sameSession()) return;
        setStatus(
          groupId,
          `Camera cut added at ${(group.syncPoint + time).toFixed(2)}s · Undo restores the previous edit`,
        );
      } catch (error) {
        if (!owner.sameSession()) return;
        multiCamEngine.loadGroups(
          useProjectStore.getState().project.multicamGroups ?? [],
        );
        toast.error(
          "Could not switch camera",
          error instanceof Error ? error.message : undefined,
        );
      } finally {
        busyRef.current = false;
        if (owner.sameSession()) setProcessingGroupId(null);
      }
    },
    [applyReviewedEdit, captureOwner, multiCamEngine, setStatus],
  );

  const updateReviewedCut = useCallback(
    async (
      groupId: string,
      change: (engine: MultiCamEngine) => boolean,
      failure: string,
    ) => {
      if (!multiCamEngine || busyRef.current) return;
      const owner = captureOwner();
      busyRef.current = true;
      setProcessingGroupId(groupId);
      try {
        if (!change(multiCamEngine)) return;
        await applyReviewedEdit(groupId);
      } catch (error) {
        if (!owner.sameSession()) return;
        multiCamEngine.loadGroups(
          useProjectStore.getState().project.multicamGroups ?? [],
        );
        toast.error(
          failure,
          error instanceof Error ? error.message : undefined,
        );
      } finally {
        busyRef.current = false;
        if (owner.sameSession()) setProcessingGroupId(null);
      }
    },
    [applyReviewedEdit, captureOwner, multiCamEngine],
  );
  const handleAcceptCut = useCallback(
    (groupId: string, switchId: string) =>
      updateReviewedCut(
        groupId,
        (engine) => engine.acceptSwitch(groupId, switchId),
        "Could not accept cut",
      ),
    [updateReviewedCut],
  );
  const handleRejectCut = useCallback(
    (groupId: string, switchId: string) =>
      updateReviewedCut(
        groupId,
        (engine) => engine.removeSwitch(groupId, switchId),
        "Could not reject cut",
      ),
    [updateReviewedCut],
  );
  const handleNudgeCut = useCallback(
    (groupId: string, switchId: string, deltaSeconds: number) =>
      updateReviewedCut(
        groupId,
        (engine) => engine.nudgeSwitch(groupId, switchId, deltaSeconds),
        "Could not nudge cut",
      ),
    [updateReviewedCut],
  );

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      if (!multiCamEngine) return;
      if (busyRef.current || !multiCamEngine.deleteGroup(groupId)) return;
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
      void persistGroups().catch((error) =>
        toast.error(
          "Could not delete group",
          error instanceof Error ? error.message : undefined,
        ),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const toggleClipSelection = (clipId: string) => {
    setSelectedClips((prev) =>
      prev.includes(clipId)
        ? prev.filter((id) => id !== clipId)
        : [...prev, clipId],
    );
  };

  return (
    <fieldset
      disabled={Boolean(processingGroupId)}
      className="min-w-0 space-y-4 border-0 p-0"
    >
      <div className="flex items-start gap-3 rounded-[7px] border border-border bg-bg-2 p-3">
        <Video size={16} className="text-accent" />
        <div className="flex-1 flex flex-col gap-0.5">
          <span className="text-[13px] font-medium text-fg">
            Multi-Camera Editing
          </span>
          <span className="font-normal text-[12px] leading-5 text-fg-3">
            Choose recordings of the same event, create a group, then sync audio
            or cut between cameras at the playhead.
          </span>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="space-y-2">
          <span className="text-[12px] font-medium text-fg-2">
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
              onAutoEdit={() => handleAutoEdit(group.id)}
              onAcceptCut={(switchId) => handleAcceptCut(group.id, switchId)}
              onRejectCut={(switchId) => handleRejectCut(group.id, switchId)}
              onNudgeCut={(switchId, delta) =>
                handleNudgeCut(group.id, switchId, delta)
              }
              onExportOtio={() => handleExportOtio(group.id)}
              onExportOrma={() => void handleExportOrma(group.id)}
              onFindSocialClips={() => void handleFindSocialClips(group.id)}
              onImportManifest={(file) =>
                void handleImportManifest(group.id, file)
              }
              onExportManifest={() => handleExportManifest(group.id)}
              onDelete={() => handleDeleteGroup(group.id)}
              isProcessing={processingGroupId === group.id}
              status={groupStatus[group.id]}
            />
          ))}
        </div>
      )}

      <div className="space-y-2 pt-2 border-t border-border">
        <span className="block text-[12px] font-medium text-fg-2">
          Create New Group
        </span>
        <span className="font-normal block text-[12px] leading-5 text-fg-3">
          Choose 2 or more recordings of the same event. Use separate tracks for
          camera sources; source tracks are hidden and muted when the edit is
          created.
        </span>

        {availableClips.length === 0 ? (
          <div className="text-center py-4">
            <Video size={24} className="mx-auto mb-2 text-fg-3 opacity-50" />
            <span className="font-normal text-[10px] text-fg-3">
              Add video clips to unlocked timeline tracks to use multi-camera
              editing
            </span>
          </div>
        ) : (
          <>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {availableClips.map((clip) => (
                <Label
                  key={clip.id}
                  className={cn(
                    "flex min-w-0 cursor-pointer items-center gap-2 rounded-[7px] border border-border bg-bg-2 p-3 text-[12px] font-normal has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    selectedClips.includes(clip.id) &&
                      "border-accent bg-selected",
                  )}
                >
                  <Checkbox
                    aria-label={`${clip.name} ${clip.trackName}`}
                    checked={selectedClips.includes(clip.id)}
                    onCheckedChange={() => toggleClipSelection(clip.id)}
                  />
                  <span className="min-w-0 flex-1 truncate text-fg">
                    {clip.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-fg-3">
                    {clip.trackName}
                  </span>
                </Label>
              ))}
            </div>

            <Button
              type="button"
              size="sm"
              onClick={() => {
                void handleCreateGroup();
              }}
              disabled={
                !multiCamEngine ||
                selectedClips.length < 2 ||
                Boolean(processingGroupId)
              }
              className="w-full gap-2 bg-accent text-[12px] text-accent-fg hover:bg-accent/90"
            >
              <Plus size={14} aria-hidden />
              {`Create Group (${selectedClips.length} selected)`}
            </Button>
          </>
        )}
      </div>

      <Collapsible className="rounded-[7px] border border-border bg-bg-2">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full justify-between px-3 text-[12px] text-fg"
          >
            Automatic edit settings
            <ChevronDown size={14} aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-4 p-3 pt-0">
            <Label className="flex items-center gap-2 text-[12px] text-fg-2">
              <Checkbox
                aria-label="Sync cameras before Auto Edit"
                className="size-3.5 [&_svg]:size-3"
                checked={syncBeforeAutoEdit}
                onCheckedChange={(checked) =>
                  setSyncBeforeAutoEdit(checked === true)
                }
              />
              Sync cameras before Auto Edit (turn off to use manual offsets)
            </Label>
            <span className="text-[12px] font-medium text-fg-2">
              Automatic edit policy
            </span>
            <CameraSelect
              label="Preset"
              value={policyPreset}
              onChange={(value) => {
                setPolicyPreset(value);
                if (
                  value === "conversation" ||
                  value === "energetic" ||
                  value === "panel"
                ) {
                  const preset = MULTICAM_POLICY_PRESETS[value];
                  setOverlapStrategy(preset.strategy);
                  setOverlapEscalation(preset.escalateTo);
                }
              }}
              options={[
                { label: "Custom", value: "custom" },
                { label: "Conversation", value: "conversation" },
                { label: "Energetic", value: "energetic" },
                { label: "Panel", value: "panel" },
              ]}
            />
            <CameraSelect
              label="Overlapping speakers"
              value={overlapStrategy}
              onChange={(value) => {
                setPolicyPreset("custom");
                setOverlapStrategy(value);
              }}
              options={[
                { label: "Hold current camera", value: "hold" },
                { label: "Choose energy winner", value: "winner" },
                { label: "Participant priority", value: "priority" },
                { label: "Use wide shot", value: "wide" },
                { label: "Split active speakers", value: "composite" },
                { label: "Progressive PiP", value: "progressive" },
              ]}
            />
            <CameraSelect
              label="Sustained overlap"
              value={overlapEscalation}
              onChange={(value) => {
                setPolicyPreset("custom");
                setOverlapEscalation(value);
              }}
              options={[
                { label: "Wide shot", value: "wide" },
                { label: "Energy winner", value: "winner" },
                { label: "Participant priority", value: "priority" },
                { label: "Split layout", value: "composite" },
                { label: "Progressive PiP", value: "progressive" },
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              <CameraNumber
                label="Minimum shot"
                value={minShotSeconds}
                min={0}
                max={30}
                step={0.1}
                onChange={(value) => setMinShotSeconds(value ?? 0)}
              />
              <CameraNumber
                label="Maximum shot"
                value={maxShotSeconds}
                min={0}
                max={120}
                step={1}
                onChange={(value) => setMaxShotSeconds(value ?? 0)}
              />
            </div>
            <span className="font-normal block text-[12px] text-fg-3">
              Maximum shot length triggers a listener reaction or wide reset.
            </span>
            <Label className="flex items-center gap-2 text-[12px] text-fg-2">
              <Checkbox
                aria-label="Add per-channel local Whisper transcripts"
                className="size-3.5 [&_svg]:size-3"
                checked={includeTranscripts}
                onCheckedChange={(checked) =>
                  setIncludeTranscripts(checked === true)
                }
              />
              Add per-channel local Whisper transcripts to the .orma artifact
            </Label>
            <Label className="flex items-center gap-2 text-[12px] text-fg-2">
              <Checkbox
                aria-label="Add local MediaPipe face/reaction cues"
                className="size-3.5 [&_svg]:size-3"
                checked={includeVisualReactions}
                onCheckedChange={(checked) =>
                  setIncludeVisualReactions(checked === true)
                }
              />
              Add local MediaPipe face/reaction cues (slower)
            </Label>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <span className="font-normal text-[12px] leading-5 text-fg-3 text-center">
        Automatic edits create an editable timeline track and undo in one step
      </span>
    </fieldset>
  );
};


export default MultiCameraPanel;
