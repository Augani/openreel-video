import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  Video,
  Camera,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Check,
  Link,
  Sparkles,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEngineStore } from "../../../stores/engine-store";
import { toast } from "../../../stores/notification-store";
import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import {
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
          : "bg-bg-2 border-border hover:border-primary/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: angle.color }}
        />
        {isEditing ? (
          <ToolcraftTextInputControl
            label="Camera angle name"
            isLabelHidden
            value={editName}
            onChange={setEditName}
            onBlur={handleSave}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 px-1 py-0.5 text-[10px] bg-bg-1 rounded border border-primary focus:outline-none"
            hasAutoFocus
          />
        ) : (
          <span
            className="flex-1 text-[10px] font-medium text-fg"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            {angle.name}
          </span>
        )}
        <IconButton label={`Cut to ${angle.name} at playhead`} icon={<Camera size={12} />}
          variant={isActive ? "primary" : "ghost"} size="sm" onClick={onSelect} />
        <IconButton
          label="Remove angle"
          icon={<Trash2 size={10} />}
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1 text-fg-3 hover:text-red-400 transition-colors"
        />
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span className="text-[8px] text-fg-3">Offset:</span>
        <ToolcraftNumberInputControl
          label="Angle offset"
          isLabelHidden
          size="sm"
          value={Number(angle.offset.toFixed(2))}
          onChange={(value) => onOffsetChange(value || 0)}
          onClick={(e) => e.stopPropagation()}
          className="w-16 px-1 py-0.5 text-[8px] bg-bg-1 rounded border border-border focus:border-primary focus:outline-none"
          step={0.1}
        />
        <span className="text-[8px] text-fg-3">sec</span>
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
}) => (
  <div className="border border-border rounded-lg overflow-hidden">
    <Button
      label={group.name}
      variant="ghost"
      onClick={onToggle}
      className="w-full flex items-center gap-2 p-2 bg-bg-2 hover:bg-bg-1 transition-colors"
    >
      {isExpanded ? (
        <ChevronDown size={12} className="text-fg-3" />
      ) : (
        <ChevronRight size={12} className="text-fg-3" />
      )}
      <Camera size={12} className="text-primary" />
      <span className="flex-1 text-left text-[10px] font-medium text-fg">
        {group.name}
      </span>
      <span className="text-[9px] text-fg-3">
        {group.angles.length} angles
      </span>
    </Button>
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
          <Button
            label="Sync Audio"
            variant="ghost"
            icon={<Link size={10} />}
            onClick={onSync}
            isDisabled={isProcessing}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] text-fg-2 hover:text-fg bg-bg-2 rounded transition-colors"
          />
          <Button
            label="Auto Edit"
            variant="primary"
            icon={<Sparkles size={10} />}
            onClick={onAutoEdit}
            isLoading={isProcessing}
            isDisabled={group.angles.length < 2}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] rounded transition-colors"
          />
          <IconButton
            label="Delete camera group"
            icon={<Trash2 size={10} />}
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="flex items-center justify-center gap-1 px-2 py-1.5 text-[9px] text-red-400 hover:bg-red-400/10 rounded transition-colors"
          />
        </div>
        <div className="flex gap-1">
          <label className="flex-1 cursor-pointer rounded bg-bg-2 py-1 text-center text-[8px] text-fg-2 hover:text-fg">
            Import manifest
            <input
              type="file"
              accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportManifest(file);
                event.target.value = "";
              }}
            />
          </label>
          {group.manifest && (
            <Button
              label="Export manifest"
              variant="ghost"
              onClick={onExportManifest}
              className="flex-1 py-1 text-[8px]"
            />
          )}
        </div>
        {status && (
          <Text type="supporting" color="secondary" className="block text-[9px] text-fg-3">
            {status}
          </Text>
        )}
        {(group.switches?.length ?? 0) > 0 && (
          <div className="space-y-1 rounded-md border border-border bg-bg-1 p-2">
            <div className="flex items-center justify-between text-[9px]">
              <span className="font-medium text-fg-2">Cut review</span>
              <span className="text-fg-3">
                {Math.max(0, (group.switches?.length ?? 1) - 1)} cuts
              </span>
            </div>
            <div className="max-h-28 space-y-1 overflow-y-auto">
              {(group.switches ?? []).map((switchItem, switchIndex) => {
                const angle = group.angles.find((item) => item.id === switchItem.angleId);
                return (
                  <div
                    key={switchItem.id}
                    className="grid grid-cols-[42px_1fr_auto] items-center gap-1 text-[8px] text-fg-3"
                  >
                    <span>{switchItem.time.toFixed(2)}s</span>
                    <span className="truncate text-fg-2">{angle?.name ?? switchItem.angleId}</span>
                    <span className="text-right">
                      {switchItem.reason?.replaceAll("-", " ") ?? "manual"}
                      {switchItem.confidence !== undefined
                        ? ` · ${Math.round(switchItem.confidence * 100)}%`
                        : ""}
                    </span>
                    {switchIndex > 0 && (
                      <div className="col-span-3 flex items-center justify-end gap-1">
                        <Button
                          label="−100 ms"
                          variant="ghost"
                          onClick={() => onNudgeCut(switchItem.id, -0.1)}
                          className="px-1 py-0.5 text-[8px]"
                        />
                        <Button
                          label="+100 ms"
                          variant="ghost"
                          onClick={() => onNudgeCut(switchItem.id, 0.1)}
                          className="px-1 py-0.5 text-[8px]"
                        />
                        <Button
                          label="Reject"
                          variant="ghost"
                          onClick={() => onRejectCut(switchItem.id)}
                          className="px-1 py-0.5 text-[8px] text-red-400"
                        />
                        <Button
                          label={switchItem.reviewStatus === "accepted" ? "Accepted" : "Accept"}
                          variant="ghost"
                          onClick={() => onAcceptCut(switchItem.id)}
                          isDisabled={switchItem.reviewStatus === "accepted"}
                          className="px-1 py-0.5 text-[8px] text-emerald-400"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Text type="supporting" color="secondary" className="block text-[8px] text-fg-3">
              The generated output track remains fully editable on the timeline.
            </Text>
          </div>
        )}
        {group.manifest && group.shotPlan && (
          <div className="flex gap-1 border-t border-border pt-2">
            <Button
              label="Export OTIO"
              variant="ghost"
              onClick={onExportOtio}
              className="flex-1 py-1 text-[8px]"
            />
            <Button
              label="Export .orma"
              variant="ghost"
              onClick={onExportOrma}
              className="flex-1 py-1 text-[8px]"
            />
            <Button
              label="Find clips"
              variant="ghost"
              onClick={onFindSocialClips}
              className="flex-1 py-1 text-[8px]"
            />
          </div>
        )}
      </div>
    )}
  </div>
);

export const MultiCameraPanel: React.FC<MultiCameraPanelProps> = () => {
  const project = useProjectStore((state) => state.project);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const getMultiCamEngine = useEngineStore((state) => state.getMultiCamEngine);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedClips, setSelectedClips] = useState<string[]>(() =>
    useUIStore.getState().getSelectedClipIds().filter((id) => {
      const clip = useProjectStore.getState().getClip(id);
      return clip && project.mediaLibrary.items.some((media) => media.id === clip.mediaId && media.type === "video");
    }),
  );
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [syncBeforeAutoEdit, setSyncBeforeAutoEdit] = useState(true);
  const [processingGroupId, setProcessingGroupId] = useState<string | null>(null);
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
  const [multiCamEngine, setMultiCamEngine] =
    useState<import("@openreel/core").MultiCamEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadEngine = async () => {
      const engine = await getMultiCamEngine();
      if (!cancelled) {
        engine.loadGroups(useProjectStore.getState().project.multicamGroups ?? []);
        setMultiCamEngine(engine);
      }
    };
    void loadEngine().catch((error) => toast.error("Camera tools could not load", String(error)));
    return () => {
      cancelled = true;
    };
  }, [getMultiCamEngine]);

  const groups = project.multicamGroups ?? [];

  useEffect(() => {
    if (!processingGroupId) multiCamEngine?.loadGroups(project.multicamGroups ?? []);
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
    for (const track of project.timeline.tracks) {
      if (track.locked) continue;
      for (const clip of track.clips) {
        const media = project.mediaLibrary.items.find(
          (item) => item.id === clip.mediaId,
        );
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
  }, [project]);

  const setStatus = useCallback((groupId: string, status: string) => {
    if (!mounted.current) return;
    setGroupStatus((current) => ({ ...current, [groupId]: status }));
  }, []);

  const persistGroups = useCallback(async () => {
    if (!multiCamEngine) return;
    const result = await useProjectStore.getState().executeAction({
      type: "multicam/setAll",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      params: { groups: multiCamEngine.getAllGroups() },
    });
    if (!result.success) {
      multiCamEngine.loadGroups(useProjectStore.getState().project.multicamGroups ?? []);
      throw new Error(result.error?.message ?? "Could not save the camera group.");
    }
  }, [multiCamEngine]);

  const decodeGroupAudio = useCallback(
    async (group: MultiCamGroup) => {
      const currentProject = useProjectStore.getState().project;
      const sources = resolveMulticamSources(currentProject, group);
      const unsupportedSource = sources.find(
        (source) => source.clip.reversed || (source.clip.speed ?? 1) !== 1 || source.clip.speedKeyframes?.length || source.clip.freezeFrames?.length,
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
          if (!source.media.blob) {
            throw new Error(`${source.angle.name} needs its source media relinked.`);
          }
          setStatus(group.id, `Decoding ${source.angle.name}…`);
          const buffer = await loadAudioBuffer(audioContext, source.media.blob, {
            audioTrackIndex: source.clip.audioTrackIndex,
            onProgress: ({ message }) => setStatus(group.id, `${source.angle.name}: ${message}`),
          });
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
    ) => {
      const liveGroup = multiCamEngine?.getGroup(groupId);
      if (!liveGroup) throw new Error("Camera group is no longer available.");
      for (const source of sources) {
        const angle = liveGroup.angles.find((item) => item.id === source.angle.id);
        if (angle) angle.trackId = source.track.id;
      }
      liveGroup.syncPoint = Math.min(...sources.map((source) => source.clip.startTime));
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

    const group = multiCamEngine.createGroup(
      `Multi-Cam ${groups.length + 1}`,
      selectedClips,
    );
    try {
      const sources = resolveMulticamSources(project, group);
      updateGroupSourceLayout(group.id, sources);
      group.duration = Math.min(...sources.map((source) => source.clip.duration));
      await persistGroups();
    } catch (error) {
      multiCamEngine.deleteGroup(group.id);
      toast.error(
        "Camera group failed",
        error instanceof Error ? error.message : "Could not create the camera group.",
      );
      return;
    }

    setExpandedGroups((prev) => new Set([...prev, group.id]));
    setSelectedClips([]);
  }, [
    groups.length,
    multiCamEngine,
    persistGroups,
    project,
    selectedClips,
    updateGroupSourceLayout,
  ]);

  const handleRemoveAngle = useCallback(
    (groupId: string, angleId: string) => {
      if (!multiCamEngine) return;
      multiCamEngine.removeAngle(groupId, angleId);
      void persistGroups().catch((error) =>
        toast.error("Could not remove angle", error instanceof Error ? error.message : undefined),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const handleRenameAngle = useCallback(
    (groupId: string, angleId: string, name: string) => {
      if (!multiCamEngine) return;
      multiCamEngine.renameAngle(groupId, angleId, name);
      void persistGroups().catch((error) =>
        toast.error("Could not rename angle", error instanceof Error ? error.message : undefined),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const handleOffsetChange = useCallback(
    (groupId: string, angleId: string, offset: number) => {
      if (!multiCamEngine) return;
      multiCamEngine.setAngleOffset(groupId, angleId, offset);
      void persistGroups().catch((error) =>
        toast.error("Could not save offset", error instanceof Error ? error.message : undefined),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const handleSyncAudio = useCallback(
    async (groupId: string) => {
      if (!multiCamEngine) return;
      const group = multiCamEngine.getGroup(groupId);
      if (!group || busyRef.current) return;
      busyRef.current = true;
      setProcessingGroupId(groupId);
      const before = useProjectStore.getState().project;
      const snapshot = JSON.stringify([before.id, before.timeline, before.multicamGroups]);
      const ensureCurrent = () => {
        const latest = useProjectStore.getState().project;
        if (!mounted.current || snapshot !== JSON.stringify([latest.id, latest.timeline, latest.multicamGroups])) {
          throw new Error("The project changed during analysis. Run the camera analysis again.");
        }
      };
      try {
        const { buffers, sources } = await decodeGroupAudio(group);
        updateGroupSourceLayout(groupId, sources);
        setStatus(groupId, "Synchronizing camera audio…");
        const { results } = await analyzeMulticamSyncInWorker(
          buffers,
          group.angles[0]?.id ?? "",
        );
        const liveGroup = multiCamEngine.getGroup(groupId);
        if (!liveGroup) throw new Error("Camera group is no longer available.");
        updateAlignedSourceOffsets(liveGroup, sources, results);
        const alignedSources = sources.map((source) => ({
          ...source,
          angle:
            liveGroup.angles.find((angle) => angle.id === source.angle.id) ?? source.angle,
        }));
        liveGroup.duration = getMulticamAnalysisDuration(alignedSources, buffers);
        ensureCurrent();
        await persistGroups();
        const confidences = [...results.values()].map((result) => result.confidence);
        const confidence = confidences.length
          ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
          : 0;
        setStatus(groupId, `Audio synchronized · ${Math.round(confidence * 100)}% confidence`);
        toast.success("Camera audio synchronized", group.name);
      } catch (error) {
        multiCamEngine.loadGroups(useProjectStore.getState().project.multicamGroups ?? []);
        const message = error instanceof Error ? error.message : "Audio sync failed.";
        setStatus(groupId, message);
        toast.error("Audio sync failed", message);
      } finally {
        busyRef.current = false;
        setProcessingGroupId(null);
      }
    },
    [
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
      const group = multiCamEngine.getGroup(groupId);
      if (!group) return;
      busyRef.current = true;
      setProcessingGroupId(groupId);
      const before = useProjectStore.getState().project;
      const snapshot = JSON.stringify([before.id, before.timeline, before.multicamGroups]);
      const ensureCurrent = () => {
        const latest = useProjectStore.getState().project;
        if (!mounted.current || snapshot !== JSON.stringify([latest.id, latest.timeline, latest.multicamGroups])) {
          throw new Error("The project changed during analysis. Run the camera analysis again.");
        }
      };
      try {
        const { buffers, sources } = await decodeGroupAudio(group);
        updateGroupSourceLayout(groupId, sources);
        setStatus(groupId, "Synchronizing camera audio…");
        const { results: syncResults, drift } = syncBeforeAutoEdit
          ? await analyzeMulticamSyncInWorker(buffers, group.angles[0]?.id ?? "")
          : { results: null, drift: {} as Record<string, import("@openreel/core").MulticamDriftModel> };

        const liveGroup = multiCamEngine.getGroup(groupId);
        if (!liveGroup) throw new Error("Camera group is no longer available.");
        if (syncResults) updateAlignedSourceOffsets(liveGroup, sources, syncResults);
        for (const angle of liveGroup.angles) {
          angle.driftSecondsPerSecond = drift[angle.id]?.secondsPerSecond ?? 0;
        }
        const alignedSources = sources.map((source) => ({
          ...source,
          angle:
            liveGroup.angles.find((angle) => angle.id === source.angle.id) ?? source.angle,
        }));
        const duration = getMulticamAnalysisDuration(alignedSources, buffers);
        if (!Number.isFinite(duration) || duration <= 0.1) {
          throw new Error("The camera recordings do not have enough overlapping audio.");
        }

        setStatus(groupId, "Running local Silero voice detection…");
        const vadTracks = new Map<string, import("@openreel/core").MulticamVadTrack>();
        for (const source of alignedSources) {
          const buffer = buffers.get(source.angle.id);
          if (!buffer) continue;
          const vadAudio = prepareMulticamAnalysisAudio(buffer, 16_000);
          const vad = await analyzeSileroVad(vadAudio.samples, vadAudio.sampleRate, {
            onProgress: (completed, total) => {
              if (completed === total || completed % 100 === 0) {
                setStatus(
                  groupId,
                  `Voice detection · ${source.angle.name} · ${Math.round((completed / total) * 100)}%`,
                );
              }
            },
          });
          vadTracks.set(source.angle.id, vad);
        }
        setStatus(groupId, "Calibrating room noise and microphone bleed…");
        const calibrationWindows = findMulticamCalibrationRanges(vadTracks);
        const calibrationSources = alignedSources.map((source) => {
          const buffer = buffers.get(source.angle.id);
          if (!buffer) throw new Error(`Missing decoded audio for ${source.angle.name}.`);
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
            if (!buffer) throw new Error(`Missing decoded audio for ${source.angle.name}.`);
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
        const currentProject = useProjectStore.getState().project;
        const manifest = liveGroup.manifest ?? buildMulticamManifest(
          currentProject,
          liveGroup,
          alignedSources,
          {
            min_shot_ms: editPolicy.minShotMs,
            max_shot_ms: Math.max(editPolicy.minShotMs, editPolicy.maxShotMs),
            cut_lead_ms: editPolicy.cutLeadMs,
            reaction_shot_after_ms: editPolicy.reactionShotAfterMs,
            forbid_jump_cut_same_subject: editPolicy.forbidJumpCutSameSubject,
          },
        );
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
              { onProgress: (message) => setStatus(groupId, message) },
            )
          : [];
        const shotPlan = incorporateMulticamReactionCues(
          planMulticamShots(activity, manifest, {
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
        multiCamEngine.applyAutomaticEdit(
          groupId,
          {
            duration: shotPlan.durationMs / 1_000,
            segments: shotPlan.shots.map((shot) => ({
              angleId: shot.layout.panels[0]?.cameraId ?? manifest.sync.reference,
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
                  const angle = liveGroup.angles.find((entry) => entry.id === angleId);
                  setStatus(groupId, `${angle?.name ?? angleId}: ${message}`);
                },
              })
            : undefined,
        });
        liveGroup.analysisArtifactId = await saveMulticamArtifact(
          currentProject.id,
          groupId,
          artifact,
        );

        const outputTrackId = liveGroup.outputTrackId ?? `multicam-output-${groupId}`;
        const sourceClips = new Map(
          alignedSources.map((source) => [source.clip.id, source.clip]),
        );
        const outputTracks = multiCamEngine.buildShotPlanTracks(
          groupId,
          outputTrackId,
          sourceClips,
          currentProject.settings,
        );
        if (outputTracks.length === 0 || outputTracks.every((track) => track.clips.length === 0)) {
          throw new Error("The detected cuts could not be mapped to source clips.");
        }
        multiCamEngine.setOutputTracks(groupId, outputTracks.map((track) => track.id));

        setStatus(groupId, `Applying ${Math.max(0, shotPlan.shots.length - 1)} cuts…`);
        const updatedGroup = multiCamEngine.getGroup(groupId);
        if (!updatedGroup) throw new Error("Camera group is no longer available.");
        const applyAction = createMulticamApplyTracksAction({
          project: currentProject,
          group: updatedGroup,
          groups: multiCamEngine.getAllGroups(),
          outputTracks,
        });
        ensureCurrent();
        const result = await useProjectStore.getState().executeAction(applyAction);
        if (!result.success) {
          throw new Error(result.error?.message ?? "Could not apply the automatic edit.");
        }
        setStatus(
          groupId,
          `${shotPlan.shots.length} shots created on “${group.name} Auto Edit”`,
        );
        toast.success(
          "Automatic multicam edit created",
          `${Math.max(0, shotPlan.shots.length - 1)} cuts · one undo step`,
        );
      } catch (error) {
        multiCamEngine.loadGroups(
          useProjectStore.getState().project.multicamGroups ?? [],
        );
        const message = error instanceof Error ? error.message : "Automatic edit failed.";
        setStatus(groupId, message);
        toast.error("Automatic edit failed", message);
      } finally {
        busyRef.current = false;
        setProcessingGroupId(null);
      }
    },
    [
      decodeGroupAudio,
      syncBeforeAutoEdit,
      editPolicy,
      includeTranscripts,
      includeVisualReactions,
      multiCamEngine,
      overlapEscalation,
      overlapStrategy,
      setStatus,
      updateGroupSourceLayout,
    ],
  );

  const downloadText = useCallback((filename: string, contents: string, type: string) => {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportOtio = useCallback((groupId: string) => {
    const group = multiCamEngine?.getGroup(groupId);
    if (!group?.manifest || !group.shotPlan) return;
    downloadText(
      `${group.name.replace(/[^a-z0-9-_]+/gi, "-")}.otio`,
      serializeMulticamOtio(group.shotPlan, group.manifest, group.name),
      "application/json",
    );
  }, [downloadText, multiCamEngine]);

  const handleExportOrma = useCallback(async (groupId: string) => {
    const group = multiCamEngine?.getGroup(groupId);
    if (!group) return;
    const artifact = await loadMulticamArtifact(
      useProjectStore.getState().project.id,
      groupId,
    );
    if (!artifact) {
      toast.error("Analysis unavailable", "Run Auto Edit before exporting the .orma artifact.");
      return;
    }
    downloadText(
      `${group.name.replace(/[^a-z0-9-_]+/gi, "-")}.orma`,
      serializeOrma(artifact),
      "application/vnd.openreel.activity+json",
    );
  }, [downloadText, multiCamEngine]);

  const handleImportManifest = useCallback(async (groupId: string, file: File) => {
    if (!multiCamEngine) return;
    try {
      const parsed = parseMulticamManifest(await file.text());
      const group = multiCamEngine.getGroup(groupId);
      if (!group) throw new Error("Camera group is no longer available.");
      const currentProject = useProjectStore.getState().project;
      const sources = resolveMulticamSources(currentProject, group);
      const unusedAngles = [...group.angles];
      const cameras = parsed.cameras.map((camera) => {
        const matched = unusedAngles.find((angle) => {
          const source = sources.find((entry) => entry.angle.id === angle.id);
          return (
            camera.angleId === angle.id ||
            camera.id === angle.id ||
            camera.clipId === angle.clipId ||
            camera.file === source?.media.sourceFile?.name ||
            camera.file === source?.media.name
          );
        }) ?? unusedAngles[0];
        if (!matched) throw new Error(`Could not map camera ${camera.id} (${camera.file}) to a selected angle.`);
        unusedAngles.splice(unusedAngles.indexOf(matched), 1);
        return { ...camera, clipId: matched.clipId, angleId: matched.id };
      });
      group.manifest = { ...parsed, cameras };
      await persistGroups();
      toast.success("Multicam manifest imported", `${parsed.participants.length} participants · ${parsed.cameras.length} cameras`);
    } catch (error) {
      toast.error("Manifest import failed", error instanceof Error ? error.message : undefined);
    }
  }, [multiCamEngine, persistGroups]);

  const handleExportManifest = useCallback((groupId: string) => {
    const group = multiCamEngine?.getGroup(groupId);
    if (!group?.manifest) return;
    downloadText(
      `${group.name.replace(/[^a-z0-9-_]+/gi, "-")}.multicam.json`,
      serializeMulticamManifest(group.manifest),
      "application/json",
    );
  }, [downloadText, multiCamEngine]);

  const handleFindSocialClips = useCallback(async (groupId: string) => {
    const artifact = await loadMulticamArtifact(
      useProjectStore.getState().project.id,
      groupId,
    );
    if (!artifact) {
      toast.error("Analysis unavailable", "Run Auto Edit before finding social clips.");
      return;
    }
    const candidates = extractMulticamSocialClips(artifact);
    const store = useProjectStore.getState();
    store.beginHistoryGroup("Add multicam social clip candidates");
    try {
      for (const candidate of candidates) {
        await useProjectStore.getState().executeAction({
          type: "marker/add",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: {
            time: candidate.startMs / 1_000,
            label: `Social · ${candidate.title ?? candidate.reason}`,
            color: "#f59e0b",
          },
        });
      }
    } finally {
      useProjectStore.getState().endHistoryGroup();
    }
    toast.success("Social clip candidates added", `${candidates.length} timeline markers`);
  }, []);

  const applyReviewedEdit = useCallback(
    async (groupId: string) => {
      if (!multiCamEngine) return;
      const group = multiCamEngine.getGroup(groupId);
      if (!group) return;
      const outputTrackId = group.outputTrackId ?? `multicam-output-${groupId}`;
      const currentProject = useProjectStore.getState().project;
      const sources = resolveMulticamSources(currentProject, group);
      const sourceClips = new Map(sources.map((source) => [source.clip.id, source.clip]));
      const outputTracks = group.shotPlan
        ? multiCamEngine.buildShotPlanTracks(
            groupId,
            outputTrackId,
            sourceClips,
            currentProject.settings,
          )
        : [];
      multiCamEngine.setOutputTracks(groupId, outputTracks.length ? outputTracks.map((track) => track.id) : [outputTrackId]);
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
      if (!result.success) throw new Error(result.error?.message ?? "Could not update cut review.");
    },
    [multiCamEngine],
  );

  const handleSelectAngle = useCallback(async (groupId: string, angleId: string) => {
    if (!multiCamEngine || busyRef.current) return;
    const group = multiCamEngine.getGroup(groupId);
    if (!group) return;
    const time = useTimelineStore.getState().playheadPosition - group.syncPoint;
    if (time < 0 || time >= group.duration) {
      toast.error("Move the playhead inside the camera group", `Group range: ${group.syncPoint.toFixed(2)}s – ${(group.syncPoint + group.duration).toFixed(2)}s`);
      return;
    }
    busyRef.current = true;
    setProcessingGroupId(groupId);
    try {
      if (!multiCamEngine.cutToAngle(groupId, angleId, time)) throw new Error("This camera is unavailable at the playhead.");
      await applyReviewedEdit(groupId);
      setStatus(groupId, `Camera cut added at ${(group.syncPoint + time).toFixed(2)}s · Undo restores the previous edit`);
    } catch (error) {
      multiCamEngine.loadGroups(useProjectStore.getState().project.multicamGroups ?? []);
      toast.error("Could not switch camera", error instanceof Error ? error.message : undefined);
    } finally {
      busyRef.current = false;
      setProcessingGroupId(null);
    }
  }, [applyReviewedEdit, multiCamEngine, setStatus]);

  const handleAcceptCut = useCallback(async (groupId: string, switchId: string) => {
    if (!multiCamEngine?.acceptSwitch(groupId, switchId)) return;
    try {
      await applyReviewedEdit(groupId);
    } catch (error) {
      multiCamEngine?.loadGroups(useProjectStore.getState().project.multicamGroups ?? []);
      toast.error("Could not accept cut", error instanceof Error ? error.message : undefined);
    }
  }, [applyReviewedEdit, multiCamEngine]);

  const handleRejectCut = useCallback(async (groupId: string, switchId: string) => {
    if (!multiCamEngine?.removeSwitch(groupId, switchId)) return;
    try {
      await applyReviewedEdit(groupId);
    } catch (error) {
      multiCamEngine?.loadGroups(useProjectStore.getState().project.multicamGroups ?? []);
      toast.error("Could not reject cut", error instanceof Error ? error.message : undefined);
    }
  }, [applyReviewedEdit, multiCamEngine]);

  const handleNudgeCut = useCallback(async (
    groupId: string,
    switchId: string,
    deltaSeconds: number,
  ) => {
    if (!multiCamEngine?.nudgeSwitch(groupId, switchId, deltaSeconds)) return;
    try {
      await applyReviewedEdit(groupId);
    } catch (error) {
      multiCamEngine?.loadGroups(useProjectStore.getState().project.multicamGroups ?? []);
      toast.error("Could not nudge cut", error instanceof Error ? error.message : undefined);
    }
  }, [applyReviewedEdit, multiCamEngine]);

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      if (!multiCamEngine) return;
      multiCamEngine.deleteGroup(groupId);
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
      void persistGroups().catch((error) =>
        toast.error("Could not delete group", error instanceof Error ? error.message : undefined),
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
    <fieldset disabled={Boolean(processingGroupId)} className="space-y-3 min-w-0">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Video size={16} className="text-primary" />
        <div className="flex-1 flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-fg">
            Multi-Camera Editing
          </span>
          <Text type="supporting" color="secondary" className="text-[9px] text-fg-3">
            Choose recordings of the same event, create a group, then sync audio or cut between cameras at the playhead.
          </Text>
        </div>
      </div>


      {groups.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-medium text-fg-2">
            Camera Groups
          </span>
          {groups.map((group) => (
            <GroupSection
              key={group.id}
              group={{ ...group, activeAngleId: multiCamEngine?.getAngleAtTime(group.id, playhead - group.syncPoint)?.id ?? group.activeAngleId }}
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
              onNudgeCut={(switchId, delta) => handleNudgeCut(group.id, switchId, delta)}
              onExportOtio={() => handleExportOtio(group.id)}
              onExportOrma={() => void handleExportOrma(group.id)}
              onFindSocialClips={() => void handleFindSocialClips(group.id)}
              onImportManifest={(file) => void handleImportManifest(group.id, file)}
              onExportManifest={() => handleExportManifest(group.id)}
              onDelete={() => handleDeleteGroup(group.id)}
              isProcessing={processingGroupId === group.id}
              status={groupStatus[group.id]}
            />
          ))}
        </div>
      )}

      <div className="space-y-2 pt-2 border-t border-border">
        <span className="block text-[10px] font-medium text-fg-2">
          Create New Group
        </span>
        <Text type="supporting" color="secondary" className="block text-[9px] text-fg-3">
          Choose 2 or more recordings of the same event. Use separate tracks for camera sources; source tracks are hidden and muted when the edit is created.
        </Text>

        {availableClips.length === 0 ? (
          <div className="text-center py-4">
            <Video
              size={24}
              className="mx-auto mb-2 text-fg-3 opacity-50"
            />
            <Text type="supporting" color="secondary" className="text-[10px] text-fg-3">
              Add video clips to unlocked timeline tracks to use multi-camera editing
            </Text>
          </div>
        ) : (
          <>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {availableClips.map((clip) => (
                <SelectableCard
                  key={clip.id}
                  label={`${clip.name} ${clip.trackName}`}
                  isSelected={selectedClips.includes(clip.id)}
                  onChange={() => toggleClipSelection(clip.id)}
                  padding={2}
                  variant={selectedClips.includes(clip.id) ? "green" : "muted"}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${
                    selectedClips.includes(clip.id)
                      ? "bg-primary/20 border border-primary"
                      : "bg-bg-2 border border-transparent hover:border-primary/30"
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
                    <span className="text-[10px] text-fg">
                      {clip.name}
                    </span>
                    <span className="text-[8px] text-fg-3 ml-1">
                      ({clip.trackName})
                    </span>
                  </div>
                </SelectableCard>
              ))}
            </div>

            <Button
              label={`Create Group (${selectedClips.length} selected)`}
              variant="primary"
              icon={<Plus size={12} />}
              onClick={handleCreateGroup}
              isDisabled={!multiCamEngine || selectedClips.length < 2 || Boolean(processingGroupId)}
              className={`w-full flex items-center justify-center gap-2 py-2 text-[10px] rounded-lg transition-colors ${
                selectedClips.length >= 2
                  ? "bg-primary text-white hover:bg-primary/90"
                  : "bg-bg-2 text-fg-3 cursor-not-allowed"
              }`}
            />
          </>
        )}
      </div>

      <details className="space-y-2 rounded-lg border border-border bg-bg-2 p-2">
        <summary className="cursor-pointer text-xs">Automatic edit settings</summary>
        <label className="flex items-center gap-2 text-[10px] text-fg-2">
          <input type="checkbox" checked={syncBeforeAutoEdit} onChange={(event) => setSyncBeforeAutoEdit(event.target.checked)} />
          Sync cameras before Auto Edit (turn off to use manual offsets)
        </label>
        <span className="text-[10px] font-medium text-fg-2">Automatic edit policy</span>
        <Selector
          label="Preset"
          size="sm"
          width="100%"
          value={policyPreset}
          onChange={(value) => {
            setPolicyPreset(value);
            if (value === "conversation" || value === "energetic" || value === "panel") {
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
        <Selector
          label="Overlapping speakers"
          size="sm"
          width="100%"
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
        <Selector
          label="Sustained overlap"
          size="sm"
          width="100%"
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
          <ToolcraftNumberInputControl
            label="Minimum shot"
            size="sm"
            value={minShotSeconds}
            min={0}
            max={30}
            step={0.1}
            unit="sec"
            onChange={(value) => setMinShotSeconds(value ?? 0)}
          />
          <ToolcraftNumberInputControl
            label="Maximum shot"
            size="sm"
            value={maxShotSeconds}
            min={0}
            max={120}
            step={1}
            unit="sec"
            onChange={(value) => setMaxShotSeconds(value ?? 0)}
          />
        </div>
        <Text type="supporting" color="secondary" className="block text-[9px] text-fg-3">
          Maximum shot length triggers a listener reaction or wide reset.
        </Text>
        <label className="flex items-center gap-2 text-[9px] text-fg-2">
          <input
            type="checkbox"
            checked={includeTranscripts}
            onChange={(event) => setIncludeTranscripts(event.target.checked)}
          />
          Add per-channel local Whisper transcripts to the .orma artifact
        </label>
        <label className="flex items-center gap-2 text-[9px] text-fg-2">
          <input
            type="checkbox"
            checked={includeVisualReactions}
            onChange={(event) => setIncludeVisualReactions(event.target.checked)}
          />
          Add local MediaPipe face/reaction cues (slower)
        </label>
      </details>
      <Text type="supporting" color="secondary" className="text-[9px] text-fg-3 text-center">
        Automatic edits create an editable timeline track and undo in one step
      </Text>
    </fieldset>
  );
};

export default MultiCameraPanel;
