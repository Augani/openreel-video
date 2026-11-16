import { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Switch,
} from "@openreel/ui";
import {
  getVolumeAutomationPointsForRange,
  resolveAudibleAudioTarget,
  type EQBand,
  type Effect,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useInspectorNavigationStore } from "../../../stores/inspector-navigation-store";
import { useUIStore } from "../../../stores/ui-store";
import { ValueField } from "./PrimaryVideoProperties";
import { InspectorSlider } from "./shell/InspectorSlider";
import { toast } from "../../../stores/notification-store";
import { createNoiseReductionEffect } from "../../../bridges/audio-bridge";
import { normalizeClipLoudness, NormalizeLockedTrackError } from "../../../services/loudness";
import { setQuickAudioDucking } from "../../../services/quick-audio-ducking";
const presets: Record<string, EQBand[]> = {
  flat: [
    { type: "lowshelf", frequency: 100, gain: 0, q: 0.7 },
    { type: "peaking", frequency: 1300, gain: 0, q: 0.8 },
    { type: "highshelf", frequency: 8000, gain: 0, q: 0.7 },
  ],
  music: [
    { type: "lowshelf", frequency: 100, gain: 1, q: 0.7 },
    { type: "peaking", frequency: 1300, gain: -5, q: 0.8 },
    { type: "highshelf", frequency: 8000, gain: 1, q: 0.7 },
  ],
  voice: [
    { type: "highpass", frequency: 80, gain: 0, q: 0.7 },
    { type: "peaking", frequency: 300, gain: -3, q: 1 },
    { type: "peaking", frequency: 3500, gain: 3, q: 0.8 },
  ],
};
function EQCurve({ bands, onEdit }: { bands: EQBand[]; onEdit: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const analyzer = useRef<BiquadFilterNode | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.width,
      height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#1c1d21";
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach((fraction) => {
      const x = fraction * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    });
    ctx.strokeStyle = "#26282d";
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    const frequencies = Float32Array.from(
      { length: width },
      (_, i) => 20 * Math.pow(1000, i / (width - 1)),
    );
    const db = new Float32Array(width);
    if (typeof OfflineAudioContext !== "undefined") {
      // One analysis node is sufficient for every band; no rendering or live audio.
      analyzer.current ??= new OfflineAudioContext(1, 1, 48000).createBiquadFilter();
      const filter = analyzer.current;
      const magnitude = new Float32Array(width);
      const phase = new Float32Array(width);
      for (const band of bands) {
        filter.type = band.type;
        filter.frequency.value = band.frequency;
        filter.Q.value = band.q;
        filter.gain.value = band.gain;
        if (typeof filter.getFrequencyResponse !== "function") continue;
        filter.getFrequencyResponse(frequencies, magnitude, phase);
        for (let i = 0; i < width; i++)
          db[i] += 20 * Math.log10(Math.max(0.00001, magnitude[i]));
      }
    }
    ctx.strokeStyle = "#e8be62";
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < width; i++) {
      const y = height / 2 - (Math.max(-12, Math.min(12, db[i])) * height) / 24;
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.stroke();
    for (const band of bands) {
      const x = Math.max(
        0,
        Math.min(width - 1, (Math.log10(band.frequency / 20) / 3) * width),
      );
      const y =
        height / 2 -
        (Math.max(-12, Math.min(12, db[Math.round(x)])) * height) / 24;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#e8be62";
      ctx.fill();
    }
  }, [bands]);
  return (
    <div className="workspace-eq-curve">
      <Button
        variant="ghost"
        className="workspace-eq-plot"
        aria-label="Edit equalizer bands & effects"
        onClick={onEdit}
      >
        <canvas
          ref={ref}
          width={580}
          height={140}
          aria-label="Equalizer frequency response"
        />
      </Button>
      <div aria-hidden="true">
        <span>60</span>
        <span>1k</span>
        <span>16k</span>
      </div>
    </div>
  );
}
export function PrimaryAudioProperties({ clipId }: { clipId: string }) {
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const project = useProjectStore((s) => s.project);
  const clip = project.timeline.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === clipId);
  const queue = useRef(Promise.resolve());
  const [enhancing, setEnhancing] = useState<string | null>(null);
  const [loudnessTarget, setLoudnessTarget] = useState<string>("-14");
  const [customLufs, setCustomLufs] = useState(-14);
  const [normalizeStatus, setNormalizeStatus] = useState<string | null>(null);
  if (!clip) return null;
  const audioTarget = resolveAudibleAudioTarget(clip, project.timeline) ?? clip;
  const openEnhancement = (sectionId: string) => {
    if (audioTarget.id !== clipId)
      useUIStore
        .getState()
        .select({
          type: "clip",
          id: audioTarget.id,
          trackId: audioTarget.trackId,
        });
    useInspectorNavigationStore
      .getState()
      .requestSection(sectionId, audioTarget.id);
  };
  const ducking = audioTarget.metadata?.audioDucking as
    | { enabled?: boolean; reduction?: number }
    | undefined;
  const noise = audioTarget.audioEffects.find(
    (effect) => effect.type === "noiseReduction",
  );
  const targetLufs = loudnessTarget === "custom" ? customLufs : Number(loudnessTarget);
  const runNormalize = async () => {
    setEnhancing("loudness");
    setNormalizeStatus("Measuring…");
    try {
      const result = await normalizeClipLoudness(clipId, targetLufs);
      if (!result.applied) {
        setNormalizeStatus("Silent clip: nothing to normalize");
        return;
      }
      const { plan, measured } = result;
      const sign = plan.appliedGainDb >= 0 ? "+" : "−";
      setNormalizeStatus(
        `${measured.integrated.toFixed(1)} → ${plan.resultingLufs.toFixed(1)} LUFS (${sign}${Math.abs(plan.appliedGainDb).toFixed(1)} dB)` +
          (plan.clamped ? " · limited by +12 dB max" : "") +
          (plan.resultingTruePeakDb > -1 ? ` · peaks ${plan.resultingTruePeakDb.toFixed(1)} dBTP` : ""),
      );
    } catch (error) {
      setNormalizeStatus(null);
      toast.error(
        error instanceof NormalizeLockedTrackError
          ? "Track is locked"
          : "Loudness could not be measured",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setEnhancing(null);
    }
  };
  const toggleEnhancement = (
    kind: "noise",
    enabled: boolean,
  ) => {
    setEnhancing(kind);
    queue.current = queue.current
      .then(async () => {
        const store = useProjectStore.getState();
        if (store.project.id !== project.id)
          throw new Error("The project changed. Select the clip again.");
        const effects = store.getAudioEffects(audioTarget.id);
        const existing = effects.find((effect) => effect.type === "noiseReduction");
        if (existing) {
          if (
            !(await store.toggleAudioEffect(
              audioTarget.id,
              existing.id,
              enabled,
            ))
          )
            throw new Error("The adjustment could not be changed.");
        } else if (enabled) {
          const effect = createNoiseReductionEffect();
          if (
            !(await store.addAudioEffect(audioTarget.id, {
              ...effect,
              id: crypto.randomUUID(),
            }))
          )
            throw new Error("The adjustment could not be added.");
        }
      })
      .catch((error) => {
        toast.error(
          "Audio adjustment failed",
          error instanceof Error ? error.message : "Try again.",
        );
      })
      .finally(() => setEnhancing(null));
  };
  const update = (type: string, params: Record<string, unknown>) => {
    void useProjectStore.getState().executeAction({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type,
      params: { clipId, ...params },
    });
  };
  const effect = (type: string, params: Record<string, unknown>) => {
    queue.current = queue.current
      .then(async () => {
        const state = useProjectStore.getState();
        if (state.project.id !== project.id)
          throw new Error("The project changed. Select the clip again.");
        const existing = state.getAudioEffects(clipId).find((e) => e.type === type);
        const reenable = existing?.enabled === false;
        if (reenable) state.actionHistory.beginGroup(`Enable and adjust ${type}`);
        try {
          const ok = existing
            ? await state.updateAudioEffect(clipId, existing.id, params)
            : await state.addAudioEffect(clipId, {
                id: crypto.randomUUID(),
                type,
                enabled: true,
                params,
              } as Effect);
          if (!ok) throw new Error("Audio effect could not be updated.");
          if (
            reenable &&
            !(await useProjectStore.getState().toggleAudioEffect(clipId, existing.id, true))
          )
            throw new Error("Audio effect could not be enabled.");
        } finally {
          if (reenable) state.actionHistory.endGroup();
        }
      })
      .catch(() => {
        toast.error("Audio adjustment failed", "Try the adjustment again.");
      });
  };
  const localTime = Math.max(
    0,
    Math.min(clip.duration, playhead - clip.startTime),
  );
  const volumePoints = clip.automation?.volume ?? [];
  const pointAtPlayhead = volumePoints.find(
    (point) => Math.abs(point.time - localTime) < 0.01,
  );
  const volume =
    getVolumeAutomationPointsForRange(
      volumePoints,
      localTime,
      0.001,
      clip.volume,
    )[0]?.value ?? clip.volume;
  const gain = volume > 0 ? 20 * Math.log10(volume) : -60;
  const panEffect = clip.audioEffects.find((e) => e.type === "pan");
  const pan =
    panEffect?.enabled === false ? 0 : Number(panEffect?.params.value ?? 0);
  const eq = clip.audioEffects.find((e) => e.type === "eq");
  const bands = eq?.enabled !== false && Array.isArray(eq?.params.bands)
    ? (eq.params.bands as EQBand[])
    : presets.flat;
  const rows = [
    {
      label: "Volume",
      value: gain,
      min: -60,
      max: 12,
      step: 0.1,
      unit: "dB",
      onChange: (value: number) => {
        const volume = value <= -60 ? 0 : Math.pow(10, value / 20);
        if (volumePoints.length)
          update("audio/addAutomation", {
            points: [
              ...volumePoints.filter(
                (point) => Math.abs(point.time - localTime) >= 0.01,
              ),
              { time: localTime, value: volume },
            ].sort((a, b) => a.time - b.time),
          });
        else update("audio/setVolume", { volume });
      },
    },
    {
      label: "Pan",
      value: pan,
      min: -1,
      max: 1,
      step: 0.01,
      unit: "",
      onChange: (value: number) => effect("pan", { value }),
    },
    {
      label: "Fade in",
      value: clip.fade?.fadeIn ?? 0,
      min: 0,
      max: clip.duration / 2,
      step: 0.1,
      unit: "s",
      onChange: (fadeIn: number) => update("audio/setFade", { fadeIn }),
    },
    {
      label: "Fade out",
      value: clip.fade?.fadeOut ?? 0,
      min: 0,
      max: clip.duration / 2,
      step: 0.1,
      unit: "s",
      onChange: (fadeOut: number) => update("audio/setFade", { fadeOut }),
    },
  ];
  return (
    <div className="workspace-primary-audio" data-section-id="clip-audio">
      <div className="workspace-primary-properties">
        {rows.map((row) => (
          <div className="workspace-audio-property" key={row.label}>
            <span>{row.label}</span>
            <InspectorSlider
              historyKey={`${clipId}:${row.label}`}
              aria-label={row.label}
              value={[row.value]}
              min={row.min}
              max={row.max}
              step={row.step}
              onValueChange={([v]) => row.onChange(v)}
            />
            <ValueField
              label={`${row.label} value`}
              value={row.value}
              min={row.min}
              max={row.max}
              step={row.step}
              unit={row.unit}
              displayPrecision={row.unit === "s" ? 1 : 3}
              fixedPrecision={row.unit === "s"}
              displayText={row.label === "Pan" && row.value === 0 ? "C" : undefined}
              onChange={row.onChange}
            />
            {row.label === "Volume" ? (
              <Button
                variant="ghost"
                size="icon-xs"
                className={`workspace-keyframe ${pointAtPlayhead ? "is-set" : ""}`}
                aria-label={`${pointAtPlayhead ? "Remove" : "Add"} volume keyframe`}
                aria-pressed={!!pointAtPlayhead}
                disabled={
                  playhead < clip.startTime ||
                  playhead > clip.startTime + clip.duration
                }
                onClick={() =>
                  update("audio/addAutomation", {
                    points: pointAtPlayhead
                      ? volumePoints.filter(
                          (point) => point !== pointAtPlayhead,
                        )
                      : [
                          ...volumePoints,
                          { time: localTime, value: volume },
                        ].sort((a, b) => a.time - b.time),
                  })
                }
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill={pointAtPlayhead ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 2l10 10-10 10L2 12z" /></svg>
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="workspace-keyframe"
                disabled
                aria-label={`${row.label} keyframes unavailable`}
                title="Only volume automation is currently supported."
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 2l10 10-10 10L2 12z" /></svg>
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="workspace-audio-separator" role="separator" />
      <section>
        <div className="workspace-eq-heading">
          <h3>Equalizer</h3>
          <Select
            value={
              eq?.enabled === false ? "bypassed" : Object.entries(presets).find(
                ([, p]) => JSON.stringify(p) === JSON.stringify(bands),
              )?.[0] ?? "custom"
            }
            onValueChange={(value) => {
              if (presets[value]) effect("eq", { bands: presets[value] });
            }}
          >
            <SelectTrigger aria-label="Equalizer preset" icon={<span aria-hidden="true">▾</span>}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">Flat</SelectItem>
              {eq?.enabled === false && <SelectItem value="bypassed" disabled>Bypassed</SelectItem>}
              <SelectItem value="music">Music bed · duck mids</SelectItem>
              <SelectItem value="voice">Voice clarity</SelectItem>
              <SelectItem value="custom" disabled>
                Custom
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <EQCurve
          bands={bands}
          onEdit={() =>
            useInspectorNavigationStore
              .getState()
              .requestSection("audio-effects", clipId)
          }
        />
      </section>
      <div className="workspace-audio-separator" role="separator" />
      <section>
        <h3>Enhance</h3>
        <div className="workspace-enhancement-row">
          <Button
            variant="ghost"
            onClick={() => openEnhancement("audio-ducking")}
          >
            Auto-duck under dialogue
          </Button>
          <span>
            {ducking?.enabled
              ? `${Math.round(20 * Math.log10(Math.max(0.001, 1 - (ducking.reduction ?? 0.6))))} dB`
              : "off"}
          </span>
          <Switch
            aria-label="Auto-duck under dialogue"
            checked={ducking?.enabled === true}
            disabled={enhancing !== null}
            onCheckedChange={async (enabled) => {
              setEnhancing("ducking");
              try {
                await setQuickAudioDucking(clipId, enabled);
              } catch (error) {
                toast.error(
                  "Ducking could not be applied",
                  error instanceof Error ? error.message : "Try again.",
                );
              } finally {
                setEnhancing(null);
              }
            }}
          />
        </div>
        <div
          className="workspace-enhancement-row workspace-loudness-row"
          title="Measures this clip's integrated loudness (ITU-R BS.1770-4) and sets its clip gain to land on the target. One undo step."
        >
          <Button
            variant="ghost"
            aria-label="Normalize loudness"
            disabled={enhancing !== null}
            onClick={() => void runNormalize()}
          >
            Normalize loudness
          </Button>
          {/* The target picker already shows the target; only surface results. */}
          {normalizeStatus ? (
            <span data-testid="normalize-loudness-status" title={normalizeStatus}>{normalizeStatus}</span>
          ) : null}
          <Select value={loudnessTarget} onValueChange={setLoudnessTarget}>
            <SelectTrigger aria-label="Loudness target" icon={<span aria-hidden="true">▾</span>}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="-14">−14 LUFS · streaming</SelectItem>
              <SelectItem value="-16">−16 LUFS · podcast</SelectItem>
              <SelectItem value="-23">−23 LUFS · broadcast</SelectItem>
              <SelectItem value="custom">Custom…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {loudnessTarget === "custom" ? (
          <div className="workspace-audio-property">
            <span>Target</span>
            <InspectorSlider
              historyKey={`${clipId}:loudness-target`}
              aria-label="Custom loudness target"
              value={[customLufs]}
              min={-40}
              max={-5}
              step={0.5}
              onValueChange={([v]) => setCustomLufs(v)}
            />
            <ValueField
              label="Custom loudness target value"
              value={customLufs}
              min={-40}
              max={-5}
              step={0.5}
              unit="LUFS"
              displayPrecision={1}
              fixedPrecision
              onChange={setCustomLufs}
            />
          </div>
        ) : null}
        <div className="workspace-enhancement-row">
          <Button
            variant="ghost"
            onClick={() => openEnhancement("background-noise-removal")}
          >
            Noise reduction
          </Button>
          <span>{noise?.enabled ? "on" : "off"}</span>
          <Switch
            aria-label="Noise reduction"
            checked={noise?.enabled === true}
            disabled={enhancing !== null}
            onCheckedChange={(enabled) => toggleEnhancement("noise", enabled)}
          />
        </div>
      </section>
    </div>
  );
}
