import React, { useCallback, useEffect, useRef, useState } from "react";
import { findEnhanceSpeechEffect, getEnhanceSpeechBalance, getEnhanceSpeechMix } from "@openreel/core";
import { Button, Progress, Tabs, TabsList, TabsTrigger } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import {
  applyEnhanceSpeech,
  cancelEnhanceSpeech,
  isPreviewingOriginal,
  removeEnhanceSpeech,
  setEnhancePreviewOriginal,
  setEnhanceSpeechBalance,
  setEnhanceSpeechMix,
  startEnhanceJob,
  useEnhanceStatus,
} from "../../../services/enhance-speech";
import { PropertySlider } from "./shell/PropertySlider";

interface EnhanceSpeechSectionProps {
  clipId: string;
}

/**
 * Enhance Speech: removes noise and room reverb from dialogue with an on-device model. One click adds the effect; Mix
 * blends the enhanced voice with the original. The model runs once per source in a worker (progress and Cancel below),
 * and the preview and the export both play that same cached result. "Hear Original / Enhanced" is a preview-only A/B.
 */
export const EnhanceSpeechSection: React.FC<EnhanceSpeechSectionProps> = ({ clipId }) => {
  const clip = useProjectStore((state) =>
    state.project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId),
  );
  const locked = useProjectStore((state) => {
    const track = state.project.timeline.tracks.find((candidate) => candidate.clips.some((c) => c.id === clipId));
    return track?.locked ?? false;
  });
  const status = useEnhanceStatus(clipId);
  const effect = findEnhanceSpeechEffect(clip);
  const mix = getEnhanceSpeechMix(clip?.audioEffects);
  const balance = getEnhanceSpeechBalance(clip?.audioEffects);
  const [draftMix, setDraftMix] = useState(mix || 100);
  const [draftBalance, setDraftBalance] = useState(balance);
  const pendingBalance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewingOriginal = isPreviewingOriginal(clip);
  const hasEffect = !!effect && effect.enabled;

  // A clip that already carries the effect (a reopened project) gets its enhancement computed here, so progress shows.
  useEffect(() => {
    if (hasEffect && mix > 0 && status.state === "idle") void startEnhanceJob(clipId);
  }, [clipId, hasEffect, mix, status.state]);

  useEffect(() => {
    if (mix > 0) setDraftMix(mix);
  }, [mix]);
  useEffect(() => setDraftBalance(balance), [balance]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); if (pendingBalance.current) clearTimeout(pendingBalance.current); }, []);

  const guard = useCallback(async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enhance Speech could not be applied.");
    }
  }, []);

  if (!clip) return null;
  const running = status.state === "running";
  const percent = Math.round(status.fraction * 100);

  return (
    <div className="space-y-2.5" data-testid="enhance-speech-section">
      <p className="text-[11px] leading-relaxed text-fg-3">
        Removes background noise and room reverb from dialogue. Runs on this device; the first use downloads a 9 MB model.
      </p>
      {!hasEffect ? (
        <Button
          size="sm"
          className="w-full text-[11px]"
          data-testid="enhance-speech-apply"
          disabled={locked}
          onClick={() => void guard(() => applyEnhanceSpeech([clipId]))}
        >
          Enhance Speech
        </Button>
      ) : (
        <>
          {running && (
            <div className="space-y-1.5 rounded-[7px] border border-border bg-bg-1 p-2.5" data-testid="enhance-speech-progress" role="status" aria-live="polite">
              <div className="flex items-center justify-between text-[11px]">
                <span>Enhancing speech… {percent}%</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" data-testid="enhance-speech-cancel" onClick={() => void guard(() => cancelEnhanceSpeech(clipId))}>
                  Cancel
                </Button>
              </div>
              <Progress value={percent} className="h-1.5" />
              <p className="text-[10px] text-fg-3">You can keep editing and playing; the enhanced voice is swapped in when it is ready.</p>
            </div>
          )}
          {status.state === "failed" && (
            <div className="space-y-1.5 rounded-[7px] border border-destructive/40 bg-bg-1 p-2.5 text-[11px]" role="alert" data-testid="enhance-speech-failed">
              <p>Enhance Speech could not run{status.error ? `: ${status.error}` : "."}</p>
              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => void startEnhanceJob(clipId)}>
                Try again
              </Button>
            </div>
          )}
          <PropertySlider
            label="Mix"
            value={draftMix}
            min={0}
            max={100}
            step={1}
            defaultValue={100}
            isDisabled={locked}
            formatValue={(value) => `${Math.round(value)}%`}
            onChange={(value) => {
              setDraftMix(value);
              if (pending.current) clearTimeout(pending.current);
              pending.current = setTimeout(() => void guard(() => setEnhanceSpeechMix(clipId, value)), 250);
            }}
          />
          <PropertySlider
            label="Speech / Background"
            ariaLabel="Speech and background balance"
            value={draftBalance}
            min={0}
            max={100}
            step={1}
            defaultValue={100}
            isDisabled={locked}
            formatValue={(value) => (value >= 100 ? "Speech only" : value === 50 ? "Original" : value <= 0 ? "Background only" : `${Math.round(value)}`)}
            onChange={(value) => {
              setDraftBalance(value);
              if (pendingBalance.current) clearTimeout(pendingBalance.current);
              pendingBalance.current = setTimeout(() => void guard(() => setEnhanceSpeechBalance(clipId, value)), 250);
            }}
          />
          <p className="text-[10px] leading-relaxed text-fg-3" data-testid="enhance-speech-balance-note">
            Background is what the model removed (original minus enhanced). Moving this remixes the two; the model does not run again.
          </p>
          <div className="space-y-2 rounded-[7px] border border-border bg-bg-1 p-2.5">
            <p className="text-[11px] font-medium">Before / After</p>
            <Tabs value={previewingOriginal ? "original" : "enhanced"} onValueChange={(value) => setEnhancePreviewOriginal(clipId, value === "original")}>
              <TabsList className="grid h-7 w-full grid-cols-2">
                <TabsTrigger value="original" className="text-[11px]" data-testid="enhance-speech-hear-original">Hear Original</TabsTrigger>
                <TabsTrigger value="enhanced" className="text-[11px]" data-testid="enhance-speech-hear-enhanced" disabled={running}>Hear Enhanced</TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-[10px] leading-relaxed text-fg-3">Preview only. Export always uses the enhanced audio at this Mix.</p>
          </div>
          <Button size="sm" variant="outline" className="w-full text-[11px]" data-testid="enhance-speech-remove" disabled={locked} onClick={() => void guard(() => removeEnhanceSpeech(clipId))}>
            Remove Enhance Speech
          </Button>
        </>
      )}
      {error && <p className="text-[11px] text-destructive" role="alert">{error}</p>}
    </div>
  );
};
