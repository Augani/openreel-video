import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Volume2, Wand2, AlertCircle, Check } from "lucide-react";
import { autoLearnNoiseProfile } from "@openreel/core";
import {
  getAudioBridgeEffects,
  initializeAudioBridgeEffects,
  type NoiseReductionConfig,
  type NoiseReductionFocus,
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
type LearningState = "idle" | "learning" | "success" | "error";

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
  const audioEffects = useProjectStore((state) => state.getAudioEffects(clipId));
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
      setLearningState("idle");
      setErrorMessage(null);
      return;
    }

    setEnabled(false);
    setEffectId(null);
    setConfig(DEFAULT_NOISE_REDUCTION_STATE);
    setActivePresetId(defaultFocus);
    setLearningState("idle");
    setErrorMessage(null);
  }, [audioEffects, clipId, defaultFocus]);

  const applyNoiseReductionConfig = useCallback(
    (nextConfig: NoiseReductionConfig) => {
      const bridge = getAudioBridgeEffects();

      if (effectId) {
        const updateResult = bridge.updateNoiseReduction(
          clipId,
          effectId,
          nextConfig,
        );

        if (!updateResult.success) {
          throw new Error(
            updateResult.error ?? "Failed to update noise reduction",
          );
        }

        toggleAudioEffect(clipId, effectId, true);
        setEnabled(true);
        return effectId;
      }

      const applyResult = bridge.applyNoiseReduction(clipId, nextConfig);

      if (!applyResult.success || !applyResult.effectId) {
        throw new Error(applyResult.error ?? "Failed to apply noise reduction");
      }

      setEffectId(applyResult.effectId);
      setEnabled(true);
      return applyResult.effectId;
    },
    [clipId, effectId, toggleAudioEffect],
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
        toggleAudioEffect(clipId, effectId, newEnabled);
      }

      setEnabled(newEnabled);
    },
    [applyNoiseReductionConfig, config, effectId, toggleAudioEffect],
  );

  const handleConfigChange = useCallback(
    (key: keyof NoiseReductionConfig, value: number) => {
      const bridge = getAudioBridgeEffects();

      setConfig((prev) => {
        const newConfig = { ...prev, [key]: value };

        if (effectId && enabled) {
          bridge.updateNoiseReduction(clipId, effectId, newConfig);
        }

        return newConfig;
      });
    },
    [clipId, effectId, enabled],
  );

  const handleApplyPreset = useCallback(
    (presetId: NoiseReductionFocus) => {
      const nextConfig = {
        ...getNoiseReductionPreset(presetId).config,
        profile: config.profile,
      };

      setErrorMessage(null);
      setLearningState("idle");
      setActivePresetId(presetId);
      setConfig(nextConfig);

      try {
        applyNoiseReductionConfig(nextConfig);
      } catch (error) {
        setLearningState("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to apply noise reduction preset",
        );
      }
    },
    [applyNoiseReductionConfig, config.profile],
  );

  const handleSetPreviewMode = useCallback(
    (mode: "original" | "cleaned") => {
      if (!effectId) {
        return;
      }

      setAudioEffectPreviewBypass(clipId, effectId, mode === "original");
    },
    [clipId, effectId, setAudioEffectPreviewBypass],
  );

  const handleLearnNoiseProfile = useCallback(async () => {
    setLearningState("learning");
    setErrorMessage(null);

    let audioContext: AudioContext | null = null;

    try {
      const bridge = getAudioBridgeEffects();
      const project = useProjectStore.getState().project;

      const clip = project.timeline.tracks
        .flatMap((track) => track.clips)
        .find((c) => c.id === clipId);

      if (!clip) {
        throw new Error("Clip not found");
      }

      const mediaItem = project.mediaLibrary.items.find(
        (m) => m.id === clip.mediaId,
      );

      if (!mediaItem?.blob) {
        throw new Error("No audio data available for this clip");
      }

      audioContext = new AudioContext();
      const arrayBuffer = await mediaItem.blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const analysisContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate,
      );

      const analyzedProfile = await autoLearnNoiseProfile(
        audioBuffer,
        analysisContext,
      );

      const profile = analyzedProfile
        ? {
            id: `profile-${clipId}`,
            frequencyBins: analyzedProfile.frequencyBins,
            magnitudes: analyzedProfile.magnitudes,
            sampleRate: analyzedProfile.sampleRate,
            createdAt: Date.now(),
          }
        : await bridge.learnNoiseProfile(audioBuffer, `profile-${clipId}`);
      const serializedProfile: SerializedNoiseProfile = {
        frequencyBins: Array.from(profile.frequencyBins),
        magnitudes: Array.from(profile.magnitudes),
        sampleRate: profile.sampleRate,
      };

      const suggestedPresetId = suggestNoiseReductionPreset(profile);
      const suggestedConfig = {
        ...suggestNoiseReductionConfig(profile),
        profile: serializedProfile,
      };

      setConfig(suggestedConfig);
      setActivePresetId(suggestedPresetId);
      applyNoiseReductionConfig(suggestedConfig);
      setLearningState("success");

      setTimeout(() => {
        setLearningState("idle");
      }, 2000);
    } catch (error) {
      setLearningState("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to learn noise profile",
      );

      setTimeout(() => {
        setLearningState("idle");
        setErrorMessage(null);
      }, 3000);
    } finally {
      await audioContext?.close();
    }
  }, [applyNoiseReductionConfig, clipId]);

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
            Reduce hiss, HVAC, and room tone while keeping the wanted audio in
            front.
          </p>

          <div className="grid grid-cols-2 gap-2">
            {NOISE_REDUCTION_PRESETS.map((preset) => {
              const isActive = preset.id === activePresetId;

              return (
                <button
                  key={preset.id}
                  onClick={() => handleApplyPreset(preset.id)}
                  className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                    isActive
                      ? "border-primary bg-primary/10 text-text-primary"
                      : "border-border bg-background-secondary text-text-secondary hover:border-primary/50 hover:bg-primary/5"
                  }`}
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
            Current mode: <span className="text-text-primary">{activePreset.label}</span>
            <br />
            {activePreset.description}
          </div>

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
            disabled={learningState === "learning"}
            className={`w-full py-2 rounded-lg text-[10px] font-medium transition-colors flex items-center justify-center gap-2 ${
              learningState === "learning"
                ? "bg-primary/20 text-primary cursor-wait"
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
            ) : learningState === "success" ? (
              <>
                <Check size={12} />
                Recommended Preset Applied
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

          {errorMessage && (
            <div className="text-[9px] text-red-500 text-center">
              {errorMessage}
            </div>
          )}

          {config.profile && learningState !== "error" && (
            <div className="text-[9px] text-text-muted text-center">
              Learned noise profile saved for this clip.
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
