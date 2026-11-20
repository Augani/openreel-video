import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newSpectralRegionId, DEFAULT_SPECTRAL_ATTENUATION_DB, type SpectralRegion, type SpectralView } from "@openreel/core";
import { Button, Switch, cn } from "@openreel/ui";
import { X } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import {
  commitSpectralRegions,
  forgetSpectralView,
  loadSpectralSource,
  prepareSpectralView,
  regionsOf,
  requestSpectralView,
  type SpectralSource,
} from "../../services/spectral-edit";
import {
  COLOUR_MAPS,
  FREQUENCY_RANGES,
  bandFromPixels,
  colourTable,
  formatHz,
  formatSeconds,
  frequencyRange,
  panTime,
  pixelsToRect,
  rectToPixels,
  timeToX,
  yToFreq,
  zoomTime,
  type ColourMapId,
  type FrequencyRangeId,
  type SpectralViewport,
  type TimeFrequencyRect,
} from "./spectral-geometry";

interface SpectralEditorProps {
  clipId: string;
}

type Tool = "box" | "band";
const MIN_DRAG_PIXELS = 4;
const AXIS_GUIDES = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

/** Paints a spectrogram window onto a canvas through a colour table; columns map by source time so a stale image stays aligned while a new one loads. */
function paintSpectrogram(canvas: HTMLCanvasElement, view: SpectralView | null, viewport: SpectralViewport, colour: ColourMapId, clipRange: { start: number; end: number }): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(viewport.width * dpr));
  const h = Math.max(1, Math.round(viewport.height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!view) return;
  const table = colourTable(colour);
  const image = ctx.createImageData(w, h);
  const binHz = view.sampleRate / view.fftSize;
  const rowPos = new Float32Array(h);
  // On a log axis one pixel row spans many linear bins at the top, so a thin tone would fall between samples; each row takes the peak of the bins it covers.
  const rowLo = new Int32Array(h);
  const rowHi = new Int32Array(h);
  const clampBin = (hz: number) => Math.max(0, Math.min(view.bins - 1, Math.round(hz / binHz)));
  for (let y = 0; y < h; y += 1) {
    const here = { ...viewport, height: h };
    rowPos[y] = Math.max(0, Math.min(view.bins - 1.001, yToFreq(here, y + 0.5) / binHz));
    rowLo[y] = clampBin(yToFreq(here, y + 1));
    rowHi[y] = clampBin(yToFreq(here, y));
  }
  const span = view.endTime - view.startTime || 1;
  for (let x = 0; x < w; x += 1) {
    const t = viewport.startTime + ((x + 0.5) / w) * (viewport.endTime - viewport.startTime);
    const column = ((t - view.startTime) / span) * view.frames;
    const inside = column >= 0 && column < view.frames;
    const base = Math.min(view.frames - 1, Math.max(0, Math.floor(column))) * view.bins;
    const dim = t < clipRange.start || t > clipRange.end ? 0.45 : 1;
    for (let y = 0; y < h; y += 1) {
      const o = (y * w + x) * 4;
      if (!inside) {
        image.data[o + 3] = 255;
        continue;
      }
      const p = rowPos[y];
      const i0 = Math.floor(p);
      const f = p - i0;
      let v = Math.round(view.data[base + i0] * (1 - f) + view.data[base + i0 + 1] * f);
      for (let k = rowLo[y]; k <= rowHi[y]; k += 1) v = Math.max(v, view.data[base + k]);
      image.data[o] = table[v * 3] * dim;
      image.data[o + 1] = table[v * 3 + 1] * dim;
      image.data[o + 2] = table[v * 3 + 2] * dim;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  ctx.font = `${9 * dpr}px ui-monospace, monospace`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = dpr;
  const scaled = { ...viewport, width: w, height: h };
  for (const hz of AXIS_GUIDES) {
    if (hz <= viewport.minHz * 1.05 || hz >= viewport.maxHz) continue;
    const y = (1 - Math.log(hz / viewport.minHz) / Math.log(viewport.maxHz / viewport.minHz)) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : `${hz}`, 3 * dpr, y - 2 * dpr);
  }
  const range = viewport.endTime - viewport.startTime;
  const step = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300].find((s) => range / s <= 6) ?? 600;
  for (let t = Math.ceil(viewport.startTime / step) * step; t < viewport.endTime; t += step) {
    const x = timeToX(scaled, t);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 5 * dpr);
    ctx.stroke();
    ctx.fillText(`${Number(t.toFixed(3))}s`, x + 2 * dpr, 12 * dpr);
  }
}

const describeRegion = (region: SpectralRegion): string =>
  `${region.mode === "remove" ? "Remove" : `Attenuate ${Math.abs(region.gainDb)} dB`} · ${formatSeconds(region.startTime)}-${formatSeconds(region.endTime)} · ${formatHz(region.lowHz)}-${formatHz(region.highHz)}`;

/**
 * The spectral editor: STFT spectrogram of the clip's source on a log frequency axis with zoom, a colour map,
 * rectangle and frequency-band selection, and attenuate / remove. Every commit is one undoable edit to the clip's
 * "spectralRepair" effect, applied identically in the preview and the export.
 */
export const SpectralEditor: React.FC<SpectralEditorProps> = ({ clipId }) => {
  const clip = useProjectStore((state) => state.project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId));
  const regions = useMemo(() => regionsOf(clip), [clip]);
  const regionsRef = useRef(regions);
  regionsRef.current = regions;

  const [source, setSource] = useState<SpectralSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spectrogram, setSpectrogram] = useState<SpectralView | null>(null);
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [window_, setWindow] = useState<{ startTime: number; endTime: number } | null>(null);
  const [rangeId, setRangeId] = useState<FrequencyRangeId>("full");
  const [colour, setColour] = useState<ColourMapId>("heat");
  const [tool, setTool] = useState<Tool>("box");
  const [selection, setSelection] = useState<TimeFrequencyRect | null>(null);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [attenuation, setAttenuation] = useState(Math.abs(DEFAULT_SPECTRAL_ATTENUATION_DB));
  const [showOriginal, setShowOriginal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState({ width: 280, height: 190 });
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Decode the clip's source once per media file.
  useEffect(() => {
    let live = true;
    setSource(null);
    setSpectrogram(null);
    setViewKey(null);
    setSelection(null);
    setError(null);
    loadSpectralSource(clipId)
      .then((loaded) => {
        if (!live) return;
        setSource(loaded);
        setWindow({ startTime: 0, endTime: loaded.duration });
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not open the clip's audio"));
    return () => {
      live = false;
    };
  }, [clipId, clip?.mediaId]);

  // Track the stage size.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setSize({ width: Math.max(80, Math.floor(stage.clientWidth)), height: Math.max(80, Math.floor(stage.clientHeight)) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [expanded, source]);

  const regionKey = useMemo(() => JSON.stringify(regions.filter((r) => r.enabled).map((r) => [r.mode, r.startTime, r.endTime, r.lowHz, r.highHz, r.gainDb])), [regions]);

  // Edited (or original) audio -> the spectrogram worker.
  useEffect(() => {
    if (!source) return;
    let live = true;
    setBusy(true);
    prepareSpectralView(source, regionsRef.current, showOriginal)
      .then((key) => live && setViewKey(key))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not compute the spectrogram"))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [source, regionKey, showOriginal]);

  const nyquist = (source?.sampleRate ?? 48000) / 2;
  const { minHz, maxHz } = frequencyRange(rangeId, nyquist);
  const viewport: SpectralViewport = {
    startTime: window_?.startTime ?? 0,
    endTime: window_?.endTime ?? 1,
    minHz,
    maxHz,
    width: size.width,
    height: size.height,
  };
  const duration = source?.duration ?? 0;

  // Debounced spectrogram window request.
  const startKey = window_ ? `${window_.startTime.toFixed(4)}:${window_.endTime.toFixed(4)}` : "";
  useEffect(() => {
    if (!viewKey || !window_) return;
    let live = true;
    const timer = setTimeout(() => {
      requestSpectralView(viewKey, { startTime: window_.startTime, endTime: window_.endTime, maxFrames: Math.min(1400, Math.max(60, size.width)), fftSize: 4096 })
        .then((view) => live && setSpectrogram(view))
        .catch(() => {
          forgetSpectralView(viewKey);
          if (live) setViewKey(null);
          if (live && source) void prepareSpectralView(source, regionsRef.current, showOriginal).then((key) => live && setViewKey(key));
        });
    }, 90);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, startKey, size.width]);

  useEffect(() => {
    if (canvasRef.current) paintSpectrogram(canvasRef.current, spectrogram, viewport, colour, { start: clip?.inPoint ?? 0, end: clip?.outPoint ?? duration });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spectrogram, size, colour, rangeId, startKey, clip?.inPoint, clip?.outPoint]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setExpanded(false);
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [expanded]);

  const local = (event: React.PointerEvent): { x: number; y: number } => {
    const box = stageRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(box.width, event.clientX - box.left)), y: Math.max(0, Math.min(box.height, event.clientY - box.top)) };
  };
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || !source) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const p = local(event);
    setDrag({ a: p, b: p });
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (drag) setDrag({ a: drag.a, b: local(event) });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (!drag || !source) return;
    const b = local(event);
    const wide = Math.abs(b.x - drag.a.x) >= MIN_DRAG_PIXELS;
    const tall = Math.abs(b.y - drag.a.y) >= MIN_DRAG_PIXELS;
    setDrag(null);
    if (tool === "band" ? tall : wide && tall) {
      setSelection(tool === "band" ? bandFromPixels(viewport, drag.a.y, b.y, source.duration, nyquist) : pixelsToRect(viewport, drag.a, b, source.duration, nyquist));
    } else if (!wide && !tall) setSelection(null);
  };

  const commit = useCallback(
    async (mode: "attenuate" | "remove") => {
      if (!selection) return;
      const region: SpectralRegion = {
        id: newSpectralRegionId(),
        mode,
        startTime: selection.startTime,
        endTime: selection.endTime,
        lowHz: selection.lowHz,
        highHz: selection.highHz,
        gainDb: mode === "attenuate" ? -Math.abs(attenuation) : -120,
        enabled: true,
      };
      if (region.endTime - region.startTime < 1e-3 || region.highHz <= region.lowHz) return;
      const ok = await commitSpectralRegions(clipId, [...regionsRef.current, region]);
      if (ok) setSelection(null);
      else setError("Could not apply that edit.");
    },
    [attenuation, clipId, selection],
  );

  const zoom = (factor: number) => {
    if (!window_ || !source) return;
    const anchor = selection ? (selection.startTime + selection.endTime) / 2 : (window_.startTime + window_.endTime) / 2;
    setWindow(zoomTime(window_.startTime, window_.endTime, source.duration, factor, anchor));
  };
  const zoomed = window_ && source ? window_.endTime - window_.startTime < source.duration - 1e-6 : false;

  if (error && !source) {
    return (
      <p role="alert" className="text-[11px] text-status-error" data-testid="spectral-error">
        {error}
      </p>
    );
  }

  const dragRect = drag
    ? tool === "band"
      ? { x: 0, y: Math.min(drag.a.y, drag.b.y), width: size.width, height: Math.abs(drag.b.y - drag.a.y) }
      : { x: Math.min(drag.a.x, drag.b.x), y: Math.min(drag.a.y, drag.b.y), width: Math.abs(drag.b.x - drag.a.x), height: Math.abs(drag.b.y - drag.a.y) }
    : null;
  const selectionPx = selection ? rectToPixels(viewport, selection) : null;

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-2", expanded && "fixed inset-4 z-50 overflow-auto rounded-lg border border-border bg-bg-0 p-4 shadow-2xl")}
      data-testid="spectral-editor"
      data-expanded={expanded}
    >
      <p className="text-[11px] leading-snug text-fg-muted">
        Drag a box over the sound you want to change, then attenuate or remove it. Edits are saved on the clip, can be undone, and play the same in preview and export.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="Selection tool" className="flex overflow-hidden rounded border border-border">
          {(["box", "band"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              data-testid={`spectral-tool-${id}`}
              onClick={() => setTool(id)}
              className={cn("px-2 py-1 text-[11px]", tool === id ? "bg-accent text-white" : "bg-bg-1 text-fg hover:bg-bg-2")}
            >
              {id === "box" ? "Box" : "Frequency band"}
            </button>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => zoom(0.5)} disabled={!source} data-testid="spectral-zoom-in" aria-label="Zoom in">
          +
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => zoom(2)} disabled={!source || !zoomed} data-testid="spectral-zoom-out" aria-label="Zoom out">
          -
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => source && setWindow({ startTime: 0, endTime: source.duration })} disabled={!source || !zoomed} data-testid="spectral-zoom-fit">
          Fit
        </Button>
        <select
          aria-label="Frequency range"
          value={rangeId}
          onChange={(e) => setRangeId(e.target.value as FrequencyRangeId)}
          className="h-6 rounded border border-border bg-bg-1 px-1 text-[11px] text-fg"
          data-testid="spectral-range"
        >
          {FREQUENCY_RANGES.map((range) => (
            <option key={range.id} value={range.id}>
              {range.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Colour map"
          value={colour}
          onChange={(e) => setColour(e.target.value as ColourMapId)}
          className="h-6 rounded border border-border bg-bg-1 px-1 text-[11px] text-fg"
          data-testid="spectral-colour"
        >
          {COLOUR_MAPS.map((map) => (
            <option key={map.id} value={map.id}>
              {map.label}
            </option>
          ))}
        </select>
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 px-2 text-[11px]" onClick={() => setExpanded((v) => !v)} data-testid="spectral-expand" aria-pressed={expanded}>
          {expanded ? "Close" : "Expand"}
        </Button>
      </div>

      <div
        ref={stageRef}
        className={cn("relative w-full cursor-crosshair touch-none select-none overflow-hidden rounded border border-border bg-bg-1", expanded ? "min-h-0 flex-1" : "h-[190px]")}
        style={expanded ? { minHeight: 320 } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        data-testid="spectral-stage"
        data-start={viewport.startTime}
        data-end={viewport.endTime}
        data-min-hz={viewport.minHz}
        data-max-hz={viewport.maxHz}
        data-duration={duration}
        data-nyquist={nyquist}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" role="img" aria-label="Spectrogram of the clip's audio" data-testid="spectral-canvas" data-ready={spectrogram && !busy ? "true" : "false"} />
        <div className="pointer-events-none absolute inset-0">
          {regions.map((region) => {
            const box = rectToPixels(viewport, region);
            return (
              <div
                key={region.id}
                data-testid={`spectral-region-${region.id}`}
                data-mode={region.mode}
                className={cn("absolute border", region.mode === "remove" ? "border-red-400 bg-red-500/25" : "border-sky-300 bg-sky-400/25", !region.enabled && "opacity-30")}
                style={{ left: box.x, top: box.y, width: Math.max(1, box.width), height: Math.max(1, box.height) }}
              />
            );
          })}
          {selectionPx && (
            <div
              data-testid="spectral-selection"
              className="absolute border border-dashed border-white bg-white/15"
              style={{ left: selectionPx.x, top: selectionPx.y, width: Math.max(1, selectionPx.width), height: Math.max(1, selectionPx.height) }}
            />
          )}
          {dragRect && <div className="absolute border border-dashed border-white/80 bg-white/10" style={{ left: dragRect.x, top: dragRect.y, width: dragRect.width, height: dragRect.height }} />}
        </div>
        {!source && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-fg-muted" data-testid="spectral-loading">
            Decoding audio…
          </div>
        )}
      </div>

      {zoomed && window_ && source && (
        <input
          type="range"
          aria-label="Pan the spectrogram"
          min={0}
          max={Math.max(0, source.duration - (window_.endTime - window_.startTime))}
          step={0.01}
          value={window_.startTime}
          onChange={(e) => setWindow(panTime(window_.startTime, window_.endTime, source.duration, Number(e.target.value) - window_.startTime))}
          className="w-full"
          data-testid="spectral-pan"
        />
      )}

      <div className="flex min-h-[18px] items-center justify-between gap-2 text-[10px] text-fg-muted" data-testid="spectral-readout">
        <span className="truncate">
          {selection
            ? `Selection ${formatSeconds(selection.startTime)}-${formatSeconds(selection.endTime)}, ${formatHz(selection.lowHz)}-${formatHz(selection.highHz)}`
            : source
              ? `${formatSeconds(viewport.startTime)} to ${formatSeconds(viewport.endTime)} of ${formatSeconds(source.duration)}${busy ? " (updating)" : ""}`
              : ""}
        </span>
        <label className="flex shrink-0 items-center gap-1">
          <span>Original</span>
          <Switch checked={showOriginal} onCheckedChange={setShowOriginal} aria-label="Show the original, unedited spectrogram" className="workspace-switch flex-none" data-testid="spectral-show-original" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" data-testid="spectral-actions">
        <label className="flex items-center gap-1 text-[11px] text-fg">
          <span>Attenuate by</span>
          <input
            type="number"
            min={1}
            max={120}
            step={1}
            value={attenuation}
            onChange={(e) => setAttenuation(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
            className="h-6 w-14 rounded border border-border bg-bg-1 px-1 text-[11px] text-fg"
            aria-label="Attenuation in dB"
            data-testid="spectral-db"
          />
          <span>dB</span>
        </label>
        <Button type="button" size="sm" className="h-6 px-2 text-[11px]" disabled={!selection} onClick={() => void commit("attenuate")} data-testid="spectral-attenuate">
          Attenuate
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={!selection} onClick={() => void commit("remove")} data-testid="spectral-remove">
          Remove
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={!selection} onClick={() => setSelection(null)} data-testid="spectral-clear-selection">
          Clear selection
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-status-error" data-testid="spectral-error">
          {error}
        </p>
      )}

      {regions.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="spectral-regions">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Edits on this clip</span>
          {regions.map((region) => (
            <div key={region.id} className="flex min-w-0 items-center gap-1.5 rounded border border-border bg-bg-1 px-1.5 py-1" data-testid="spectral-region-row">
              <Switch
                checked={region.enabled}
                onCheckedChange={(on) => void commitSpectralRegions(clipId, regionsRef.current.map((r) => (r.id === region.id ? { ...r, enabled: on } : r)))}
                aria-label={`${region.enabled ? "Bypass" : "Enable"} edit ${describeRegion(region)}`}
                className="workspace-switch flex-none"
              />
              <span className="min-w-0 flex-1 truncate text-[10px] text-fg" title={describeRegion(region)}>
                {describeRegion(region)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-5 shrink-0 text-fg-muted hover:text-status-error"
                aria-label={`Delete edit ${describeRegion(region)}`}
                onClick={() => void commitSpectralRegions(clipId, regionsRef.current.filter((r) => r.id !== region.id))}
              >
                <X size={11} aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SpectralEditor;

