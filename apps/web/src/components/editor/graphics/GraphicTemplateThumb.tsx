import React, { useEffect, useRef } from "react";
import {
  expandGraphicInstance,
  graphicsEngine,
  protectedDurations,
  titleEngine,
  type GraphicInstance,
  type GraphicTemplate,
} from "@openreel/core";

const W = 320;
const H = 180;

/** Renders a template through the real title/graphics engines (the export path) at its hold pose. */
export async function renderTemplatePreview(
  canvas: HTMLCanvasElement,
  template: GraphicTemplate,
  values?: GraphicInstance["values"],
): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = W;
  canvas.height = H;
  const backdrop = ctx.createLinearGradient(0, 0, W, H);
  backdrop.addColorStop(0, "#2b3a55");
  backdrop.addColorStop(0.55, "#4b5f7e");
  backdrop.addColorStop(1, "#1d2536");
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, W, H);
  const { intro, outro } = protectedDurations(template);
  const duration = Math.max(template.duration, intro + outro + 0.5);
  const instance: GraphicInstance = {
    id: "preview",
    name: template.name,
    trackId: "preview",
    startTime: 0,
    duration,
    template,
    values: values ?? {},
  };
  const time = intro + Math.max(0.05, (duration - intro - outro) / 2);
  const expanded = expandGraphicInstance(instance, { width: W, height: H });
  for (const clip of [...expanded.shapeClips, ...expanded.svgClips]) {
    const layer = await graphicsEngine.renderGraphic(clip, time, W, H);
    ctx.drawImage(layer.canvas, 0, 0);
  }
  for (const clip of expanded.textClips) {
    const layer = titleEngine.renderText(clip, W, H, time);
    ctx.drawImage(layer.canvas, 0, 0);
  }
}

export const GraphicTemplateThumb: React.FC<{ template: GraphicTemplate; className?: string }> = ({ template, className }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    void renderTemplatePreview(canvas, template).catch(() => {
      if (cancelled || !canvas.getContext("2d")) return;
    });
    return () => {
      cancelled = true;
    };
  }, [template]);
  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      role="img"
      aria-label={`${template.name} preview`}
      className={className ?? "block w-full aspect-video rounded-[3px] bg-black/40"}
    />
  );
};
