import { PrimaryAudioProperties } from "../PrimaryAudioProperties";
import { EssentialSoundSection } from "../EssentialSoundSection";
import { SurroundPanSection } from "../SurroundPanSection";
import { AudioChannelsSection } from "../AudioChannelsSection";
import React, { Suspense, lazy } from "react";
import { getChannelLayout } from "@openreel/core";
import { useProjectStore } from "../../../../stores/project-store";
import {
  AutoCutSilenceSection,
  AudioTextSyncPanel,
  NoiseReductionSection,
  AudioEffectsSection,
  AudioDuckingSection,
  RepairSection,
} from "../";
import { VoiceOverPanel } from "../VoiceOverPanel";
import { InspectorSection } from "../shell/InspectorSection";

// The spectral editor (spectrogram, selection tools, worker client) loads when its section is first opened, never with the editor shell.
const SpectralEditor = lazy(() => import("../../../audio-spectral/SpectralEditor"));

interface AudioTabProps {
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

  const surround = useProjectStore((state) => getChannelLayout(state.project.settings) === "5.1");

  return (
    <>
      {showAudioEffects && clip && (
        <InspectorSection title="Essential Sound" sectionId="essential-sound" defaultOpen>
          <EssentialSoundSection clipIds={[clipId]} />
        </InspectorSection>
      )}
      {showAudioEffects && clip && <PrimaryAudioProperties clipId={clipId} />}
      {showAudioEffects && clip && (
        <InspectorSection title="Audio channels" sectionId="audio-channels" defaultOpen>
          <AudioChannelsSection clipIds={[clipId]} />
        </InspectorSection>
      )}
      {showAudioEffects && clip && surround && (
        <InspectorSection title="Surround pan" sectionId="surround-pan" defaultOpen>
          <SurroundPanSection clipId={clipId} />
        </InspectorSection>
      )}
      {showAudioEffects && clip && (
        <InspectorSection title="Audio repair" sectionId="audio-repair" defaultOpen>
          <RepairSection clipId={clipId} />
        </InspectorSection>
      )}
      {showAudioEffects && clip && (
        <InspectorSection title="Spectral editing" sectionId="spectral-editing" defaultOpen={false}>
          <Suspense fallback={<p className="text-[11px] text-fg-muted">Loading spectral editor…</p>}>
            <SpectralEditor clipId={clipId} />
          </Suspense>
        </InspectorSection>
      )}
      <InspectorSection
        title="Advanced audio tools"
        sectionId="advanced-audio"
        sectionIds={[
          "voice-over",
          "auto-cut-silence",
          "beat-sync",
          "background-noise-removal",
          "audio-effects",
          "audio-ducking",
        ]}
        defaultOpen={false}
      >
        {showAudioEffects && (
          <InspectorSection title="Voice Over" sectionId="voice-over" defaultOpen={false}>
            <VoiceOverPanel />
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
      </InspectorSection>
    </>
  );
};
