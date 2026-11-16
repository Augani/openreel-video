import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@openreel/ui";
import { getMulticamSources, listMulticamClips, multicamClipAtTime, multicamCommonRange, type MulticamAngle, type MulticamSource } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { previewProxyCache, usePreviewProxyStore } from "../../stores/preview-proxy-store";
import { useUIStore } from "../../stores/ui-store";
import { gridColumns, useMulticamStore, type MulticamGrid } from "../../stores/multicam-monitor-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { hasShortcutFocus } from "../../services/keyboard-shortcuts";
import {
  activeAngleId,
  cutToAngle,
  cutToAngleNumber,
  flattenMulticamCommand,
  placeMulticamSource,
  setAudioModeCommand,
  startRecording,
  stopRecording,
} from "../../services/multicam-controller";
import { PreviewScrubber } from "./PreviewScrubber";
import { PreviewTimecode } from "./PreviewTimecode";
import { PreviewTransportControls } from "./PreviewTransportControls";
import { MonitorTabs } from "./MonitorTabs";

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

/** One angle: a muted video parked on (or playing along with) the shared clock. */
function AngleTile({
  angle,
  index,
  active,
  playing,
  sharedTime,
  onPick,
}: {
  angle: MulticamAngle;
  index: number;
  active: boolean;
  playing: boolean;
  sharedTime: number | null;
  onPick: () => void;
}) {
  const projectId = useProjectStore((state) => state.project.id);
  const original = useProjectStore((state) => state.project.mediaLibrary.items.find((item) => item.id === angle.mediaId));
  // Angles decode the proxy while proxies are toggled on (same rule as the Program monitor);
  // export and the flattened timeline always read the full-resolution item.
  const proxyRevision = usePreviewProxyStore((state) => state.revision);
  const blob = useMemo(
    () => (original ? previewProxyCache.resolve(projectId, original).blob : undefined),
    // The revision restarts decoding when a proxy is built, toggled or removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [original, projectId, proxyRevision],
  );
  const url = useBlobUrl(blob);
  useEffect(() => {
    if (blob) previewProxyCache.noteDecode(angle.mediaId, blob);
  }, [blob, angle.mediaId]);
  const ref = useRef<HTMLVideoElement>(null);
  const mediaTime = sharedTime === null ? null : sharedTime - angle.offset;
  const inRange = mediaTime !== null && mediaTime >= 0 && mediaTime <= angle.duration;

  useEffect(() => {
    const video = ref.current;
    if (!video || mediaTime === null) return;
    const target = Math.max(0, Math.min(angle.duration, mediaTime));
    if (playing && inRange) {
      if (video.paused) {
        video.currentTime = target;
        void video.play().catch(() => undefined);
      } else if (Math.abs(video.currentTime - target) > 0.25) {
        video.currentTime = target;
      }
      return;
    }
    if (!video.paused) video.pause();
    if (Math.abs(video.currentTime - target) > 0.01) video.currentTime = target;
  }, [mediaTime, playing, inRange, angle.duration]);

  return (
    <button
      type="button"
      data-testid="multicam-angle"
      data-angle-id={angle.id}
      data-angle-index={index + 1}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      aria-label={`Angle ${index + 1}: ${angle.name}${active ? " (active)" : ""}`}
      onClick={onPick}
      className={cn(
        "relative min-h-0 min-w-0 overflow-hidden rounded-md bg-black outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent",
        active ? "ring-[3px] ring-offset-0" : "ring-1 ring-white/10 hover:ring-white/30",
      )}
      style={active ? { boxShadow: `0 0 0 3px ${angle.color}` } : undefined}
    >
      {url ? (
        <video
          ref={ref}
          src={url}
          muted
          playsInline
          preload="auto"
          onError={() => { if (blob) previewProxyCache.failPlayback(angle.mediaId, blob); }}
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="grid h-full w-full place-items-center text-[11px] text-fg-3">Media offline</span>
      )}
      {url && mediaTime !== null && !inRange && (
        <span className="absolute inset-0 grid place-items-center bg-black/70 text-[11px] text-fg-3">No footage here</span>
      )}
      <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
        <span className="grid h-4 min-w-4 place-items-center rounded-sm px-1 text-[10px] font-black text-black" style={{ background: angle.color }}>
          {index + 1}
        </span>
        <span className="max-w-[140px] truncate">{angle.name}</span>
      </span>
      {active && (
        <span className="absolute right-1.5 top-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-fg">
          Active
        </span>
      )}
    </button>
  );
}

const FOLLOW = "__follow__";

export function MulticamMonitor() {
  const project = useProjectStore((state) => state.project);
  const frameRate = project.settings.frameRate;
  const duration = project.timeline.duration;
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const playing = useTimelineStore((state) => state.playbackState === "playing");
  const lockedReason = useTimelineStore((state) => state.playbackLockedReason);
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const grid = useMulticamStore((state) => state.grid);
  const setGrid = useMulticamStore((state) => state.setGrid);
  const recording = useMulticamStore((state) => state.recording);
  const pending = useMulticamStore((state) => state.pending);
  const committing = useMulticamStore((state) => state.committing);
  const chosenSourceId = useMulticamStore((state) => state.sourceId);
  const setSourceId = useMulticamStore((state) => state.setSourceId);
  const containerRef = useRef<HTMLDivElement>(null);

  const sources = getMulticamSources(project);
  const under = useMemo(() => multicamClipAtTime(project, playhead), [project, playhead]);
  const source: MulticamSource | null = under?.source ?? sources.find((s) => s.id === chosenSourceId) ?? sources[0] ?? null;
  const clipsOfSource = useMemo(() => (source ? listMulticamClips(project, source.id) : []), [project, source]);
  const range = source ? multicamCommonRange(source) : null;
  const sharedTime = under && source && under.source.id === source.id ? under.sharedTime : range ? range.start : null;
  const active = activeAngleId(project, playhead, pending);

  // Number keys 1-9 cut (while recording) or switch the clip under the playhead.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
      if (!match || !hasShortcutFocus(event)) return;
      if (cutToAngleNumber(Number(match[1]))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Leaving the monitor mid-pass commits it rather than losing the cuts.
  useEffect(() => () => void stopRecording(), []);

  const columns = gridColumns(grid, source?.angles.length ?? 4);
  const rows = Math.max(1, Math.ceil((source?.angles.length ?? 1) / columns));
  const audioValue = source?.audio.mode === "fixed" ? source.audio.angleId : FOLLOW;
  const disabled = Boolean(lockedReason) || exporting || committing;
  const canFlatten = clipsOfSource.length > 0 && !recording;

  return (
    <div
      ref={containerRef}
      data-testid="multicam-monitor"
      data-recording={recording ? "true" : "false"}
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-stage-bg outline-none"
    >
      <div className="workspace-preview-header">
        <MonitorTabs active="multicam" />
        <span className="truncate">{source ? source.name : "No multi-camera source"}</span>
        <div className="workspace-preview-options">
          {recording && (
            <span data-testid="multicam-rec-status" className="flex items-center gap-1.5 text-[11px] font-semibold text-status-error">
              <span className="h-2 w-2 animate-pulse rounded-full bg-status-error" aria-hidden="true" />
              REC · {pending.length} cut{pending.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {source ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-1.5" data-testid="multicam-toolbar">
            {sources.length > 1 && (
              <Select value={source.id} onValueChange={(id) => setSourceId(id)}>
                <SelectTrigger aria-label="Multi-camera source" className="h-7 w-[150px] px-2 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={grid} onValueChange={(next) => setGrid(next as MulticamGrid)}>
              <SelectTrigger aria-label="Angle grid" data-testid="multicam-grid" className="h-7 w-[96px] px-2 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Grid: Auto</SelectItem>
                <SelectItem value="2x2">Grid: 2 × 2</SelectItem>
                <SelectItem value="3x3">Grid: 3 × 3</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={audioValue}
              disabled={recording || disabled}
              onValueChange={(next) => void setAudioModeCommand(source.id, next === FOLLOW ? { mode: "follow" } : { mode: "fixed", angleId: next })}
            >
              <SelectTrigger aria-label="Multicam audio" data-testid="multicam-audio" className="h-7 w-[170px] px-2 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW}>Audio follows video</SelectItem>
                {source.angles.map((angle, index) => (
                  <SelectItem key={angle.id} value={angle.id}>
                    Fixed audio: {index + 1} {angle.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-testid="multicam-place"
                disabled={disabled || recording}
                title="Place this source on the timeline at the playhead"
                onClick={() => void placeMulticamSource(source.id)}
              >
                Place on timeline
              </Button>
              <Button
                type="button"
                size="sm"
                variant={recording ? "destructive" : "secondary"}
                data-testid="multicam-record"
                aria-pressed={recording}
                disabled={disabled || (!recording && clipsOfSource.length === 0)}
                title={clipsOfSource.length === 0 ? "Place the source on the timeline first" : "Play and cut live with the number keys 1-9"}
                onClick={() => (recording ? void stopRecording() : startRecording())}
              >
                {recording ? "Stop recording" : "Record"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-testid="multicam-flatten"
                disabled={disabled || !canFlatten}
                title="Turn every multicam clip of this source into plain clips of its active angle"
                onClick={() => void flattenMulticamCommand({ sourceId: source.id })}
              >
                Flatten
              </Button>
            </div>
          </div>

          <div
            className="grid min-h-0 flex-1 gap-1.5 p-2"
            data-testid="multicam-grid-view"
            data-columns={columns}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
          >
            {source.angles.map((angle, index) => (
              <AngleTile
                key={angle.id}
                angle={angle}
                index={index}
                active={active === angle.id}
                playing={playing}
                sharedTime={sharedTime}
                onPick={() => cutToAngle(angle.id)}
              />
            ))}
          </div>
          {clipsOfSource.length === 0 && (
            <p className="px-3 pb-1 text-[11px] text-fg-3" data-testid="multicam-hint">
              Place this source on the timeline to cut between angles with the number keys 1-{source.angles.length}.
            </p>
          )}
        </>
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div className="max-w-sm space-y-3">
            <p className="text-sm text-fg-2">No multi-camera source yet. Sync two to nine camera clips to cut between them.</p>
            <Button type="button" size="sm" onClick={() => useEditorWorkspaceStore.getState().setMulticamSourceOpen(true)}>
              Create multi-camera source…
            </Button>
          </div>
        </div>
      )}

      <div className="workspace-preview-controls">
        <div className="workspace-preview-scrub-row">
          <PreviewScrubber
            position={playhead}
            duration={duration}
            frameRate={frameRate}
            disabled={Boolean(lockedReason) || exporting || recording}
            onSeek={(seconds) => useTimelineStore.getState().seekTo(seconds)}
          />
        </div>
        <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-1">
          <PreviewTimecode position={playhead} duration={duration} frameRate={frameRate} disabled={Boolean(lockedReason) || exporting || recording} />
          <PreviewTransportControls
            duration={duration}
            frameRate={frameRate}
            playing={playing}
            lockedReason={lockedReason}
            exporting={exporting}
            onTogglePlayback={() => useTimelineStore.getState().togglePlayback()}
          />
        </div>
      </div>
    </div>
  );
}
