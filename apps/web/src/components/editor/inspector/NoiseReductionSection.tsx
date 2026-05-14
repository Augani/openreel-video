import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Volume2, Wand2, AlertCircle, Check } from "lucide-react";
import {
  autoLearnNoiseProfile,
  extractAudioSegment,
  resolveAudibleAudioTarget,
  SpectralNoiseReducer,
  type Clip,
  type Project,
} from "@openreel/core";
import {
  getAudioBridgeEffects,
  initializeAudioBridgeEffects,
  type NoiseReductionConfig,
  type NoiseReductionFocus,
  type NoiseProfileData,
  type SerializedNoiseProfile,
  DEFAULT_NOISE_REDUCTION,
} from "../../../bridges/audio-bridge-effects";
import { useProjectStore } from "../../../stores/project-store";
import { LabeledSlider as Slider } from "@openreel/ui";
import {
  NOISE_REDUCTION_PRESETS,
  getNoiseReductionPreset,
  suggestNoiseReductionConfig,
  suggestNoiseReductionPreset,
} from "./noise-reduction-presets";
import {
  loadAudioBuffer,
  type AudioLoadProgress,
} from "../../../utils/load-audio-buffer";

/**
 * NoiseReductionSection Props
 */
interface NoiseReductionSectionProps {
  clipId: string;
}

const DEFAULT_NOISE_REDUCTION_STATE: NoiseReductionConfig = {
  threshold: DEFAULT_NOISE_REDUCTION.threshold,
  reduction: DEFAULT_NOISE_REDUCTION.reduction,
  attack: DEFAULT_NOISE_REDUCTION.attack,
  release: DEFAULT_NOISE_REDUCTION.release,
  focus: DEFAULT_NOISE_REDUCTION.focus,
};

/**
 * Learning state for noise profile
 */
type LearningState = "idle" | "learning" | "ready" | "applying" | "success" | "error";

interface NoiseRecommendation {
  presetId: NoiseReductionFocus;
  config: NoiseReductionConfig;
  profile?: SerializedNoiseProfile;
  hasLearnedProfile: boolean;
}

interface LearnedNoiseProfileResult {
  profile: NoiseProfileData;
  serializedProfile: SerializedNoiseProfile;
}

interface NoiseAnalysisResult {
  recommendationProfile: NoiseProfileData;
  learnedProfile: LearnedNoiseProfileResult | null;
}

interface AnalysisProgressState {
  progress: number;
  message: string;
}

const MAX_RECOMMENDATION_SAMPLE_SECONDS = 20;

const findClipById = (project: Project, clipId: string): Clip | null => {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) {
      return clip;
    }
  }

  return null;
};

const buildRecommendationProfile = (
  clipId: string,
  audioBuffer: AudioBuffer,
  context: BaseAudioContext,
): NoiseProfileData => {
  const sampleDuration = Math.min(
    audioBuffer.duration,
    MAX_RECOMMENDATION_SAMPLE_SECONDS,
  );
  const sampleStart = Math.max(0, (audioBuffer.duration - sampleDuration) / 2);
  const sampleBuffer =
    sampleDuration < audioBuffer.duration
      ? extractAudioSegment(
          audioBuffer,
          sampleStart,
          sampleStart + sampleDuration,
          context,
        )
      : audioBuffer;

  const reducer = new SpectralNoiseReducer();
  const profile = reducer.learnNoiseProfile(sampleBuffer);

  return {
    id: `analysis-${clipId}`,
    frequencyBins: profile.frequencyBins,
    magnitudes: profile.magnitudes,
    standardDeviations: profile.standardDeviations,
    sampleRate: profile.sampleRate,
    fftSize: profile.fftSize,
    createdAt: Date.now(),
  };
};

/**
 * NoiseReductionSection Component
 *
 * - 14.1: Display noise reduction controls (threshold, reduction)
 * - 14.2: Learn noise profile from audio segment
 * - 14.3: Apply noise reduction with learned profile
 */
export const NoiseReductionSection: React.FC<NoiseReductionSectionProps> = ({
  clipId,
}) => {
  const defaultFocus = DEFAULT_NOISE_REDUCTION.focus ?? "balanced";
  const project = useProjectStore((state) => state.project);
  const audioTargetClip = React.useMemo(() => {
    const clip = findClipById(project, clipId);
    return clip ? resolveAudibleAudioTarget(clip, project.timeline) : null;
  }, [clipId, project]);
  const audioTargetClipId = audioTargetClip?.id ?? clipId;
  const audioEffects = useProjectStore((state) =>
    state.getAudioEffects(audioTargetClipId),
  );
  const setAudioEffectPreviewBypass = useProjectStore(
    (state) => state.setAudioEffectPreviewBypass,
  );
  const toggleAudioEffect = useProjectStore((state) => state.toggleAudioEffect);

  const [enabled, setEnabled] = useState(false);
  const [effectId, setEffectId] = useState<string | null>(null);
  const [config, setConfig] = useState<NoiseReductionConfig>(
    DEFAULT_NOISE_REDUCTION_STATE,
  );

  const [learningState, setLearningState] = useState<LearningState>("idle");
  const [activePresetId, setActivePresetId] =
    useState<NoiseReductionFocus>(defaultFocus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recommendation, setRecommendation] =
    useState<NoiseRecommendation | null>(null);
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgressState | null>(null);

  const [isOpen, setIsOpen] = useState(true);

  const activePreset = getNoiseReductionPreset(activePresetId);
  const activeEffect = audioEffects.find((effect) => effect.type === "noiseReduction");
  const previewingOriginal = activeEffect?.metadata?.previewBypass === true;

  useEffect(() => {
    initializeAudioBridgeEffects().catch((error) => {
      console.error("Failed to initialize AudioBridgeEffects:", error);
    });
  }, []);

  useEffect(() => {
    setRecommendation(null);
    setLearningState("idle");
    setErrorMessage(null);
    setAppliedMessage(null);
    setAnalysisProgress(null);
  }, [audioTargetClipId, clipId]);

  useEffect(() => {
    const noiseEffect = audioEffects.find((effect) => effect.type === "noiseReduction");

    if (noiseEffect) {
      setEnabled(noiseEffect.enabled);
      setEffectId(noiseEffect.id);
      const params = noiseEffect.params as Partial<NoiseReductionConfig>;
      setConfig({
        ...DEFAULT_NOISE_REDUCTION_STATE,
        ...params,
      });
      setActivePresetId((params.focus ?? defaultFocus) as NoiseReductionFocus);
      return;
    }

    setEnabled(false);
    setEffectId(null);
    setConfig(DEFAULT_NOISE_REDUCTION_STATE);
    setActivePresetId(defaultFocus);
  }, [audioEffects, clipId, defaultFocus]);

  const applyNoiseReductionConfig = useCallback(
    (nextConfig: NoiseReductionConfig, existingEffectId = effectId) => {
      const bridge = getAudioBridgeEffects();

      if (existingEffectId) {
        const updateResult = bridge.updateNoiseReduction(
          audioTargetClipId,
          existingEffectId,
          nextConfig,
        );

        if (!updateResult.success) {
          throw new Error(
            updateResult.error ?? "Failed to update noise reduction",
          );
        }

        toggleAudioEffect(audioTargetClipId, existingEffectId, true);
        setAudioEffectPreviewBypass(audioTargetClipId, existingEffectId, false);
        setEnabled(true);
        window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
        return existingEffectId;
      }

      const applyResult = bridge.applyNoiseReduction(audioTargetClipId, nextConfig);

      if (!applyResult.success || !applyResult.effectId) {
        throw new Error(applyResult.error ?? "Failed to apply noise reduction");
      }

      setEffectId(applyResult.effectId);
      setAudioEffectPreviewBypass(audioTargetClipId, applyResult.effectId, false);
      setEnabled(true);
      window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
      return applyResult.effectId;
    },
    [audioTargetClipId, effectId, setAudioEffectPreviewBypass, toggleAudioEffect],
  );

  const handleToggle = useCallback(
    (newEnabled: boolean) => {
      if (newEnabled && !effectId) {
        try {
          applyNoiseReductionConfig(config);
        } catch (error) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Failed to apply noise reduction",
          );
          return;
        }
      } else if (effectId) {
        toggleAudioEffect(audioTargetClipId, effectId, newEnabled);
        window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
      }

      setEnabled(newEnabled);
    },
    [
      applyNoiseReductionConfig,
      audioTargetClipId,
      config,
      effectId,
      toggleAudioEffect,
    ],
  );

  const handleConfigChange = useCallback(
    (key: keyof NoiseReductionConfig, value: number) => {
      const bridge = getAudioBridgeEffects();

      setConfig((prev) => {
        const newConfig = { ...prev, [key]: value };

        if (effectId && enabled) {
          bridge.updateNoiseReduction(audioTargetClipId, effectId, newConfig);
          window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
        }

        return newConfig;
      });
    },
    [audioTargetClipId, effectId, enabled],
  );

  const updateAnalysisProgress = useCallback((progress: AudioLoadProgress | AnalysisProgressState) => {
    setAnalysisProgress({
      progress: Math.max(0, Math.min(1, progress.progress)),
      message: progress.message,
    });
  }, []);

  const analyzeNoiseForClip = useCallback(
    async (): Promise<NoiseAnalysisResult> => {
      const project = useProjectStore.getState().project;
      const clip = project.timeline.tracks
        .flatMap((track) => track.clips)
        .find((candidate) => candidate.id === audioTargetClipId);

      if (!clip) {
        throw new Error("Clip not found");
      }

      const mediaItem = project.mediaLibrary.items.find(
        (candidate) => candidate.id === clip.mediaId,
      );

      if (!mediaItem?.blob) {
        throw new Error("No audio data available for this clip");
      }

      let audioContext: AudioContext | null = null;

      try {
        updateAnalysisProgress({ progress: 0.03, message: "Preparing clip analysis" });
        audioContext = new AudioContext();
        const audioBuffer = await loadAudioBuffer(
          audioContext,
          mediaItem.blob,
          {
            audioTrackIndex: clip.audioTrackIndex ?? 0,
            onProgress: updateAnalysisProgress,
          },
        );

        if (!audioBuffer) {
          throw new Error("Failed to decode audio for analysis");
        }

        const clipStart = Math.max(0, clip.inPoint || 0);
        const clipEnd = Math.min(
          audioBuffer.duration,
          clip.outPoint > clipStart ? clip.outPoint : clipStart + clip.duration,
        );

        if (clipEnd <= clipStart) {
          throw new Error("Clip audio range is empty");
        }

        const analysisContext = new OfflineAudioContext(
          audioBuffer.numberOfChannels,
          Math.max(1, Math.ceil((clipEnd - clipStart) * audioBuffer.sampleRate)),
          audioBuffer.sampleRate,
        );

        const clipBuffer = extractAudioSegment(
          audioBuffer,
          clipStart,
          clipEnd,
          analysisContext,
        );

        updateAnalysisProgress({ progress: 0.84, message: "Analyzing noise signature" });
        const recommendationProfile = buildRecommendationProfile(
          audioTargetClipId,
          clipBuffer,
          analysisContext,
        );

        updateAnalysisProgress({ progress: 0.93, message: "Learning custom cleanup profile" });

        const analyzedProfile = await autoLearnNoiseProfile(
          clipBuffer,
          analysisContext,
        );

        updateAnalysisProgress({ progress: 1, message: "Recommendation ready" });

        if (!analyzedProfile) {
          return {
            recommendationProfile,
            learnedProfile: null,
          };
        }

        const learnedProfile: NoiseProfileData = {
          id: `profile-${audioTargetClipId}`,
          frequencyBins: analyzedProfile.frequencyBins,
          magnitudes: analyzedProfile.magnitudes,
          standardDeviations: analyzedProfile.standardDeviations,
          sampleRate: analyzedProfile.sampleRate,
          fftSize: analyzedProfile.fftSize,
          createdAt: Date.now(),
        };

        return {
          recommendationProfile: learnedProfile,
          learnedProfile: {
            profile: learnedProfile,
            serializedProfile: {
              frequencyBins: Array.from(learnedProfile.frequencyBins),
              magnitudes: Array.from(learnedProfile.magnitudes),
              standardDeviations: learnedProfile.standardDeviations
                ? Array.from(learnedProfile.standardDeviations)
                : undefined,
              sampleRate: learnedProfile.sampleRate,
              fftSize: learnedProfile.fftSize,
            },
          },
        };
      } finally {
        await audioContext?.close();
      }
    },
    [audioTargetClipId, updateAnalysisProgress],
  );

  const handleApplyPreset = useCallback(
    async (presetId: NoiseReductionFocus) => {
      setErrorMessage(null);
      setRecommendation(null);
      setAppliedMessage(null);
      setLearningState("applying");

      try {
        const presetConfig = getNoiseReductionPreset(presetId).config;
        const nextConfig: NoiseReductionConfig = config.profile
          ? { ...presetConfig, profile: config.profile }
          : { ...presetConfig };

        setActivePresetId(presetId);
        setConfig(nextConfig);
        const nextEffectId = applyNoiseReductionConfig(nextConfig);
        let message = `${getNoiseReductionPreset(presetId).label} applied to this clip.`;

        try {
          const { learnedProfile } = await analyzeNoiseForClip();
          if (!learnedProfile) {
            setAnalysisProgress(null);
            setAppliedMessage(message);
            setLearningState("success");
            setTimeout(() => {
              setLearningState("idle");
            }, 2000);
            return;
          }
          const profiledConfig: NoiseReductionConfig = {
            ...presetConfig,
            profile: learnedProfile.serializedProfile,
          };
          setConfig(profiledConfig);
          applyNoiseReductionConfig(profiledConfig, nextEffectId);
          message = `${getNoiseReductionPreset(presetId).label} learned and applied to this clip.`;
        } catch {
          message = `${getNoiseReductionPreset(presetId).label} applied to this clip.`;
        }

        setAnalysisProgress(null);
        setAppliedMessage(message);
        setLearningState("success");
        setTimeout(() => {
          setLearningState("idle");
        }, 2000);
      } catch (error) {
        setLearningState("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to apply noise reduction preset",
        );
      }
    },
    [applyNoiseReductionConfig, analyzeNoiseForClip, config.profile],
  );

  const handleSetPreviewMode = useCallback(
    (mode: "original" | "cleaned") => {
      if (!effectId) {
        return;
      }

      setAudioEffectPreviewBypass(audioTargetClipId, effectId, mode === "original");
      window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
    },
    [audioTargetClipId, effectId, setAudioEffectPreviewBypass],
  );

  const handleLearnNoiseProfile = useCallback(async () => {
    setLearningState("learning");
    setErrorMessage(null);
    setRecommendation(null);
    setAppliedMessage(null);
    setAnalysisProgress({ progress: 0.02, message: "Preparing clip analysis" });

    try {
      const { recommendationProfile, learnedProfile } = await analyzeNoiseForClip();

      const suggestedPresetId = suggestNoiseReductionPreset(recommendationProfile);
      const suggestedConfig: NoiseReductionConfig = learnedProfile
        ? {
            ...suggestNoiseReductionConfig(recommendationProfile),
            profile: learnedProfile.serializedProfile,
          }
        : suggestNoiseReductionConfig(recommendationProfile);

      setRecommendation({
        presetId: suggestedPresetId,
        config: suggestedConfig,
        profile: learnedProfile?.serializedProfile,
        hasLearnedProfile: learnedProfile !== null,
      });
      setAnalysisProgress(null);
      setLearningState("ready");
    } catch (error) {
      setLearningState("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to analyze this clip",
      );
      setAnalysisProgress(null);

      setTimeout(() => {
        setLearningState("idle");
        setErrorMessage(null);
      }, 3000);
    }
  }, [analyzeNoiseForClip]);

  const handleApplyRecommendation = useCallback(() => {
    if (!recommendation) {
      return;
    }

    setLearningState("applying");
    setErrorMessage(null);

    try {
      setConfig(recommendation.config);
      setActivePresetId(recommendation.presetId);
      applyNoiseReductionConfig(recommendation.config);
      setRecommendation(null);
      setAppliedMessage(
        `${getNoiseReductionPreset(recommendation.presetId).label} applied to this clip.`,
      );
      setLearningState("success");
      setTimeout(() => {
        setLearningState("idle");
      }, 2000);
    } catch (error) {
      setLearningState("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to apply recommended cleanup",
      );
    }
  }, [applyNoiseReductionConfig, recommendation]);

  const recommendationPreset = recommendation
    ? getNoiseReductionPreset(recommendation.presetId)
    : null;

  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        enabled ? "border-border" : "border-border/50 opacity-60"
      }`}
    >
      <div className="flex items-center gap-2 p-2 bg-background-tertiary">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex-1 flex items-center gap-1"
        >
          <ChevronDown
            size={12}
            className={`transition-transform ${
              isOpen ? "" : "-rotate-90"
            } text-text-muted`}
          />
          <Volume2 size={12} className="text-text-muted" />
          <span className="text-[10px] font-medium text-text-primary">
            Noise Reduction
          </span>
        </button>
        <button
          onClick={() => handleToggle(!enabled)}
          className={`w-8 h-4 rounded-full transition-colors ${
            enabled
              ? "bg-primary"
              : "bg-background-tertiary border border-border"
          }`}
        >
          <div
            className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {isOpen && (
        <div className="p-3 space-y-3">
          <p className="text-[9px] leading-relaxed text-text-muted">
            Reduce white noise, wind, hum, room tone, and background music while
            keeping speech or the wanted audio in front.
          </p>

          <div className="grid grid-cols-2 gap-2">
            {NOISE_REDUCTION_PRESETS.map((preset) => {
              const isActive = preset.id === activePresetId;

              return (
                <button
                  key={preset.id}
                  onClick={() => handleApplyPreset(preset.id)}
                  disabled={learningState === "learning" || learningState === "applying"}
                  className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                    isActive
                      ? "border-primary bg-primary/10 text-text-primary"
                      : "border-border bg-background-secondary text-text-secondary hover:border-primary/50 hover:bg-primary/5"
                  } disabled:cursor-wait disabled:opacity-70`}
                >
                  <div className="text-[10px] font-medium">{preset.label}</div>
                  <div className="mt-1 text-[9px] leading-relaxed opacity-80">
                    {preset.description}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-border/70 bg-background-secondary/60 px-2 py-2 text-[9px] text-text-muted">
            <div className="flex items-center justify-between gap-2">
              <span>
                Current mode: <span className="text-text-primary">{activePreset.label}</span>
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[8px] font-medium ${
                  enabled
                    ? "bg-green-500/15 text-green-400"
                    : "bg-background-tertiary text-text-muted"
                }`}
              >
                {enabled ? "Applied" : "Off"}
              </span>
            </div>
            <div className="mt-1">{activePreset.description}</div>
            {appliedMessage && (
              <div className="mt-2 rounded-md border border-green-500/20 bg-green-500/10 px-2 py-1 text-green-400">
                {appliedMessage}
              </div>
            )}
          </div>

          {recommendation && recommendationPreset && (
            <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-3">
              <div className="flex items-center gap-2 text-primary">
                <Wand2 size={12} />
                <span className="text-[10px] font-medium">Recommendation ready</span>
              </div>
              <p className="text-[9px] leading-relaxed text-text-secondary">
                Detected noise best matches {recommendationPreset.label.toLowerCase()}.
                {recommendation.hasLearnedProfile
                  ? ` Apply ${Math.round(recommendation.config.reduction * 100)}% cleanup at ${recommendation.config.threshold.toFixed(0)} dB to save this profile on the clip.`
                  : ` Apply ${Math.round(recommendation.config.reduction * 100)}% cleanup at ${recommendation.config.threshold.toFixed(0)} dB. A custom profile could not be isolated, so this recommendation uses the best preset match for the clip.`}
              </p>
              <button
                onClick={handleApplyRecommendation}
                disabled={learningState === "applying"}
                className="w-full rounded-lg bg-primary px-3 py-2 text-[10px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-wait disabled:opacity-70"
              >
                {learningState === "applying" ? "Applying..." : "Apply Recommended Cleanup"}
              </button>
            </div>
          )}

          <div className="space-y-2 rounded-lg border border-border/70 bg-background-secondary/60 px-2 py-2">
            <div className="text-[9px] font-medium text-text-primary">
              A/B Preview
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleSetPreviewMode("original")}
                disabled={!effectId}
                className={`rounded-lg border px-2 py-1.5 text-[10px] transition-colors ${
                  previewingOriginal
                    ? "border-primary bg-primary/10 text-text-primary"
                    : "border-border bg-background-secondary text-text-secondary hover:border-primary/50"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Hear Original
              </button>
              <button
                onClick={() => handleSetPreviewMode("cleaned")}
                disabled={!effectId}
                className={`rounded-lg border px-2 py-1.5 text-[10px] transition-colors ${
                  !previewingOriginal
                    ? "border-primary bg-primary/10 text-text-primary"
                    : "border-border bg-background-secondary text-text-secondary hover:border-primary/50"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Hear Cleaned
              </button>
            </div>
            <p className="text-[9px] leading-relaxed text-text-muted">
              Preview only. Export still uses the cleaned audio effect chain.
            </p>
          </div>

          <Slider
            label="Threshold"
            value={config.threshold}
            onChange={(v) => handleConfigChange("threshold", v)}
            min={-80}
            max={0}
            unit="dB"
          />

          <Slider
            label="Reduction"
            value={config.reduction * 100}
            onChange={(v) => handleConfigChange("reduction", v / 100)}
            min={0}
            max={100}
            unit="%"
          />

          <Slider
            label="Attack"
            value={config.attack ?? 10}
            onChange={(v) => handleConfigChange("attack", v)}
            min={0}
            max={100}
            unit="ms"
          />

          <Slider
            label="Release"
            value={config.release ?? 100}
            onChange={(v) => handleConfigChange("release", v)}
            min={0}
            max={500}
            unit="ms"
          />

          <button
            onClick={handleLearnNoiseProfile}
            disabled={learningState === "learning" || learningState === "applying"}
            className={`w-full py-2 rounded-lg text-[10px] font-medium transition-colors flex items-center justify-center gap-2 ${
              learningState === "learning" || learningState === "applying"
                ? "bg-primary/20 text-primary cursor-wait"
                : learningState === "ready"
                  ? "bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20"
                : learningState === "success"
                  ? "bg-green-500/20 text-green-500"
                  : learningState === "error"
                    ? "bg-red-500/20 text-red-500"
                    : "bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20"
            }`}
          >
            {learningState === "learning" ? (
              <>
                <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Analyzing...
              </>
            ) : learningState === "applying" ? (
              <>
                <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Applying cleanup...
              </>
            ) : learningState === "ready" ? (
              <>
                <Check size={12} />
                Recommendation Ready
              </>
            ) : learningState === "success" ? (
              <>
                <Check size={12} />
                Cleanup Applied
              </>
            ) : learningState === "error" ? (
              <>
                <AlertCircle size={12} />
                Analysis Failed
              </>
            ) : (
              <>
                <Wand2 size={12} />
                Analyze & Recommend
              </>
            )}
          </button>

          {analysisProgress && (learningState === "learning" || learningState === "applying") && (
            <div className="space-y-1 rounded-lg border border-primary/20 bg-primary/5 px-2 py-2">
              <div className="flex items-center justify-between text-[9px] text-text-secondary">
                <span>{analysisProgress.message}</span>
                <span>{Math.round(analysisProgress.progress * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-background-tertiary">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(6, Math.round(analysisProgress.progress * 100))}%` }}
                />
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="text-[9px] text-red-500 text-center">
              {errorMessage}
            </div>
          )}

          {config.profile && !recommendation && learningState !== "error" && (
            <div className="text-[9px] text-text-muted text-center">
              Learned noise profile is active on this clip.
              <br />
              Auto-tuned with {activePreset.label.toLowerCase()} and reused for export cleanup.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NoiseReductionSection;
