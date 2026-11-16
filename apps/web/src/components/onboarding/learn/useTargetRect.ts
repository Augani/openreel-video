import { useEffect, useState } from "react";

export interface TargetRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function sameRect(a: TargetRect | null, b: TargetRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function measure(el: Element): TargetRect {
  const r = el.getBoundingClientRect();
  return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
}

/** How often to look again for a target that is not mounted yet (a panel the user has not opened). */
const RETRY_MS = 500;

/**
 * Tracks the rectangle of the element matching `selector`. Unlike the passive tour (100ms polling), it
 * observes the element with a ResizeObserver and window resize/scroll, and only polls (slowly) while the
 * target does not exist yet. Returns null when there is no such element.
 */
export function useTargetRect(selector: string | null): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    let el: Element | null = null;
    let observer: ResizeObserver | null = null;
    let retry: ReturnType<typeof setInterval> | null = null;
    let frame = 0;

    const update = () => {
      frame = 0;
      const next = el && el.isConnected ? measure(el) : null;
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    const attach = () => {
      const found = document.querySelector(selector);
      if (!found) {
        if (el) {
          observer?.disconnect();
          el = null;
          update();
        }
        return false;
      }
      if (found !== el) {
        observer?.disconnect();
        el = found;
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(schedule);
          observer.observe(el);
        }
        update();
      }
      return true;
    };

    attach();
    // A mounted target is observed, but it can still be replaced; the slow check covers both cases cheaply.
    retry = setInterval(attach, RETRY_MS);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    return () => {
      if (retry) clearInterval(retry);
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [selector]);

  return rect;
}
