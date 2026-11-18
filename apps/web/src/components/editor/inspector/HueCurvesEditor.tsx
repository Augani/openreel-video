import React, { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@openreel/ui";
import { RotateCcw } from "@/icons/lucide-compat";
import {
  hueCurvePointProperty,
  HUE_CURVE_INFO,
  HUE_CURVE_KINDS,
  buildHueCurveLut,
  createFlatHueCurve,
  hslToRgb,
  normalizeHueCurvePoints,
  type CurvePoint,
  type HueCurveKind,
  type HueCurvesValues,
} from "@openreel/core";

import { KeyframeButton } from "./PrimaryVideoProperties";
import type { HueCurveKeyframing } from "./useHueCurveKeyframes";

const SIZE = 200;
const PAD = 8;
const INNER = SIZE - PAD * 2;
const MIN_POINT_GAP = 0.01;

interface HueCurvesEditorProps {
  values: HueCurvesValues;
  onChange: (values: HueCurvesValues) => void;
  onReset: () => void;
  /** False on clips still using the classic order: the editor is shown but cannot edit. */
  enabled: boolean;
  onEnable: () => void;
  /** When set, each point can be keyframed (its output value over time). */
  keyframing?: HueCurveKeyframing;
}

const toSvgX = (x: number): number => PAD + x * INNER;
const toSvgY = (y: number): number => PAD + (1 - y) * INNER;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function hueBackground(): string {
  const stops: string[] = [];
  for (let i = 0; i <= 12; i++) {
    const [r, g, b] = hslToRgb(i / 12, 0.75, 0.5);
    stops.push(`rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}) ${((i / 12) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

const LUMA_BACKGROUND = "linear-gradient(to right, #000, #fff)";

function pathFor(points: CurvePoint[], periodic: boolean): string {
  const lut = buildHueCurveLut(points, periodic);
  const divisor = periodic ? lut.length : lut.length - 1;
  const steps: string[] = [];
  for (let i = 0; i < lut.length; i++) {
    steps.push(`${i === 0 ? "M" : "L"}${toSvgX(i / divisor).toFixed(2)},${toSvgY(lut[i]).toFixed(2)}`);
  }
  if (periodic) steps.push(`L${toSvgX(1).toFixed(2)},${toSvgY(lut[0]).toFixed(2)}`);
  return steps.join(" ");
}

export const HueCurvesEditor: React.FC<HueCurvesEditorProps> = ({
  values,
  onChange,
  onReset,
  enabled,
  onEnable,
  keyframing,
}) => {
  const [kind, setKind] = useState<HueCurveKind>("hueVsSat");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const info = HUE_CURVE_INFO[kind];
  const points = values[kind];
  const sorted = useMemo(() => normalizeHueCurvePoints(points), [points]);
  const background = useMemo(
    () => (info.periodic ? hueBackground() : LUMA_BACKGROUND),
    [info.periodic],
  );

  const commit = useCallback(
    (next: CurvePoint[]) => {
      onChange({ ...values, [kind]: next });
    },
    [kind, onChange, values],
  );

  const pointFromEvent = useCallback((event: { clientX: number; clientY: number }): CurvePoint => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * SIZE;
    const y = ((event.clientY - rect.top) / rect.height) * SIZE;
    return { x: clamp01((x - PAD) / INNER), y: clamp01(1 - (y - PAD) / INNER) };
  }, []);

  const handleBackgroundPointerDown = useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
      if (!enabled) return;
      const next = pointFromEvent(event);
      const base = sorted.length === 0 ? createFlatHueCurve() : sorted;
      const tooClose = base.some((p) => Math.abs(p.x - next.x) < MIN_POINT_GAP);
      if (tooClose) return;
      const updated = [...base, next].sort((a, b) => a.x - b.x);
      commit(updated);
      setDragIndex(updated.findIndex((p) => p === next));
      svgRef.current?.setPointerCapture(event.pointerId);
    },
    [commit, enabled, pointFromEvent, sorted],
  );

  const handlePointPointerDown = useCallback(
    (index: number) => (event: React.PointerEvent<SVGCircleElement>) => {
      if (!enabled) return;
      event.stopPropagation();
      setSelected(index);
      setDragIndex(index);
      svgRef.current?.setPointerCapture(event.pointerId);
    },
    [enabled],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (dragIndex === null || !enabled) return;
      const next = pointFromEvent(event);
      const updated = sorted.map((p, i) => (i === dragIndex ? next : p));
      const lower = dragIndex > 0 ? updated[dragIndex - 1].x + MIN_POINT_GAP : 0;
      const upper = dragIndex < updated.length - 1 ? updated[dragIndex + 1].x - MIN_POINT_GAP : 1;
      updated[dragIndex] = { x: Math.max(lower, Math.min(upper, next.x)), y: next.y };
      commit(updated);
    },
    [commit, dragIndex, enabled, pointFromEvent, sorted],
  );

  const endDrag = useCallback(() => setDragIndex(null), []);

  const removePoint = useCallback(
    (index: number) => {
      if (!enabled) return;
      const updated = sorted.filter((_, i) => i !== index);
      commit(updated.length === 0 ? createFlatHueCurve() : updated);
    },
    [commit, enabled, sorted],
  );

  const handlePointKey = useCallback(
    (index: number) => (event: React.KeyboardEvent<SVGCircleElement>) => {
      if (!enabled) return;
      const step = event.shiftKey ? 0.1 : 0.02;
      const updated = sorted.map((p) => ({ ...p }));
      let handled = true;
      if (event.key === "ArrowUp") updated[index].y = clamp01(updated[index].y + step);
      else if (event.key === "ArrowDown") updated[index].y = clamp01(updated[index].y - step);
      else if (event.key === "ArrowLeft") updated[index].x = clamp01(updated[index].x - step);
      else if (event.key === "ArrowRight") updated[index].x = clamp01(updated[index].x + step);
      else if (event.key === "Delete" || event.key === "Backspace") {
        removePoint(index);
        event.preventDefault();
        return;
      } else handled = false;
      if (!handled) return;
      event.preventDefault();
      commit(updated.sort((a, b) => a.x - b.x));
    },
    [commit, enabled, removePoint, sorted],
  );

  const resetCurrent = useCallback(() => commit(createFlatHueCurve()), [commit]);

  return (
    <div className="space-y-3" data-testid="hue-curves-editor">
      {!enabled && (
        <div
          role="status"
          className="rounded-[7px] border border-border bg-bg-1 p-2 text-[10px] leading-snug text-fg-2"
        >
          Hue curves are part of the Premiere-order color pipeline. This clip still uses the classic
          order, so its current look is unchanged and the curves are off.
          <Button
            type="button"
            variant="ghost"
            onClick={onEnable}
            aria-label="Switch this clip to the Premiere-order pipeline"
            className="mt-2 h-7 w-full rounded-[7px] border border-border bg-bg-2 text-[10px] font-semibold text-fg-2 hover:bg-bg-3 hover:text-fg"
          >
            Switch this clip to Premiere order
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1" role="tablist" aria-label="Hue curve type">
        {HUE_CURVE_KINDS.map((candidate) => (
          <Button
            key={candidate}
            type="button"
            role="tab"
            variant="ghost"
            aria-selected={candidate === kind}
            aria-label={HUE_CURVE_INFO[candidate].label}
            onClick={() => {
              setKind(candidate);
              setDragIndex(null);
            }}
            className={`h-7 rounded-[7px] border text-[10px] font-semibold ${
              candidate === kind
                ? "border-primary bg-primary text-white"
                : "border-border bg-bg-2 text-fg-2 hover:text-fg"
            }`}
          >
            {HUE_CURVE_INFO[candidate].label}
          </Button>
        ))}
      </div>

      <p className="text-[10px] leading-snug text-fg-3">{info.description}</p>

      <div
        className={`relative mx-auto w-full max-w-[240px] overflow-hidden rounded-[7px] border border-border ${
          enabled ? "" : "opacity-50"
        }`}
        style={{ aspectRatio: "1 / 1", background }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="absolute inset-0 h-full w-full touch-none"
          role="group"
          aria-label={`${info.label} curve`}
          data-testid={`hue-curve-svg-${kind}`}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <rect
            x={0}
            y={0}
            width={SIZE}
            height={SIZE}
            fill="rgba(0,0,0,0.35)"
            onPointerDown={handleBackgroundPointerDown}
            data-testid="hue-curve-surface"
          />
          <line x1={PAD} x2={SIZE - PAD} y1={toSvgY(0.5)} y2={toSvgY(0.5)} stroke="rgba(255,255,255,0.35)" strokeDasharray="3 3" pointerEvents="none" />
          <path d={pathFor(sorted, info.periodic)} fill="none" stroke="#fff" strokeWidth={1.6} pointerEvents="none" />
          {sorted.map((p, index) => (
            <circle
              key={`${index}-${p.x.toFixed(4)}`}
              cx={toSvgX(p.x)}
              cy={toSvgY(p.y)}
              r={5}
              fill={dragIndex === index ? "#fff" : "#111"}
              stroke={keyframing?.isAnimated(kind, index) ? "#f5b82e" : "#fff"}
              strokeWidth={keyframing?.isAnimated(kind, index) ? 2.5 : 1.5}
              onFocus={() => setSelected(index)}
              tabIndex={enabled ? 0 : -1}
              role="slider"
              aria-label={`${info.label} point ${index + 1}`}
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={Number(p.y.toFixed(3))}
              data-testid={`hue-curve-point-${index}`}
              onPointerDown={handlePointPointerDown(index)}
              onDoubleClick={() => removePoint(index)}
              onKeyDown={handlePointKey(index)}
              style={{ cursor: enabled ? "grab" : "default" }}
            />
          ))}
        </svg>
      </div>

      {keyframing && sorted.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-fg-2" data-testid="hue-curve-keyframe-row">
          <span>
            Point {Math.min(selected, sorted.length - 1) + 1} of {sorted.length}
            {keyframing.isAnimated(kind, Math.min(selected, sorted.length - 1)) ? " (animated)" : ""}
          </span>
          <KeyframeButton
            keyframes={keyframing.keyframes}
            time={keyframing.localTime}
            disabled={!enabled || !keyframing.inside}
            onChange={keyframing.setKeys}
            properties={{ [hueCurvePointProperty(kind, Math.min(selected, sorted.length - 1))]: sorted[Math.min(selected, sorted.length - 1)].y }}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-[10px] text-fg-3">
        <span>Click to add a point. Double-click or Delete removes it.</span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            onClick={resetCurrent}
            disabled={!enabled}
            aria-label={`Reset ${info.label} curve`}
            className="h-6 rounded-[7px] px-2 text-[10px] text-fg-3 hover:text-fg"
          >
            Reset curve
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onReset}
            disabled={!enabled}
            aria-label="Reset all hue curves"
            title="Reset all hue curves"
            className="h-6 w-6 rounded-[7px] text-fg-3 hover:text-fg"
          >
            <RotateCcw size={10} />
          </Button>
        </div>
      </div>
    </div>
  );
};
