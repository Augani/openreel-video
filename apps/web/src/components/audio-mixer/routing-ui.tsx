import { memo, useEffect, useRef, useState } from "react";
import {
  busOutputProblem,
  planAddSend,
  planRemoveSend,
  planSetSend,
  planSetTrackOutput,
  type AudioBus,
  type AudioSend,
  type AutomationPoint,
  type RoutingPlan,
} from "@openreel/core";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  cn,
} from "@openreel/ui";
import { Plus, X } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { toast } from "../../stores/notification-store";
import { volumeToDb, formatDb } from "./types";
import type { SignalLevel, StereoSignalLevels } from "../../services/audio-mixer-meter";

const MASTER = "master";

/** Commit a routing plan; a refused plan (e.g. a routing loop) is explained in a toast. */
export async function commitRoutingPlan(plan: RoutingPlan): Promise<boolean> {
  const result = await useProjectStore.getState().applyAudioRouting(plan);
  if (!result.success) {
    toast.error(result.error?.message ?? (plan.ok ? "Could not change the routing." : plan.message));
    return false;
  }
  return true;
}

/** Output assignment dropdown: Master or any bus (buses that would create a loop are disabled). */
export const OutputSelect = memo(function OutputSelect({
  value,
  buses,
  busId,
  label,
  testId,
  onChange,
  className,
}: {
  value: string | undefined;
  buses: readonly AudioBus[];
  /** When assigning a bus's own output: that bus (excluded, loops disabled). */
  busId?: string;
  label: string;
  testId: string;
  onChange: (output: string | undefined) => void;
  className?: string;
}) {
  const current = value && buses.some((b) => b.id === value) ? value : MASTER;
  return (
    <Select value={current} onValueChange={(next) => onChange(next === MASTER ? undefined : next)}>
      <SelectTrigger
        aria-label={`${label} output`}
        data-testid={testId}
        className={cn("h-6 w-full gap-1 px-1.5 text-[11px]", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={MASTER}>Master</SelectItem>
        {buses
          .filter((b) => b.id !== busId)
          .map((b) => {
            const problem = busId ? busOutputProblem(buses, busId, b.id) : null;
            return (
              <SelectItem key={b.id} value={b.id} disabled={!!problem} title={problem ?? undefined}>
                {b.name}
              </SelectItem>
            );
          })}
      </SelectContent>
    </Select>
  );
});

const PEAK_HOLD_MS = 1800;
const DECAY_PER_SECOND = 0.35;

/** Peak-hold readout: holds the highest peak for 1.8 s, then falls; click to reset. */
export function usePeakHold(levels: StereoSignalLevels | SignalLevel[]) {
  const held = useRef({ value: 0, at: 0, tick: 0 });
  const [, force] = useState(0);
  const peak = Math.max(0, ...levels.map((l) => l.peak));
  const now = performance.now();
  const h = held.current;
  if (peak >= h.value) {
    held.current = { value: peak, at: now, tick: now };
  } else if (now - h.at > PEAK_HOLD_MS) {
    held.current = { ...h, value: Math.max(peak, h.value - (DECAY_PER_SECOND * (now - h.tick)) / 1000), tick: now };
  } else {
    held.current = { ...h, tick: now };
  }
  return {
    peak: held.current.value,
    reset: () => {
      held.current = { value: 0, at: 0, tick: 0 };
      force((n) => n + 1);
    },
  };
}

export const PeakHoldReadout = memo(function PeakHoldReadout({
  levels,
  label,
  testId,
}: {
  levels: StereoSignalLevels;
  label: string;
  testId: string;
}) {
  const { peak, reset } = usePeakHold(levels);
  const db = volumeToDb(peak);
  const hot = peak >= 1;
  return (
    <button
      type="button"
      onClick={reset}
      title={`${label} peak hold (click to reset)`}
      aria-label={`${label} peak hold`}
      data-testid={testId}
      className={cn(
        "h-4 w-full rounded-sm bg-bg-2 text-center font-mono text-[10px] tabular-nums",
        hot ? "text-status-error" : "text-fg-muted",
      )}
    >
      {peak > 0 ? `${formatDb(db)} dB` : "-∞ dB"}
    </button>
  );
});

const toDbText = (level: number) => `${formatDb(volumeToDb(level))} dB`;

function LevelSlider({
  value,
  label,
  onCommit,
  disabled,
}: {
  value: number;
  label: string;
  onCommit: (level: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Slider
      aria-label={label}
      aria-valuetext={toDbText(draft)}
      min={0}
      max={4}
      step={0.01}
      value={[draft]}
      disabled={disabled}
      onValueChange={([next]) => setDraft(next)}
      onValueCommit={([next]) => onCommit(next)}
      className="h-3 min-w-0 flex-1 cursor-pointer [&_[data-slot=slider-track]]:h-1.5 [&_[role=slider]]:size-2.5"
    />
  );
}

/** Editable list of automation points (timeline seconds, linear level). One undo step per edit. */
export function AutomationPointsEditor({
  title,
  points,
  baseLevel,
  max,
  onCommit,
  testId,
}: {
  title: string;
  points: readonly AutomationPoint[] | undefined;
  baseLevel: number;
  max: number;
  onCommit: (points: AutomationPoint[] | null) => void;
  testId: string;
}) {
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const list = points ?? [];
  const commit = (next: AutomationPoint[]) =>
    onCommit(next.length ? [...next].sort((a, b) => a.time - b.time) : null);
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="text-xs font-semibold text-fg">{title}</div>
      {list.length === 0 && <div className="text-[11px] text-fg-muted">No automation. The level stays at its fader value.</div>}
      {list.map((point, index) => (
        <div key={`${index}-${point.time}`} className="flex items-center gap-1" data-testid={`${testId}-point-${index}`}>
          <Input
            type="number"
            step={0.1}
            min={0}
            defaultValue={Number(point.time.toFixed(3))}
            aria-label={`${title} point ${index + 1} time (s)`}
            className="h-6 w-16 px-1 text-[11px]"
            onBlur={(e) => {
              const time = Math.max(0, Number(e.currentTarget.value));
              if (Number.isFinite(time) && time !== point.time) commit(list.map((p, i) => (i === index ? { ...p, time } : p)));
            }}
          />
          <span className="text-[10px] text-fg-muted">s</span>
          <Input
            type="number"
            step={0.05}
            min={0}
            max={max}
            defaultValue={Number(point.value.toFixed(3))}
            aria-label={`${title} point ${index + 1} level`}
            className="h-6 w-16 px-1 text-[11px]"
            onBlur={(e) => {
              const value = Math.min(max, Math.max(0, Number(e.currentTarget.value)));
              if (Number.isFinite(value) && value !== point.value) commit(list.map((p, i) => (i === index ? { ...p, value } : p)));
            }}
          />
          <span className="w-12 truncate font-mono text-[10px] text-fg-muted">{toDbText(point.value)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-5 text-fg-muted hover:text-status-error"
            aria-label={`Remove ${title} point ${index + 1}`}
            onClick={() => commit(list.filter((_, i) => i !== index))}
          >
            <X size={11} aria-hidden />
          </Button>
        </div>
      ))}
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 flex-1 px-1 text-[11px]"
          data-testid={`${testId}-add`}
          onClick={() => commit([...list, { time: Number(playhead.toFixed(3)), value: list.length ? list[list.length - 1].value : baseLevel }])}
        >
          Add point at playhead
        </Button>
        {list.length > 0 && (
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onCommit(null)}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/** Send slots of one track strip: bus, pre/post, level, automation, remove, and an add menu. */
export const SendsSection = memo(function SendsSection({
  trackId,
  trackName,
  sends,
  buses,
}: {
  trackId: string;
  trackName: string;
  sends: readonly AudioSend[] | undefined;
  buses: readonly AudioBus[];
}) {
  const list = sends ?? [];
  const free = buses.filter((b) => !list.some((s) => s.busId === b.id));
  const timeline = () => useProjectStore.getState().project.timeline;
  return (
    <div className="flex w-full flex-col gap-1" role="group" aria-label={`${trackName} sends`} data-testid={`sends-${trackId}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Sends {list.length}</span>
      {list.map((send) => {
        const bus = buses.find((b) => b.id === send.busId);
        const name = bus?.name ?? "Missing bus";
        return (
          <div
            key={send.id}
            className={cn("flex flex-col gap-0.5 rounded border border-border bg-bg-1 px-1 py-0.5", send.muted && "opacity-60")}
            data-testid={`send-${trackId}-${send.id}`}
            data-bus-id={send.busId}
          >
            <div className="flex items-center gap-0.5">
              <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2" title={name}>
                {name}
              </span>
              <Button
                type="button"
                variant="ghost"
                className={cn("h-4 px-1 text-[9px] font-bold", send.preFader ? "text-status-warning" : "text-fg-muted")}
                aria-pressed={send.preFader}
                aria-label={`${send.preFader ? "Pre" : "Post"}-fader send from ${trackName} to ${name}; click to switch`}
                title={send.preFader ? "Pre-fader (ignores the track fader)" : "Post-fader (follows the track fader)"}
                onClick={() => void commitRoutingPlan(planSetSend(timeline(), trackId, send.id, { preFader: !send.preFader }))}
              >
                {send.preFader ? "PRE" : "POST"}
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn("h-4 px-1 text-[9px] font-bold", send.automation?.length ? "text-accent" : "text-fg-muted")}
                    aria-label={`Automate send from ${trackName} to ${name}`}
                    data-testid={`send-auto-${trackId}-${send.id}`}
                  >
                    A
                  </Button>
                </PopoverTrigger>
                <PopoverContent
            side="right"
            align="start"
            className="w-72"
            // Committing a point re-renders the strip and the mixer dialog's focus scope grabs focus back;
            // that must not dismiss the editor mid-edit (outside clicks and Escape still do).
            onFocusOutside={(event) => event.preventDefault()}
          >
                  <AutomationPointsEditor
                    title={`${trackName} → ${name} send level`}
                    points={send.automation}
                    baseLevel={send.level}
                    max={4}
                    testId={`send-auto-editor-${send.id}`}
                    onCommit={(points) => void commitRoutingPlan(planSetSend(timeline(), trackId, send.id, { automation: points }))}
                  />
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-4 text-fg-muted hover:text-status-error"
                aria-label={`Remove send from ${trackName} to ${name}`}
                onClick={() => void commitRoutingPlan(planRemoveSend(timeline(), trackId, send.id))}
              >
                <X size={10} aria-hidden />
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <LevelSlider
                value={send.level}
                label={`Send level ${trackName} to ${name}`}
                onCommit={(level) => void commitRoutingPlan(planSetSend(timeline(), trackId, send.id, { level }))}
              />
              <span className="w-11 shrink-0 text-right font-mono text-[10px] text-fg-muted">{toDbText(send.level)}</span>
            </div>
          </div>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 w-full gap-1 px-1 text-[11px]"
            disabled={free.length === 0}
            aria-label={`Add send to ${trackName}`}
            title={buses.length === 0 ? "Add a bus first" : free.length === 0 ? "Already sending to every bus" : undefined}
            data-testid={`add-send-${trackId}`}
          >
            <Plus size={11} aria-hidden />
            Add send
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {free.map((bus) => (
            <DropdownMenuItem
              key={bus.id}
              data-testid={`add-send-${trackId}-${bus.id}`}
              onSelect={() => void commitRoutingPlan(planAddSend(timeline(), trackId, bus.id))}
            >
              {bus.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

export const assignTrackOutput = (trackId: string, output: string | undefined) =>
  commitRoutingPlan(planSetTrackOutput(useProjectStore.getState().project.timeline, trackId, output ?? null));
