import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Volume2 } from "lucide-react";
import {
  getAudioBridgeEffects,
  initializeAudioBridgeEffects,
  type EQBandConfig,
  type CompressorConfig,
  type ReverbConfig,
  type DelayConfig,
  DEFAULT_EQ_BANDS,
} from "../../../bridges/audio-bridge-effects";
import { useProjectStore } from "../../../stores/project-store";
import { LabeledSlider as Slider } from "@openreel/ui";

const SubSection: React.FC<{
  title: string;
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, enabled = true, onToggle, defaultOpen = false, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

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
          <span className="text-[10px] font-medium text-text-primary">
            {title}
          </span>
        </button>
        {onToggle && (
          <button
            onClick={() => onToggle(!enabled)}
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
        )}
      </div>
      {isOpen && <div className="p-3 space-y-3">{children}</div>}
    </div>
  );
};

const EQBand: React.FC<{
  frequency: string;
  gain: number;
  onChange: (gain: number) => void;
}> = ({ frequency, gain, onChange }) => {
  const percentage = ((gain + 12) / 24) * 100;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="h-16 w-4 bg-background-tertiary rounded-full relative overflow-hidden">
        <input
          type="range"
          min={-12}
          max={12}
          value={gain}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          style={{ writingMode: "vertical-lr", direction: "rtl" }}
        />
        <div
          className="absolute bottom-0 left-0 right-0 bg-primary/50 rounded-full transition-all"
          style={{ height: `${percentage}%` }}
        />
        <div
          className="absolute left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow-sm pointer-events-none transition-all"
          style={{ bottom: `calc(${percentage}% - 6px)` }}
        />
      </div>
      <span className="text-[8px] text-text-muted">{frequency}</span>
      <span className="text-[8px] font-mono text-text-secondary">
        {gain > 0 ? "+" : ""}
        {gain}
      </span>
    </div>
  );
};

interface AudioEffectsSectionProps {
  clipId: string;
}

/**
 * AudioEffectsSection Component
 *
 * - 13.1: Display audio effect controls (EQ, compressor, reverb, delay)
 * - 13.2: Apply EQ with frequency band adjustments
 * - 13.3: Apply compressor with threshold, ratio, attack, release
 * - 13.4: Apply reverb with room size, damping, wet/dry
 * - 13.5: Apply delay with time, feedback, wet level
 */
export const AudioEffectsSection: React.FC<AudioEffectsSectionProps> = ({
  clipId,
}) => {
  // Get store methods
  const toggleAudioEffect = useProjectStore((state) => state.toggleAudioEffect);
  const getAudioEffects = useProjectStore((state) => state.getAudioEffects);

  // Local state for audio effects
  const [eqEnabled, setEqEnabled] = useState(false);
  const [eqEffectId, setEqEffectId] = useState<string | null>(null);
  const [eqBands, setEqBands] = useState<
    Array<{ frequency: string; gain: number }>
  >([
    { frequency: "60Hz", gain: 0 },
    { frequency: "250Hz", gain: 0 },
    { frequency: "1kHz", gain: 0 },
    { frequency: "4kHz", gain: 0 },
    { frequency: "16kHz", gain: 0 },
  ]);

  const [compressorEnabled, setCompressorEnabled] = useState(false);
  const [compressorEffectId, setCompressorEffectId] = useState<string | null>(
    null,
  );
  const [compressor, setCompressor] = useState<CompressorConfig>({
    threshold: -20,
    ratio: 4,
    attack: 0.01,
    release: 0.1,
  });

  const [reverbEnabled, setReverbEnabled] = useState(false);
  const [reverbEffectId, setReverbEffectId] = useState<string | null>(null);
  const [reverb, setReverb] = useState<ReverbConfig>({
    roomSize: 0.5,
    damping: 0.5,
    wetLevel: 0.3,
  });

  const [delayEnabled, setDelayEnabled] = useState(false);
  const [delayEffectId, setDelayEffectId] = useState<string | null>(null);
  const [delay, setDelay] = useState<DelayConfig>({
    time: 0.25,
    feedback: 0.3,
    wetLevel: 0.25,
  });

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

    // Load existing effects from clip
    const effects = getAudioEffects(clipId);
    for (const effect of effects) {
      if (effect.type === "eq") {
        setEqEnabled(effect.enabled);
        setEqEffectId(effect.id);
        const params = effect.params as { bands?: EQBandConfig[] };
        if (params.bands) {
          setEqBands(
            params.bands.map((b) => ({
              frequency: formatFrequency(b.frequency),
              gain: b.gain,
            })),
          );
        }
      } else if (effect.type === "compressor") {
        setCompressorEnabled(effect.enabled);
        setCompressorEffectId(effect.id);
        const params = effect.params as Partial<CompressorConfig>;
        setCompressor((prev) => ({ ...prev, ...params }));
      } else if (effect.type === "reverb") {
        setReverbEnabled(effect.enabled);
        setReverbEffectId(effect.id);
        const params = effect.params as Partial<ReverbConfig>;
        setReverb((prev) => ({ ...prev, ...params }));
      } else if (effect.type === "delay") {
        setDelayEnabled(effect.enabled);
        setDelayEffectId(effect.id);
        const params = effect.params as Partial<DelayConfig>;
        setDelay((prev) => ({ ...prev, ...params }));
      }
    }
  }, [clipId, getAudioEffects]);

  // Format frequency for display
  const formatFrequency = (freq: number): string => {
    if (freq >= 1000) {
      return `${freq / 1000}kHz`;
    }
    return `${freq}Hz`;
  };

  // Parse frequency from display string
  const parseFrequency = (freqStr: string): number => {
    if (freqStr.includes("kHz")) {
      return parseFloat(freqStr) * 1000;
    }
    return parseFloat(freqStr);
  };

  // Handle EQ toggle
  const handleEqToggle = useCallback(
    (enabled: boolean) => {
      const bridge = getAudioBridgeEffects();

      if (enabled && !eqEffectId) {
        // Create new EQ effect
        const bands: EQBandConfig[] = eqBands.map((b, i) => ({
          type: DEFAULT_EQ_BANDS[i].type,
          frequency: parseFrequency(b.frequency),
          gain: b.gain,
          q: DEFAULT_EQ_BANDS[i].q,
        }));

        const result = bridge.applyEQ(clipId, bands);

        if (result.success && result.effectId) {
          setEqEffectId(result.effectId);
        }
      } else if (eqEffectId) {
        // Toggle existing effect

        toggleAudioEffect(clipId, eqEffectId, enabled);
      }

      setEqEnabled(enabled);
    },
    [clipId, eqEffectId, eqBands, toggleAudioEffect],
  );

  // Handle EQ band change
  const handleEqBandChange = useCallback(
    (index: number, gain: number) => {
      const bridge = getAudioBridgeEffects();

      setEqBands((bands) => {
        const newBands = bands.map((band, i) =>
          i === index ? { ...band, gain } : band,
        );

        // Update effect if it exists
        if (eqEffectId && eqEnabled) {
          const eqBandConfigs: EQBandConfig[] = newBands.map((b, i) => ({
            type: DEFAULT_EQ_BANDS[i].type,
            frequency: parseFrequency(b.frequency),
            gain: b.gain,
            q: DEFAULT_EQ_BANDS[i].q,
          }));
          bridge.updateEQ(clipId, eqEffectId, eqBandConfigs);
        }

        return newBands;
      });
    },
    [clipId, eqEffectId, eqEnabled],
  );

  // Handle compressor toggle
  const handleCompressorToggle = useCallback(
    (enabled: boolean) => {
      const bridge = getAudioBridgeEffects();

      if (enabled && !compressorEffectId) {
        const result = bridge.applyCompressor(clipId, compressor);
        if (result.success && result.effectId) {
          setCompressorEffectId(result.effectId);
        }
      } else if (compressorEffectId) {
        toggleAudioEffect(clipId, compressorEffectId, enabled);
      }

      setCompressorEnabled(enabled);
    },
    [clipId, compressorEffectId, compressor, toggleAudioEffect],
  );

  // Handle compressor change
  const handleCompressorChange = useCallback(
    (key: keyof CompressorConfig, value: number) => {
      const bridge = getAudioBridgeEffects();

      setCompressor((prev) => {
        const newCompressor = { ...prev, [key]: value };

        if (compressorEffectId && compressorEnabled) {
          bridge.updateCompressor(clipId, compressorEffectId, newCompressor);
        }

        return newCompressor;
      });
    },
    [clipId, compressorEffectId, compressorEnabled],
  );

  // Handle reverb toggle
  const handleReverbToggle = useCallback(
    (enabled: boolean) => {
      const bridge = getAudioBridgeEffects();

      if (enabled && !reverbEffectId) {
        const result = bridge.applyReverb(clipId, reverb);

        if (result.success && result.effectId) {
          setReverbEffectId(result.effectId);
        }
      } else if (reverbEffectId) {
        toggleAudioEffect(clipId, reverbEffectId, enabled);
      }

      setReverbEnabled(enabled);
    },
    [clipId, reverbEffectId, reverb, toggleAudioEffect],
  );

  // Handle reverb change
  const handleReverbChange = useCallback(
    (key: keyof ReverbConfig, value: number) => {
      const bridge = getAudioBridgeEffects();

      setReverb((prev) => {
        const newReverb = { ...prev, [key]: value };

        if (reverbEffectId && reverbEnabled) {
          bridge.updateReverb(clipId, reverbEffectId, newReverb);
        }

        return newReverb;
      });
    },
    [clipId, reverbEffectId, reverbEnabled],
  );

  // Handle delay toggle
  const handleDelayToggle = useCallback(
    (enabled: boolean) => {
      const bridge = getAudioBridgeEffects();

      if (enabled && !delayEffectId) {
        const result = bridge.applyDelay(clipId, delay);

        if (result.success && result.effectId) {
          setDelayEffectId(result.effectId);
        }
      } else if (delayEffectId) {
        toggleAudioEffect(clipId, delayEffectId, enabled);
      }

      setDelayEnabled(enabled);
    },
    [clipId, delayEffectId, delay, toggleAudioEffect],
  );

  // Handle delay change
  const handleDelayChange = useCallback(
    (key: keyof DelayConfig, value: number) => {
      const bridge = getAudioBridgeEffects();

      setDelay((prev) => {
        const newDelay = { ...prev, [key]: value };

        if (delayEffectId && delayEnabled) {
          bridge.updateDelay(clipId, delayEffectId, newDelay);
        }

        return newDelay;
      });
    },
    [clipId, delayEffectId, delayEnabled],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-2 bg-background-tertiary rounded-lg">
        <Volume2 size={14} className="text-text-secondary" />
        <span className="text-[10px] text-text-secondary">
          Audio clip: {clipId.substring(0, 8)}...
        </span>
      </div>

      <SubSection
        title="Equalizer"
        enabled={eqEnabled}
        onToggle={handleEqToggle}
        defaultOpen
      >
        <div className="flex justify-around py-2">
          {eqBands.map((band, index) => (
            <EQBand
              key={band.frequency}
              frequency={band.frequency}
              gain={band.gain}
              onChange={(gain) => handleEqBandChange(index, gain)}
            />
          ))}
        </div>
      </SubSection>

      <SubSection
        title="Compressor"
        enabled={compressorEnabled}
        onToggle={handleCompressorToggle}
      >
        <div className="space-y-2">
          <Slider
            label="Threshold"
            value={compressor.threshold}
            onChange={(v) => handleCompressorChange("threshold", v)}
            min={-60}
            max={0}
            unit="dB"
          />
          <Slider
            label="Ratio"
            value={compressor.ratio}
            onChange={(v) => handleCompressorChange("ratio", v)}
            min={1}
            max={20}
            step={0.5}
            unit=":1"
          />
          <Slider
            label="Attack"
            value={compressor.attack * 1000}
            onChange={(v) => handleCompressorChange("attack", v / 1000)}
            min={1}
            max={100}
            step={1}
            unit="ms"
          />
          <Slider
            label="Release"
            value={compressor.release * 1000}
            onChange={(v) => handleCompressorChange("release", v / 1000)}
            min={10}
            max={1000}
            unit="ms"
          />
        </div>
      </SubSection>

      <SubSection
        title="Reverb"
        enabled={reverbEnabled}
        onToggle={handleReverbToggle}
      >
        <div className="space-y-2">
          <Slider
            label="Room Size"
            value={reverb.roomSize * 100}
            onChange={(v) => handleReverbChange("roomSize", v / 100)}
            min={0}
            max={100}
            unit="%"
          />
          <Slider
            label="Damping"
            value={reverb.damping * 100}
            onChange={(v) => handleReverbChange("damping", v / 100)}
            min={0}
            max={100}
            unit="%"
          />
          <Slider
            label="Wet/Dry"
            value={reverb.wetLevel * 100}
            onChange={(v) => handleReverbChange("wetLevel", v / 100)}
            min={0}
            max={100}
            unit="%"
          />
        </div>
      </SubSection>

      <SubSection
        title="Delay"
        enabled={delayEnabled}
        onToggle={handleDelayToggle}
      >
        <div className="space-y-2">
          <Slider
            label="Time"
            value={delay.time * 1000}
            onChange={(v) => handleDelayChange("time", v / 1000)}
            min={1}
            max={2000}
            unit="ms"
          />
          <Slider
            label="Feedback"
            value={delay.feedback * 100}
            onChange={(v) => handleDelayChange("feedback", v / 100)}
            min={0}
            max={95}
            unit="%"
          />
          <Slider
            label="Wet Level"
            value={delay.wetLevel * 100}
            onChange={(v) => handleDelayChange("wetLevel", v / 100)}
            min={0}
            max={100}
            unit="%"
          />
        </div>
      </SubSection>
    </div>
  );
};

export default AudioEffectsSection;
