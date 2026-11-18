import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  REPAIR_EFFECT_DEFINITIONS,
  REPAIR_EFFECT_TYPES,
  type RepairEffectType,
  type RepairSuggestion,
  type Spectrogram,
} from "@openreel/core";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
  cn,
} from "@openreel/ui";
import { ChevronDown, Plus, Sparkles, X } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import {
  analyzeClip,
  applyRepairSuggestions,
  clipRepairEffects,
  createClipRepairEffect,
  spectrogramForClip,
  type ClipAnalysis,
} from "../../../services/audio-repair";
import { RepairEffectEditor } from "../../audio-repair/RepairEffectEditor";
import { SpectrogramCanvas } from "../../audio-repair/SpectrogramCanvas";

interface RepairSectionProps {
  clipId: string;
}

const ISSUE_LABELS: Record<RepairEffectType, string> = {
  deClip: "Clipping",
  deClick: "Clicks",
  deHum: "Hum",
  deEss: "Sibilance",
  deReverb: "Reverb",
  gate: "Noise between phrases",
  brickwallLimiter: "Peaks over the ceiling",
  lowPass: "High-frequency hiss",
};

/**
 * Essential-Sound-style Repair panel for a dialogue clip: Analyze finds hum,
 * clipping, clicks and sibilance, suggests settings, and Apply adds every
 * ticked fix as one undo step. Below it, each repair effect on the clip with
 * bypass (A/B), presets, parameters and gain-reduction meter, plus a
 * read-only spectrogram of the source or the processed result.
 */
export const RepairSection: React.FC<RepairSectionProps> = ({ clipId }) => {
  const clip = useProjectStore((state) =>
    state.project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId),
  );
  const effects = useMemo(() => clipRepairEffects(clip), [clip]);
  const toggleAudioEffect = useProjectStore((state) => state.toggleAudioEffect);
  const removeAudioEffect = useProjectStore((state) => state.removeAudioEffect);
  const updateAudioEffect = useProjectStore((state) => state.updateAudioEffect);
  const addAudioEffect = useProjectStore((state) => state.addAudioEffect);

  const [analysis, setAnalysis] = useState<ClipAnalysis | null>(null);
  const [busy, setBusy] = useState<"analyze" | "spectrogram" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<RepairEffectType>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [view, setView] = useState<"source" | "processed">("source");
  const [processed, setProcessed] = useState<Spectrogram | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const runId = useRef(0);

  // What the analysis describes: the clip's source audio window. Trimming, retiming or relinking it makes the findings stale.
  const sourceKey = clip
    ? [clip.mediaId, clip.inPoint, clip.outPoint, clip.duration, clip.speed ?? 1, clip.startTime].join("|")
    : "";
  // What the "With repairs" spectrogram describes: the clip's effect chain.
  const effectsKey = useMemo(() => JSON.stringify(effects.map((e) => [e.id, e.enabled, e.params])), [effects]);
  const effectsKeyRef = useRef(effectsKey);
  effectsKeyRef.current = effectsKey;

  // A different clip, or an edit that changes what the analysis described, invalidates it.
  useEffect(() => {
    runId.current += 1;
    setAnalysis(null);
    setProcessed(null);
    setPicked(new Set());
    setError(null);
    setApplied(null);
    setView("source");
    setBusy(null);
  }, [clipId, sourceKey]);

  // Editing the repair chain makes a rendered "With repairs" spectrogram stale.
  useEffect(() => {
    setProcessed(null);
    setView("source");
  }, [effectsKey]);

  const analyze = useCallback(async () => {
    const id = ++runId.current;
    setBusy("analyze");
    setError(null);
    setApplied(null);
    try {
      const result = await analyzeClip(clipId);
      if (id !== runId.current) return;
      setAnalysis(result);
      setProcessed(null);
      setView("source");
      setPicked(new Set(result.suggestions.map((s) => s.type)));
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      if (id === runId.current) setBusy(null);
    }
  }, [clipId]);

  const showProcessed = useCallback(async () => {
    setView("processed");
    const id = runId.current;
    const key = effectsKeyRef.current;
    setBusy("spectrogram");
    try {
      const sp = await spectrogramForClip(clipId, true);
      if (id === runId.current && key === effectsKeyRef.current) setProcessed(sp);
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : "Could not render the processed clip");
    } finally {
      if (id === runId.current) setBusy(null);
    }
  }, [clipId]);

  const suggestions = analysis?.suggestions ?? [];
  const chosen = suggestions.filter((s) => picked.has(s.type));

  const apply = useCallback(async () => {
    if (chosen.length === 0) return;
    setError(null);
    try {
      await applyRepairSuggestions(clipId, chosen as readonly RepairSuggestion[]);
      setApplied(`Applied ${chosen.length} repair${chosen.length === 1 ? "" : "s"} (one undo step).`);
      setProcessed(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the repairs");
    }
  }, [chosen, clipId]);

  if (!clip) return null;

  const issues: Array<{ type: RepairEffectType; present: boolean; detail: string }> = analysis
    ? [
        {
          type: "deHum",
          present: analysis.report.hum.present,
          detail: analysis.report.hum.present
            ? `${analysis.report.hum.frequency} Hz, ${analysis.report.hum.prominenceDb.toFixed(0)} dB above floor`
            : "None found",
        },
        {
          type: "deClip",
          present: analysis.report.clipping.present,
          detail: analysis.report.clipping.present
            ? `${analysis.report.clipping.runs} clipped peaks at ${analysis.report.clipping.peak.toFixed(2)} FS`
            : "None found",
        },
        {
          type: "deClick",
          present: analysis.report.clicks.present,
          detail: analysis.report.clicks.present ? `${analysis.report.clicks.count} clicks` : "None found",
        },
        {
          type: "deEss",
          present: analysis.report.sibilance.present,
          detail: analysis.report.sibilance.present
            ? `Harsh around ${(analysis.report.sibilance.centerHz / 1000).toFixed(1)} kHz`
            : "None found",
        },
      ]
    : [];

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="repair-section">
      <p className="text-[11px] leading-snug text-fg-muted">
        Analyze finds hum, clipping, clicks and sibilance in this clip and suggests settings. Applying is one undo step.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-[11px]"
          onClick={() => void analyze()}
          disabled={busy !== null}
          data-testid="repair-analyze"
        >
          <Sparkles size={12} aria-hidden />
          {busy === "analyze" ? "Analyzing…" : analysis ? "Analyze again" : "Auto-detect issues"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" data-testid="repair-add">
              <Plus size={12} aria-hidden />
              Add effect
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {REPAIR_EFFECT_TYPES.map((type) => (
              <DropdownMenuItem
                key={type}
                onSelect={() => {
                  const effect = createClipRepairEffect(type);
                  void addAudioEffect(clipId, effect);
                  setExpanded(effect.id);
                }}
              >
                {REPAIR_EFFECT_DEFINITIONS[type].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-status-error">
          {error}
        </p>
      )}

      {analysis && (
        <div className="flex flex-col gap-1.5 rounded border border-border bg-bg-1 p-2" data-testid="repair-findings">
          {issues.map((issue) => {
            const suggestion = suggestions.find((s) => s.type === issue.type);
            return (
              <label
                key={issue.type}
                className={cn("flex min-w-0 items-start gap-2 text-[11px]", !issue.present && "opacity-55")}
                data-testid={`repair-issue-${issue.type}`}
                data-present={issue.present}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  disabled={!issue.present}
                  checked={issue.present && picked.has(issue.type)}
                  onChange={(e) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(issue.type);
                      else next.delete(issue.type);
                      return next;
                    })
                  }
                  aria-label={`Fix ${ISSUE_LABELS[issue.type]}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-fg">{ISSUE_LABELS[issue.type]}</span>
                  <span className="text-fg-muted"> · {issue.detail}</span>
                  {suggestion && (
                    <span className="block truncate text-[10px] text-fg-muted">→ {REPAIR_EFFECT_DEFINITIONS[issue.type].label}</span>
                  )}
                </span>
              </label>
            );
          })}
          <div className="mt-1 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              disabled={chosen.length === 0}
              onClick={() => void apply()}
              data-testid="repair-apply"
            >
              {suggestions.length === 0 ? "Nothing to repair" : `Apply ${chosen.length} repair${chosen.length === 1 ? "" : "s"}`}
            </Button>
            {applied && (
              <span className="text-[10px] text-fg-muted" data-testid="repair-applied">
                {applied}
              </span>
            )}
          </div>
        </div>
      )}

      {effects.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="repair-effects">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">On this clip</span>
          {effects.map((effect) => {
            const type = effect.type as RepairEffectType;
            const open = expanded === effect.id;
            return (
              <div
                key={effect.id}
                className={cn("rounded border border-border bg-bg-1", !effect.enabled && "opacity-70")}
                data-testid={`repair-effect-${type}`}
                data-enabled={effect.enabled}
              >
                <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-1">
                  <Switch
                    checked={effect.enabled}
                    onCheckedChange={(on) => void toggleAudioEffect(clipId, effect.id, on)}
                    aria-label={`${effect.enabled ? "Bypass" : "Enable"} ${REPAIR_EFFECT_DEFINITIONS[type].label}`}
                    className="workspace-switch flex-none"
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] text-fg"
                    onClick={() => setExpanded(open ? null : effect.id)}
                    aria-expanded={open}
                    aria-label={`Edit ${REPAIR_EFFECT_DEFINITIONS[type].label} parameters`}
                  >
                    <ChevronDown size={11} aria-hidden className={cn("shrink-0 transition-transform", !open && "-rotate-90")} />
                    <span className="truncate">{REPAIR_EFFECT_DEFINITIONS[type].label}</span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-5 shrink-0 text-fg-muted hover:text-status-error"
                    aria-label={`Remove ${REPAIR_EFFECT_DEFINITIONS[type].label}`}
                    onClick={() => void removeAudioEffect(clipId, effect.id)}
                  >
                    <X size={11} aria-hidden />
                  </Button>
                </div>
                {open && (
                  <div className="border-t border-border px-2 py-2">
                    <RepairEffectEditor
                      type={type}
                      effectId={effect.id}
                      params={effect.params}
                      active={effect.enabled}
                      onCommit={(params) => void updateAudioEffect(clipId, effect.id, params)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {analysis && (
        <div className="flex flex-col gap-1.5" data-testid="repair-spectrogram">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Spectrogram</span>
            <div className="flex gap-1" role="group" aria-label="Spectrogram source">
              <Button
                type="button"
                size="sm"
                variant={view === "source" ? "secondary" : "ghost"}
                className="h-5 px-1.5 text-[10px]"
                onClick={() => setView("source")}
                aria-pressed={view === "source"}
              >
                Source
              </Button>
              <Button
                type="button"
                size="sm"
                variant={view === "processed" ? "secondary" : "ghost"}
                className="h-5 px-1.5 text-[10px]"
                onClick={() => void showProcessed()}
                disabled={busy === "spectrogram"}
                aria-pressed={view === "processed"}
              >
                {busy === "spectrogram" ? "Rendering…" : "With repairs"}
              </Button>
            </div>
          </div>
          <SpectrogramCanvas
            spectrogram={view === "source" ? analysis.spectrogram : processed}
            label={`Spectrogram of the ${view === "source" ? "source" : "repaired"} clip audio`}
          />
          <span className="text-[10px] text-fg-muted">Hum shows as steady horizontal lines, clicks as vertical stripes, sibilance as bright bursts near the top.</span>
        </div>
      )}
    </div>
  );
};
