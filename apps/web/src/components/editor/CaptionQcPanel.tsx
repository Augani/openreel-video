import { useMemo, useState } from "react";
import {
  DEFAULT_CAPTION_QC,
  checkCaptions,
  listCaptionTracks,
  type CaptionQcCode,
  type CaptionQcIssue,
  type CaptionQcOptions,
} from "@openreel/core";
import {
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { formatFrameTimecode } from "../../utils/frame-timecode";

/** Radix Select items cannot have an empty value; the default caption track ("") uses this. */
const DEFAULT_TRACK_VALUE = "__default__";

const CODE_LABEL: Record<CaptionQcCode, string> = {
  empty: "Empty",
  cps: "Chars/sec",
  wpm: "Words/min",
  "max-lines": "Rows",
  "max-chars": "Row length",
  "min-duration": "Too short",
  "max-duration": "Too long",
  gap: "Gap",
  overlap: "Overlap",
};

type LimitKey = "maxCps" | "maxWpm" | "maxLines" | "maxCharsPerLine" | "minDuration" | "maxDuration" | "minGapFrames";

const LIMITS: ReadonlyArray<{ key: LimitKey; label: string; step: number }> = [
  { key: "maxCps", label: "Max chars/sec", step: 1 },
  { key: "maxWpm", label: "Max words/min", step: 5 },
  { key: "maxLines", label: "Max rows", step: 1 },
  { key: "maxCharsPerLine", label: "Max chars/row", step: 1 },
  { key: "minDuration", label: "Min seconds", step: 0.05 },
  { key: "maxDuration", label: "Max seconds", step: 0.5 },
  { key: "minGapFrames", label: "Min gap (frames)", step: 1 },
];

/**
 * Caption QC: reading speed, rows, row length, duration, gaps and overlaps of the
 * project's captions (`checkCaptions`). Clicking an issue puts the playhead on that caption.
 */
export function CaptionQcPanel() {
  const subtitles = useProjectStore((s) => s.project.timeline.subtitles);
  const frameRate = useProjectStore((s) => s.project.settings.frameRate);
  const seekTo = useTimelineStore((s) => s.seekTo);

  const tracks = useMemo(() => listCaptionTracks(subtitles), [subtitles]);
  const [trackId, setTrackId] = useState("");
  const activeTrack = tracks.some((t) => t.id === trackId) ? trackId : (tracks[0]?.id ?? "");
  const [limits, setLimits] = useState<Record<LimitKey, string>>(() =>
    Object.fromEntries(LIMITS.map(({ key }) => [key, String(Math.round(DEFAULT_CAPTION_QC[key] * 100) / 100)])) as Record<LimitKey, string>,
  );
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [activeCue, setActiveCue] = useState<string | null>(null);

  const options = useMemo<CaptionQcOptions>(() => {
    const o: CaptionQcOptions = { frameRate, ...(tracks.length > 1 ? { captionTrackId: activeTrack } : {}) };
    for (const { key } of LIMITS) {
      const value = Number(limits[key]);
      if (Number.isFinite(value) && value > 0) (o as Record<string, number | string>)[key] = value;
    }
    return o;
  }, [frameRate, tracks.length, activeTrack, limits]);

  const report = useMemo(() => checkCaptions(subtitles, options), [subtitles, options]);
  const visible = useMemo(
    () => report.issues.filter((i) => !errorsOnly || i.severity === "error"),
    [report.issues, errorsOnly],
  );

  const jump = (issue: CaptionQcIssue) => {
    setActiveCue(issue.cueId);
    seekTo(issue.time);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="caption-qc-panel">
      <div className="shrink-0 space-y-2 border-b border-border px-2.5 py-2">
        {tracks.length > 1 && (
          <Select value={activeTrack || DEFAULT_TRACK_VALUE} onValueChange={(v) => setTrackId(v === DEFAULT_TRACK_VALUE ? "" : v)}>
            <SelectTrigger aria-label="Caption track to check" className="h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tracks.map((t) => (
                <SelectItem key={t.id || "default"} value={t.id || DEFAULT_TRACK_VALUE}>
                  {t.id ? `${t.id}${t.language ? ` (${t.language})` : ""}` : "Default captions"} · {t.cueCount}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" data-testid="caption-qc-summary">
          <span className={report.errorCount ? "font-medium text-status-error" : "text-fg-3"}>
            {report.errorCount} error{report.errorCount === 1 ? "" : "s"}
          </span>
          <span className={report.warningCount ? "font-medium text-status-warning" : "text-fg-3"}>
            {report.warningCount} warning{report.warningCount === 1 ? "" : "s"}
          </span>
          <span className="text-fg-3">
            {report.cueCount} caption{report.cueCount === 1 ? "" : "s"} · avg {report.averageCps} cps · worst {report.worstCps}
          </span>
        </div>
        <details className="group">
          <summary className="cursor-pointer select-none text-[11px] text-fg-2 hover:text-fg">Limits</summary>
          <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1.5">
            {LIMITS.map(({ key, label, step }) => (
              <label key={key} className="flex min-w-0 flex-col gap-0.5 text-[10px] text-fg-3">
                <span className="truncate">{label}</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={step}
                  aria-label={label}
                  value={limits[key]}
                  onChange={(e) => setLimits((l) => ({ ...l, [key]: e.currentTarget.value }))}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="h-6 px-1.5 text-[11px]"
                />
              </label>
            ))}
          </div>
        </details>
        {report.issues.length > 0 && (
          <label className="flex items-center gap-1.5 text-[11px] text-fg-2">
            <input
              type="checkbox"
              checked={errorsOnly}
              onChange={(e) => setErrorsOnly(e.currentTarget.checked)}
              aria-label="Show errors only"
            />
            Errors only
          </label>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {!report.cueCount ? (
          <p className="px-3 py-6 text-center text-[11px] text-fg-3">
            No captions to check. Generate or import captions first.
          </p>
        ) : !visible.length ? (
          <p className="px-3 py-6 text-center text-[11px] text-fg-3" data-testid="caption-qc-clear">
            {report.issues.length ? "No errors." : `All ${report.cueCount} captions pass.`}
          </p>
        ) : (
          <ul className="m-0 list-none p-1" aria-label="Caption issues">
            {visible.map((issue, i) => (
              <li key={`${issue.cueId}-${issue.code}-${i}`}>
                <button
                  type="button"
                  data-testid="caption-qc-issue"
                  data-code={issue.code}
                  data-cue-id={issue.cueId}
                  data-severity={issue.severity}
                  onClick={() => jump(issue)}
                  className={`flex w-full min-w-0 items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-bg-3 ${
                    activeCue === issue.cueId ? "bg-bg-3" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-1 size-1.5 shrink-0 rounded-full ${
                      issue.severity === "error" ? "bg-status-error" : "bg-status-warning"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-fg-2">
                        {CODE_LABEL[issue.code]}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-fg-3">
                        {formatFrameTimecode(issue.time, frameRate)}
                      </span>
                    </span>
                    <span className="block break-words text-[11px] leading-snug text-fg-2">{issue.message}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
