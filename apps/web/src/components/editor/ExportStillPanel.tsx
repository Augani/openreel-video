import React, { useMemo, useState } from "react";
import {
  downloadBlob,
  frameFileName,
  gifPlaybackFps,
  sequenceFrameRange,
  validateGifFrameBudget,
  validateGifOptions,
  validateSequenceRange,
  type ExportProgress,
  type SequenceImageFormat,
} from "@openreel/core";
import { Button, Input, Label, Progress } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import {
  cancelStillExport,
  runStillExport,
  stillExportFilename,
  type StillExportRequest,
} from "../../services/still-export";

interface ExportStillPanelProps {
  /** Timeline span to export (seconds, Out exclusive); omit for the whole timeline. */
  range?: { startTime: number; endTime: number };
  /** Called after the file was handed to the browser / desktop save flow. */
  onDone?: () => void;
}

type Mode = "sequence" | "gif";

const numberOrUndefined = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * "Images & GIF" tab of the Export dialog: a PNG / JPEG image sequence (one zip, numbered by a pattern)
 * or an animated GIF, over the whole timeline or the marked In/Out. Runs the same engine paths as the
 * agent tools `export_image_sequence` and `export_gif`.
 */
export const ExportStillPanel: React.FC<ExportStillPanelProps> = ({ range, onDone }) => {
  const project = useProjectStore((state) => state.project);
  const [mode, setMode] = useState<Mode>("sequence");
  const [format, setFormat] = useState<SequenceImageFormat>("png");
  const [quality, setQuality] = useState("92");
  const [pattern, setPattern] = useState("frame_{0000}");
  const [startNumber, setStartNumber] = useState("0");
  const [fps, setFps] = useState(String(Math.min(15, Math.round(project.settings.frameRate))));
  const [colors, setColors] = useState("256");
  const [loopMode, setLoopMode] = useState<"forever" | "once" | "count">("forever");
  const [loopCount, setLoopCount] = useState("3");
  const [gifWidth, setGifWidth] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  const projectFps = project.settings.frameRate;
  const duration = project.timeline.duration;

  const gifSize = useMemo(() => {
    const requested = numberOrUndefined(gifWidth);
    const scale = Math.min(1, 640 / project.settings.width);
    const width = Math.max(2, Math.round(requested ?? project.settings.width * scale));
    const height = Math.max(2, Math.round((width * project.settings.height) / project.settings.width));
    return { width, height, custom: requested !== undefined };
  }, [gifWidth, project.settings.width, project.settings.height]);

  const plan = useMemo((): { request: StillExportRequest | null; error: string | null; frames: number; sample: string } => {
    try {
      if (mode === "sequence") {
        const span = sequenceFrameRange(duration, projectFps, range);
        const invalid = validateSequenceRange(span);
        const start = numberOrUndefined(startNumber) ?? 0;
        const q = numberOrUndefined(quality) ?? 92;
        const sample = frameFileName(pattern, span.startFrame, format, start);
        const frames = span.endFrame - span.startFrame + 1;
        if (invalid) return { request: null, error: invalid, frames, sample };
        if (!pattern.trim()) return { request: null, error: "Enter a file name pattern, for example frame_{0000}.", frames, sample };
        if (!Number.isInteger(start) || start < 0) return { request: null, error: "The start number must be a whole number, 0 or more.", frames, sample };
        if (format === "jpg" && (q < 1 || q > 100)) return { request: null, error: "JPEG quality is 1 to 100.", frames, sample };
        return {
          request: { kind: "sequence", format, quality: q, pattern: pattern.trim(), startNumber: start, range },
          error: null,
          frames,
          sample,
        };
      }
      const rate = numberOrUndefined(fps) ?? 15;
      const palette = numberOrUndefined(colors) ?? 256;
      const loop = loopMode === "forever" ? 0 : loopMode === "once" ? ("none" as const) : (numberOrUndefined(loopCount) ?? 1);
      const playback = gifPlaybackFps(Math.min(50, Math.max(1, rate)));
      const start = range?.startTime ?? 0;
      const end = Math.min(duration, range?.endTime ?? duration);
      const frames = end > start ? Math.max(1, Math.round((end - start) * playback)) : 0;
      const invalid =
        validateGifOptions({ width: gifSize.width, height: gifSize.height, fps: rate, maxColors: palette, loop }) ??
        (frames === 0 ? "There is nothing to export in that range." : validateGifFrameBudget(gifSize.width, gifSize.height, frames));
      if (invalid) return { request: null, error: invalid, frames, sample: "" };
      return {
        request: { kind: "gif", fps: rate, width: gifSize.width, height: gifSize.height, maxColors: palette, loop, range },
        error: null,
        frames,
        sample: "",
      };
    } catch (error) {
      return { request: null, error: error instanceof Error ? error.message : "Check the settings.", frames: 0, sample: "" };
    }
  }, [mode, format, quality, pattern, startNumber, fps, colors, loopMode, loopCount, gifSize, range, duration, projectFps]);

  const start = async () => {
    if (!plan.request || running) return;
    setRunning(true);
    setMessage(null);
    setProgress(null);
    const outcome = await runStillExport(useProjectStore.getState().project, plan.request, setProgress);
    setRunning(false);
    if (!outcome.ok) {
      setMessage(outcome.cancelled ? { tone: "ok", text: "Export cancelled." } : { tone: "error", text: outcome.message });
      return;
    }
    downloadBlob(outcome.output.blob, stillExportFilename(project.name, plan.request));
    setMessage({ tone: "ok", text: `Exported ${outcome.output.frames} frame${outcome.output.frames === 1 ? "" : "s"}.` });
    onDone?.();
  };

  const cancel = () => {
    cancelStillExport();
  };

  return (
    <div className="mx-auto max-w-xl space-y-4" data-testid="export-still-panel">
      <div role="radiogroup" aria-label="Still export type" className="flex gap-4 text-xs">
        <label className="flex items-center gap-2">
          <input type="radio" name="still-mode" checked={mode === "sequence"} onChange={() => setMode("sequence")} data-testid="still-mode-sequence" />
          Image sequence (PNG / JPEG)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="still-mode" checked={mode === "gif"} onChange={() => setMode("gif")} data-testid="still-mode-gif" />
          Animated GIF
        </label>
      </div>

      {mode === "sequence" ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="still-format" className="text-[11px] text-fg-2">Format</Label>
            <select
              id="still-format"
              value={format}
              onChange={(event) => setFormat(event.currentTarget.value === "jpg" ? "jpg" : "png")}
              className="h-8 w-full rounded border border-border bg-bg-2 px-2 text-xs"
              data-testid="still-format"
            >
              <option value="png">PNG (lossless)</option>
              <option value="jpg">JPEG</option>
            </select>
          </div>
          {format === "jpg" && (
            <div className="space-y-1.5">
              <Label htmlFor="still-quality" className="text-[11px] text-fg-2">JPEG quality (1-100)</Label>
              <Input id="still-quality" type="number" min={1} max={100} value={quality} onChange={(event) => setQuality(event.currentTarget.value)} className="h-8 text-xs" data-testid="still-quality" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="still-pattern" className="text-[11px] text-fg-2">File name pattern</Label>
            <Input id="still-pattern" value={pattern} onChange={(event) => setPattern(event.currentTarget.value)} className="h-8 text-xs" data-testid="still-pattern" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="still-start-number" className="text-[11px] text-fg-2">Start number</Label>
            <Input id="still-start-number" type="number" min={0} value={startNumber} onChange={(event) => setStartNumber(event.currentTarget.value)} className="h-8 text-xs" data-testid="still-start-number" />
          </div>
          <p className="col-span-2 text-[10px] leading-snug text-fg-muted" data-testid="still-summary">
            {plan.error ? null : `${plan.frames} frame${plan.frames === 1 ? "" : "s"}, e.g. ${plan.sample}, delivered as one zip.`} The zeros in braces set the padding; the number is added to the project frame index.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="still-fps" className="text-[11px] text-fg-2">Frame rate (1-50 fps)</Label>
            <Input id="still-fps" type="number" min={1} max={50} value={fps} onChange={(event) => setFps(event.currentTarget.value)} className="h-8 text-xs" data-testid="still-fps" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="still-colors" className="text-[11px] text-fg-2">Palette colours (2-256)</Label>
            <Input id="still-colors" type="number" min={2} max={256} value={colors} onChange={(event) => setColors(event.currentTarget.value)} className="h-8 text-xs" data-testid="still-colors" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="still-loop" className="text-[11px] text-fg-2">Loop</Label>
            <select
              id="still-loop"
              value={loopMode}
              onChange={(event) => setLoopMode(event.currentTarget.value as typeof loopMode)}
              className="h-8 w-full rounded border border-border bg-bg-2 px-2 text-xs"
              data-testid="still-loop"
            >
              <option value="forever">Forever</option>
              <option value="once">Play once</option>
              <option value="count">A set number of times</option>
            </select>
          </div>
          {loopMode === "count" ? (
            <div className="space-y-1.5">
              <Label htmlFor="still-loop-count" className="text-[11px] text-fg-2">Plays</Label>
              <Input id="still-loop-count" type="number" min={1} max={65535} value={loopCount} onChange={(event) => setLoopCount(event.currentTarget.value)} className="h-8 text-xs" data-testid="still-loop-count" />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="still-gif-width" className="text-[11px] text-fg-2">Width (px)</Label>
              <Input id="still-gif-width" type="number" min={2} max={4096} placeholder={String(gifSize.width)} value={gifWidth} onChange={(event) => setGifWidth(event.currentTarget.value)} className="h-8 text-xs" data-testid="still-gif-width" />
            </div>
          )}
          <p className="col-span-2 text-[10px] leading-snug text-fg-muted" data-testid="still-summary">
            {plan.error ? null : `${gifSize.width} x ${gifSize.height}, ${plan.frames} frames at ${gifPlaybackFps(Math.min(50, Math.max(1, numberOrUndefined(fps) ?? 15))).toFixed(2)} fps. `}
            GIF delays are whole hundredths of a second, so the real rate is rounded; frames are sampled at that rate to keep the duration true. One palette for the whole GIF.
          </p>
        </div>
      )}

      {range && (
        <p className="text-[11px] text-fg-muted">Exporting the marked In/Out only.</p>
      )}
      {plan.error && (
        <p className="text-[11px] text-red-400" role="alert" data-testid="still-error">{plan.error}</p>
      )}
      {message && (
        <p className={message.tone === "error" ? "text-[11px] text-red-400" : "text-[11px] text-fg-muted"} role={message.tone === "error" ? "alert" : "status"} data-testid="still-message">
          {message.text}
        </p>
      )}
      {running && (
        <div className="space-y-1" data-testid="still-progress">
          <Progress value={Math.round((progress?.progress ?? 0) * 100)} />
          <p className="text-[10px] text-fg-muted">
            {progress ? `${progress.phase}: frame ${progress.currentFrame} of ${progress.totalFrames}` : "Starting..."}
          </p>
        </div>
      )}
      <div className="flex justify-end gap-2">
        {running ? (
          <Button variant="secondary" size="sm" className="h-8 text-xs" onClick={cancel} type="button" aria-label="Cancel image export">
            Cancel
          </Button>
        ) : (
          <Button size="sm" className="h-8 text-xs" onClick={() => void start()} disabled={!plan.request} type="button" aria-label={mode === "gif" ? "Export GIF" : "Export image sequence"} data-testid="still-export">
            {mode === "gif" ? "Export GIF" : "Export image sequence"}
          </Button>
        )}
      </div>
    </div>
  );
};
