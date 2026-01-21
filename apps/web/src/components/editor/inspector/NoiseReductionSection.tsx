import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Volume2, Wand2, AlertCircle, Check } from "lucide-react";
import {
  getAudioBridgeEffects,
  initializeAudioBridgeEffects,
  type NoiseReductionConfig,
  type NoiseProfileData,
  DEFAULT_NOISE_REDUCTION,
} from "../../../bridges/audio-bridge-effects";
import { useProjectStore } from "../../../stores/project-store";
import { LabeledSlider as Slider } from "@openreel/ui";

/**
 * NoiseReductionSection Props
 */
interface NoiseReductionSectionProps {
  clipId: string;
}

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
  // Get store methods
  const toggleAudioEffect = useProjectStore((state) => state.toggleAudioEffect);
  const getAudioEffects = useProjectStore((state) => state.getAudioEffects);

  // Local state
  const [enabled, setEnabled] = useState(false);
  const [effectId, setEffectId] = useState<string | null>(null);
  const [config, setConfig] = useState<NoiseReductionConfig>({
    threshold: DEFAULT_NOISE_REDUCTION.threshold,
    reduction: DEFAULT_NOISE_REDUCTION.reduction,
    attack: DEFAULT_NOISE_REDUCTION.attack,
    release: DEFAULT_NOISE_REDUCTION.release,
  });

  // Noise profile state
  const [learningState, setLearningState] = useState<LearningState>("idle");
  const [noiseProfile, setNoiseProfile] = useState<NoiseProfileData | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Collapsible state
  const [isOpen, setIsOpen] = useState(true);

  // Initialize bridge and load existing effects
  useEffect(() => {
    const initBridge = async () => {
      try {
        await initializeAudioBridgeEffects();
      } catch (error) {
        console.error("Failed to initialize AudioBridgeEffects:", error);
      }
    };
    initBridge();

    // Load existing noise reduction effect from clip
    const effects = getAudioEffects(clipId);
    const noiseEffect = effects.find((e) => e.type === "noiseReduction");
    if (noiseEffect) {
      setEnabled(noiseEffect.enabled);
      setEffectId(noiseEffect.id);
      const params = noiseEffect.params as Partial<NoiseReductionConfig>;
      setConfig((prev) => ({ ...prev, ...params }));
    }
  }, [clipId, getAudioEffects]);

  // Handle enable toggle
  const handleToggle = useCallback(
    (newEnabled: boolean) => {
      const bridge = getAudioBridgeEffects();

      if (newEnabled && !effectId) {
        // Create new noise reduction effect
        const result = bridge.applyNoiseReduction(clipId, config);
        if (result.success && result.effectId) {
          setEffectId(result.effectId);
        }
      } else if (effectId) {
        // Toggle existing effect
        toggleAudioEffect(clipId, effectId, newEnabled);
      }

      setEnabled(newEnabled);
    },
    [clipId, effectId, config, toggleAudioEffect],
  );

  // Handle config change
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

  // Handle learn noise profile
  const handleLearnNoiseProfile = useCallback(async () => {
    setLearningState("learning");
    setErrorMessage(null);

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

      const audioContext = new AudioContext();
      const arrayBuffer = await mediaItem.blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const profile = await bridge.learnNoiseProfile(
        audioBuffer,
        `profile-${clipId}`,
      );
      setNoiseProfile(profile);
      setLearningState("success");

      if (!enabled) {
        handleToggle(true);
      }

      setTimeout(() => {
        setLearningState("idle");
      }, 2000);

      await audioContext.close();
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
    }
  }, [clipId, enabled, handleToggle]);

  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        enabled ? "border-border" : "border-border/50 opacity-60"
      }`}
    >
      {/* Header */}
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

      {/* Content */}
      {isOpen && (
        <div className="p-3 space-y-3">
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

          {/* Attack */}
          <Slider
            label="Attack"
            value={config.attack ?? 10}
            onChange={(v) => handleConfigChange("attack", v)}
            min={0}
            max={100}
            unit="ms"
          />

          {/* Release */}
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
                Learning...
              </>
            ) : learningState === "success" ? (
              <>
                <Check size={12} />
                Profile Learned
              </>
            ) : learningState === "error" ? (
              <>
                <AlertCircle size={12} />
                Failed
              </>
            ) : (
              <>
                <Wand2 size={12} />
                Learn Noise Profile
              </>
            )}
          </button>

          {/* Error message */}
          {errorMessage && (
            <div className="text-[9px] text-red-500 text-center">
              {errorMessage}
            </div>
          )}

          {/* Profile info */}
          {noiseProfile && learningState !== "error" && (
            <div className="text-[9px] text-text-muted text-center">
              Profile: {noiseProfile.id.substring(0, 16)}...
              <br />
              Sample rate: {noiseProfile.sampleRate}Hz
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NoiseReductionSection;
