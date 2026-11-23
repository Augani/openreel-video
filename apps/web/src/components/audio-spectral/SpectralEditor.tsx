import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  newSpectralRegionId,
  DEFAULT_SPECTRAL_ATTENUATION_DB,
  DEFAULT_SPECTRAL_HARMONICS,
  DEFAULT_HARMONIC_BAND_CENTS,
  DEFAULT_WAND_TOLERANCE_DB,
  regionFeather,
  regionShape,
  spectralRegionsKey,
  sanitizeSpectralRegions,
  adviseHeal,
  type SpectralChannel,
  type SpectralHarmonicSpec,
  type SpectralRegion,
  type SpectralRegionMode,
  type SpectralView,
  type SpectralWandMask,
} from "@openreel/core";
import { Button, Switch, cn } from "@openreel/ui";
import { X } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { runHarmonicTrack, runMagicWand } from "../../services/spectral-analysis";
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
  RECT_HANDLES,
  bandFromPixels,
  brushRadiiFromPixels,
  colourTable,
  formatHz,
  formatSeconds,
  freqToY,
  frequencyRange,
  moveRect,
  movePoints,
  panTime,
  pixelsToPoints,
  pixelsToRect,
  pointToPixel,
  polygonArea,
  rectToPixels,
  resizeRect,
  thinPath,
  timeToX,
  xToTime,
  yToFreq,
  zoomTime,
  type ColourMapId,
  type FrequencyRangeId,
  type PixelPoint,
  type RectHandle,
  type SpectralViewport,
  type TimeFrequencyPoint,
  type TimeFrequencyRect,
} from "./spectral-geometry";

interface SpectralEditorProps {
  clipId: string;
}

type Tool = "box" | "band" | "lasso" | "brush" | "wand" | "harmonic";
const TOOLS: ReadonlyArray<{ id: Tool; label: string; title?: string }> = [
  { id: "box", label: "Box" },
  { id: "band", label: "Frequency band" },
  { id: "lasso", label: "Lasso" },
  { id: "brush", label: "Brush" },
  { id: "wand", label: "Magic wand", title: "Click a point to select the connected region of similar energy" },
  { id: "harmonic", label: "Harmonic", title: "Click a fundamental (or drag a box around it): the pitch is tracked through time and its overtones are selected as one region" },
];
const CHANNEL_LABEL: Record<SpectralChannel, string> = { both: "Both channels", left: "Left", right: "Right" };
const MAX_HARMONICS = 32;
const MIN_DRAG_PIXELS = 4;
const MODE_LABEL: Record<SpectralRegionMode, string> = { attenuate: "Attenuate", remove: "Remove", heal: "Heal" };

/** What the person has selected but not yet applied: a box / band, a lasso polygon or a brush stroke. */
interface Selection extends TimeFrequencyRect {
  readonly shape: "rect" | "lasso" | "brush" | "wand" | "harmonic";
  readonly points?: TimeFrequencyPoint[];
  readonly brushSeconds?: number;
  readonly brushOctaves?: number;
  /** wand: the cells the click selected (stored with the region, so it never depends on the algorithm again). */
  readonly wand?: SpectralWandMask;
  /** harmonic: the series settings; `points` is the tracked fundamental. */
  readonly harmonic?: SpectralHarmonicSpec;
  /** harmonic: where the track was started, to re-run it when the number of partials changes. */
  readonly trackFrom?: { seed?: TimeFrequencyPoint; box?: TimeFrequencyRect };
}

/** What a drag on the stage or on a handle of the selected region is doing. */
type EditDrag =
  | { kind: "move"; id: string; from: SpectralRegion; start: PixelPoint }
  | { kind: "handle"; id: string; from: SpectralRegion; handle: RectHandle }
  | { kind: "vertex"; id: string; from: SpectralRegion; index: number };
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

const SHAPE_LABEL = { rect: "Box", lasso: "Lasso", brush: "Brush", wand: "Wand", harmonic: "Harmonic" } as const;
const describeRegion = (region: SpectralRegion): string => {
  const detail =
    region.shape === "harmonic" && region.harmonic && region.points
      ? ` (${region.harmonic.harmonics} partials, f0 ${formatHz(region.points[0].hz)} to ${formatHz(region.points[region.points.length - 1].hz)})`
      : region.shape === "wand" && region.wand
        ? ` (${region.wand.toleranceDb} dB${region.wand.localContrast ? ", contrast" : ""})`
        : "";
  const channel = region.channel === "left" ? " · Left" : region.channel === "right" ? " · Right" : "";
  return `${SHAPE_LABEL[regionShape(region)]}${detail} · ${region.mode === "attenuate" ? `Attenuate ${Math.abs(region.gainDb)} dB` : MODE_LABEL[region.mode]}${channel} · ${formatSeconds(region.startTime)}-${formatSeconds(region.endTime)} · ${formatHz(region.lowHz)}-${formatHz(region.highHz)}`;
};

/** Paints the cells of stored wand masks onto a canvas that covers the stage (one rectangle per run of cells in a frame). */
function paintWandCells(canvas: HTMLCanvasElement, viewport: SpectralViewport, items: ReadonlyArray<{ wand: SpectralWandMask; fill: string }>): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(viewport.width * dpr));
  const h = Math.max(1, Math.round(viewport.height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  for (const { wand, fill } of items) {
    ctx.fillStyle = fill;
    const binHz = wand.sampleRate / wand.fftSize;
    const frameSeconds = wand.hop / wand.sampleRate;
    const px = (t: number) => timeToX(viewport, t) * dpr;
    const py = (hz: number) => freqToY(viewport, Math.max(hz, 1)) * dpr;
    let at = 0;
    for (let i = 0; i < wand.runs.length; i += 1) {
      const n = wand.runs[i];
      if (i % 2 === 1) {
        // A run may continue over several frames: split it at frame boundaries.
        let from = at;
        let left = n;
        while (left > 0) {
          const frame = Math.floor(from / wand.bins);
          const bin = from - frame * wand.bins;
          const take = Math.min(left, wand.bins - bin);
          const tc = ((wand.m0 + frame) * wand.hop + wand.fftSize / 2) / wand.sampleRate;
          const x0 = px(tc - frameSeconds / 2);
          const x1 = px(tc + frameSeconds / 2);
          const y0 = py((wand.k0 + bin + take - 0.5) * binHz);
          const y1 = py(Math.max((wand.k0 + bin - 0.5) * binHz, viewport.minHz * 0.5));
          if (x1 >= 0 && x0 <= w && y1 >= 0 && y0 <= h) ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
          from += take;
          left -= take;
        }
      }
      at += n;
    }
  }
}

/** One polyline per selected partial of a harmonic region, drawn as a band as wide as the partial's selection. */
function harmonicPaths(viewport: SpectralViewport, points: readonly TimeFrequencyPoint[], spec: SpectralHarmonicSpec): Array<{ h: number; d: string; width: number }> {
  const out: Array<{ h: number; d: string; width: number }> = [];
  const cents = Math.pow(2, spec.bandCents / 1200) - 1;
  for (let h = 1; h <= spec.harmonics; h += 1) {
    const segs: string[] = [];
    let top = 0;
    for (const p of points) {
      const hz = h * p.hz;
      if (hz > spec.maxHz) continue;
      const x = timeToX(viewport, p.t);
      const y = freqToY(viewport, hz);
      segs.push(`${segs.length ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`);
      top = hz;
    }
    if (segs.length < 2) continue;
    const width = Math.max(2, Math.abs(freqToY(viewport, top) - freqToY(viewport, top * (1 + cents))) * 2);
    out.push({ h, d: segs.join(" "), width });
  }
  return out;
}
const WAND_FILL: Record<SpectralRegionMode, string> = { attenuate: "rgba(125,211,252,0.32)", remove: "rgba(248,113,113,0.32)", heal: "rgba(134,239,172,0.32)" };
const REGION_COLOUR: Record<SpectralRegionMode, string> = { attenuate: "rgb(125 211 252)", remove: "rgb(248 113 113)", heal: "rgb(134 239 172)" };

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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  /** The pixel path of a lasso or brush stroke being drawn. */
  const [path, setPath] = useState<PixelPoint[] | null>(null);
  const [brushPx, setBrushPx] = useState(10);
  const [wandTolerance, setWandTolerance] = useState(DEFAULT_WAND_TOLERANCE_DB);
  const [wandContrast, setWandContrast] = useState(false);
  const [harmonics, setHarmonics] = useState(DEFAULT_SPECTRAL_HARMONICS);
  const [bandCents, setBandCents] = useState(DEFAULT_HARMONIC_BAND_CENTS);
  const [maxHarmonicHz, setMaxHarmonicHz] = useState(12000);
  /** Which channel of a stereo source the next edit applies to. */
  const [channel, setChannel] = useState<SpectralChannel>("both");
  const [analysing, setAnalysing] = useState(false);
  const analysisRun = useRef(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The selected region while one of its handles is dragged (committed as ONE edit on release). */
  const [draft, setDraft] = useState<SpectralRegion | null>(null);
  const editRef = useRef<EditDrag | null>(null);
  const [attenuation, setAttenuation] = useState(Math.abs(DEFAULT_SPECTRAL_ATTENUATION_DB));
  const [showOriginal, setShowOriginal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState({ width: 280, height: 190 });
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wandCanvasRef = useRef<HTMLCanvasElement>(null);

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

  const regionKey = useMemo(() => spectralRegionsKey(regions), [regions]);

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
  const stereo = (source?.buffer.numberOfChannels ?? 1) > 1;

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

  // The cells of every magic-wand region (and of the pending wand selection).
  useEffect(() => {
    if (!wandCanvasRef.current) return;
    const items: Array<{ wand: SpectralWandMask; fill: string }> = [];
    for (const region of draft ? regions.map((r) => (r.id === draft.id ? draft : r)) : regions) {
      if (region.shape === "wand" && region.wand) items.push({ wand: region.wand, fill: region.enabled ? (region.id === selectedId ? "rgba(255,255,255,0.4)" : WAND_FILL[region.mode]) : "rgba(255,255,255,0.08)" });
    }
    if (selection?.shape === "wand" && selection.wand) items.push({ wand: selection.wand, fill: "rgba(255,255,255,0.38)" });
    paintWandCells(wandCanvasRef.current, viewport, items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, draft, selection, selectedId, size, rangeId, startKey]);

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
    setSelectedId(null);
    if (tool === "lasso" || tool === "brush") setPath([p]);
    else setDrag({ a: p, b: p });
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const p = local(event);
    if (editRef.current) return updateEdit(p);
    if (path) setPath(thinPath([...path, p], 3));
    else if (drag) setDrag({ a: drag.a, b: p });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (editRef.current) return void finishEdit();
    if (!source) return;
    if (path) {
      const stroke = thinPath([...path, local(event)], 3);
      setPath(null);
      if (tool === "lasso") {
        if (stroke.length >= 3 && polygonArea(stroke) >= MIN_DRAG_PIXELS * MIN_DRAG_PIXELS * 2) {
          const points = pixelsToPoints(viewport, stroke, source.duration, nyquist);
          setSelection({ shape: "lasso", points, ...boundsOf(points) });
        } else setSelection(null);
      } else {
        const radii = brushRadiiFromPixels(viewport, brushPx);
        const points = pixelsToPoints(viewport, stroke, source.duration, nyquist);
        setSelection({ shape: "brush", points, ...radii, ...boundsOf(points, radii) });
      }
      return;
    }
    if (!drag) return;
    const b = local(event);
    const wide = Math.abs(b.x - drag.a.x) >= MIN_DRAG_PIXELS;
    const tall = Math.abs(b.y - drag.a.y) >= MIN_DRAG_PIXELS;
    setDrag(null);
    if (tool === "wand") {
      const [seed] = pixelsToPoints(viewport, [drag.a], source.duration, nyquist);
      void selectWand(seed);
      return;
    }
    if (tool === "harmonic") {
      if (wide && tall) void selectHarmonic({ box: pixelsToRect(viewport, drag.a, b, source.duration, nyquist) });
      else {
        const [seed] = pixelsToPoints(viewport, [drag.a], source.duration, nyquist);
        void selectHarmonic({ seed });
      }
      return;
    }
    if (tool === "band" ? tall : wide && tall) {
      setSelection({ shape: "rect", ...(tool === "band" ? bandFromPixels(viewport, drag.a.y, b.y, source.duration, nyquist) : pixelsToRect(viewport, drag.a, b, source.duration, nyquist)) });
    } else if (!wide && !tall) setSelection(null);
  };

  const wandBounds = (wand: SpectralWandMask): TimeFrequencyRect => {
    const [r] = sanitizeSpectralRegions([{ id: "tmp", mode: "remove", shape: "wand", wand }]);
    return r ? { startTime: r.startTime, endTime: r.endTime, lowHz: r.lowHz, highHz: r.highHz } : { startTime: 0, endTime: 0, lowHz: 0, highHz: 0 };
  };

  /** Magic wand: select the connected region of similar energy around a point. Re-run with the current tolerance. */
  const selectWand = async (seed: TimeFrequencyPoint, tolerance = wandTolerance, contrast = wandContrast) => {
    if (!source) return;
    const run = ++analysisRun.current;
    setAnalysing(true);
    setError(null);
    // Let the busy state paint before the analysis blocks the thread.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const outcome = await runMagicWand(source.buffer, seed, tolerance, contrast).catch(() => ({ ok: false as const, message: "The magic wand failed on this audio." }));
    if (run !== analysisRun.current) return;
    setAnalysing(false);
    if (!outcome.ok) {
      setSelection(null);
      setError(outcome.message);
      return;
    }
    setSelection({ shape: "wand", wand: outcome.wand, ...wandBounds(outcome.wand) });
  };

  /** Harmonic selection: track the pitch of the clicked fundamental (or of the strongest peak in a box) and select its overtones. */
  const selectHarmonic = async (from: { seed?: TimeFrequencyPoint; box?: TimeFrequencyRect }, count = harmonics, ceiling = maxHarmonicHz, cents = bandCents) => {
    if (!source) return;
    const run = ++analysisRun.current;
    setAnalysing(true);
    setError(null);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const outcome = await runHarmonicTrack(source.buffer, { seed: from.seed, box: from.box, harmonics: count, maxHz: Math.min(ceiling, nyquist) }).catch(() => ({ ok: false as const, message: "The harmonic tracker failed on this audio." }));
    if (run !== analysisRun.current) return;
    setAnalysing(false);
    if (!outcome.ok) {
      setSelection(null);
      setError(outcome.message);
      return;
    }
    const spec: SpectralHarmonicSpec = { harmonics: count, maxHz: Math.min(ceiling, nyquist), bandCents: cents };
    const [r] = sanitizeSpectralRegions([{ id: "tmp", mode: "remove", shape: "harmonic", points: outcome.points, harmonic: spec }]);
    if (!r) {
      setSelection(null);
      setError("That track is too short to select.");
      return;
    }
    setSelection({ shape: "harmonic", points: r.points as TimeFrequencyPoint[], harmonic: spec, trackFrom: from, startTime: r.startTime, endTime: r.endTime, lowHz: r.lowHz, highHz: r.highHz });
  };

  /** The bounding box the stored region will get (the same derivation the core does when it sanitises the region). */
  const boundsOf = (points: TimeFrequencyPoint[], radii?: { brushSeconds: number; brushOctaves: number }): TimeFrequencyRect => {
    const [r] = sanitizeSpectralRegions([{ id: "tmp", mode: "heal", shape: radii ? "brush" : "lasso", points, ...radii }]);
    return r ? { startTime: r.startTime, endTime: r.endTime, lowHz: r.lowHz, highHz: r.highHz } : { startTime: 0, endTime: 0, lowHz: 0, highHz: 0 };
  };

  /* Editing the selected region: move / resize a box, move the vertices of a lasso. */
  const beginEdit = (event: React.PointerEvent, edit: EditDrag) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    stageRef.current?.setPointerCapture?.(event.pointerId);
    editRef.current = edit;
    setDraft(edit.from);
  };
  const updateEdit = (p: PixelPoint) => {
    const edit = editRef.current;
    if (!edit || !source) return;
    const { from } = edit;
    let next: Record<string, unknown> = { ...from };
    if (edit.kind === "move") {
      const dt = xToTime(viewport, p.x) - xToTime(viewport, edit.start.x);
      const dOct = Math.log2(yToFreq(viewport, p.y) / yToFreq(viewport, edit.start.y));
      if (from.points) next = { ...from, points: movePoints(from.points, dt, dOct, source.duration, nyquist) };
      else next = { ...from, ...moveRect(from, dt, dOct, source.duration, nyquist) };
    } else if (edit.kind === "handle") {
      next = { ...from, ...resizeRect(from, edit.handle, xToTime(viewport, p.x), yToFreq(viewport, p.y), source.duration, nyquist) };
    } else if (from.points) {
      const [point] = pixelsToPoints(viewport, [p], source.duration, nyquist);
      next = { ...from, points: from.points.map((q, i) => (i === edit.index ? point : q)) };
    }
    const [clean] = sanitizeSpectralRegions([next]);
    if (clean) setDraft(clean);
  };
  const finishEdit = async () => {
    const edit = editRef.current;
    editRef.current = null;
    const final = draft;
    setDraft(null);
    if (!edit || !final) return;
    if (JSON.stringify(final) === JSON.stringify(edit.from)) return;
    const ok = await commitSpectralRegions(clipId, regionsRef.current.map((r) => (r.id === final.id ? final : r)));
    if (!ok) setError("Could not apply that edit.");
  };

  /** Heal continues a steady partial present on both sides of the selection, so flag that before it is applied. */
  const healContinues = useMemo(() => {
    if (!selection || !source || selection.shape === "wand" || selection.shape === "harmonic") return false;
    if (selection.startTime <= 0.001 && selection.endTime >= source.duration - 0.001) return false;
    try {
      return adviseHeal(source.buffer.getChannelData(0), source.sampleRate, selection).continuesBothSides;
    } catch {
      return false;
    }
  }, [selection, source]);

  // Moving the tolerance / contrast re-runs the wand from the same seed; changing the partial count re-runs the track; the bandwidth only re-reads it.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    const current = selectionRef.current;
    if (!current || current.shape !== "wand" || !current.wand) return;
    if (current.wand.toleranceDb === wandTolerance && current.wand.localContrast === wandContrast) return;
    const timer = setTimeout(() => void selectWand(current.wand!.seed, wandTolerance, wandContrast), 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wandTolerance, wandContrast]);
  useEffect(() => {
    const current = selectionRef.current;
    if (!current || current.shape !== "harmonic" || !current.harmonic || !current.trackFrom) return;
    const spec = current.harmonic;
    if (spec.harmonics === harmonics && spec.maxHz === Math.min(maxHarmonicHz, nyquist)) {
      if (spec.bandCents !== bandCents) {
        const next = { ...spec, bandCents };
        const [r] = sanitizeSpectralRegions([{ id: "tmp", mode: "remove", shape: "harmonic", points: current.points, harmonic: next }]);
        if (r) setSelection({ ...current, harmonic: next, startTime: r.startTime, endTime: r.endTime, lowHz: r.lowHz, highHz: r.highHz });
      }
      return;
    }
    const timer = setTimeout(() => void selectHarmonic(current.trackFrom!, harmonics, maxHarmonicHz, bandCents), 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harmonics, maxHarmonicHz, bandCents]);

  const commit = useCallback(
    async (mode: SpectralRegionMode) => {
      if (!selection) return;
      const [region] = sanitizeSpectralRegions([
        {
          id: newSpectralRegionId(),
          mode,
          shape: selection.shape,
          points: selection.points,
          brushSeconds: selection.brushSeconds,
          brushOctaves: selection.brushOctaves,
          wand: selection.wand,
          harmonic: selection.harmonic,
          channel: channel === "both" ? undefined : channel,
          startTime: selection.startTime,
          endTime: selection.endTime,
          lowHz: selection.lowHz,
          highHz: selection.highHz,
          gainDb: mode === "attenuate" ? -Math.abs(attenuation) : -120,
          enabled: true,
        },
      ]);
      if (!region || region.endTime - region.startTime < 1e-3 || region.highHz <= region.lowHz) return;
      const ok = await commitSpectralRegions(clipId, [...regionsRef.current, region]);
      if (ok) {
        setSelection(null);
        setSelectedId(region.id);
      } else setError("Could not apply that edit.");
    },
    [attenuation, channel, clipId, selection],
  );

  /** One undoable change to one region of the list. */
  const changeRegion = useCallback(
    (id: string, change: (region: SpectralRegion) => SpectralRegion) =>
      void commitSpectralRegions(clipId, regionsRef.current.map((r) => (r.id === id ? change(r) : r))).then((ok) => ok || setError("Could not apply that edit.")),
    [clipId],
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

  const dragRect = drag && tool !== "wand"
    ? tool === "band"
      ? { x: 0, y: Math.min(drag.a.y, drag.b.y), width: size.width, height: Math.abs(drag.b.y - drag.a.y) }
      : { x: Math.min(drag.a.x, drag.b.x), y: Math.min(drag.a.y, drag.b.y), width: Math.abs(drag.b.x - drag.a.x), height: Math.abs(drag.b.y - drag.a.y) }
    : null;
  const selectionPx = selection ? rectToPixels(viewport, selection) : null;
  const shown = draft ? regions.map((r) => (r.id === draft.id ? draft : r)) : regions;

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-2", expanded && "fixed inset-4 z-50 overflow-auto rounded-lg border border-border bg-bg-0 p-4 shadow-2xl")}
      data-testid="spectral-editor"
      data-expanded={expanded}
    >
      <p className="text-[11px] leading-snug text-fg-muted">
        Select the sound you want to change with a box, a frequency band, a lasso, a brush, the magic wand (click a point to take the connected region of similar energy) or the harmonic tool (click a fundamental to follow its pitch and take its overtones), then attenuate, remove or heal it. Heal matches the background around the selection; Remove is a smooth, quieter fill. Edits are saved on the clip, can be undone, and play the same in preview and export.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="Selection tool" className="flex overflow-hidden rounded border border-border">
          {TOOLS.map(({ id, label, title }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              data-testid={`spectral-tool-${id}`}
              title={title}
              onClick={() => setTool(id)}
              className={cn("px-2 py-1 text-[11px]", tool === id ? "bg-accent text-white" : "bg-bg-1 text-fg hover:bg-bg-2")}
            >
              {label}
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
        {tool === "brush" && (
          <label className="flex items-center gap-1 text-[11px] text-fg">
            <span>Brush size</span>
            <input type="range" min={3} max={40} step={1} value={brushPx} onChange={(e) => setBrushPx(Number(e.target.value))} aria-label="Brush size in pixels" data-testid="spectral-brush-size" className="w-16" />
          </label>
        )}
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 px-2 text-[11px]" onClick={() => setExpanded((v) => !v)} data-testid="spectral-expand" aria-pressed={expanded}>
          {expanded ? "Close" : "Expand"}
        </Button>
      </div>

      {(tool === "wand" || tool === "harmonic" || stereo) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg" data-testid="spectral-tool-options">
          {tool === "wand" && (
            <>
              <label className="flex items-center gap-1">
                <span>Tolerance</span>
                <input type="range" min={1} max={30} step={1} value={wandTolerance} onChange={(e) => setWandTolerance(Number(e.target.value))} aria-label="Magic wand tolerance in dB" data-testid="spectral-wand-tolerance" className="w-20" />
                <span className="w-9 tabular-nums text-fg-muted" data-testid="spectral-wand-tolerance-value">{wandTolerance} dB</span>
              </label>
              <label className="flex items-center gap-1" title="Compare cells with their own surroundings instead of with the clicked cell's level: follows a whistle or hum whose level wanders and ignores the floor">
                <input type="checkbox" checked={wandContrast} onChange={(e) => setWandContrast(e.target.checked)} data-testid="spectral-wand-contrast" />
                <span>Local contrast</span>
              </label>
            </>
          )}
          {tool === "harmonic" && (
            <>
              <label className="flex items-center gap-1">
                <span>Harmonics</span>
                <input type="number" min={1} max={MAX_HARMONICS} step={1} value={harmonics} onChange={(e) => setHarmonics(Math.max(1, Math.min(MAX_HARMONICS, Math.round(Number(e.target.value)) || 1)))} aria-label="Number of harmonics, the fundamental counting as one" data-testid="spectral-harmonics" className="h-6 w-12 rounded border border-border bg-bg-1 px-1 text-[11px] text-fg" />
              </label>
              <label className="flex items-center gap-1">
                <span>Up to</span>
                <input type="number" min={100} max={Math.round(nyquist)} step={500} value={maxHarmonicHz} onChange={(e) => setMaxHarmonicHz(Math.max(100, Math.min(Math.round(nyquist), Number(e.target.value) || 100)))} aria-label="Highest frequency of the selected harmonics in Hz" data-testid="spectral-harmonic-max" className="h-6 w-16 rounded border border-border bg-bg-1 px-1 text-[11px] text-fg" />
                <span>Hz</span>
              </label>
              <label className="flex items-center gap-1">
                <span>Bandwidth</span>
                <input type="number" min={5} max={400} step={5} value={bandCents} onChange={(e) => setBandCents(Math.max(5, Math.min(400, Number(e.target.value) || 5)))} aria-label="Bandwidth of each harmonic in cents" data-testid="spectral-harmonic-cents" className="h-6 w-14 rounded border border-border bg-bg-1 px-1 text-[11px] text-fg" />
                <span>cents</span>
              </label>
            </>
          )}
          {stereo && (
            <label className="flex items-center gap-1">
              <span>Edit</span>
              <select aria-label="Channel to edit" value={channel} onChange={(e) => setChannel(e.target.value as SpectralChannel)} className="h-6 rounded border border-border bg-bg-1 px-1 text-[11px] text-fg" data-testid="spectral-channel">
                {(Object.keys(CHANNEL_LABEL) as SpectralChannel[]).map((id) => (
                  <option key={id} value={id}>
                    {CHANNEL_LABEL[id]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {analysing && <span className="text-fg-muted" role="status" data-testid="spectral-analysing">Analysing…</span>}
        </div>
      )}

      <div
        ref={stageRef}
        className={cn("relative w-full cursor-crosshair touch-none select-none overflow-hidden rounded border border-border bg-bg-1", expanded ? "min-h-0 flex-1" : "h-[190px]")}
        style={expanded ? { minHeight: 320 } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setDrag(null);
          setPath(null);
          editRef.current = null;
          setDraft(null);
        }}
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
          <canvas ref={wandCanvasRef} className="absolute inset-0 h-full w-full" aria-hidden data-testid="spectral-wand-layer" />
          {shown.map((region) => {
            const shape = regionShape(region);
            if (shape !== "rect") return null;
            const box = rectToPixels(viewport, region);
            const selected = region.id === selectedId;
            return (
              <div
                key={region.id}
                data-testid={`spectral-region-${region.id}`}
                data-mode={region.mode}
                data-shape="rect"
                data-selected={selected}
                className={cn("absolute border", region.mode === "remove" ? "border-red-400 bg-red-500/25" : region.mode === "heal" ? "border-green-300 bg-green-400/25" : "border-sky-300 bg-sky-400/25", selected && "border-2 border-white", !region.enabled && "opacity-30")}
                style={{ left: box.x, top: box.y, width: Math.max(1, box.width), height: Math.max(1, box.height), pointerEvents: selected ? "auto" : "none", cursor: selected ? "move" : undefined }}
                onPointerDown={selected ? (e) => beginEdit(e, { kind: "move", id: region.id, from: region, start: local(e) }) : undefined}
              >
                {selected &&
                  RECT_HANDLES.map((handle) => (
                    <span
                      key={handle}
                      data-testid={`spectral-handle-${handle}`}
                      className="absolute size-2 rounded-sm border border-black/60 bg-white"
                      style={{
                        left: handle.includes("w") ? -4 : handle.includes("e") ? undefined : "calc(50% - 4px)",
                        right: handle.includes("e") ? -4 : undefined,
                        top: handle.includes("n") ? -4 : handle.includes("s") ? undefined : "calc(50% - 4px)",
                        bottom: handle.includes("s") ? -4 : undefined,
                        cursor: `${handle}-resize`,
                      }}
                      onPointerDown={(e) => beginEdit(e, { kind: "handle", id: region.id, from: region, handle })}
                    />
                  ))}
              </div>
            );
          })}
          <svg className="absolute inset-0" width={size.width} height={size.height} data-testid="spectral-mask-layer">
            {shown.map((region) => {
              const shape = regionShape(region);
              if (shape === "wand" && region.wand) {
                const box = rectToPixels(viewport, region);
                const selected = region.id === selectedId;
                return (
                  <rect
                    key={region.id}
                    data-testid={`spectral-region-${region.id}`}
                    data-mode={region.mode}
                    data-shape="wand"
                    data-selected={selected}
                    x={box.x}
                    y={box.y}
                    width={Math.max(1, box.width)}
                    height={Math.max(1, box.height)}
                    fill="none"
                    stroke={selected ? "white" : REGION_COLOUR[region.mode]}
                    strokeWidth={selected ? 2 : 1}
                    strokeDasharray="3 3"
                    opacity={region.enabled ? 1 : 0.3}
                  />
                );
              }
              if (shape === "harmonic" && region.points && region.harmonic) {
                const selected = region.id === selectedId;
                const colour = REGION_COLOUR[region.mode];
                const line = region.points.map((p) => pointToPixel(viewport, p)).map((p) => `${p.x},${p.y}`).join(" ");
                return (
                  <g key={region.id} data-testid={`spectral-region-${region.id}`} data-mode={region.mode} data-shape="harmonic" data-selected={selected} opacity={region.enabled ? 1 : 0.3} fill="none" strokeLinecap="round" strokeLinejoin="round">
                    {harmonicPaths(viewport, region.points, region.harmonic).map((path) => (
                      <path key={path.h} d={path.d} stroke={selected ? "white" : colour} strokeOpacity={selected ? 0.4 : 0.32} strokeWidth={path.width} />
                    ))}
                    <polyline points={line} stroke={selected ? "white" : colour} strokeWidth={selected ? 2 : 1} />
                    {selected && (
                      <polyline
                        points={line}
                        stroke="transparent"
                        strokeWidth={10}
                        style={{ pointerEvents: "stroke", cursor: "move" }}
                        data-testid="spectral-harmonic-grip"
                        onPointerDown={(e) => beginEdit(e, { kind: "move", id: region.id, from: region, start: local(e) })}
                      />
                    )}
                  </g>
                );
              }
              if (shape === "rect" || !region.points) return null;
              const px = region.points.map((p) => pointToPixel(viewport, p));
              const selected = region.id === selectedId;
              const colour = REGION_COLOUR[region.mode];
              const common = { "data-testid": `spectral-region-${region.id}`, "data-mode": region.mode, "data-shape": shape, "data-selected": selected, opacity: region.enabled ? 1 : 0.3 } as const;
              if (shape === "lasso") {
                return (
                  <polygon
                    key={region.id}
                    {...common}
                    points={px.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill={colour}
                    fillOpacity={0.25}
                    stroke={selected ? "white" : colour}
                    strokeWidth={selected ? 2 : 1}
                    style={{ pointerEvents: selected ? "visiblePainted" : "none", cursor: selected ? "move" : undefined }}
                    onPointerDown={selected ? (e) => beginEdit(e, { kind: "move", id: region.id, from: region, start: local(e) }) : undefined}
                  />
                );
              }
              const rx = ((region.brushSeconds ?? 0.04) / (viewport.endTime - viewport.startTime)) * viewport.width;
              const ry = (Math.abs(freqToY(viewport, 1000) - freqToY(viewport, 1000 * Math.pow(2, region.brushOctaves ?? 0.12))));
              return (
                <g key={region.id} {...common} stroke={selected ? "white" : colour} strokeWidth={selected ? 2 : 1}>
                  {px.length > 1 && <polyline points={px.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={colour} strokeOpacity={0.25} strokeWidth={Math.max(2, 2 * Math.min(rx, ry))} strokeLinecap="round" strokeLinejoin="round" />}
                  {px.map((p, i) => (
                    <ellipse key={i} cx={p.x} cy={p.y} rx={Math.max(1, rx)} ry={Math.max(1, ry)} fill={colour} fillOpacity={px.length > 24 ? 0.04 : 0.2} />
                  ))}
                </g>
              );
            })}
            {(() => {
              const region = shown.find((r) => r.id === selectedId && regionShape(r) === "lasso" && r.points);
              return region?.points?.map((point, index) => {
                const p = pointToPixel(viewport, point);
                return (
                  <circle
                    key={index}
                    data-testid={`spectral-vertex-${index}`}
                    cx={p.x}
                    cy={p.y}
                    r={4}
                    fill="white"
                    stroke="black"
                    strokeOpacity={0.6}
                    style={{ pointerEvents: "auto", cursor: "grab" }}
                    onPointerDown={(e) => beginEdit(e, { kind: "vertex", id: region.id, from: region, index })}
                  />
                );
              });
            })()}
            {selection?.points && selection.shape === "lasso" && (
              <polygon data-testid="spectral-selection" points={selection.points.map((p) => { const q = pointToPixel(viewport, p); return `${q.x},${q.y}`; }).join(" ")} fill="white" fillOpacity={0.15} stroke="white" strokeDasharray="4 3" />
            )}
            {selection?.points && selection.shape === "brush" && (
              <g data-testid="spectral-selection" fill="white" fillOpacity={0.12} stroke="white" strokeDasharray="4 3">
                <polyline points={selection.points.map((p) => { const q = pointToPixel(viewport, p); return `${q.x},${q.y}`; }).join(" ")} fill="none" strokeOpacity={0.35} strokeWidth={2 * brushPx} strokeLinecap="round" strokeLinejoin="round" stroke="white" strokeDasharray="none" />
              </g>
            )}
            {selection?.shape === "harmonic" && selection.points && selection.harmonic && (
              <g data-testid="spectral-selection" data-shape="harmonic" fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round">
                {harmonicPaths(viewport, selection.points, selection.harmonic).map((p) => (
                  <path key={p.h} d={p.d} strokeOpacity={0.35} strokeWidth={p.width} />
                ))}
                <polyline points={selection.points.map((p) => { const q = pointToPixel(viewport, p); return `${q.x},${q.y}`; }).join(" ")} strokeDasharray="4 3" />
              </g>
            )}
            {path && tool === "lasso" && <polygon data-testid="spectral-lasso-path" points={path.map((p) => `${p.x},${p.y}`).join(" ")} fill="white" fillOpacity={0.12} stroke="white" strokeDasharray="4 3" />}
            {path && tool === "brush" && <polyline data-testid="spectral-brush-path" points={path.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="white" strokeOpacity={0.4} strokeWidth={2 * brushPx} strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
          {selectionPx && (selection?.shape === "rect" || selection?.shape === "wand") && (
            <div
              data-testid="spectral-selection"
              data-shape={selection.shape}
              className={cn("absolute border border-dashed border-white", selection.shape === "rect" && "bg-white/15")}
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
            ? `${selection.shape === "rect" ? "Selection" : SHAPE_LABEL[selection.shape]} ${formatSeconds(selection.startTime)}-${formatSeconds(selection.endTime)}, ${formatHz(selection.lowHz)}-${formatHz(selection.highHz)}`
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
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={!selection} onClick={() => void commit("remove")} data-testid="spectral-remove" title="Replace the selection by a smooth interpolation of its surroundings. Cheapest, and the lowest error when what lay underneath is silence or cannot be predicted, but it leaves a notch 5 to 10 dB quieter than the background">
          Remove
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={!selection} onClick={() => void commit("heal")} data-testid="spectral-heal" title="Refill the selection with the surrounding background at its own level and texture (no quiet hole) and carry steady partials through short gaps. Best where the background is audible: noise floor, hum, held notes. Not for a slice of a persistent tone: use Remove for that">
          Heal
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={!selection} onClick={() => setSelection(null)} data-testid="spectral-clear-selection">
          Clear selection
        </Button>
      </div>
      {selection && healContinues && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-[11px] text-amber-300" data-testid="spectral-heal-warning">
          <span>A steady tone in this band continues on both sides of the selection. Heal carries it through, so it would stay. Remove takes it out, or select its whole length.</span>
          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => void commit("remove")} data-testid="spectral-heal-use-remove">
            Use Remove
          </Button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-status-error" data-testid="spectral-error">
          {error}
        </p>
      )}

      {regions.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="spectral-regions">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Edits on this clip</span>
          {shown.map((region) => {
            const selected = region.id === selectedId;
            const masked = regionShape(region) !== "rect";
            return (
              <div
                key={region.id}
                className={cn("flex min-w-0 flex-wrap items-center gap-1.5 rounded border bg-bg-1 px-1.5 py-1", selected ? "border-accent" : "border-border")}
                data-testid="spectral-region-row"
                data-region-id={region.id}
                data-selected={selected}
              >
                <Switch
                  checked={region.enabled}
                  onCheckedChange={(on) => changeRegion(region.id, (r) => ({ ...r, enabled: on }))}
                  aria-label={`${region.enabled ? "Hide" : "Show"} edit ${describeRegion(region)}`}
                  className="workspace-switch flex-none"
                  data-testid="spectral-region-enabled"
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-[10px] text-fg"
                  title={describeRegion(region)}
                  aria-pressed={selected}
                  onClick={() => setSelectedId(selected ? null : region.id)}
                  data-testid="spectral-region-select"
                >
                  {describeRegion(region)}
                </button>
                <select
                  aria-label={`Mode of edit ${describeRegion(region)}`}
                  value={region.mode}
                  onChange={(e) => {
                    const mode = e.target.value as SpectralRegionMode;
                    changeRegion(region.id, (r) => ({ ...r, mode, gainDb: mode === "attenuate" ? (r.mode === "attenuate" ? r.gainDb : -Math.abs(attenuation)) : -120 }));
                  }}
                  className="h-5 rounded border border-border bg-bg-0 px-0.5 text-[10px] text-fg"
                  data-testid="spectral-region-mode"
                >
                  {(["attenuate", "remove", "heal"] as const).map((mode) => (
                    <option key={mode} value={mode}>
                      {MODE_LABEL[mode]}
                    </option>
                  ))}
                </select>
                {region.mode === "attenuate" && (
                  <input
                    type="number"
                    min={1}
                    max={120}
                    step={1}
                    defaultValue={Math.abs(region.gainDb)}
                    key={`${region.id}-${region.gainDb}`}
                    aria-label={`Attenuation in dB of edit ${describeRegion(region)}`}
                    className="h-5 w-11 rounded border border-border bg-bg-0 px-1 text-[10px] text-fg"
                    data-testid="spectral-region-gain"
                    onBlur={(e) => {
                      const dB = Math.max(1, Math.min(120, Number(e.target.value) || 1));
                      if (-dB !== region.gainDb) changeRegion(region.id, (r) => ({ ...r, gainDb: -dB }));
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                )}
                {stereo && (
                  <select
                    aria-label={`Channel of edit ${describeRegion(region)}`}
                    value={region.channel ?? "both"}
                    onChange={(e) => {
                      const next = e.target.value as SpectralChannel;
                      changeRegion(region.id, (r) => {
                        const { channel: _drop, ...rest } = r;
                        void _drop;
                        return next === "both" ? rest : { ...rest, channel: next };
                      });
                    }}
                    className="h-5 rounded border border-border bg-bg-0 px-0.5 text-[10px] text-fg"
                    data-testid="spectral-region-channel"
                  >
                    {(Object.keys(CHANNEL_LABEL) as SpectralChannel[]).map((id) => (
                      <option key={id} value={id}>
                        {CHANNEL_LABEL[id]}
                      </option>
                    ))}
                  </select>
                )}
                {region.shape === "harmonic" && region.harmonic && (
                  <>
                    <input
                      type="number"
                      min={1}
                      max={MAX_HARMONICS}
                      step={1}
                      defaultValue={region.harmonic.harmonics}
                      key={`${region.id}-h${region.harmonic.harmonics}`}
                      aria-label={`Harmonics of edit ${describeRegion(region)}`}
                      title="Harmonics (the fundamental counts as one)"
                      className="h-5 w-10 rounded border border-border bg-bg-0 px-1 text-[10px] text-fg"
                      data-testid="spectral-region-harmonics"
                      onBlur={(e) => {
                        const n = Math.max(1, Math.min(MAX_HARMONICS, Math.round(Number(e.target.value)) || 1));
                        if (n !== region.harmonic?.harmonics) changeRegion(region.id, (r) => (r.harmonic ? { ...r, harmonic: { ...r.harmonic, harmonics: n } } : r));
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                    <input
                      type="number"
                      min={5}
                      max={400}
                      step={5}
                      defaultValue={region.harmonic.bandCents}
                      key={`${region.id}-c${region.harmonic.bandCents}`}
                      aria-label={`Bandwidth in cents of edit ${describeRegion(region)}`}
                      title="Bandwidth of each harmonic, cents"
                      className="h-5 w-11 rounded border border-border bg-bg-0 px-1 text-[10px] text-fg"
                      data-testid="spectral-region-cents"
                      onBlur={(e) => {
                        const c = Math.max(5, Math.min(400, Number(e.target.value) || 5));
                        if (c !== region.harmonic?.bandCents) changeRegion(region.id, (r) => (r.harmonic ? { ...r, harmonic: { ...r.harmonic, bandCents: c } } : r));
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  </>
                )}
                {masked && (
                  <input
                    type="number"
                    min={0}
                    max={8}
                    step={1}
                    defaultValue={regionFeather(region)}
                    key={`${region.id}-f${regionFeather(region)}`}
                    aria-label={`Feather of edit ${describeRegion(region)}`}
                    title="Soft edge in STFT cells"
                    className="h-5 w-9 rounded border border-border bg-bg-0 px-1 text-[10px] text-fg"
                    data-testid="spectral-region-feather"
                    onBlur={(e) => {
                      const feather = Math.max(0, Math.min(8, Math.round(Number(e.target.value) || 0)));
                      if (feather !== regionFeather(region)) changeRegion(region.id, (r) => ({ ...r, feather }));
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-5 shrink-0 text-fg-muted hover:text-status-error"
                  aria-label={`Delete edit ${describeRegion(region)}`}
                  data-testid="spectral-region-delete"
                  onClick={() => {
                    if (selected) setSelectedId(null);
                    void commitSpectralRegions(clipId, regionsRef.current.filter((r) => r.id !== region.id));
                  }}
                >
                  <X size={11} aria-hidden />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SpectralEditor;

