import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Volume2, Wand2, AlertCircle, Check } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftProgressBar as ProgressBar } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { MockToggle } from "./shell/InspectorControls";
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
import { useTranslation } from "react-i18next";

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

interface RecommendationProfileProgress {
  progress: number;
  message: string;
}

export interface RecommendationSampleRange {
  start: number;
  end: number;
}

const MAX_RECOMMENDATION_SAMPLE_SECONDS = 24;
const MAX_RECOMMENDATION_SAMPLE_WINDOWS = 3;
const MIN_RECOMMENDATION_WINDOW_SECONDS = 4;

const findClipById = (project: Project, clipId: string): Clip | null => {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) {
      return clip;
    }
  }

  return null;
};

export const getRecommendationSampleRanges = (
  duration: number,
): RecommendationSampleRange[] => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [];
  }

  if (duration <= MAX_RECOMMENDATION_SAMPLE_SECONDS) {
    return [{ start: 0, end: duration }];
  }

  const maxWindowsByDuration = Math.max(
    1,
    Math.min(
      MAX_RECOMMENDATION_SAMPLE_WINDOWS,
      Math.floor(duration / MIN_RECOMMENDATION_WINDOW_SECONDS),
    ),
  );
  const windowCount = Math.max(
    1,
    Math.min(
      maxWindowsByDuration,
      Math.ceil(duration / MAX_RECOMMENDATION_SAMPLE_SECONDS),
    ),
  );
  const windowDuration = Math.min(
    duration,
    MAX_RECOMMENDATION_SAMPLE_SECONDS / windowCount,
  );
  const firstCenter = windowCount === 1 ? 0.5 : 0.18;
  const lastCenter = windowCount === 1 ? 0.5 : 0.82;

  return Array.from({ length: windowCount }, (_, index) => {
    const center =
      windowCount === 1
        ? 0.5
        : firstCenter +
          ((lastCenter - firstCenter) * index) / (windowCount - 1);
    const maxStart = Math.max(0, duration - windowDuration);
    const start = Math.min(
      maxStart,
      Math.max(0, duration * center - windowDuration / 2),
    );

    return {
      start,
      end: Math.min(duration, start + windowDuration),
    };
  });
};

const buildRecommendationSampleBuffer = (
  audioBuffer: AudioBuffer,
  context: BaseAudioContext,
  onProgress?: (progress: RecommendationProfileProgress) => void,
): { sampleBuffer: AudioBuffer; sampleCount: number } => {
  const sampleRanges = getRecommendationSampleRanges(audioBuffer.duration);

  if (sampleRanges.length === 0) {
    throw new Error("Clip audio range is empty");
  }

  if (
    sampleRanges.length === 1 &&
    sampleRanges[0].start <= 0 &&
    sampleRanges[0].end >= audioBuffer.duration
  ) {
    onProgress?.({ progress: 0.4, message: "Analyzing clip audio" });
    return {
      sampleBuffer: audioBuffer,
      sampleCount: 1,
    };
  }

  const segments = sampleRanges.map((sampleRange, index) => {
    onProgress?.({
      progress: (index + 1) / (sampleRanges.length + 1),
      message: `Sampling clip audio (${index + 1}/${sampleRanges.length})`,
    });

    return extractAudioSegment(
      audioBuffer,
      sampleRange.start,
      sampleRange.end,
      context,
    );
  });
  const sampleLength = segments.reduce(
    (total, segment) => total + segment.length,
    0,
  );
  const sampleBuffer = context.createBuffer(
    audioBuffer.numberOfChannels,
    sampleLength,
    audioBuffer.sampleRate,
  );

  let offset = 0;
  for (const segment of segments) {
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      sampleBuffer.getChannelData(channel).set(
        segment.getChannelData(channel),
        offset,
      );
    }

    offset += segment.length;
  }

  onProgress?.({
    progress: 0.85,
    message: `Analyzing ${segments.length} clip samples`,
  });

  return {
    sampleBuffer,
    sampleCount: segments.length,
  };
};

export const buildRecommendationProfile = (
  clipId: string,
  audioBuffer: AudioBuffer,
  context: BaseAudioContext,
  onProgress?: (progress: RecommendationProfileProgress) => void,
): NoiseProfileData => {
  const { sampleBuffer, sampleCount } = buildRecommendationSampleBuffer(
    audioBuffer,
    context,
    onProgress,
  );
  const reducer = new SpectralNoiseReducer();
  const profile = reducer.learnNoiseProfile(sampleBuffer);

  onProgress?.({
    progress: 1,
    message:
      sampleCount > 1
        ? `Analyzed ${sampleCount} clip samples`
        : "Analyzed clip audio",
  });

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
  const { t } = useTranslation();
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
          (progress) => {
            updateAnalysisProgress({
              progress: 0.84 + progress.progress * 0.08,
              message: progress.message,
            });
          },
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
          recommendationProfile,
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
  const isBusy =
    learningState === "learning" || learningState === "applying";
  const learnButtonState = (() => {
    switch (learningState) {
      case "learning":
        return {
          label: t("Analyzing..."),
          icon: <Wand2 size={12} aria-hidden />,
          isLoading: true,
        };
      case "applying":
        return {
          label: t("Applying cleanup..."),
          icon: <Wand2 size={12} aria-hidden />,
          isLoading: true,
        };
      case "ready":
        return {
          label: t("Recommendation Ready"),
          icon: <Check size={12} aria-hidden />,
          isLoading: false,
        };
      case "success":
        return {
          label: t("Cleanup Applied"),
          icon: <Check size={12} aria-hidden />,
          isLoading: false,
        };
      case "error":
        return {
          label: t("Analysis Failed"),
          icon: <AlertCircle size={12} aria-hidden />,
          isLoading: false,
        };
      default:
        return {
          label: t("Analyze & Recommend"),
          icon: <Wand2 size={12} aria-hidden />,
          isLoading: false,
        };
    }
  })();

  return (
    <Card
      variant="muted"
      padding={0}
      className={`overflow-hidden border ${
        enabled ? "border-border" : "border-border/50 opacity-60"
      }`}
    >
      <div className="flex items-center gap-2 p-2 bg-bg-2">
        <ClickableCard
          label={`${isOpen ? "Collapse" : "Expand"} noise reduction`}
          onClick={() => setIsOpen(!isOpen)}
          padding={0}
          variant="transparent"
          className="flex-1"
        >
          <div className="flex items-center gap-1">
            <ChevronDown
              size={12}
              className={`transition-transform ${
                isOpen ? "" : "-rotate-90"
              } text-fg-3`}
              aria-hidden
            />
            <Volume2 size={12} className="text-fg-3" aria-hidden />
            <Text
              type="supporting"
              color="primary"
              weight="bold"
              className="text-[10px]"
            >
              {t("Noise Reduction")}</Text>
          </div>
        </ClickableCard>
        <MockToggle
          ariaLabel={t("Enable noise reduction")}
          checked={enabled}
          onChange={handleToggle}
        />
      </div>

      {isOpen && (
        <div className="p-3 space-y-3">
          <Text
            type="supporting"
            color="secondary"
            className="text-[9px] leading-relaxed"
          >
            {t("Reduce white noise, wind, hum, room tone, and background music while keeping speech or the wanted audio in front.")}</Text>

          <div className="grid grid-cols-2 gap-2">
            {NOISE_REDUCTION_PRESETS.map((preset) => {
              const isActive = preset.id === activePresetId;

              return (
                <ClickableCard
                  key={preset.id}
                  label={`Use ${preset.label} noise reduction`}
                  onClick={() => handleApplyPreset(preset.id)}
                  isDisabled={isBusy}
                  padding={2}
                  variant={isActive ? "green" : "default"}
                  className={`border ${
                    isActive ? "border-primary" : "border-border"
                  }`}
                >
                  <Text
                    type="supporting"
                    color="primary"
                    weight="bold"
                    className="block text-[10px]"
                  >
                    {t(preset.label)}
                  </Text>
                  <Text
                    type="supporting"
                    color="secondary"
                    className="block mt-1 text-[9px] leading-relaxed"
                  >
                    {preset.description}
                  </Text>
                </ClickableCard>
              );
            })}
          </div>

          <Card
            variant="transparent"
            padding={2}
            className="border border-border/70 bg-bg-1/60"
          >
            <div className="flex items-center justify-between gap-2">
              <Text type="supporting" color="secondary" className="text-[9px]">
                {t("Current mode: ")}{t(activePreset.label)}
              </Text>
              <Text
                type="supporting"
                className={`rounded-full px-2 py-0.5 text-[8px] font-medium ${
                  enabled
                    ? "bg-green-500/15 text-green-400"
                    : "bg-bg-2 text-fg-3"
                }`}
              >
                {enabled ? "Applied" : "Off"}
              </Text>
            </div>
            <Text type="supporting" color="secondary" className="mt-1 text-[9px]">
              {activePreset.description}
            </Text>
            {appliedMessage && (
              <Text
                type="supporting"
                className="block mt-2 rounded-md border border-green-500/20 bg-green-500/10 px-2 py-1 text-[9px] text-green-400"
              >
                {appliedMessage}
              </Text>
            )}
          </Card>

          {recommendation && recommendationPreset && (
            <Card
              variant="green"
              padding={3}
              className="space-y-2 border border-primary/40"
            >
              <div className="flex items-center gap-2">
                <Wand2 size={12} className="text-primary" aria-hidden />
                <Text
                  type="supporting"
                  color="primary"
                  weight="bold"
                  className="text-[10px]"
                >
                  {t("Recommendation ready")}</Text>
              </div>
              <Text
                type="supporting"
                color="secondary"
                className="text-[9px] leading-relaxed"
              >
                {t("Detected noise best matches ")}{recommendationPreset.label.toLowerCase()}.
                {recommendation.hasLearnedProfile
                  ? ` Apply ${Math.round(recommendation.config.reduction * 100)}% cleanup at ${recommendation.config.threshold.toFixed(0)} dB to save this profile on the clip.`
                  : ` Apply ${Math.round(recommendation.config.reduction * 100)}% cleanup at ${recommendation.config.threshold.toFixed(0)} dB. A custom profile could not be isolated, so this recommendation uses the best preset match for the clip.`}
              </Text>
              <Button
                label={
                  learningState === "applying"
                    ? t("Applying...")
                    : t("Apply Recommended Cleanup")
                }
                variant="primary"
                size="sm"
                onClick={handleApplyRecommendation}
                isDisabled={learningState === "applying"}
                isLoading={learningState === "applying"}
                className="w-full"
              />
            </Card>
          )}

          <Card
            variant="transparent"
            padding={2}
            className="space-y-2 border border-border/70 bg-bg-1/60"
          >
            <Text type="supporting" color="primary" weight="bold" className="text-[9px]">
              {t("A/B Preview")}</Text>
            <div className="grid grid-cols-2 gap-2">
              <Button
                label={t("Hear Original")}
                variant={previewingOriginal ? "primary" : "secondary"}
                size="sm"
                onClick={() => handleSetPreviewMode("original")}
                isDisabled={!effectId}
              />
              <Button
                label={t("Hear Cleaned")}
                variant={!previewingOriginal ? "primary" : "secondary"}
                size="sm"
                onClick={() => handleSetPreviewMode("cleaned")}
                isDisabled={!effectId}
              />
            </div>
            <Text
              type="supporting"
              color="secondary"
              className="text-[9px] leading-relaxed"
            >
              {t("Preview only. Export still uses the cleaned audio effect chain.")}</Text>
          </Card>

          <PropertySlider
            label={t("Threshold")}
            value={config.threshold}
            onChange={(value: number) => handleConfigChange("threshold", value)}
            min={-80}
            max={0}
            formatValue={(value) => `${Math.round(value)} dB`}
          />

          <PropertySlider
            label={t("Reduction")}
            value={config.reduction * 100}
            onChange={(value: number) =>
              handleConfigChange("reduction", value / 100)
            }
            min={0}
            max={100}
            formatValue={(value) => `${Math.round(value)}%`}
          />

          <PropertySlider
            label={t("Attack")}
            value={config.attack ?? 10}
            onChange={(value: number) => handleConfigChange("attack", value)}
            min={0}
            max={100}
            formatValue={(value) => `${Math.round(value)} ms`}
          />

          <PropertySlider
            label={t("Release")}
            value={config.release ?? 100}
            onChange={(value: number) => handleConfigChange("release", value)}
            min={0}
            max={500}
            formatValue={(value) => `${Math.round(value)} ms`}
          />

          <Button
            label={t(learnButtonState.label)}
            icon={learnButtonState.icon}
            variant="primary"
            size="sm"
            onClick={handleLearnNoiseProfile}
            isDisabled={isBusy}
            isLoading={learnButtonState.isLoading}
            className="w-full"
          />

          {analysisProgress && (learningState === "learning" || learningState === "applying") && (
            <Card variant="green" padding={2} className="border border-primary/20">
              <Text type="supporting" color="secondary" className="block text-[9px]">
                {analysisProgress.message}
              </Text>
              <ProgressBar
                label={t("Noise analysis progress")}
                isLabelHidden
                value={Math.round(analysisProgress.progress * 100)}
                max={100}
                hasValueLabel
                variant="accent"
              />
            </Card>
          )}

          {errorMessage && (
            <Text
              type="supporting"
              className="block text-[9px] text-red-500 text-center"
            >
              {errorMessage}
            </Text>
          )}

          {config.profile && !recommendation && learningState !== "error" && (
            <Text
              type="supporting"
              color="secondary"
              className="block text-[9px] text-center"
            >
              {t("Learned noise profile is active on this clip. ")}<br />
              {t("Auto-tuned with ")}{activePreset.label.toLowerCase()} {t(" and reused for export cleanup.")}</Text>
          )}
        </div>
      )}
    </Card>
  );
};

export default NoiseReductionSection;
