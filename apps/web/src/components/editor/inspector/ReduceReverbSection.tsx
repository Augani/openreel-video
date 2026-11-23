import React, { useCallback, useEffect, useRef, useState } from "react";
import { findReduceReverbEffect, getReduceReverbParams } from "@openreel/core";
import { Button, Progress } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import {
  cancelReduceReverb,
  currentReduceReverb,
  removeReduceReverb,
  setReduceReverb,
  startReverbJob,
  applyReduceReverb,
  useReduceReverbStatus,
} from "../../../services/reduce-reverb";
import { PropertySlider } from "./shell/PropertySlider";

interface ReduceReverbSectionProps {
  clipId: string;
}

/**
 * Reduce Reverb: removes the late reverberation (the smeared tail) of a roomy dialogue recording with an on-device
 * dereverberation: weighted prediction error plus a blind-RT60 spectral stage. Amount is how hard the tail is removed; Sensitivity
 * how early the prediction starts and how much of the signal is assumed to be reverberant. It runs once per source and setting in a
 * worker (progress and Cancel below); the preview and the export both play that same cached result.
 */
const ReduceReverbSection: React.FC<ReduceReverbSectionProps> = ({ clipId }) => {
  const clip = useProjectStore((state) =>
    state.project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId),
  );
  const locked = useProjectStore((state) => {
    const track = state.project.timeline.tracks.find((candidate) => candidate.clips.some((c) => c.id === clipId));
    return track?.locked ?? false;
  });
  const status = useReduceReverbStatus(clipId);
  const effect = findReduceReverbEffect(clip);
  const params = getReduceReverbParams(clip?.audioEffects);
  const hasEffect = !!effect && effect.enabled && !!params;
  const current = currentReduceReverb(clip);
  const [draftAmount, setDraftAmount] = useState(current.amount);
  const [draftSensitivity, setDraftSensitivity] = useState(current.sensitivity);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A clip that already carries the effect (a reopened project) gets its result computed here, so progress shows.
  useEffect(() => {
    if (hasEffect && status.state === "idle") void startReverbJob(clipId);
  }, [clipId, hasEffect, status.state]);

  useEffect(() => {
    if (params) {
      setDraftAmount(params.amount);
      setDraftSensitivity(params.sensitivity);
    }
  }, [params?.amount, params?.sensitivity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);

  const guard = useCallback(async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reduce Reverb could not be applied.");
    }
  }, []);

  const commit = (change: { amount?: number; sensitivity?: number }) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void guard(() => setReduceReverb(clipId, change)), 300);
  };

  if (!clip) return null;
  const running = status.state === "running";
  const percent = Math.round(status.fraction * 100);

  return (
    <div className="space-y-2.5" data-testid="reduce-reverb-section">
      <p className="text-[11px] leading-relaxed text-fg-3">
        Removes the late reverb tail of a roomy recording. Runs on this device. It cannot remove early reflections; strong settings can thin a voice.
      </p>
      {!hasEffect ? (
        <Button size="sm" className="w-full text-[11px]" data-testid="reduce-reverb-apply" disabled={locked} onClick={() => void guard(() => applyReduceReverb([clipId]))}>
          Reduce Reverb
        </Button>
      ) : (
        <>
          {running && (
            <div className="space-y-1.5 rounded-[7px] border border-border bg-bg-1 p-2.5" data-testid="reduce-reverb-progress" role="status" aria-live="polite">
              <div className="flex items-center justify-between text-[11px]">
                <span>Reducing reverb… {percent}%</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" data-testid="reduce-reverb-cancel" onClick={() => void guard(() => cancelReduceReverb(clipId))}>
                  Cancel
                </Button>
              </div>
              <Progress value={percent} className="h-1.5" />
              <p className="text-[10px] text-fg-3">You can keep editing and playing; the dry voice is swapped in when it is ready.</p>
            </div>
          )}
          {status.state === "failed" && (
            <div className="space-y-1.5 rounded-[7px] border border-destructive/40 bg-bg-1 p-2.5 text-[11px]" role="alert" data-testid="reduce-reverb-failed">
              <p>Reduce Reverb could not run{status.error ? `: ${status.error}` : "."}</p>
              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => void startReverbJob(clipId)}>
                Try again
              </Button>
            </div>
          )}
          <PropertySlider
            label="Amount"
            value={draftAmount}
            min={0}
            max={100}
            step={1}
            defaultValue={60}
            isDisabled={locked}
            formatValue={(value) => `${Math.round(value)}%`}
            onChange={(value) => {
              setDraftAmount(value);
              commit({ amount: value });
            }}
          />
          <PropertySlider
            label="Sensitivity"
            value={draftSensitivity}
            min={0}
            max={100}
            step={1}
            defaultValue={50}
            isDisabled={locked}
            formatValue={(value) => `${Math.round(value)}%`}
            onChange={(value) => {
              setDraftSensitivity(value);
              commit({ sensitivity: value });
            }}
          />
          {status.state === "ready" && status.rt60 !== undefined && (
            <p className="text-[10px] text-fg-3" data-testid="reduce-reverb-estimate">
              {(status.confidence ?? 0) > 0
                ? `Estimated room decay (RT60): ${status.rt60.toFixed(2)} s.`
                : "Not enough speech pauses to measure the room; a typical room decay was assumed."}
            </p>
          )}
          <Button size="sm" variant="outline" className="w-full text-[11px]" data-testid="reduce-reverb-remove" disabled={locked} onClick={() => void guard(() => removeReduceReverb(clipId))}>
            Remove Reduce Reverb
          </Button>
        </>
      )}
      {error && <p className="text-[11px] text-destructive" role="alert">{error}</p>}
    </div>
  );
};

export default ReduceReverbSection;
