import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AUDIO_TYPES,
  AUDIO_TYPE_LABELS,
  loudnessTargetFor,
  normalizeEssentialOptions,
  type AudioType,
  type EssentialSoundOptions,
} from "@openreel/core";
import { Button, cn } from "@openreel/ui";
import { ChevronDown, Loader2, Mic, Music, Waves, Zap } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import {
  applyEssentialSound,
  clearEssentialSound,
  essentialOptionsOf,
  essentialSoundStatus,
  essentialTarget,
  type EssentialProgress,
  type EssentialSoundResult,
} from "../../../services/essential-sound";
import { InspectorToggle } from "./shell/InspectorControls";
import { PropertySlider } from "./shell/PropertySlider";

interface EssentialSoundSectionProps {
  /** One clip, or every selected clip: the type and presets apply to all of them. */
  clipIds: readonly string[];
}

const TYPE_ICONS: Record<AudioType, React.ReactNode> = {
  dialogue: <Mic size={16} aria-hidden />,
  music: <Music size={16} aria-hidden />,
  sfx: <Zap size={16} aria-hidden />,
  ambience: <Waves size={16} aria-hidden />,
};

const TYPE_HINTS: Record<AudioType, string> = {
  dialogue: "Speech: match to −16 LUFS, clean up, add presence.",
  music: "Music bed: sit under dialogue, scoop the mids.",
  sfx: "Effects: match loudness and catch peaks with a limiter.",
  ambience: "Room tone: sit low, roll off the highs.",
};

const lufs = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(1).replace("-", "−");

const Group: React.FC<{ title: string; testId: string; defaultOpen?: boolean; children: React.ReactNode }> = ({
  title,
  testId,
  defaultOpen = true,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-testid={testId} className="rounded-[7px] border border-border bg-bg-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-[11px] font-semibold text-fg"
      >
        <ChevronDown size={12} aria-hidden className={cn("text-fg-3 transition-transform", !open && "-rotate-90")} />
        {title}
      </button>
      {open && <div className="space-y-2 border-t border-border/60 p-2">{children}</div>}
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-[11px] text-fg-2">{label}</span>
    {children}
  </div>
);

const progressLabel = (progress: EssentialProgress | null): string | null => {
  if (!progress) return null;
  const of = progress.total > 1 ? ` (${progress.index + 1} of ${progress.total})` : "";
  switch (progress.step) {
    case "measuring":
      return `Measuring loudness${of}…`;
    case "loudness":
      return `Matching loudness${of}…`;
    case "ducking":
      return `Ducking under dialogue${of}…`;
    case "effects":
      return `Applying effects${of}…`;
    default:
      return null;
  }
};

export const EssentialSoundSection: React.FC<EssentialSoundSectionProps> = ({ clipIds }) => {
  const project = useProjectStore((state) => state.project);
  const targets = useMemo(
    () => clipIds.map((id) => project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id)).filter((c) => !!c),
    [clipIds, project],
  );
  const lead = useMemo(() => {
    const first = clipIds[0] ? essentialTarget(clipIds[0]) : null;
    return first ? (project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === first.id) ?? null) : null;
    // `project` identity changes on every edit, which is when the status must refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipIds, project]);
  const status = useMemo(() => essentialSoundStatus(lead, project), [lead, project]);
  const options = useMemo(() => essentialOptionsOf(lead), [lead]);
  const audioType = status.audioType;
  const lockedTrack = useMemo(() => {
    for (const clip of targets) {
      const track = project.timeline.tracks.find((t) => t.id === clip.trackId);
      if (track?.locked) return track.name;
    }
    return null;
  }, [targets, project]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<EssentialProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [duckingReason, setDuckingReason] = useState<string | null>(null);
  const [clarityAmount, setClarityAmount] = useState(options.clarityAmount);
  const [duckAmount, setDuckAmount] = useState(options.duckAmountDb);
  const [duckFade, setDuckFade] = useState(options.duckFadeMs);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const leadId = lead?.id ?? null;
  useEffect(() => {
    setClarityAmount(options.clarityAmount);
    setDuckAmount(options.duckAmountDb);
    setDuckFade(options.duckFadeMs);
    setError(null);
    setNotes([]);
    setDuckingReason(null);
    // Re-sync the sliders when the clip (not each edit) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  const run = useCallback(
    (work: () => Promise<EssentialSoundResult[] | string[] | void>) => {
      // One operation at a time: each is a single undo step.
      queue.current = queue.current.then(async () => {
        setBusy(true);
        setError(null);
        try {
          const result = await work();
          if (Array.isArray(result) && result.length > 0 && typeof result[0] === "object") {
            const results = result as EssentialSoundResult[];
            setNotes([...new Set(results.flatMap((r) => r.notes))]);
            setDuckingReason(results.find((r) => r.duckingReason)?.duckingReason ?? null);
          } else if (Array.isArray(result)) {
            setNotes(result as string[]);
            setDuckingReason(null);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Essential Sound could not be applied.");
        } finally {
          setProgress(null);
          setBusy(false);
        }
      });
    },
    [],
  );

  const apply = useCallback(
    (type: AudioType, patch: Partial<EssentialSoundOptions>, rematch?: boolean) =>
      run(() => applyEssentialSound(clipIds, type, patch, { rematch, onProgress: setProgress })),
    [clipIds, run],
  );

  const debounced = useCallback((fn: () => void) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(fn, 450);
  }, []);

  if (clipIds.length === 0) return null;

  const matched = status.state?.loudness;
  const active = !!audioType;
  const target = audioType ? loudnessTargetFor(audioType, normalizeEssentialOptions(options)) : null;
  const disabled = busy || lockedTrack !== null;
  const noiseOn = options.repair && options.reduceNoise;
  const rumbleOn = options.repair && options.reduceRumble;

  return (
    <div className="space-y-2" data-testid="essential-sound">
      {clipIds.length > 1 && (
        <p className="text-[10px] text-fg-3" data-testid="essential-sound-multi">
          Applies to all {clipIds.length} selected clips.
        </p>
      )}
      <div role="radiogroup" aria-label="Audio type" className="grid grid-cols-2 gap-1.5">
        {AUDIO_TYPES.map((type) => {
          const selected = audioType === type;
          return (
            <Button
              key={type}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={AUDIO_TYPE_LABELS[type]}
              data-testid={`essential-type-${type}`}
              disabled={disabled}
              onClick={() => apply(type, {})}
              className={cn(
                "h-12 flex-col gap-0.5 rounded-[7px] border text-[11px] font-semibold",
                selected ? "border-primary bg-primary/15 text-fg" : "border-border bg-bg-2 text-fg-2 hover:bg-bg-3",
              )}
            >
              {TYPE_ICONS[type]}
              {AUDIO_TYPE_LABELS[type]}
            </Button>
          );
        })}
      </div>

      {lockedTrack && (
        <p role="alert" data-testid="essential-locked" className="text-[10px] text-status-warning">
          The track &quot;{lockedTrack}&quot; is locked. Unlock it to use Essential Sound.
        </p>
      )}

      {!active && (
        <p className="text-[10px] text-fg-3">Tag the clip as Dialogue, Music, SFX or Ambience for one-click presets.</p>
      )}

      {active && audioType && (
        <>
          <p className="text-[10px] text-fg-3" data-testid="essential-hint">
            {status.inferred ? `Inferred from the track role. ` : ""}
            {TYPE_HINTS[audioType]}
          </p>

          <Button
            type="button"
            size="sm"
            data-testid="essential-apply-all"
            disabled={disabled}
            onClick={() =>
              apply(
                audioType,
                { loudness: true, clarity: true, ducking: audioType !== "dialogue", clarityAmount, duckAmountDb: duckAmount, duckFadeMs: duckFade },
                true,
              )
            }
            className="h-8 w-full rounded-[7px] text-[11px] font-semibold"
          >
            Apply all presets
          </Button>

          <Group title="Loudness" testId="essential-group-loudness">
            <Row label={`Target ${lufs(target)} LUFS`}>
              <Button
                type="button"
                size="sm"
                data-testid="essential-auto-match"
                disabled={disabled}
                onClick={() => apply(audioType, { loudness: true }, true)}
                className="h-7 rounded-[7px] px-2.5 text-[11px]"
              >
                {matched ? "Match again" : "Auto-Match"}
              </Button>
            </Row>
            {matched && (
              <>
                <p data-testid="essential-loudness-readout" className="font-mono text-[11px] text-fg">
                  {lufs(matched.beforeLufs)} → {lufs(matched.afterLufs)} LUFS
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="essential-reset-match"
                  disabled={disabled}
                  onClick={() => apply(audioType, { loudness: false })}
                  className="h-6 px-1.5 text-[10px]"
                >
                  Reset loudness
                </Button>
                {matched.clamped && (
                  <p className="text-[10px] text-status-warning">The +12 dB clip gain limit stopped short of the target.</p>
                )}
              </>
            )}
            {busy && progressLabel(progress) && (
              <p data-testid="essential-progress" className="flex items-center gap-1 text-[10px] text-fg-3" role="status">
                <Loader2 size={11} className="animate-spin" aria-hidden />
                {progressLabel(progress)}
              </p>
            )}
          </Group>

          {audioType === "dialogue" && (
          <Group title="Repair" testId="essential-group-repair">
            {(
              <>
                <Row label="Reduce noise">
                  <InspectorToggle
                    ariaLabel="Reduce noise"
                    checked={noiseOn}
                    isDisabled={disabled}
                    onChange={(on) => apply(audioType, { repair: on || rumbleOn, reduceNoise: on, reduceRumble: rumbleOn })}
                  />
                </Row>
                <Row label="Reduce rumble">
                  <InspectorToggle
                    ariaLabel="Reduce rumble"
                    checked={rumbleOn}
                    isDisabled={disabled}
                    onChange={(on) => apply(audioType, { repair: on || noiseOn, reduceRumble: on, reduceNoise: noiseOn })}
                  />
                </Row>
                <p className="text-[10px] text-fg-3">For hum, clicks and sibilance use Audio repair below.</p>
              </>
            )}
          </Group>
          )}

          <Group title="Clarity" testId="essential-group-clarity">
            <Row label={audioType === "sfx" ? "Limiter" : "EQ preset"}>
              <InspectorToggle
                ariaLabel="Clarity preset"
                checked={options.clarity && !!status.state}
                isDisabled={disabled}
                onChange={(on) => apply(audioType, { clarity: on, clarityAmount })}
              />
            </Row>
            <PropertySlider
              label="Amount"
              min={0}
              max={1}
              step={0.05}
              value={clarityAmount}
              isDisabled={disabled || !options.clarity}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              onChange={(value) => {
                setClarityAmount(value);
                debounced(() => apply(audioType, { clarity: true, clarityAmount: value }));
              }}
            />
          </Group>

          {audioType !== "dialogue" && (
            <Group title="Duck against Dialogue" testId="essential-group-ducking">
              <Row label="Duck under dialogue">
                <InspectorToggle
                  ariaLabel="Duck against Dialogue"
                  checked={options.ducking && !!status.state?.ducking}
                  isDisabled={disabled}
                  onChange={(on) => apply(audioType, { ducking: on, duckAmountDb: duckAmount, duckFadeMs: duckFade })}
                />
              </Row>
              <PropertySlider
                label="Amount"
                min={3}
                max={30}
                step={1}
                value={duckAmount}
                isDisabled={disabled}
                formatValue={(v) => `−${Math.round(v)} dB`}
                onChange={(value) => {
                  setDuckAmount(value);
                  if (options.ducking) debounced(() => apply(audioType, { ducking: true, duckAmountDb: value, duckFadeMs: duckFade }));
                }}
              />
              <PropertySlider
                label="Fade"
                min={50}
                max={1500}
                step={50}
                value={duckFade}
                isDisabled={disabled}
                formatValue={(v) => `${Math.round(v)} ms`}
                onChange={(value) => {
                  setDuckFade(value);
                  if (options.ducking) debounced(() => apply(audioType, { ducking: true, duckAmountDb: duckAmount, duckFadeMs: value }));
                }}
              />
              {duckingReason && (
                <p data-testid="essential-ducking-reason" className="text-[10px] text-status-warning">
                  {duckingReason}
                </p>
              )}
            </Group>
          )}
        </>
      )}

      {error && (
        <p role="alert" data-testid="essential-error" className="text-[10px] text-status-error">
          {error}
        </p>
      )}
      {notes.map((note) => (
        <p key={note} data-testid="essential-note" className="text-[10px] text-fg-3">
          {note}
        </p>
      ))}

      {status.state || lead?.audioType ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="essential-clear"
          disabled={disabled}
          onClick={() => run(() => clearEssentialSound(clipIds))}
          className="h-7 w-full rounded-[7px] border border-border text-[11px]"
        >
          Clear Audio Type
        </Button>
      ) : null}
    </div>
  );
};
