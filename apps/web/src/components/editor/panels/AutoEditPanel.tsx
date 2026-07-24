import React, { useState, useCallback, useMemo } from "react";
import { Music, Zap, Loader2 } from "@/icons/lucide-compat";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftEmptyState as EmptyState } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftSliderControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import {
  getBeatDetectionEngine,
  getAutoEditService,
  type AutoEditOptions,
  type AutoEditResult,
  type CutMode,
  type BeatAnalysisResult,
  type Clip,
} from "@openreel/core";

interface AutoEditPanelProps {
  onClose: () => void;
}

export const AutoEditPanel: React.FC<AutoEditPanelProps> = ({ onClose }) => {
  const project = useProjectStore((s) => s.project);
  const [cutMode, setCutMode] = useState<CutMode>("beats");
  const [sensitivity, setSensitivity] = useState(0.5);
  const [minClipDuration, setMinClipDuration] = useState(0.5);
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<AutoEditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioClips = useMemo(() => {
    const clips: Clip[] = [];
    for (const track of project.timeline.tracks) {
      if (track.type === "audio") {
        clips.push(...track.clips);
      }
    }
    return clips;
  }, [project.timeline.tracks]);

  const videoClips = useMemo(() => {
    const clips: Clip[] = [];
    for (const track of project.timeline.tracks) {
      if (track.type === "video") {
        clips.push(...track.clips);
      }
    }
    return clips;
  }, [project.timeline.tracks]);

  const [selectedAudioClipId, setSelectedAudioClipId] = useState<string>(
    audioClips[0]?.id ?? "",
  );

  const audioClipOptions = useMemo(
    () =>
      audioClips.map((clip) => ({
        value: clip.id,
        label: `${clip.mediaId} (${clip.duration.toFixed(1)}s)`,
      })),
    [audioClips],
  );

  const handleAnalyze = useCallback(async () => {
    const audioClip = audioClips.find((c) => c.id === selectedAudioClipId);
    if (!audioClip || videoClips.length === 0) return;

    setAnalyzing(true);
    setError(null);
    setPreview(null);

    try {
      const beatEngine = getBeatDetectionEngine();

      let beatAnalysis: BeatAnalysisResult;
      const existing = project.timeline.beatAnalysis;
      if (existing && existing.sourceClipId === selectedAudioClipId) {
        beatAnalysis = {
          bpm: existing.bpm,
          confidence: existing.confidence,
          beats: project.timeline.beatMarkers?.map((m, i) => ({
            time: m.time,
            strength: m.strength,
            index: i,
          })) ?? [],
          duration: project.timeline.duration,
          downbeats: project.timeline.beatMarkers
            ?.filter((m) => m.isDownbeat)
            .map((m) => m.time) ?? [],
        };
      } else {
        const mediaItem = useProjectStore
          .getState()
          .project.mediaLibrary.items.find(
            (m) => m.id === audioClip.mediaId,
          );
        if (!mediaItem?.blob) {
          setError("Audio file not loaded");
          setAnalyzing(false);
          return;
        }
        beatAnalysis = await beatEngine.analyzeFromBlob(mediaItem.blob);
      }

      const options: AutoEditOptions = {
        cutMode,
        minClipDuration,
        maxClipDuration: 10,
        sensitivity,
      };

      const autoEditService = getAutoEditService();
      const result = autoEditService.generateCuts(
        beatAnalysis,
        videoClips,
        options,
      );
      setPreview(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to analyze audio",
      );
    } finally {
      setAnalyzing(false);
    }
  }, [
    audioClips,
    selectedAudioClipId,
    videoClips,
    cutMode,
    sensitivity,
    minClipDuration,
    project.timeline,
  ]);

  const handleApply = useCallback(() => {
    if (!preview || preview.cuts.length === 0) return;

    const tracks = [...project.timeline.tracks];
    const videoTrackIndex = tracks.findIndex((t) => t.type === "video");
    if (videoTrackIndex === -1) return;

    const newClips: Clip[] = preview.cuts.map((cut, index) => {
      const sourceClip = videoClips.find((c) => c.id === cut.sourceClipId);
      if (!sourceClip) return null;

      return {
        ...sourceClip,
        id: `auto-edit-${Date.now()}-${index}`,
        startTime: cut.startTime,
        duration: cut.duration,
        inPoint: cut.inPoint,
        outPoint: cut.outPoint,
      };
    }).filter((c): c is Clip => c !== null);

    const updatedTrack = {
      ...tracks[videoTrackIndex],
      clips: newClips,
    };
    tracks[videoTrackIndex] = updatedTrack;

    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks,
          duration: preview.totalDuration,
        },
        modifiedAt: Date.now(),
      },
    }));

    onClose();
  }, [preview, project.timeline.tracks, videoClips, onClose]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-primary" aria-hidden />
          <Text type="label" weight="bold" className="text-[11px]">
            Beat-Synced Auto-Edit
          </Text>
        </div>
      </div>

      {audioClips.length === 0 ? (
        <EmptyState
          title="Add an audio track to use auto-edit"
          icon={<Music size={24} className="text-text-muted opacity-50" aria-hidden />}
          isCompact
        />
      ) : (
        <>
          <Selector
            label="Audio Source"
            value={selectedAudioClipId}
            onChange={setSelectedAudioClipId}
            options={audioClipOptions}
            size="sm"
            className="w-full"
          />

          <div className="space-y-2">
            <Text type="supporting" color="secondary" weight="bold" display="block" className="text-[10px]">
              Cut Mode
            </Text>
            <ToolcraftSegmentedControl<CutMode>
              ariaLabel="Cut mode"
              value={cutMode}
              onChange={setCutMode}
              options={(["beats", "downbeats", "segments"] as CutMode[]).map(
                (mode) => ({
                  value: mode,
                  label: mode,
                }),
              )}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Text type="supporting" color="secondary" weight="bold" className="text-[10px]">
                Sensitivity
              </Text>
              <Text type="supporting" color="secondary" className="text-[9px]">
                {Math.round(sensitivity * 100)}%
              </Text>
            </div>
            <ToolcraftSliderControl
              label="Sensitivity"
              isLabelHidden
              min={0}
              max={1}
              step={0.05}
              value={sensitivity}
              onChange={setSensitivity}
              valueDisplay="none"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Text type="supporting" color="secondary" weight="bold" className="text-[10px]">
                Min Clip Duration
              </Text>
              <Text type="supporting" color="secondary" className="text-[9px]">
                {minClipDuration.toFixed(1)}s
              </Text>
            </div>
            <ToolcraftSliderControl
              label="Minimum clip duration"
              isLabelHidden
              min={0.1}
              max={3}
              step={0.1}
              value={minClipDuration}
              onChange={setMinClipDuration}
              valueDisplay="none"
            />
          </div>

          <Button
            label={analyzing ? "Analyzing beats..." : "Generate Auto-Edit"}
            onClick={handleAnalyze}
            isDisabled={analyzing || videoClips.length === 0}
            variant="primary"
            icon={
              analyzing ? (
                <Loader2 size={12} className="animate-spin" aria-hidden />
              ) : (
                <Zap size={12} aria-hidden />
              )
            }
            className="w-full"
          />

          {error && (
            <Card variant="red" padding={2}>
              <Text type="supporting" className="text-[9px]">
                {error}
              </Text>
            </Card>
          )}

          {preview && (
            <Card variant="muted" padding={3} className="space-y-2 border border-border">
              <Text type="label" weight="bold" display="block" className="text-[10px]">
                Preview
              </Text>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Text type="supporting" color="secondary" className="text-[9px]">
                    Cuts:{" "}
                  </Text>
                  <Text type="supporting" className="text-[9px]">
                    {preview.cuts.length}
                  </Text>
                </div>
                <div>
                  <Text type="supporting" color="secondary" className="text-[9px]">
                    Duration:{" "}
                  </Text>
                  <Text type="supporting" className="text-[9px]">
                    {preview.totalDuration.toFixed(1)}s
                  </Text>
                </div>
              </div>
              <Button
                label="Apply Auto-Edit"
                onClick={handleApply}
                variant="primary"
                size="sm"
                className="w-full"
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
};
