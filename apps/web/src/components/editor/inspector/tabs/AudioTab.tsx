import React from "react";
import { useProjectStore } from "../../../../stores/project-store";
import {
  AutoCutSilenceSection,
  AudioTextSyncPanel,
  NoiseReductionSection,
  AudioEffectsSection,
  AudioDuckingSection,
} from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { PropertySlider } from "../shell/PropertySlider";

export interface AudioTabProps {
  clipId: string;
  clipType: string | null;
  showAudioEffects: boolean;
  noiseReductionSectionTitle: string;
  selectedNoiseReductionEffect: unknown;
}

export const AudioTab: React.FC<AudioTabProps> = ({
  clipId,
  clipType,
  showAudioEffects,
  noiseReductionSectionTitle,
  selectedNoiseReductionEffect,
}) => {
  const clip = useProjectStore((state) =>
    state.project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((candidate) => candidate.id === clipId),
  );

  const updateAudio = React.useCallback(
    (type: "audio/setVolume" | "audio/setFade", params: Record<string, unknown>) => {
      void useProjectStore.getState().executeAction({
        type,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clipId, ...params },
      });
    },
    [clipId],
  );

  return (
    <>
      {showAudioEffects && clip && (
        <InspectorSection title="Clip Audio" sectionId="clip-audio" defaultOpen>
          <div className="space-y-4">
            <PropertySlider
              label="Volume"
              value={clip.volume * 100}
              onChange={(value) => updateAudio("audio/setVolume", { volume: value / 100 })}
              min={0}
              max={400}
              step={1}
              formatValue={(value) => `${Math.round(value)}%`}
            />
            <PropertySlider
              label="Fade in"
              value={clip.fade?.fadeIn ?? 0}
              onChange={(fadeIn) => updateAudio("audio/setFade", { fadeIn })}
              min={0}
              max={Math.max(0, clip.duration / 2)}
              step={0.1}
              formatValue={(value) => `${value.toFixed(1)}s`}
            />
            <PropertySlider
              label="Fade out"
              value={clip.fade?.fadeOut ?? 0}
              onChange={(fadeOut) => updateAudio("audio/setFade", { fadeOut })}
              min={0}
              max={Math.max(0, clip.duration / 2)}
              step={0.1}
              formatValue={(value) => `${value.toFixed(1)}s`}
            />
          </div>
        </InspectorSection>
      )}
      {showAudioEffects && (
        <InspectorSection
          title="Auto Cut Silence"
          sectionId="auto-cut-silence"
          defaultOpen={false}
        >
          <AutoCutSilenceSection clipId={clipId} />
        </InspectorSection>
      )}
      {clipType === "audio" && (
        <InspectorSection title="Beat Sync" sectionId="beat-sync" defaultOpen={false}>
          <AudioTextSyncPanel clipId={clipId} />
        </InspectorSection>
      )}
      {showAudioEffects && (
        <InspectorSection
          title={noiseReductionSectionTitle}
          sectionId="background-noise-removal"
          defaultOpen={Boolean(selectedNoiseReductionEffect)}
        >
          <NoiseReductionSection clipId={clipId} />
        </InspectorSection>
      )}
      {showAudioEffects && (
        <>
          <InspectorSection
            title="Audio Effects"
            sectionId="audio-effects"
            defaultOpen={false}
          >
            <AudioEffectsSection clipId={clipId} />
          </InspectorSection>
        </>
      )}
      {showAudioEffects && (
        <InspectorSection
          title="Audio Ducking"
          sectionId="audio-ducking"
          defaultOpen={false}
        >
          <AudioDuckingSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
