import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  evaluateCompliance,
  getRealtimeAudioGraph,
  LOUDNESS_PRESETS,
  loudnessTargetFromPreset,
  type ComplianceResult,
  type LoudnessSnapshot,
} from "@openreel/core";
import { Button, Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useLoudnessStore } from "../../stores/loudness-store";
import { createLiveLoudnessTap } from "../../services/live-loudness-meter";
import { analyzeTimelineLoudness } from "../../services/loudness";
import { toast } from "../../stores/notification-store";
import { describeCompliance, describeVerdict, isSilentCompliance } from "../../services/export-loudness-report";

const formatLufs = (value: number, digits = 1): string =>
  Number.isFinite(value) ? value.toFixed(digits) : "−∞";

/** EBU +9 scale: -41..-5 LUFS across the bar. */
const barPercent = (lufs: number): number =>
  Number.isFinite(lufs) ? Math.min(100, Math.max(0, ((lufs + 41) / 36) * 100)) : 0;

const EMPTY_SNAPSHOT: LoudnessSnapshot = {
  momentary: -Infinity,
  shortTerm: -Infinity,
  integrated: -Infinity,
  loudnessRange: 0,
  momentaryMax: -Infinity,
  shortTermMax: -Infinity,
  truePeak: -Infinity,
  samplePeak: -Infinity,
  duration: 0,
};

function Readout({
  label,
  value,
  unit,
  testId,
  warn,
}: {
  label: string;
  value: string;
  unit: string;
  testId: string;
  warn?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-md border border-border bg-bg-2 px-2 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</span>
      <span className="flex items-baseline gap-1">
        <span
          className={`font-mono text-[15px] tabular-nums ${warn ? "text-status-error" : "text-fg"}`}
          data-testid={testId}
        >
          {value}
        </span>
        <span className="text-[10px] text-fg-muted">{unit}</span>
      </span>
    </div>
  );
}

function ComplianceList({ result, testId }: { result: ComplianceResult; testId: string }) {
  return (
    <div className="mt-1.5 rounded-md border border-border bg-bg-2 px-2 py-1.5" data-testid={testId}>
      <p
        className={`text-[11px] font-semibold ${isSilentCompliance(result) ? "text-fg-muted" : result.pass ? "text-status-success" : "text-status-error"}`}
        data-testid={`${testId}-verdict`}
      >
        {result.specLabel}: {describeVerdict(result)}
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {describeCompliance(result).map((line, index) => (
          <li
            key={result.checks[index].id}
            className={`font-mono text-[10px] ${result.checks[index].pass ? "text-fg-muted" : "text-status-error"}`}
            data-testid={`${testId}-${result.checks[index].id}`}
            data-pass={result.checks[index].pass}
          >
            {line}
          </li>
        ))}
      </ul>
      {result.dialogueFallback && (
        <p className="mt-0.5 text-[10px] text-fg-muted">No dialogue detected, so program loudness was checked.</p>
      )}
    </div>
  );
}

function LevelBar({ label, lufs }: { label: string; lufs: number }) {
  const percent = barPercent(lufs);
  const hot = Number.isFinite(lufs) && lufs > -14;
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 text-[10px] font-semibold text-fg-muted">{label}</span>
      <Progress
        role="meter"
        aria-label={`${label === "M" ? "Momentary" : "Short-term"} loudness`}
        aria-valuemin={-41}
        aria-valuemax={-5}
        aria-valuenow={Number.isFinite(lufs) ? lufs : -41}
        aria-valuetext={`${formatLufs(lufs)} LUFS`}
        value={percent}
        className={`h-2 flex-1 rounded-sm bg-bg-3 [&>div]:!transform-none [&>div]:w-[var(--lufs-level)] ${
          hot ? "[&>div]:bg-status-warning" : "[&>div]:bg-accent"
        }`}
        style={{ "--lufs-level": `${percent}%` } as CSSProperties}
      />
    </div>
  );
}

/**
 * Master loudness meter strip for the audio mixer: live momentary/short-term
 * readouts while audio plays, plus an offline whole-timeline analysis.
 */
export const LoudnessPanel = memo(function LoudnessPanel({ visible }: { visible: boolean }) {
  const projectId = useProjectStore((s) => s.project.id);
  const [live, setLive] = useState<LoudnessSnapshot>(EMPTY_SNAPSHOT);
  const tapRef = useRef<ReturnType<typeof createLiveLoudnessTap> | null>(null);
  const status = useLoudnessStore((s) => s.status);
  const progress = useLoudnessStore((s) => s.progress);
  const analysis = useLoudnessStore((s) => s.analysis);
  const analysisProject = useLoudnessStore((s) => s.projectId);
  const analysisTimeline = useLoudnessStore((s) => s.timelineRef);
  const timeline = useProjectStore((s) => s.project.timeline);
  const error = useLoudnessStore((s) => s.error);
  const [targetId, setTargetId] = useState("streaming");
  const exportReport = useLoudnessStore((s) => s.exportReport);

  useEffect(() => {
    if (!visible) return;
    let tap: ReturnType<typeof createLiveLoudnessTap>;
    try {
      tap = createLiveLoudnessTap(getRealtimeAudioGraph());
    } catch {
      return; // no audio graph yet (e.g. headless test environment)
    }
    tapRef.current = tap;
    tap.read();
    const timer = window.setInterval(() => {
      const next = tap.read();
      setLive((prev) =>
        prev.momentary === next.momentary &&
        prev.shortTerm === next.shortTerm &&
        prev.integrated === next.integrated &&
        prev.truePeak === next.truePeak
          ? prev
          : next,
      );
    }, 100);
    return () => {
      window.clearInterval(timer);
      tap.dispose();
      if (tapRef.current === tap) tapRef.current = null;
    };
  }, [visible, projectId]);

  const resetLive = useCallback(() => {
    tapRef.current?.reset();
    setLive(EMPTY_SNAPSHOT);
  }, []);

  const analyze = useCallback(async () => {
    try {
      await analyzeTimelineLoudness();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Loudness analysis failed", err instanceof Error ? err.message : "Try again.");
    }
  }, []);

  const preset = LOUDNESS_PRESETS.find((p) => p.id === targetId) ?? LOUDNESS_PRESETS[0];
  const fresh = analysis && analysisProject === projectId ? analysis : null;
  const stale = fresh !== null && analysisTimeline !== timeline;
  const running = status === "running";
  const dialogueGated = preset.gating === "dialogue" && Number.isFinite(fresh?.dialogueIntegrated ?? NaN);
  const comparedLufs = fresh ? (dialogueGated ? (fresh.dialogueIntegrated as number) : fresh.integrated) : -Infinity;
  const delta = fresh && Number.isFinite(comparedLufs) ? comparedLufs - preset.targetLufs : null;
  const compliance = fresh ? evaluateCompliance(loudnessTargetFromPreset(preset), fresh) : null;

  return (
    <section
      className="mt-3 rounded-lg border border-border bg-bg-1 p-3"
      aria-label="Loudness meter"
      data-testid="loudness-panel"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-2">Loudness (LUFS, BS.1770-4)</h3>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={resetLive} aria-label="Reset live loudness meter">
          Reset
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Readout label="Momentary" value={formatLufs(live.momentary)} unit="LUFS" testId="loudness-live-momentary" />
        <Readout label="Short-term" value={formatLufs(live.shortTerm)} unit="LUFS" testId="loudness-live-shortterm" />
        <Readout label="Integrated" value={formatLufs(live.integrated)} unit="LUFS" testId="loudness-live-integrated" />
        <Readout
          label="True peak"
          value={formatLufs(live.truePeak)}
          unit="dBTP"
          testId="loudness-live-truepeak"
          warn={live.truePeak > -1}
        />
      </div>
      <div className="mt-2 space-y-1">
        <LevelBar label="M" lufs={live.momentary} />
        <LevelBar label="S" lufs={live.shortTerm} />
      </div>

      <div className="my-3 h-px bg-border" role="separator" />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-7 px-3 text-xs" onClick={analyze} disabled={running} data-testid="loudness-analyze">
          {running ? "Analyzing…" : "Analyze timeline"}
        </Button>
        {running && (
          <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={() => useLoudnessStore.getState().cancel()}>
            Cancel
          </Button>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-fg-muted">
          Compare to
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger aria-label="Loudness target preset" className="h-7 w-[196px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOUDNESS_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {running && (
        <div className="mt-2 flex items-center gap-2" data-testid="loudness-progress">
          <Progress
            aria-label="Loudness analysis progress"
            value={Math.round(progress * 100)}
            className="h-1.5 flex-1 bg-bg-3"
          />
          <span className="w-9 text-right font-mono text-[11px] text-fg-muted">{Math.round(progress * 100)}%</span>
        </div>
      )}
      {status === "error" && error && (
        <p className="mt-2 text-[11px] text-status-error" role="alert">
          {error}
        </p>
      )}

      {fresh ? (
        <div className="mt-2" data-testid="loudness-analysis">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Readout label="Integrated" value={formatLufs(fresh.integrated)} unit="LUFS" testId="loudness-integrated" />
            <Readout
              label="Dialogue"
              value={formatLufs(fresh.dialogueIntegrated ?? -Infinity)}
              unit="LUFS"
              testId="loudness-dialogue"
            />
            <Readout label="Loudness range" value={formatLufs(fresh.loudnessRange)} unit="LU" testId="loudness-lra" />
            <Readout
              label="True peak"
              value={formatLufs(fresh.truePeak)}
              unit="dBTP"
              testId="loudness-truepeak"
              warn={fresh.truePeak > -1}
            />
            <Readout label="Analyzed" value={fresh.rangeDuration.toFixed(1)} unit="s" testId="loudness-duration" />
          </div>
          <p className="mt-1.5 text-[11px] text-fg-muted" data-testid="loudness-delta">
            {delta === null
              ? "No audible program material was found in the timeline."
              : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} LU ${dialogueGated ? "(dialogue) " : ""}vs ${preset.targetLufs} LUFS target${
                  fresh.truePeak > preset.truePeakCeilingDb ? ` · peaks exceed ${preset.truePeakCeilingDb} dBTP` : ""
                }`}
            {stale ? " · timeline edited since this analysis, re-analyze to update" : ""}
          </p>
          {compliance && <ComplianceList result={compliance} testId="loudness-compliance" />}
        </div>
      ) : (
        !running && (
          <p className="mt-2 text-[11px] text-fg-muted">
            Analyze renders the whole timeline mix offline (as an export would) and measures integrated loudness, loudness
            range and true peak.
          </p>
        )
      )}
      {exportReport?.compliance && (
        <div className="mt-3" data-testid="loudness-export-report">
          <h4 className="text-[11px] font-semibold text-fg-2">Last export</h4>
          <ComplianceList result={exportReport.compliance} testId="loudness-export-compliance" />
        </div>
      )}
    </section>
  );
});
