import React, { useState, useCallback, useMemo } from "react";
import { Music, Zap, Loader2 } from "lucide-react";
import { Slider } from "@openreel/ui";
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
          <Zap size={14} className="text-primary" />
          <span className="text-[11px] font-medium text-text-primary">
            Beat-Synced Auto-Edit
          </span>
        </div>
      </div>

      {audioClips.length === 0 ? (
        <div className="text-center py-6 text-text-muted text-[10px]">
          <Music size={24} className="mx-auto mb-2 opacity-50" />
          <p>Add an audio track to use auto-edit</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <label className="text-[10px] font-medium text-text-secondary">
              Audio Source
            </label>
            <select
              value={selectedAudioClipId}
              onChange={(e) => setSelectedAudioClipId(e.target.value)}
              className="w-full px-2 py-1.5 text-[10px] bg-background-tertiary border border-border rounded-lg text-text-primary"
            >
              {audioClips.map((clip) => (
                <option key={clip.id} value={clip.id}>
                  {clip.mediaId} ({clip.duration.toFixed(1)}s)
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-medium text-text-secondary">
              Cut Mode
            </label>
            <div className="grid grid-cols-3 gap-1">
              {(["beats", "downbeats", "segments"] as CutMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setCutMode(mode)}
                  className={`py-1.5 text-[9px] rounded-lg border transition-colors capitalize ${
                    cutMode === mode
                      ? "bg-primary/20 border-primary text-primary"
                      : "bg-background-tertiary border-border text-text-secondary hover:border-primary/50"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <label className="text-[10px] font-medium text-text-secondary">
                Sensitivity
              </label>
              <span className="text-[9px] text-text-muted">
                {Math.round(sensitivity * 100)}%
              </span>
            </div>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[sensitivity]}
              onValueChange={(v) => setSensitivity(v[0])}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <label className="text-[10px] font-medium text-text-secondary">
                Min Clip Duration
              </label>
              <span className="text-[9px] text-text-muted">
                {minClipDuration.toFixed(1)}s
              </span>
            </div>
            <Slider
              min={0.1}
              max={3}
              step={0.1}
              value={[minClipDuration]}
              onValueChange={(v) => setMinClipDuration(v[0])}
            />
          </div>

          <button
            onClick={handleAnalyze}
            disabled={analyzing || videoClips.length === 0}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-[10px] font-medium bg-primary/20 border border-primary/30 text-primary rounded-lg hover:bg-primary/30 transition-colors disabled:opacity-50"
          >
            {analyzing ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Analyzing beats...
              </>
            ) : (
              <>
                <Zap size={12} />
                Generate Auto-Edit
              </>
            )}
          </button>

          {error && (
            <p className="text-[9px] text-red-400">{error}</p>
          )}

          {preview && (
            <div className="space-y-2 p-2.5 bg-background-tertiary rounded-lg border border-border">
              <p className="text-[10px] font-medium text-text-primary">
                Preview
              </p>
              <div className="grid grid-cols-2 gap-2 text-[9px]">
                <div>
                  <span className="text-text-muted">Cuts: </span>
                  <span className="text-text-primary">{preview.cuts.length}</span>
                </div>
                <div>
                  <span className="text-text-muted">Duration: </span>
                  <span className="text-text-primary">
                    {preview.totalDuration.toFixed(1)}s
                  </span>
                </div>
              </div>
              <button
                onClick={handleApply}
                className="w-full py-2 text-[10px] font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                Apply Auto-Edit
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
