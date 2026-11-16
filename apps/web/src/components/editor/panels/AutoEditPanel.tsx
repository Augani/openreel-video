import {
  Label as RadioLabel,
  RadioGroup as ShadcnRadioGroup,
  RadioGroupItem as ShadcnRadioGroupItem,
  Select as ShadcnSelect,
  SelectTrigger as ShadcnSelectTrigger,
  SelectContent as ShadcnSelectContent,
  SelectValue as ShadcnSelectValue,
  SelectItem as ShadcnSelectItem,
  cn as uiCn,
  Label as ShadcnLabel,
  Button,
  Card,
} from "@openreel/ui";

import { PropertySlider } from "../inspector/shell/PropertySlider";

import React, { useState, useCallback, useMemo } from "react";
import { Music, Zap, Loader2 } from "@/icons/lucide-compat";







import { useProjectStore } from "../../../stores/project-store";
import {
  getBeatDetectionEngine,
  getAutoEditService,
  type AutoEditOptions,
  type AutoEditResult,
  type CutMode,
  type BeatAnalysisResult,
  type Clip,
  getMediaItemCapabilities,
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
      clips.push(
        ...track.clips.filter((clip) =>
          getMediaItemCapabilities(
            project.mediaLibrary.items.find(
              (mediaItem) => mediaItem.id === clip.mediaId,
            ),
          ).audio,
        ),
      );
    }
    return clips;
  }, [project]);

  const videoClips = useMemo(() => {
    const clips: Clip[] = [];
    for (const track of project.timeline.tracks) {
      clips.push(
        ...track.clips.filter(
          (clip) =>
            project.mediaLibrary.items.find(
              (mediaItem) => mediaItem.id === clip.mediaId,
            )?.type === "video",
        ),
      );
    }
    return clips;
  }, [project]);

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
    const sourceClipIds = new Set(videoClips.map((clip) => clip.id));
    const videoTrackIndex = tracks.findIndex((track) =>
      track.clips.some((clip) => sourceClipIds.has(clip.id)),
    );
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
          <span className="text-fg-2 font-bold text-[11px]">
            Beat-Synced Auto-Edit
          </span>
        </div>
      </div>

      {audioClips.length === 0 ? (
        <Card className="flex min-w-0 flex-col items-center justify-center gap-2 border-0 bg-transparent px-3 py-5 text-center text-fg-muted shadow-none"><div className="flex items-center justify-center">{<Music size={24} className="text-text-muted opacity-50" aria-hidden />}</div><p className="text-xs font-semibold text-fg-2">{"Add an audio track to use auto-edit"}</p></Card>
      ) : (
        <>
          <ShadcnLabel className="block min-w-0 space-y-1.5">
            <span className="block truncate text-[11px] font-medium text-text-secondary">
              {"Audio Source"}
            </span>
            <ShadcnSelect
              value={selectedAudioClipId || "__openreel_empty_option__"}
              disabled={false}
              onValueChange={(nextValue) =>
                setSelectedAudioClipId(
                  (nextValue === "__openreel_empty_option__"
                    ? ""
                    : nextValue) as Parameters<typeof setSelectedAudioClipId>[0],
                )
              }
            >
              <ShadcnSelectTrigger
                aria-label={"Audio Source"}
                className={uiCn(
                  "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-50",
                  "h-7 text-[12px]",
                  "w-full",
                  undefined,
                )}
              >
                <ShadcnSelectValue placeholder={undefined} />
              </ShadcnSelectTrigger>
              <ShadcnSelectContent>
                {audioClipOptions.map((option) => (
                  <ShadcnSelectItem
                    key={option.value}
                    value={option.value || "__openreel_empty_option__"}
                    disabled={"disabled" in option && option.disabled === true}
                  >
                    {option.label}
                  </ShadcnSelectItem>
                ))}
              </ShadcnSelectContent>
            </ShadcnSelect>
          </ShadcnLabel>

          <div className="space-y-2">
            <span className="text-fg-2 font-bold block text-[10px]">
              Cut Mode
            </span>
            <ShadcnRadioGroup
              aria-label={"Cut mode"}
              value={cutMode}
              onValueChange={(next) => {
                if (next) setCutMode(next as Parameters<typeof setCutMode>[0]);
              }}
              className="grid min-h-8 min-w-0 gap-0 rounded-[7px] border border-border bg-bg-1 p-0.5"
              style={{
                gridTemplateColumns: `repeat(${
                  (["beats", "downbeats", "segments"] as CutMode[]).map((mode) => ({
                    value: mode,
                    label: mode,
                  })).length
                }, minmax(0,1fr))`,
              }}
            >
              {(["beats", "downbeats", "segments"] as CutMode[])
                .map((mode) => ({
                  value: mode,
                  label: mode,
                }))
                .map((option) => (
                  <RadioLabel
                    key={option.value}
                    className="flex h-7 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[5px] px-2 text-[12px] font-semibold text-fg-muted focus-within:ring-2 focus-within:ring-ring has-[[data-state=checked]]:bg-bg-3 has-[[data-state=checked]]:text-fg"
                  >
                    <ShadcnRadioGroupItem data-value={option.value}
                      value={option.value}
                      aria-label={option.label ?? option.value}
                      className="sr-only"
                    />
                    {option.label}
                  </RadioLabel>
                ))}
            </ShadcnRadioGroup>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-fg-2 font-bold text-[10px]">
                Sensitivity
              </span>
              <span className="text-fg-2 font-normal text-[9px]">
                {Math.round(sensitivity * 100)}%
              </span>
            </div>
            <PropertySlider ariaLabel={"Sensitivity"}
value={sensitivity}
min={0}
max={1}
step={0.05}
onChange={setSensitivity}
isDisabled={false}
showValueLabel={false} />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-fg-2 font-bold text-[10px]">
                Min Clip Duration
              </span>
              <span className="text-fg-2 font-normal text-[9px]">
                {minClipDuration.toFixed(1)}s
              </span>
            </div>
            <PropertySlider ariaLabel={"Minimum clip duration"}
value={minClipDuration}
min={0.1}
max={3}
step={0.1}
onChange={setMinClipDuration}
isDisabled={false}
showValueLabel={false} />
          </div>

          <Button onClick={handleAnalyze} type="button" aria-label={(analyzing ? "Analyzing beats..." : "Generate Auto-Edit").trim() || undefined} disabled={(analyzing || videoClips.length === 0)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{analyzing ? (
                <Loader2 size={12} className="animate-spin" aria-hidden />
              ) : (
                <Zap size={12} aria-hidden />
              )}</span>
            <span className="truncate">{analyzing ? "Analyzing beats..." : "Generate Auto-Edit"}</span>
          </Button>

          {error && (
            <Card className="min-w-0 rounded-[7px] border shadow-none border-status-error/25 bg-status-error/10 text-fg p-2">
              <span className="text-fg-2 font-normal text-[9px]">
                {error}
              </span>
            </Card>
          )}

          {preview && (
            <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-3 space-y-2 border border-border">
              <span className="text-fg-2 font-bold block text-[10px]">
                Preview
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-fg-2 font-normal text-[9px]">
                    Cuts:{" "}
                  </span>
                  <span className="text-fg-2 font-normal text-[9px]">
                    {preview.cuts.length}
                  </span>
                </div>
                <div>
                  <span className="text-fg-2 font-normal text-[9px]">
                    Duration:{" "}
                  </span>
                  <span className="text-fg-2 font-normal text-[9px]">
                    {preview.totalDuration.toFixed(1)}s
                  </span>
                </div>
              </div>
              <Button onClick={handleApply} type="button" aria-label="Apply Auto-Edit" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full">
                <span className="truncate">{"Apply Auto-Edit"}</span>
              </Button>
            </Card>
          )}
        </>
      )}
    </div>
  );
};
