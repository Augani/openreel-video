import React, { useCallback, useRef } from "react";
import { Button, Slider, cn } from "@openreel/ui";
import {
  DEFAULT_SURROUND_PAN,
  SURROUND_CHANNEL_NAMES,
  sanitizeSurroundPan,
  surroundPanGains,
  type SurroundPan,
} from "@openreel/core";

interface SurroundPannerProps {
  /** Accessible name, e.g. "Dialogue surround pan". */
  label: string;
  pan: SurroundPan;
  onChange: (pan: SurroundPan) => void;
  /** Present when the value can be cleared (a clip falling back to its track). */
  onReset?: () => void;
  testId: string;
  /** Shown beside the title: where the value comes from ("Track", "Clip"). */
  source?: string;
  disabled?: boolean;
  className?: string;
}

const SLIDER_CLASS =
  "h-2 w-full cursor-pointer data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-border-strong [&_[data-slot=slider-range]]:bg-accent/60 [&_[role=slider]]:size-3 [&_[role=slider]]:bg-accent";

const PAD = 100;
const MARGIN = 10;
const SPAN = PAD - MARGIN * 2;

/** x -1..1 -> pad x; y -1 (rear)..1 (front) -> pad y (front at the top). */
const toPad = (pan: SurroundPan) => ({ cx: MARGIN + ((pan.x + 1) / 2) * SPAN, cy: MARGIN + ((1 - pan.y) / 2) * SPAN });

const SPEAKERS: readonly { name: string; x: number; y: number }[] = [
  { name: "L", x: 0, y: 0 },
  { name: "C", x: 0.5, y: 0 },
  { name: "R", x: 1, y: 0 },
  { name: "Ls", x: 0, y: 1 },
  { name: "Rs", x: 1, y: 1 },
];

export const formatSurroundPosition = (pan: SurroundPan): string => {
  const side = Math.abs(pan.x) < 0.05 ? "C" : pan.x < 0 ? `L${Math.round(-pan.x * 100)}` : `R${Math.round(pan.x * 100)}`;
  const depth = Math.abs(pan.y - 1) < 0.05 ? "Front" : Math.abs(pan.y + 1) < 0.05 ? "Rear" : `F${Math.round(((pan.y + 1) / 2) * 100)}`;
  return `${side} · ${depth}`;
};

/**
 * 5.1 surround panner: drag the puck around the room (x: left/right, y: rear/front),
 * with divergence (how much of the front image is pulled into the centre speaker)
 * and the LFE send. The six bars show the level each speaker receives.
 */
export const SurroundPanner: React.FC<SurroundPannerProps> = ({ label, pan, onChange, onReset, testId, source, disabled, className }) => {
  const padRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const current = sanitizeSurroundPan(pan);
  const gains = surroundPanGains(current);
  const { cx, cy } = toPad(current);

  const moveTo = useCallback(
    (clientX: number, clientY: number) => {
      const rect = padRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const px = ((clientX - rect.left) / rect.width) * PAD;
      const py = ((clientY - rect.top) / rect.height) * PAD;
      onChange(
        sanitizeSurroundPan({
          ...current,
          x: Math.round(((px - MARGIN) / SPAN) * 2 * 100 - 100) / 100,
          y: Math.round((1 - ((py - MARGIN) / SPAN) * 2) * 100) / 100,
        }),
      );
    },
    [current, onChange],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    const step = event.shiftKey ? 0.25 : 0.05;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = delta[event.key];
    if (move) {
      event.preventDefault();
      onChange(sanitizeSurroundPan({ ...current, x: current.x + move[0], y: current.y + move[1] }));
    } else if (event.key === "Home" || event.key === "0") {
      event.preventDefault();
      onChange(sanitizeSurroundPan({ ...current, x: 0, y: 1 }));
    }
  };

  return (
    <div className={cn("flex w-full flex-col items-center gap-1.5", className)} data-testid={testId} role="group" aria-label={label}>
      <div className="flex w-full items-center justify-between gap-1 text-[10px] text-fg-muted">
        <span className="font-semibold uppercase tracking-wide">Surround{source ? ` · ${source}` : ""}</span>
        <span className="font-mono" data-testid={`${testId}-position`}>{formatSurroundPosition(current)}</span>
      </div>
      <svg
        ref={padRef}
        viewBox={`0 0 ${PAD} ${PAD}`}
        className={cn("aspect-square w-full max-w-[120px] touch-none rounded bg-bg-1 ring-1 ring-border", disabled ? "opacity-50" : "cursor-crosshair")}
        data-testid={`${testId}-pad`}
        onPointerDown={(event) => {
          if (disabled) return;
          dragging.current = true;
          (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
          moveTo(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (dragging.current) moveTo(event.clientX, event.clientY);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <rect x={MARGIN} y={MARGIN} width={SPAN} height={SPAN} rx={6} className="fill-none stroke-border-strong" strokeDasharray="2 2" />
        {SPEAKERS.map((speaker) => (
          <g key={speaker.name}>
            <circle cx={MARGIN + speaker.x * SPAN} cy={MARGIN + speaker.y * SPAN} r={4.5} className="fill-border-strong" />
            <text x={MARGIN + speaker.x * SPAN} y={MARGIN + speaker.y * SPAN + 1.6} textAnchor="middle" fontSize={4.5} className="fill-fg-muted">
              {speaker.name}
            </text>
          </g>
        ))}
        <circle
          cx={cx}
          cy={cy}
          r={6}
          tabIndex={disabled ? -1 : 0}
          role="slider"
          aria-label={`${label} position`}
          aria-valuetext={formatSurroundPosition(current)}
          aria-valuemin={-1}
          aria-valuemax={1}
          aria-valuenow={current.x}
          data-testid={`${testId}-puck`}
          data-x={current.x}
          data-y={current.y}
          className="fill-accent stroke-bg-1 outline-none focus-visible:stroke-fg"
          strokeWidth={1.5}
          onKeyDown={onKeyDown}
        />
      </svg>
      <div className="grid w-full grid-cols-6 gap-0.5" aria-hidden data-testid={`${testId}-gains`}>
        {SURROUND_CHANNEL_NAMES.map((name, index) => (
          <div key={name} className="flex flex-col items-center gap-0.5">
            <div className="flex h-8 w-2 items-end rounded-sm bg-bg-1">
              <div className="w-full rounded-sm bg-accent" style={{ height: `${Math.round(Math.min(1, gains[index]) * 100)}%` }} data-testid={`${testId}-gain-${name}`} data-gain={gains[index].toFixed(3)} />
            </div>
            <span className="text-[8px] text-fg-muted">{name}</span>
          </div>
        ))}
      </div>
      <div className="flex w-full flex-col gap-1">
        <label className="flex items-center justify-between text-[10px] text-fg-muted">
          <span>Divergence</span>
          <span className="font-mono">{Math.round(current.divergence * 100)}%</span>
        </label>
        <Slider
          aria-label={`${label} divergence`}
          min={0}
          max={1}
          step={0.01}
          value={[current.divergence]}
          disabled={disabled}
          onValueChange={([next]) => onChange(sanitizeSurroundPan({ ...current, divergence: next }))}
          className={SLIDER_CLASS}
        />
        <label className="flex items-center justify-between text-[10px] text-fg-muted">
          <span>LFE send</span>
          <span className="font-mono">{Math.round(current.lfeSend * 100)}%</span>
        </label>
        <Slider
          aria-label={`${label} LFE send`}
          min={0}
          max={1}
          step={0.01}
          value={[current.lfeSend]}
          disabled={disabled}
          onValueChange={([next]) => onChange(sanitizeSurroundPan({ ...current, lfeSend: next }))}
          className={SLIDER_CLASS}
        />
      </div>
      {onReset && (
        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px]" disabled={disabled} onClick={onReset} data-testid={`${testId}-reset`}>
          {source ? "Follow track" : "Reset"}
        </Button>
      )}
    </div>
  );
};

export { DEFAULT_SURROUND_PAN };
