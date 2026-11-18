import React, { useEffect, useRef, useState } from "react";
import type { ScriptableTemplate } from "@openreel/core";
import { TemplateThumb } from "./TemplateThumb";

const FRAME_RATE = 10;

const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * The template modal's hero: the template's still render at rest and, while the pointer is over it or it has
 * keyboard focus, the template's own animation (the real title / graphics engines drawing its layers from intro to
 * outro over the sample scene, rendered lazily the first time and kept for the session). Reduced motion keeps the
 * still. The loop is drawn on a canvas laid over the still, so leaving the hero returns to it at once.
 */
export const TemplateHero: React.FC<{ template: ScriptableTemplate }> = ({ template }) => {
  const [active, setActive] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const target = canvas.current;
    if (!active || !target || prefersReducedMotion()) return undefined;
    const abort = new AbortController();
    const frames: OffscreenCanvas[] = [];
    let raf = 0;
    const started = performance.now();
    let shown = -1;
    const tick = (now: number) => {
      if (abort.signal.aborted) return;
      if (frames.length > 0) {
        const index = Math.floor(((now - started) / 1000) * FRAME_RATE) % frames.length;
        const frame = frames[index];
        if (index !== shown && frame) {
          if (target.width !== frame.width || target.height !== frame.height) {
            target.width = frame.width;
            target.height = frame.height;
          }
          target.getContext("2d")?.drawImage(frame, 0, 0);
          target.dataset.heroFrame = String(index);
          shown = index;
          setPlaying(true);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    void import("./template-thumbnail")
      .then((module) =>
        module.renderTemplateMotionFrames(template, (frame) => frames.push(frame), abort.signal),
      )
      .catch((error: unknown) => console.warn("[template-hero] animation unavailable:", error));
    raf = requestAnimationFrame(tick);
    return () => {
      abort.abort();
      cancelAnimationFrame(raf);
      setPlaying(false);
      delete target.dataset.heroFrame;
    };
  }, [active, template]);

  return (
    <div
      data-template-hero={template.id}
      data-hero-state={playing ? "playing" : "still"}
      tabIndex={0}
      role="group"
      aria-label={`${template.name} preview. Hover or focus to play the template animation.`}
      className="relative h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
    >
      <TemplateThumb template={template} alt={template.name} eager />
      <canvas
        ref={canvas}
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${playing ? "" : "invisible"}`}
      />
    </div>
  );
};
