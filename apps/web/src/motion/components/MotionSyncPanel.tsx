import type { JSX } from "react";
import { useState } from "react";
import {
  Flag,
  LocateFixed,
  Music2,
  Plus,
  RadioTower,
  Trash2,
  Zap,
} from "@/icons/lucide-compat";
import {
  MOTION_ANIMATION_PRESETS,
  addMotionCompositionMarker,
  applyMotionAnimationPresetToBeats,
  clearMotionBeatMarkers,
  createMotionMarker,
  detectMotionBeatMarkersFromPeaks,
  generateMotionBeatMarkersAtBpm,
  removeMotionCompositionMarker,
  setMotionBeatMarkers,
  updateMotionCompositionMarker,
  type MotionAnimationPresetId,
  type MotionComposition,
  type MotionLayer,
} from "@openreel/core";
import { ToolcraftText } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import {
  Button,
  EmptyState,
  Field,
  ColorInput,
  IconButton,
  NumberInput,
  PanelHeader,
  Section,
  SelectInput,
  SwitchInput,
  TextInput,
} from "./primitives";

interface MotionSyncPanelProps {
  composition: MotionComposition;
  embedded?: boolean;
}

const BEAT_PRESET_OPTIONS = MOTION_ANIMATION_PRESETS.filter((preset) =>
  ["pulse", "scale-pop", "rotate-in", "slide-up-in"].includes(preset.id),
);

export function MotionSyncPanel({
  composition,
  embedded = false,
}: MotionSyncPanelProps): JSX.Element {
  const [bpm, setBpm] = useState(composition.beatAnalysis?.bpm ?? 120);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [startTime, setStartTime] = useState(0);
  const [sensitivity, setSensitivity] = useState(0.65);
  const [presetId, setPresetId] = useState<MotionAnimationPresetId>("pulse");
  const [animationDuration, setAnimationDuration] = useState(0.18);
  const [onlyDownbeats, setOnlyDownbeats] = useState(false);
  const [sourceMediaId, setSourceMediaId] = useState("");
  const playhead = useMotionStore((state) => state.playhead);
  const setPlayhead = useMotionStore((state) => state.setPlayhead);
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const selectedAudioClipId = useMotionStore(
    (state) => state.selectedAudioClipId,
  );
  const selectAudioClip = useMotionStore((state) => state.selectAudioClip);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const project = useProjectStore((state) => state.project);
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const mediaSources = project.mediaLibrary.items.filter(
    (item) => item.type !== "image" && item.waveformData && item.metadata.duration > 0,
  );
  const selectedSource =
    mediaSources.find((item) => item.id === sourceMediaId) ?? mediaSources[0];
  const selectedLayer =
    composition.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const beatMarkers = composition.beatMarkers ?? [];

  const updateComposition = (nextComposition: MotionComposition) => {
    void upsertMotionComposition(nextComposition);
  };

  const replaceLayer = (nextLayer: MotionLayer) => {
    updateComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === nextLayer.id ? nextLayer : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const patchAudioClip = (
    clipId: string,
    updates: Record<string, number | boolean>,
  ) => {
    updateComposition({
      ...composition,
      audioClips: (composition.audioClips ?? []).map((clip) =>
        clip.id === clipId ? { ...clip, ...updates } : clip,
      ),
      modifiedAt: Date.now(),
    });
  };

  const generateManualBeats = () => {
    const markers = generateMotionBeatMarkersAtBpm({
      bpm,
      duration: composition.duration,
      startTime,
      beatsPerBar,
    });
    updateComposition(
      setMotionBeatMarkers(composition, markers, {
        bpm,
        confidence: 1,
        analyzedAt: Date.now(),
      }),
    );
  };

  const detectWaveformBeats = () => {
    if (!selectedSource?.waveformData) return;
    const markers = detectMotionBeatMarkersFromPeaks(selectedSource.waveformData, {
      duration: selectedSource.metadata.duration,
      startTime,
      compositionDuration: composition.duration,
      beatsPerBar,
      sensitivity,
    });
    updateComposition(
      setMotionBeatMarkers(composition, markers, {
        bpm: estimateBpm(markers),
        confidence: markers.length > 0 ? Math.min(1, markers.length / 32) : 0,
        sourceClipId: selectedSource.id,
        analyzedAt: Date.now(),
      }),
    );
  };

  const addMarker = () => {
    updateComposition(
      addMotionCompositionMarker(
        composition,
        createMotionMarker({
          time: playhead,
          label: `Marker ${composition.markers.length + 1}`,
          color: "#22d3ee",
        }),
      ),
    );
  };

  const updateMarker = (
    markerId: string,
    updates: {
      readonly label?: string;
      readonly time?: number;
      readonly color?: string;
    },
  ) => {
    updateComposition(
      updateMotionCompositionMarker(composition, markerId, (marker) => ({
        ...marker,
        ...updates,
      })),
    );
  };

  const removeMarker = (markerId: string) => {
    updateComposition(removeMotionCompositionMarker(composition, markerId));
  };

  const applyPresetToBeats = () => {
    if (!selectedLayer || selectedLayer.locked || beatMarkers.length === 0) {
      return;
    }
    replaceLayer(
      applyMotionAnimationPresetToBeats(selectedLayer, presetId, beatMarkers, {
        duration: animationDuration,
        onlyDownbeats,
        distance: 96,
        intensity: 1,
      }),
    );
    setRightTab("graph");
  };

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : (
        <PanelHeader
          title="Sync"
          icon={Music2}
          actions={
            <IconButton
              icon={Flag}
              label="Add marker at playhead"
              size="sm"
              onClick={addMarker}
            />
          }
        />
      )}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section
          title={`Audio Clips (${(composition.audioClips ?? []).length})`}
          icon={Music2}
        >
          {(composition.audioClips ?? []).length === 0 ? (
            <ToolcraftText type="supporting" color="secondary" className="block rounded-md border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
              Add audio from the Assets panel to score this scene. Audio is muxed
              into the exported video.
            </ToolcraftText>
          ) : (
            <div className="space-y-2">
              {(composition.audioClips ?? []).map((audioClip) => (
                <div
                  key={audioClip.id}
                  className={`rounded-md border p-2.5 transition-colors ${
                    selectedAudioClipId === audioClip.id
                      ? "border-accent bg-accent-soft shadow-sm"
                      : "border-border bg-bg-2"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      aria-label={`Select audio clip ${audioClip.name ?? "Audio"}`}
                      aria-pressed={selectedAudioClipId === audioClip.id}
                      onClick={() => selectAudioClip(audioClip.id)}
                      className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold text-fg-2 hover:text-accent"
                    >
                      {audioClip.name ?? "Audio"}
                    </button>
                    <IconButton
                      icon={Trash2}
                      label="Remove audio clip"
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        updateComposition({
                          ...composition,
                          audioClips: (composition.audioClips ?? []).filter(
                            (candidate) => candidate.id !== audioClip.id,
                          ),
                          modifiedAt: Date.now(),
                        });
                        if (selectedAudioClipId === audioClip.id) {
                          selectAudioClip(null);
                        }
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="Gain">
                      <NumberInput
                        value={audioClip.gain ?? 1}
                        min={0}
                        max={4}
                        step={0.05}
                        onChange={(gain) => patchAudioClip(audioClip.id, { gain })}
                      />
                    </Field>
                    <Field label="Start" hint="s">
                      <NumberInput
                        value={audioClip.startTime}
                        min={0}
                        max={Math.max(
                          0,
                          composition.duration - audioClip.duration,
                        )}
                        step={0.05}
                        onChange={(startTime) =>
                          patchAudioClip(audioClip.id, { startTime })
                        }
                      />
                    </Field>
                    <Field label="Duration" hint="s">
                      <NumberInput
                        value={audioClip.duration}
                        min={1 / Math.max(1, composition.frameRate)}
                        max={Math.max(
                          1 / Math.max(1, composition.frameRate),
                          composition.duration - audioClip.startTime,
                        )}
                        step={1 / Math.max(1, composition.frameRate)}
                        onChange={(duration) =>
                          patchAudioClip(audioClip.id, {
                            duration,
                            fadeIn: Math.min(audioClip.fadeIn ?? 0, duration),
                            fadeOut: Math.min(audioClip.fadeOut ?? 0, duration),
                          })
                        }
                      />
                    </Field>
                    <Field label="Source trim" hint="s">
                      <NumberInput
                        value={audioClip.trimStart ?? 0}
                        min={0}
                        step={0.05}
                        onChange={(trimStart) =>
                          patchAudioClip(audioClip.id, { trimStart })
                        }
                      />
                    </Field>
                    <Field label="Fade in" hint="s">
                      <NumberInput
                        value={audioClip.fadeIn ?? 0}
                        min={0}
                        max={audioClip.duration}
                        step={0.05}
                        onChange={(fadeIn) =>
                          patchAudioClip(audioClip.id, { fadeIn })
                        }
                      />
                    </Field>
                    <Field label="Fade out" hint="s">
                      <NumberInput
                        value={audioClip.fadeOut ?? 0}
                        min={0}
                        max={audioClip.duration}
                        step={0.05}
                        onChange={(fadeOut) =>
                          patchAudioClip(audioClip.id, { fadeOut })
                        }
                      />
                    </Field>
                  </div>
                  <div className="mt-2">
                    <SwitchInput
                      label="Mute clip"
                      checked={audioClip.muted ?? false}
                      onChange={(muted) =>
                        patchAudioClip(audioClip.id, { muted })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Beat Grid" icon={RadioTower}>
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="BPM">
              <NumberInput value={bpm} min={1} max={999} onChange={setBpm} />
            </Field>
            <Field label="Bar">
              <NumberInput
                value={beatsPerBar}
                min={1}
                max={16}
                onChange={setBeatsPerBar}
              />
            </Field>
            <Field label="Start" hint="s">
              <NumberInput
                value={startTime}
                min={0}
                max={composition.duration}
                step={0.05}
                onChange={setStartTime}
              />
            </Field>
          </div>
          <Button
            label="Generate Beat Grid"
            icon={RadioTower}
            variant="solid"
            size="md"
            onClick={generateManualBeats}
            className="w-full"
          />
        </Section>

        <Section title="Waveform Detection" icon={Music2}>
          {mediaSources.length === 0 ? (
            <EmptyState
              icon={Music2}
              title="No waveform media"
              description="Import audio or video with waveform data to detect beat markers."
            />
          ) : (
            <>
              <Field label="Source">
                <SelectInput
                  value={selectedSource?.id ?? ""}
                  options={mediaSources.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                  onChange={setSourceMediaId}
                />
              </Field>
              <Field label="Sensitivity">
                <NumberInput
                  value={sensitivity}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setSensitivity}
                />
              </Field>
              <Button
                label="Detect From Waveform"
                icon={Music2}
                variant="outline"
                size="md"
                onClick={detectWaveformBeats}
                className="w-full"
              />
            </>
          )}
        </Section>

        <Section title={`Beat Markers (${beatMarkers.length})`} icon={Zap}>
          {beatMarkers.length === 0 ? (
            <EmptyState
              icon={Zap}
              title="No beat markers"
              description="Generate a beat grid or detect beats from waveform media."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Preset">
                  <SelectInput
                    value={presetId}
                    options={BEAT_PRESET_OPTIONS.map((preset) => ({
                      value: preset.id,
                      label: preset.name,
                    }))}
                    onChange={(nextPresetId) =>
                      setPresetId(nextPresetId as MotionAnimationPresetId)
                    }
                  />
                </Field>
                <Field label="Duration" hint="s">
                  <NumberInput
                    value={animationDuration}
                    min={0.05}
                    max={2}
                    step={0.01}
                    onChange={setAnimationDuration}
                  />
                </Field>
              </div>
              <SwitchInput
                label="Downbeats only"
                checked={onlyDownbeats}
                onChange={setOnlyDownbeats}
              />
              <Button
                label="Apply To Selected Layer"
                icon={Zap}
                variant="solid"
                size="md"
                disabled={!selectedLayer || selectedLayer.locked}
                onClick={applyPresetToBeats}
                className="w-full"
              />
              <Button
                label="Clear Beat Markers"
                icon={Trash2}
                variant="danger"
                size="md"
                onClick={() => updateComposition(clearMotionBeatMarkers(composition))}
                className="w-full"
              />
            </>
          )}
        </Section>

        <Section title={`Markers (${composition.markers.length})`} icon={Flag}>
          {composition.markers.length === 0 ? (
            <EmptyState
              icon={Flag}
              title="No composition markers"
              description="Add timing markers at the playhead for cuts, reveals, voiceover notes, and sections."
            />
          ) : (
            <div className="space-y-2">
              {composition.markers.map((marker) => (
                <div
                  key={marker.id}
                  className="space-y-2 rounded-md border border-border bg-bg-2 p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: marker.color }}
                    />
                    <Button
                      label={`Go to ${marker.label}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => setPlayhead(marker.time)}
                      className="min-w-0 flex-1 justify-start text-left"
                    >
                      <span className="block truncate text-[12px] font-semibold text-fg-2">
                        {marker.label}
                      </span>
                      <span className="block text-[10.5px] tabular-nums text-fg-muted">
                        {marker.time.toFixed(2)}s
                      </span>
                    </Button>
                    <IconButton
                      icon={LocateFixed}
                      label="Go to marker"
                      size="sm"
                      onClick={() => setPlayhead(marker.time)}
                    />
                    <IconButton
                      icon={Trash2}
                      label="Remove marker"
                      size="sm"
                      variant="danger"
                      onClick={() => removeMarker(marker.id)}
                    />
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_84px] gap-2">
                    <Field label="Label">
                      <TextInput
                        value={marker.label}
                        onChange={(label) => updateMarker(marker.id, { label })}
                      />
                    </Field>
                    <Field label="Time" hint="s">
                      <NumberInput
                        value={marker.time}
                        min={0}
                        max={composition.duration}
                        step={1 / Math.max(1, composition.frameRate)}
                        onChange={(time) => updateMarker(marker.id, { time })}
                      />
                    </Field>
                  </div>
                  <Field label="Color">
                    <ColorInput
                      value={marker.color}
                      onChange={(color) => updateMarker(marker.id, { color })}
                    />
                  </Field>
                </div>
              ))}
            </div>
          )}
          <Button
            label="Add Marker At Playhead"
            icon={Plus}
            variant="outline"
            size="md"
            onClick={addMarker}
            className="w-full"
          />
        </Section>
      </div>
    </div>
  );
}

function estimateBpm(markers: readonly { readonly time: number }[]): number {
  if (markers.length < 2) return 0;
  let intervalTotal = 0;
  for (let index = 1; index < markers.length; index++) {
    intervalTotal += markers[index].time - markers[index - 1].time;
  }
  const averageInterval = intervalTotal / (markers.length - 1);
  if (averageInterval <= 0) return 0;
  return Math.round(60 / averageInterval);
}
