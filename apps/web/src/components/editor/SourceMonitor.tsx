import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@openreel/ui";
import { getRawDeveloper, isDevelopedRaw, mediaImageVersion, type MediaItem } from "@openreel/core";
import { addSourceMarker } from "../../services/clip-marker-commands";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useSourceMonitorStore } from "../../stores/source-monitor-store";
import { keyboardShortcuts } from "../../services/keyboard-shortcuts";
import { formatFrameTimecode } from "../../utils/frame-timecode";
import {
  clearSourceMarks,
  goToSourceMark,
  handleSourceMonitorAction,
  markSource,
  seekSource,
  stepSourceFrame,
} from "../../services/source-monitor-controller";
import {
  fitToFillFromSource,
  openInSourceMonitor,
  insertFromSource,
  overwriteFromSource,
  replaceFromSource,
} from "../../services/source-monitor-commands";
import { StallWatchdog, sampleMedia } from "../../services/media-stall";
import { reverseMatchFrame, runWithToast } from "../../services/premiere-edit-commands";
import { makeSubclipFromSource } from "../../services/project-panel-commands";
import { toast } from "../../stores/notification-store";
import { PreviewScrubber } from "./PreviewScrubber";
import { PreviewTransportIcon } from "./PreviewTransportControls";
import { MonitorTabs } from "./MonitorTabs";
import { SourcePatch } from "./SourcePatch";

/** Drag payload marker read by the timeline lanes. */
export const SOURCE_DRAG_KEY = "sourceMonitor";

/** Recent-clips dropdown in the Source monitor header (Premiere's source history). */
function SourceHistory({ current }: { current: MediaItem | undefined }) {
  const history = useSourceMonitorStore((s) => s.history);
  const library = useProjectStore((s) => s.project.mediaLibrary.items);
  const entries = history
    .map((id) => library.find((item) => item.id === id))
    .filter((item): item is MediaItem => !!item);
  if (entries.length === 0)
    return <span>{current ? current.name : "No clip loaded"}</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="source-history"
          aria-label="Recent source clips"
          title="Recent clips"
          className="flex max-w-[260px] items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[#26282d]"
        >
          <span className="truncate">{current ? current.name : "No clip loaded"}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" /></svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-[220px] overflow-y-auto">
        {entries.map((item) => (
          <DropdownMenuItem
            key={item.id}
            data-testid="source-history-item"
            onSelect={() => {
              const outcome = openInSourceMonitor(item.id);
              if (!outcome.success) toast.warning("Source monitor", outcome.message ?? "");
            }}
            className={item.id === current?.id ? "font-medium text-accent" : undefined}
          >
            <span className="truncate">{item.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useBlobUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/**
 * What the source monitor shows for a media item: its own file, except camera RAW stills the browser cannot
 * decode, which are developed with their current RAW Source Settings.
 */
function useMediaDisplayUrl(media: MediaItem | undefined): string | null {
  const plain = useBlobUrl(media && !isDevelopedRaw(media) ? media.blob : null);
  const [developed, setDeveloped] = useState<string | null>(null);
  const key = media && isDevelopedRaw(media) ? `${media.id}${mediaImageVersion(media)}` : null;
  useEffect(() => {
    if (!key || !media?.blob || !media.raw?.settings) {
      setDeveloped(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    getRawDeveloper()
      .develop({ sourceKey: `${media.id}:${media.blob.size}`, blob: media.blob, settings: media.raw.settings, maxLongEdge: 2048 })
      .then((frame) => {
        const canvas = document.createElement("canvas");
        canvas.width = frame.width;
        canvas.height = frame.height;
        canvas.getContext("2d")?.putImageData(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height), 0, 0);
        return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      })
      .then((blob) => {
        if (cancelled || !blob) return;
        created = URL.createObjectURL(blob);
        setDeveloped(created);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return media && isDevelopedRaw(media) ? developed : plain;
}

function Waveform({
  peaks,
  duration,
  position,
  markIn,
  markOut,
}: {
  peaks: Float32Array;
  duration: number;
  position: number;
  markIn?: number;
  markOut?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const { width, height } = canvas;
    g.clearRect(0, 0, width, height);
    const css = getComputedStyle(canvas);
    const accent = css.getPropertyValue("--accent").trim() || "#4f8cff";
    if (markIn !== undefined || markOut !== undefined) {
      const a = ((markIn ?? 0) / duration) * width;
      const b = ((markOut ?? duration) / duration) * width;
      g.fillStyle = "rgba(255,255,255,0.08)";
      g.fillRect(a, 0, Math.max(1, b - a), height);
    }
    g.fillStyle = accent;
    const bars = Math.min(width, 480);
    const step = peaks.length / bars;
    for (let i = 0; i < bars; i++) {
      let peak = 0;
      const from = Math.floor(i * step);
      const to = Math.max(from + 1, Math.floor((i + 1) * step));
      for (let j = from; j < to && j < peaks.length; j++) peak = Math.max(peak, Math.abs(peaks[j]));
      const h = Math.max(2, Math.min(1, peak) * height * 0.9);
      g.fillRect((i / bars) * width, (height - h) / 2, Math.max(1, width / bars - 1), h);
    }
    g.fillStyle = "#fff";
    g.fillRect((position / duration) * width, 0, 2, height);
  }, [peaks, duration, position, markIn, markOut]);
  return (
    <canvas
      ref={ref}
      width={960}
      height={240}
      aria-label="Source waveform"
      data-testid="source-waveform"
      className="h-full max-h-[320px] w-full"
    />
  );
}

export function SourceMonitor() {
  const mediaId = useSourceMonitorStore((s) => s.mediaId);
  const position = useSourceMonitorStore((s) => s.position);
  const rate = useSourceMonitorStore((s) => s.rate);
  const focus = useSourceMonitorStore((s) => s.focus);
  const [restrictSubclip, setRestrictSubclip] = useState(false);
  const marks = useSourceMonitorStore((s) => (s.mediaId ? s.marks[s.mediaId] : undefined));
  const projectFrameRate = useProjectStore((s) => s.project.settings.frameRate);
  const replaceKeeps = useSourceMonitorStore((s) => s.replaceKeepsAttributes);
  const rangeMarked = useTimelineStore((s) => s.loopEnd - s.loopStart > 1e-6);
  const media = useProjectStore((s) =>
    mediaId ? s.project.mediaLibrary.items.find((m) => m.id === mediaId) : undefined,
  );
  const url = useMediaDisplayUrl(media);
  const containerRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const duration = media && media.metadata.duration > 0 ? media.metadata.duration : 5;
  const frameRate = media?.metadata.frameRate || projectFrameRate || 30;
  const playable = media?.type === "video" || media?.type === "audio";

  // Program playback and the Source monitor never run at once.
  useEffect(() => {
    useTimelineStore.getState().pause();
  }, []);

  // Keyboard focus model: shortcuts act on the monitor that has focus.
  useEffect(() => {
    const claim = (event: Event) => {
      const target = event.target as Node | null;
      const inside = !!target && !!containerRef.current?.contains(target);
      const current = useSourceMonitorStore.getState();
      if (inside && current.focus !== "source") current.setFocus("source");
      else if (!inside && current.focus !== "program") current.setFocus("program");
    };
    document.addEventListener("pointerdown", claim, true);
    document.addEventListener("focusin", claim, true);
    const release = keyboardShortcuts.setActionInterceptor((action) =>
      handleSourceMonitorAction(action),
    );
    return () => {
      document.removeEventListener("pointerdown", claim, true);
      document.removeEventListener("focusin", claim, true);
      release();
    };
  }, []);

  // A fresh open (double-click, Match Frame, agent) takes keyboard focus.
  const openNonce = useSourceMonitorStore((s) => s.openNonce);
  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, [openNonce]);

  // Drive the media element from shuttle rate.
  useEffect(() => {
    const el = elRef.current;
    let frame = 0;
    let last = performance.now();
    const store = useSourceMonitorStore;
    if (rate === 0) {
      el?.pause();
      return;
    }
    const nativeForward = !!el && rate > 0;
    if (el) {
      if (nativeForward) {
        el.playbackRate = rate;
        void el.play().catch(() => store.getState().stop());
      } else el.pause();
    }
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let next: number;
      if (nativeForward && el) next = el.currentTime;
      else {
        next = store.getState().position + rate * dt;
        if (el) el.currentTime = Math.max(0, Math.min(duration, next));
      }
      if (next >= duration - 1e-3 && rate > 0) {
        store.getState().setPosition(duration);
        store.getState().stop();
        return;
      }
      if (next <= 0 && rate < 0) {
        store.getState().setPosition(0);
        store.getState().stop();
        return;
      }
      store.getState().setPosition(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [rate, duration, mediaId]);

  // Stopped: park the element on the source playhead.
  useEffect(() => {
    const el = elRef.current;
    if (!el || rate !== 0) return;
    if (Math.abs(el.currentTime - position) > 0.0005) el.currentTime = position;
  }, [position, rate, url]);

  // Recover from a wedged media pipeline: after seeks Chrome can leave a fully buffered element
  // without future data ("waiting") forever. Re-issuing the seek restarts it.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const watchdog = new StallWatchdog();
    const id = window.setInterval(() => {
      if (watchdog.check(sampleMedia(el), performance.now())) el.currentTime = sampleMedia(el).currentTime;
    }, 250);
    return () => window.clearInterval(id);
  }, [mediaId, url]);

  const onDragStart = useCallback(
    (component: "both" | "video" | "audio") => (event: React.DragEvent) => {
      if (!mediaId) return;
      event.dataTransfer.setData(
        "application/json",
        JSON.stringify({ mediaId, [SOURCE_DRAG_KEY]: true, component }),
      );
      event.dataTransfer.effectAllowed = "copy";
    },
    [mediaId],
  );

  const noFocusSteal = (event: React.MouseEvent) => event.preventDefault();
  const tc = (seconds: number) => formatFrameTimecode(seconds, frameRate);
  const hasAudio = media?.type === "audio" || (media?.type === "video" && media.metadata.hasAudio !== false);
  const hasVideo = media?.type === "video" || media?.type === "image";

  const inPct = marks?.in !== undefined ? (marks.in / duration) * 100 : 0;
  const outPct = marks?.out !== undefined ? (marks.out / duration) * 100 : 100;
  const rangeLength = (marks?.out ?? duration) - (marks?.in ?? 0);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Source monitor"
      data-testid="source-monitor"
      data-monitor-focus={focus}
      tabIndex={0}
      onPointerDown={(event) => {
        useSourceMonitorStore.getState().setFocus("source");
        if ((event.target as HTMLElement).closest("input, [role='slider']")) return;
        containerRef.current?.focus({ preventScroll: true });
      }}
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-stage-bg outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
    >
      <div className="workspace-preview-header">
        <MonitorTabs active="source" />
        <SourceHistory current={media} />
        <div className="workspace-preview-options">
          <Button type="button" variant="ghost" size="sm" data-testid="reverse-match-frame" title="Reverse Match Frame (Shift+F)" onMouseDown={noFocusSteal} disabled={!media} onClick={() => runWithToast("Reverse match frame", reverseMatchFrame)}>Find in sequence</Button>
          <span className="font-mono text-[11px] tabular-nums text-fg-3" data-testid="source-duration">
            {media ? `Dur ${tc(rangeLength)}` : ""}
          </span>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        {!media ? (
          <p className="text-sm text-fg-3">
            Double-click a clip in the media bin to load it here.
          </p>
        ) : !url ? (
          <p className="text-sm text-fg-3">This media is offline. Relink it to preview.</p>
        ) : media.type === "image" ? (
          <img
            src={url}
            alt={media.name}
            draggable
            onDragStart={onDragStart("both")}
            className="max-h-full max-w-full object-contain"
          />
        ) : media.type === "audio" ? (
          <div
            draggable
            onDragStart={onDragStart("both")}
            className="flex h-full w-full items-center justify-center"
          >
            <audio ref={elRef as React.RefObject<HTMLAudioElement>} src={url} preload="auto" />
            {media.waveformData?.length ? (
              <Waveform
                peaks={media.waveformData}
                duration={duration}
                position={position}
                markIn={marks?.in}
                markOut={marks?.out}
              />
            ) : (
              <p className="text-sm text-fg-3" data-testid="source-waveform-missing">
                Waveform unavailable
              </p>
            )}
          </div>
        ) : (
          <video
            key={media.id}
            ref={elRef as React.RefObject<HTMLVideoElement>}
            src={url}
            preload="auto"
            playsInline
            draggable
            onDragStart={onDragStart("both")}
            aria-label={`Source frame ${tc(position)}`}
            data-testid="source-video"
            className="max-h-full max-w-full bg-black object-contain"
          />
        )}
      </div>

      <div className="workspace-preview-controls">
        <div className="relative px-3 pt-2">
          {marks && (marks.in !== undefined || marks.out !== undefined) && (
            <div
              aria-hidden="true"
              data-testid="source-range"
              className="pointer-events-none absolute left-3 right-3 top-[3px] h-[3px] rounded-sm"
            >
              <div
                className="absolute h-full rounded-sm bg-accent/70"
                style={{ left: `${inPct}%`, width: `${Math.max(0, outPct - inPct)}%` }}
              />
            </div>
          )}
          {media?.markers?.map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid="source-marker-tick"
              aria-label={`Go to marker ${m.label}`}
              title={m.label}
              onMouseDown={noFocusSteal}
              onClick={() => seekSource(m.time)}
              className="absolute top-[1px] z-10 h-[9px] w-[9px] -translate-x-1/2 p-0"
              style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${Math.min(1, m.time / duration)})` }}
            >
              <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><path d="M0.5 0.5h8v4l-4 4-4-4z" fill={m.color} stroke="rgba(0,0,0,0.55)" /></svg>
            </button>
          ))}
          <PreviewScrubber
            position={position}
            duration={duration}
            frameRate={frameRate}
            disabled={!media}
            onSeek={seekSource}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <div className="flex items-center" onMouseDown={noFocusSteal}>
            <Button type="button" variant="ghost" size="icon" aria-label="Mark source in" title="Mark In (I)" disabled={!media} onClick={() => markSource("in")}><PreviewTransportIcon name="in" /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Go to source in" title="Go to In" disabled={!media} onClick={() => goToSourceMark("in")}><PreviewTransportIcon name="start" /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Source previous frame" title="Previous frame (Left)" disabled={!media} onClick={() => stepSourceFrame(-1)}><PreviewTransportIcon name="previous" /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label={rate === 0 ? "Source play" : "Source pause"} title="Play / pause (Space, K)" disabled={!media || !playable} onClick={() => useSourceMonitorStore.getState().togglePlay()}>
              {rate === 0 ? <PreviewTransportIcon name="play" size={16} /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>}
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Source next frame" title="Next frame (Right)" disabled={!media} onClick={() => stepSourceFrame(1)}><PreviewTransportIcon name="next" /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Go to source out" title="Go to Out" disabled={!media} onClick={() => goToSourceMark("out")}><PreviewTransportIcon name="end" /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Mark source out" title="Mark Out (O)" disabled={!media} onClick={() => markSource("out")}><PreviewTransportIcon name="out" /></Button>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums text-fg-2">
            <span data-testid="source-timecode" aria-label="Source timecode">{tc(position)}</span>
            <span className="text-fg-3">In <span data-testid="source-in">{marks?.in !== undefined ? tc(marks.in) : "--:--:--:--"}</span></span>
            <span className="text-fg-3">Out <span data-testid="source-out">{marks?.out !== undefined ? tc(marks.out) : "--:--:--:--"}</span></span>
            {rate !== 0 && <span className="text-accent" data-testid="source-rate">{rate}x</span>}
          </div>
          {media && <SourcePatch hasVideo={hasVideo} hasAudio={hasAudio} />}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 [&>*]:whitespace-nowrap">
            <Button type="button" variant="ghost" size="sm" data-testid="source-add-marker" title="Add a master-clip marker at the playhead (M)" onMouseDown={noFocusSteal} disabled={!media} onClick={() => void addSourceMarker()}>Add marker</Button>
            <Button type="button" variant="ghost" size="sm" onMouseDown={noFocusSteal} disabled={!media || (marks?.in === undefined && marks?.out === undefined)} onClick={clearSourceMarks}>Clear marks</Button>
            {hasVideo && media?.type === "video" && (
              <span
                role="button"
                tabIndex={-1}
                draggable
                aria-label="Drag video only"
                title="Drag video only to the timeline"
                data-testid="drag-video-only"
                onDragStart={onDragStart("video")}
                className="cursor-grab rounded border border-border px-2 py-1 text-[11px] text-fg-2 hover:border-border-strong"
              >
                Video only
              </span>
            )}
            {hasAudio && media?.type === "video" && (
              <span
                role="button"
                tabIndex={-1}
                draggable
                aria-label="Drag audio only"
                title="Drag audio only to the timeline"
                data-testid="drag-audio-only"
                onDragStart={onDragStart("audio")}
                className="cursor-grab rounded border border-border px-2 py-1 text-[11px] text-fg-2 hover:border-border-strong"
              >
                Audio only
              </span>
            )}
            {media && media.type !== "image" && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="subclip-restrict"
                  aria-pressed={restrictSubclip}
                  title="Restrict trims on clips of the new subclip to its In/Out"
                  onMouseDown={noFocusSteal}
                  onClick={() => setRestrictSubclip((value) => !value)}
                  className={restrictSubclip ? "bg-[#26282d] text-fg" : "text-fg-3"}
                >
                  Restrict
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="make-subclip"
                  title="Make a subclip from the In/Out marks"
                  onMouseDown={noFocusSteal}
                  onClick={() =>
                    void makeSubclipFromSource({ restrictTrims: restrictSubclip }).then((outcome) =>
                      outcome.success ? toast.info("Make Subclip", outcome.message) : toast.warning("Make Subclip", outcome.message),
                    )
                  }
                >
                  Make Subclip
                </Button>
              </>
            )}
            <Button type="button" variant="secondary" size="sm" onMouseDown={noFocusSteal} disabled={!media} aria-label="Insert (,)" title="Insert at the timeline playhead (,)" onClick={() => runWithToast("Insert", () => insertFromSource())}>Insert</Button>
            <Button type="button" variant="secondary" size="sm" onMouseDown={noFocusSteal} disabled={!media} aria-label="Overwrite (.)" title="Overwrite at the timeline playhead (.)" onClick={() => runWithToast("Overwrite", () => overwriteFromSource())}>Overwrite</Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="replace-edit"
              aria-label="Replace (⇧G)"
              title="Replace the selected timeline clip, or the clip under the playhead, with this source. The clip keeps its place and length; the Source playhead lines up with the timeline playhead (Shift+G)"
              onMouseDown={noFocusSteal}
              disabled={!media}
              onClick={() => runWithToast("Replace", () => replaceFromSource())}
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="replace-keep"
              aria-pressed={replaceKeeps}
              title="Replace keeps the clip's effects, keyframes and audio settings. Off resets them."
              onMouseDown={noFocusSteal}
              disabled={!media}
              onClick={() => useSourceMonitorStore.getState().setReplaceKeepsAttributes(!replaceKeeps)}
              className={replaceKeeps ? "bg-[#26282d] text-fg" : "text-fg-3"}
            >
              Keep FX
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="fit-to-fill"
              aria-label="Fit to Fill (⌥⇧F)"
              title={
                media?.type === "image"
                  ? "Fit to Fill needs video or audio"
                  : rangeMarked
                    ? "Retime the source In/Out to exactly fill the timeline In/Out range (Alt+Shift+F)"
                    : "Set In and Out marks on the timeline to fill (Alt+Shift+F)"
              }
              onMouseDown={noFocusSteal}
              disabled={!media || media.type === "image" || !rangeMarked}
              onClick={() => runWithToast("Fit to Fill", () => fitToFillFromSource())}
            >
              Fit to Fill
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
