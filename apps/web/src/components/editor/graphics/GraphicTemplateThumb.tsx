import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  expandGraphicInstance,
  GRAPHIC_TEMPLATE_CATEGORIES,
  graphicsEngine,
  protectedDurations,
  titleEngine,
  type GraphicInstance,
  type GraphicTemplate,
} from "@openreel/core";
import { displayLayoutWidth, normalizeSequencePar, squeezeOverlayToStored } from "@openreel/core/video/sequence-par";
import { useProjectStore } from "../../../stores/project-store";
import { enqueueThumbJob } from "./thumb-queue";
import { drawContain, usePlayheadBackdrop, type DrawableFrame } from "../playhead-backdrop";

const W = 320;
const H = 180;

export interface TemplatePreviewFrame {
  /** Stored frame size of the thumbnail canvas. */
  readonly width: number;
  readonly height: number;
  /** Sequence pixel aspect ratio: layers are laid out in display space and squeezed into stored pixels, as in export. */
  readonly pixelAspect: number;
}

const DEFAULT_FRAME: TemplatePreviewFrame = { width: W, height: H, pixelAspect: 1 };

/** The thumbnail frame for a sequence: 320 stored pixels wide, the sequence's stored aspect and its pixel aspect. */
export function templatePreviewFrame(
  sequence: { width: number; height: number; pixelAspectRatio?: number } | undefined,
  width: number = W,
): TemplatePreviewFrame {
  if (!sequence || !(sequence.width > 0) || !(sequence.height > 0)) {
    return width === W ? DEFAULT_FRAME : { width, height: Math.round((width * H) / W), pixelAspect: 1 };
  }
  return {
    width,
    height: Math.max(1, Math.round((width * sequence.height) / sequence.width)),
    pixelAspect: normalizeSequencePar(sequence.pixelAspectRatio),
  };
}

export interface TemplatePreviewOptions {
  /** The frame under the playhead; the slate gradient stays as the no-media fallback. */
  readonly backdrop?: DrawableFrame | null;
  /** Template time in seconds; defaults to the hold pose. */
  readonly time?: number;
}

/** Hold pose time of a template: halfway through the span between its intro and outro. */
export function templateHoldTime(template: GraphicTemplate): { time: number; duration: number; intro: number; outro: number } {
  const { intro, outro } = protectedDurations(template);
  const duration = Math.max(template.duration, intro + outro + 0.5);
  return { time: intro + Math.max(0.05, (duration - intro - outro) / 2), duration, intro, outro };
}

/** Renders a template through the real title/graphics engines (the export path); composed on the project stage. */
export async function renderTemplatePreview(
  canvas: HTMLCanvasElement,
  template: GraphicTemplate,
  values?: GraphicInstance["values"],
  frame: TemplatePreviewFrame = DEFAULT_FRAME,
  options: TemplatePreviewOptions = {},
): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: fw, height: fh, pixelAspect } = frame;
  // Artwork is composed at 2x so thin text stays crisp when scaled into the card.
  const sw = fw * 2;
  const sh = fh * 2;
  const layoutW = displayLayoutWidth(sw, pixelAspect);
  canvas.width = fw;
  canvas.height = fh;
  const hold = templateHoldTime(template);
  const instance: GraphicInstance = {
    id: "preview",
    name: template.name,
    trackId: "preview",
    startTime: 0,
    duration: hold.duration,
    template,
    values: values ?? {},
  };
  const time = options.time ?? hold.time;
  const art = document.createElement("canvas");
  art.width = sw;
  art.height = sh;
  const artCtx = art.getContext("2d");
  if (!artCtx) return;
  // Same transform as the export compositor: lay out at the display width, squeeze into stored pixels.
  const expanded = expandGraphicInstance(instance, { width: layoutW, height: sh });
  for (const clip of [...expanded.shapeClips, ...expanded.svgClips]) {
    const layer = await graphicsEngine.renderGraphic(clip, time, layoutW, sh);
    artCtx.drawImage(squeezeOverlayToStored(layer.canvas, sw, sh, pixelAspect), 0, 0, sw, sh);
  }
  for (const clip of expanded.textClips) {
    const layer = titleEngine.renderText(clip, layoutW, sh, time);
    artCtx.drawImage(squeezeOverlayToStored(layer.canvas, sw, sh, pixelAspect), 0, 0, sw, sh);
  }
  // The stage the Program monitor composes: the project frame with the footage contained and centred on black, the
  // template on top. Never cropped or zoomed, so the card is the picture "insert" would produce.
  if (options.backdrop) {
    drawContain(ctx, options.backdrop, fw, fh);
  } else {
    const backdrop = ctx.createLinearGradient(0, 0, fw, fh);
    backdrop.addColorStop(0, "#2b3a55");
    backdrop.addColorStop(0.55, "#4b5f7e");
    backdrop.addColorStop(1, "#1d2536");
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, fw, fh);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(art, 0, 0, fw, fh);
}

const formatDuration = (seconds: number): string => `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;

/** "Lower thirds · 5s": what a template is and how long it runs. */
export function templateCaption(template: GraphicTemplate): string {
  const category = GRAPHIC_TEMPLATE_CATEGORIES.find((item) => item.id === template.category)?.name ?? "Custom";
  return `${category} \u00b7 ${formatDuration(template.duration)}`;
}

export const GraphicTemplateThumb: React.FC<{ template: GraphicTemplate; className?: string; /** Full-width cards render at a higher stored width so text stays crisp. */ wide?: boolean }> = ({ template, className, wide }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = useProjectStore((state) => state.project.settings.width);
  const height = useProjectStore((state) => state.project.settings.height);
  const par = useProjectStore((state) => state.project.settings.pixelAspectRatio);
  const frame = useMemo(() => templatePreviewFrame({ width, height, pixelAspectRatio: par }, wide ? W * 1.75 : W), [width, height, par, wide]);
  const backdrop = usePlayheadBackdrop();
  // Only cards in (or just next to) the viewport render, one at a time: opening the tab stays cheap with dozens of cards.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setVisible(entry.isIntersecting);
    }, { rootMargin: "160px" });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !visible) return;
    let cancelled = false;
    void enqueueThumbJob(async () => {
      await renderTemplatePreview(canvas, template, undefined, frame, { backdrop });
      // What the pixels were composed over ("frame" = the decoded playhead frame): read by the e2e checks.
      if (!cancelled) canvas.dataset.rendered = backdrop ? (backdrop instanceof HTMLCanvasElement ? "frame" : "thumbnail") : "none";
    }, () => cancelled);
    // Hover plays the real entry animation, then settles back to the hold pose.
    const host = canvas.closest("button");
    let raf = 0;
    let running = false;
    const play = () => {
      if (running) return;
      running = true;
      const hold = templateHoldTime(template);
      const span = Math.min(hold.time + 0.3, 2.4);
      const started = performance.now();
      const step = async (now: number) => {
        if (!running || cancelled) return;
        const elapsed = (now - started) / 1000;
        const done = elapsed >= span;
        await renderTemplatePreview(canvas, template, undefined, frame, {
          backdrop,
          time: done ? hold.time : Math.min(elapsed, span),
        }).catch(() => undefined);
        if (done) running = false;
        else raf = requestAnimationFrame((t) => void step(t));
      };
      raf = requestAnimationFrame((t) => void step(t));
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
      void renderTemplatePreview(canvas, template, undefined, frame, { backdrop }).catch(() => undefined);
    };
    host?.addEventListener("mouseenter", play);
    host?.addEventListener("focus", play);
    host?.addEventListener("mouseleave", stop);
    host?.addEventListener("blur", stop);
    return () => {
      cancelled = true;
      running = false;
      cancelAnimationFrame(raf);
      host?.removeEventListener("mouseenter", play);
      host?.removeEventListener("focus", play);
      host?.removeEventListener("mouseleave", stop);
      host?.removeEventListener("blur", stop);
    };
  }, [template, frame, backdrop, visible]);
  return (
    <canvas
      ref={ref}
      width={frame.width}
      height={frame.height}
      style={{ aspectRatio: `${displayLayoutWidth(frame.width, frame.pixelAspect)} / ${frame.height}` }}
      role="img"
      aria-label={`${template.name} preview`}
      className={className ?? "block w-full rounded-[3px] bg-black/40"}
    />
  );
};
