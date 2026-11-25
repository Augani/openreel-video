import React, { useCallback, useEffect, useRef, useState } from "react";
import { PanelTop, X } from "@/icons/lucide-compat";
import { Button, Tabs, TabsList, TabsTrigger } from "@openreel/ui";
import {
  NIT_GRATICULE,
  hlsVectorscopePoint,
  nitsToSignal,
  type ScopeLevelScale,
} from "@openreel/core/video/scopes-extra";
import { getHdrScopeFrame } from "@openreel/core/video/hdr-scope-feed";
import { sequenceScopeScale } from "@openreel/core/color/sequence-color";
import {
  SKIN_TONE_ANGLE_DEG,
  VECTORSCOPE_TARGETS,
  vectorscopePoint,
} from "@openreel/core/video/scopes";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useColorMonitorStore } from "../../../stores/color-monitor-store";
import { useProjectStore } from "../../../stores/project-store";
import { getPreviewCanvas } from "./preview-canvas-registry";
import {
  frameHasContent,
  renderScope,
  scopeDimensions,
  SCOPE_ANALYSIS_WIDTH,
  type ScopeKind,
  type ScopeRaster,
} from "./scope-render";
import type { ScopesWorkerRequest } from "../../../workers/scopes.worker";

/** `name` is the accessible name when the short tab label is not descriptive enough. */
const TABS: ReadonlyArray<{ id: ScopeKind; label: string; name?: string }> = [
  { id: "waveform", label: "Luma" },
  { id: "parade", label: "RGB", name: "RGB Parade" },
  { id: "yc", label: "YC" },
  { id: "vectorscope", label: "Vector" },
  { id: "hls", label: "HLS" },
  { id: "histogram", label: "Histogram" },
];

/** ~9 fps while playing. */
const PLAYING_INTERVAL_MS = 110;
/** Safety refresh while paused (late decodes); seeks/edits refresh on their own. */
const PAUSED_INTERVAL_MS = 1000;
/** Re-sample after a seek or edit: once soon, once after async frame decode. */
const SETTLE_DELAYS_MS = [80, 300] as const;

const MIN_WIDTH = 220;
const DEFAULT_WIDTH = 340;
const DOCK_INSET = 12;

interface FloatingLayout {
  x: number;
  y: number;
  width: number;
}

/** Remembered across hide/show so the panel reopens where it was left. */
let rememberedLayout: FloatingLayout | null = null;

function drawGraticule(
  canvas: HTMLCanvasElement,
  kind: ScopeKind,
  width: number,
  height: number,
  scale: ScopeLevelScale = "ire",
  /** HDR sequences: the scope is fed PQ-encoded values, so marks sit at their PQ positions whatever label set is used. */
  labelSet?: "pq" | "hlg",
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.55)";

  if (kind === "waveform" || kind === "parade" || kind === "yc") {
    // 0 / 25 / 50 / 75 / 100 % (IRE style), or nit marks on an HDR scale
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    const marks: Array<{ frac: number; label: string }> =
      scale === "ire"
        ? [0, 25, 50, 75, 100].map((pct) => ({
            frac: pct / 100,
            label: String(pct),
          }))
        : NIT_GRATICULE[labelSet ?? scale].map((nits) => ({
            frac: nitsToSignal(nits, scale),
            label: nits === 203 ? "203 ref" : `${nits} nit`,
          }));
    for (const mark of marks) {
      const y = Math.round(height - 1 - mark.frac * (height - 1)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillText(mark.label, 2, Math.min(height - 2, Math.max(9, y - 2)));
    }
    if (kind === "parade") {
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      for (const i of [1, 2]) {
        const x = Math.round((width / 3) * i) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }
    return;
  }

  if (kind === "hls") {
    const c = width / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    for (const r of [0.25, 0.5, 0.75, 1]) {
      ctx.beginPath();
      ctx.arc(c, c, (c - 1) * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, c);
    ctx.lineTo(width, c);
    ctx.moveTo(c, 0);
    ctx.lineTo(c, height);
    ctx.stroke();
    const hues: Array<[string, readonly [number, number, number]]> = [
      ["R", [255, 0, 0]],
      ["Yl", [255, 255, 0]],
      ["G", [0, 255, 0]],
      ["Cy", [0, 255, 255]],
      ["B", [0, 0, 255]],
      ["Mg", [255, 0, 255]],
    ];
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    for (const [label, rgb] of hues) {
      const p = hlsVectorscopePoint(rgb, width);
      ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
      ctx.fillText(label, p.x + 6, p.y - 5);
    }
    return;
  }

  if (kind === "vectorscope") {
    const c = width / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    for (const r of [0.25, 0.5, 0.75, 1]) {
      ctx.beginPath();
      ctx.arc(c, c, (c - 1) * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, c);
    ctx.lineTo(width, c);
    ctx.moveTo(c, 0);
    ctx.lineTo(c, height);
    ctx.stroke();

    // Skin-tone (I) line
    const a = (SKIN_TONE_ANGLE_DEG * Math.PI) / 180;
    ctx.strokeStyle = "rgba(255,190,120,0.85)";
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * (c - 1), c - Math.sin(a) * (c - 1));
    ctx.stroke();

    // 75% colour-bar target boxes
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    const box = 10;
    for (const t of VECTORSCOPE_TARGETS) {
      const p = vectorscopePoint(t.rgb, width);
      ctx.strokeRect(p.x - box / 2, p.y - box / 2, box, box);
      ctx.fillText(t.label, p.x + box / 2 + 1, p.y - box / 2);
    }
    return;
  }

  // histogram: quarter-tone ticks
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  for (const f of [0.25, 0.5, 0.75]) {
    const x = Math.round(width * f) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

/**
 * Reads the program canvas at analysis resolution. Returns null when the
 * canvas is unavailable. `empty` flags a fully transparent read-back; the
 * caller tolerates one such read (a transient clear before an async redraw) but
 * then shows the real, blank frame rather than a stale scope.
 */
function grabFrame(
  scratch: HTMLCanvasElement,
  hdrSequence = false,
): { data: ImageData; width: number; height: number; empty: boolean } | null {
  if (hdrSequence) {
    // HDR sequence: the scope reads the PQ-encoded float image (nits), not the tone-mapped SDR monitor. Until the
    // engine has completed an HDR frame, show nothing rather than a misleading SDR trace under a nit scale.
    const feed = getHdrScopeFrame();
    if (!feed) return null;
    return { data: new ImageData(new Uint8ClampedArray(feed.data), feed.width, feed.height), width: feed.width, height: feed.height, empty: false };
  }
  const src = getPreviewCanvas();
  if (!src || src.width === 0 || src.height === 0) return null;
  // Never upscale a small preview: analyse at the canvas width up to the scope width.
  const w = Math.min(SCOPE_ANALYSIS_WIDTH, src.width);
  const h = Math.max(1, Math.round((src.height / src.width) * w));
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return { data, width: w, height: h, empty: !frameHasContent(data.data) };
  } catch {
    return null;
  }
}

export const ScopesPanel: React.FC = () => {
  const visible = useUIStore((s) => s.scopesVisible);
  // Mount the heavy part only while visible: hidden means no worker, no timers
  // and no store subscriptions.
  return visible ? <ScopesPanelBody /> : null;
};

const ScopesPanelBody: React.FC = () => {
  const kind = useUIStore((s) => s.scopesKind);
  const setKind = useUIStore((s) => s.setScopesKind);
  const setVisible = useUIStore((s) => s.setScopesVisible);
  const userScale = useUIStore((s) => s.scopesScale);
  const hdrScale = useProjectStore((s) => sequenceScopeScale(s.project.settings));
  const hdrSequence = hdrScale !== "ire";
  // HDR sequences measure in PQ nits (positions); HLG sequences label the marks with the HLG set.
  const scale = hdrSequence ? "pq" : userScale;
  const hdrLabelSet = hdrSequence ? (hdrScale === "hlg" ? "hlg" : "pq") : undefined;
  const hdrSequenceRef = useRef(hdrSequence);
  hdrSequenceRef.current = hdrSequence;
  const setScale = useUIStore((s) => s.setScopesScale);
  const falseColor = useColorMonitorStore((s) => s.falseColor);
  const setFalseColor = useColorMonitorStore((s) => s.setFalseColor);
  const isPlaying = useTimelineStore((s) => s.playbackState === "playing");
  // ACES mode: the Program monitor shows the output transform (RRT + ODT), and the scopes measure that picture.
  const acesOutput = useProjectStore((s) => (s.project.settings.colorManagement === "aces" ? (s.project.settings.acesOutput ?? "srgb") : null));
  const ocioView = useProjectStore((s) => (s.project.settings.colorManagement === "ocio" && s.project.settings.ocio ? `${s.project.settings.ocio.display} / ${s.project.settings.ocio.view}` : null));

  const rootRef = useRef<HTMLDivElement>(null);
  const scopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const graticuleRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const busyRef = useRef(false);
  const requestId = useRef(0);
  const emptyReads = useRef(0);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const dims = scopeDimensions(kind);
  const [layout, setLayout] = useState<FloatingLayout | null>(
    rememberedLayout,
  );

  const present = useCallback((raster: ScopeRaster) => {
    if (raster.kind !== kindRef.current) return;
    const canvas = scopeCanvasRef.current;
    if (!canvas) return;
    if (canvas.width !== raster.width || canvas.height !== raster.height) {
      canvas.width = raster.width;
      canvas.height = raster.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pixels = new Uint8ClampedArray(raster.pixels);
    ctx.putImageData(new ImageData(pixels, raster.width, raster.height), 0, 0);
  }, []);

  // Worker lifecycle: only exists while the panel is mounted (visible).
  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(
        new URL("../../../workers/scopes.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (
        e: MessageEvent<{ id: number; raster: ScopeRaster }>,
      ) => {
        if (e.data.id !== requestId.current) return;
        busyRef.current = false;
        present(e.data.raster);
      };
      worker.onerror = () => {
        busyRef.current = false;
        worker?.terminate();
        workerRef.current = null;
      };
    } catch {
      worker = null;
    }
    workerRef.current = worker;
    return () => {
      worker?.terminate();
      workerRef.current = null;
      busyRef.current = false;
      scratchRef.current = null;
    };
  }, [present]);

  const sample = useCallback(() => {
    if (busyRef.current) return;
    if (!scratchRef.current)
      scratchRef.current = document.createElement("canvas");
    const frame = grabFrame(scratchRef.current, hdrSequenceRef.current);
    if (!frame) return;
    if (frame.empty) {
      // Tolerate a single transient clear; a persistent one is a real blank frame.
      emptyReads.current += 1;
      if (emptyReads.current < 2) return;
    } else {
      emptyReads.current = 0;
    }
    const id = ++requestId.current;
    const worker = workerRef.current;
    if (worker) {
      busyRef.current = true;
      const buffer = frame.data.data.buffer as ArrayBuffer;
      const msg: ScopesWorkerRequest = {
        id,
        kind: kindRef.current,
        width: frame.width,
        height: frame.height,
        buffer,
      };
      worker.postMessage(msg, [buffer]);
    } else {
      // Fallback: small typed-array loops on the main thread (256px frame).
      present(renderScope(kindRef.current, frame.data));
    }
  }, [present]);

  // Interval sampling: fast while playing, slow safety net while paused.
  useEffect(() => {
    // A scope-type change supersedes any in-flight request of the old type.
    busyRef.current = false;
    sample();
    const timer = window.setInterval(
      sample,
      isPlaying ? PLAYING_INTERVAL_MS : PAUSED_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [isPlaying, kind, sample]);

  // Paused: refresh on seek and on project edits (grade tweaks). Subscribed
  // outside React so playhead ticks never re-render this component.
  useEffect(() => {
    if (isPlaying) return;
    let timers: number[] = [];
    const settle = () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers = SETTLE_DELAYS_MS.map((d) => window.setTimeout(sample, d));
    };
    const unsubPlayhead = useTimelineStore.subscribe((s, prev) => {
      if (s.playheadPosition !== prev.playheadPosition) settle();
    });
    const unsubProject = useProjectStore.subscribe((s, prev) => {
      if (s.project !== prev.project) settle();
    });
    return () => {
      unsubPlayhead();
      unsubProject();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [isPlaying, sample]);

  useEffect(() => {
    if (!graticuleRef.current) return;
    drawGraticule(graticuleRef.current, kind, dims.width, dims.height, scale, hdrLabelSet);
    // Resizing clears the trace of the previous scope type straight away.
    const trace = scopeCanvasRef.current;
    if (trace && (trace.width !== dims.width || trace.height !== dims.height)) {
      trace.width = dims.width;
      trace.height = dims.height;
    }
  }, [kind, scale, hdrLabelSet, dims.width, dims.height]);

  // Tear down an in-progress drag/resize if the panel unmounts mid-gesture.
  // Keep a floating panel reachable when the preview area is smaller than when
  // it was placed (window resize, layout change, reopening after a resize).
  useEffect(() => {
    const parent = rootRef.current?.offsetParent as HTMLElement | null;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const clamp = () => {
      const root = rootRef.current;
      if (!root || !rememberedLayout) return;
      const pw = parent.clientWidth;
      const ph = parent.clientHeight;
      if (pw === 0 || ph === 0) return;
      const l = rememberedLayout;
      const width = Math.min(l.width, Math.max(MIN_WIDTH, pw));
      const x = Math.min(Math.max(0, l.x), Math.max(0, pw - width));
      const y = Math.min(Math.max(0, l.y), Math.max(0, ph - root.offsetHeight));
      if (x !== l.x || y !== l.y || width !== l.width) {
        rememberedLayout = { x, y, width };
        setLayout(rememberedLayout);
      }
    };
    const ro = new ResizeObserver(clamp);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  const gestureCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => gestureCleanup.current?.(), []);

  const commitLayout = useCallback((next: FloatingLayout | null) => {
    rememberedLayout = next;
    setLayout(next);
  }, []);

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, [role=tab]")) return;
    const root = rootRef.current;
    const parent = root?.offsetParent as HTMLElement | null;
    if (!root || !parent) return;
    e.preventDefault();
    const pr = parent.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = {
      x: rr.left - pr.left,
      y: rr.top - pr.top,
      width: rr.width,
    };
    const move = (ev: PointerEvent) => {
      const width = origin.width;
      const x = Math.min(
        Math.max(0, origin.x + ev.clientX - startX),
        Math.max(0, pr.width - width),
      );
      const y = Math.min(
        Math.max(0, origin.y + ev.clientY - startY),
        Math.max(0, pr.height - rr.height),
      );
      commitLayout({ x, y, width });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      gestureCleanup.current = null;
    };
    gestureCleanup.current?.();
    gestureCleanup.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const beginResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    const parent = root?.offsetParent as HTMLElement | null;
    if (!root || !parent) return;
    e.preventDefault();
    e.stopPropagation();
    const pr = parent.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const startX = e.clientX;
    const origin = { x: rr.left - pr.left, y: rr.top - pr.top, width: rr.width };
    const move = (ev: PointerEvent) => {
      const maxWidth = Math.max(MIN_WIDTH, pr.width - origin.x);
      const width = Math.min(
        maxWidth,
        Math.max(MIN_WIDTH, origin.width + ev.clientX - startX),
      );
      commitLayout({ x: origin.x, y: origin.y, width });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      gestureCleanup.current = null;
    };
    gestureCleanup.current?.();
    gestureCleanup.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const aspect =
    kind === "vectorscope" || kind === "hls"
      ? "1 / 1"
      : kind === "histogram"
        ? "2 / 1"
        : "2 / 1";
  const isWaveform = kind === "waveform" || kind === "parade" || kind === "yc";
  const docked = layout === null;

  return (
    <div
      ref={rootRef}
      data-testid="scopes-panel"
      data-docked={docked}
      className="absolute z-30 rounded-[10px] border border-border bg-bg-elev/95 shadow-md backdrop-blur-sm"
      style={
        layout
          ? { left: layout.x, top: layout.y, width: layout.width }
          : { right: DOCK_INSET, top: DOCK_INSET, width: DEFAULT_WIDTH }
      }
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="flex cursor-move touch-none items-center gap-1 px-2 pt-2"
        onPointerDown={beginDrag}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button, [role=tab]")) return;
          commitLayout(null);
        }}
        title="Drag to move, double-click to dock"
      >
        <Tabs
          value={kind}
          onValueChange={(v) => setKind(v as ScopeKind)}
          className="flex-1"
        >
          <TabsList
            aria-label="Scope type"
            className="h-7 w-full justify-start gap-0.5 bg-transparent p-0"
          >
            {TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                aria-label={`${t.name ?? t.label} scope`}
                className="h-6 rounded-[6px] px-2 py-0 text-[11px] font-medium text-fg-2 data-[state=active]:text-accent"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dock scopes"
          title="Dock to top-right"
          disabled={docked}
          onClick={() => commitLayout(null)}
          className="h-6 w-6 rounded-[6px] text-fg-2 hover:bg-bg-2 hover:text-fg"
        >
          <PanelTop size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close scopes"
          title="Close scopes (Shift+S)"
          onClick={() => setVisible(false)}
          className="h-6 w-6 rounded-[6px] text-fg-2 hover:bg-bg-2 hover:text-fg"
        >
          <X size={12} />
        </Button>
      </div>
      <div className="flex items-center gap-1 px-2 pt-1">
        <Button
          variant={falseColor ? "secondary" : "ghost"}
          size="sm"
          aria-label="False colour"
          aria-pressed={falseColor}
          title="False colour exposure overlay on the Program monitor"
          onClick={() => setFalseColor(!falseColor)}
          className="h-6 rounded-[6px] px-2 text-[10px]"
        >
          False colour
        </Button>
        {acesOutput ? (
          <span
            data-testid="scopes-aces-label"
            title="ACES color management is on: the scopes read the Program monitor, which shows the ACES output transform, so they measure display-referred output code values."
            className="rounded-[6px] bg-bg-2 px-1.5 py-0.5 text-[10px] text-fg-2"
          >
            ACES output · {acesOutput === "rec709" ? "Rec.709" : "sRGB"}
          </span>
        ) : null}
        {ocioView ? (
          <span
            data-testid="scopes-ocio-label"
            title="OpenColorIO is on: the scopes read the Program monitor, which shows the config's display and view, so they measure display-referred output code values."
            className="rounded-[6px] bg-bg-2 px-1.5 py-0.5 text-[10px] text-fg-2"
          >
            OCIO output · {ocioView}
          </span>
        ) : null}
        {isWaveform && hdrSequence ? (
          <span
            data-testid="scopes-hdr-scale"
            title="HDR sequence: the scope reads the float image PQ-encoded, so levels are absolute nits (203 = reference white)."
            className="rounded-[6px] bg-bg-2 px-1.5 py-0.5 text-[10px] text-fg-2"
          >
            {hdrScale === "hlg" ? "HLG sequence" : "PQ sequence"} · nits
          </span>
        ) : isWaveform ? (
          <select
            aria-label="Waveform scale"
            value={scale}
            onChange={(e) => setScale(e.target.value as ScopeLevelScale)}
            className="h-6 rounded-[6px] border border-border bg-bg-1 px-1 text-[10px] text-fg"
          >
            <option value="ire">IRE %</option>
            <option value="pq">PQ nits</option>
            <option value="hlg">HLG nits</option>
          </select>
        ) : null}
      </div>
      <div className="p-2">
        <div
          className="relative w-full overflow-hidden rounded-[6px] bg-black"
          style={{ aspectRatio: aspect }}
        >
          <canvas
            ref={scopeCanvasRef}
            width={dims.width}
            height={dims.height}
            className="absolute inset-0 h-full w-full"
          />
          <canvas
            ref={graticuleRef}
            width={dims.width}
            height={dims.height}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
        </div>
      </div>
      <div
        role="separator"
        aria-label="Resize scopes"
        onPointerDown={beginResize}
        className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize touch-none"
      />
    </div>
  );
};
