import type React from "react";
import { useCallback, useRef, useState } from "react";

export function clampSize(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface ResizableValue {
  value: number;
  setValue(v: number): void;
  onHandlePointerDown(e: React.PointerEvent): void;
}

export interface ResizableOptions {
  initial: number;
  min: number;
  max: number;
  axis: "x" | "y";
  direction: 1 | -1;
  storageKey?: string;
}

function readInitial(opts: ResizableOptions): number {
  if (!opts.storageKey || typeof window === "undefined") {
    return clampSize(opts.initial, opts.min, opts.max);
  }
  try {
    const raw = window.localStorage.getItem(opts.storageKey);
    if (raw === null) return clampSize(opts.initial, opts.min, opts.max);
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return clampSize(opts.initial, opts.min, opts.max);
    return clampSize(parsed, opts.min, opts.max);
  } catch {
    return clampSize(opts.initial, opts.min, opts.max);
  }
}

function persist(storageKey: string | undefined, value: number): void {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    return;
  }
}

export function useResizable(opts: ResizableOptions): ResizableValue {
  const [value, setValue] = useState<number>(() => readInitial(opts));

  const valueRef = useRef<number>(value);
  valueRef.current = value;

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent): void => {
      e.preventDefault();
      const target = e.currentTarget;
      const pointerId = e.pointerId;
      const startCoord = opts.axis === "x" ? e.clientX : e.clientY;
      const startValue = valueRef.current;
      let nextValue = startValue;

      try {
        target.setPointerCapture(pointerId);
      } catch {
        return;
      }

      const onMove = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return;
        const coord = opts.axis === "x" ? ev.clientX : ev.clientY;
        const delta = (coord - startCoord) * opts.direction;
        nextValue = clampSize(startValue + delta, opts.min, opts.max);
        valueRef.current = nextValue;
        setValue(nextValue);
      };

      const onUp = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* capture already released */
        }
        persist(opts.storageKey, nextValue);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [opts.axis, opts.direction, opts.min, opts.max, opts.storageKey],
  );

  return { value, setValue, onHandlePointerDown };
}
