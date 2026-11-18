import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  getRealtimeAudioGraph,
  planRemoveBus,
  planSetBusAutomation,
  planSetBusOutput,
  planUpdateBus,
  type AudioBus,
  type AudioRack,
} from "@openreel/core";
import { Button, Input, Popover, PopoverContent, PopoverTrigger, cn } from "@openreel/ui";
import { X } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import type { StereoSignalLevels } from "../../services/audio-mixer-meter";
import { analyzeBusLoudnessNow } from "../../services/audio-stems";
import { AudioRackSection } from "./AudioRackSection";
import { Fader, PanKnob } from "./ChannelStrip";
import { MixerLevelMeters } from "./MixerLevelMeters";
import { AutomationPointsEditor, OutputSelect, PeakHoldReadout, commitRoutingPlan } from "./routing-ui";

interface BusStripProps {
  bus: AudioBus;
  buses: readonly AudioBus[];
  levels: StereoSignalLevels;
  /** True while any bus is soloed (other buses dim). */
  anySolo: boolean;
}

const previewBusRack = (busId: string, rack: AudioRack) => {
  try {
    getRealtimeAudioGraph().setBusRack(busId, rack);
  } catch {
    /* audio unavailable */
  }
};

const lufsText = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : "−∞");

/** A submix bus strip: meter, pan, fader, effect rack, output, mute/solo, automation, loudness. */
export const BusStrip = memo(function BusStrip({ bus, buses, levels, anySolo }: BusStripProps) {
  const setAudioRack = useProjectStore((state) => state.setAudioRack);
  const rack = bus.rack;
  const [volume, setVolume] = useState(rack?.volume ?? 1);
  const [pan, setPan] = useState(rack?.pan ?? 0);
  const [name, setName] = useState(bus.name);
  const [measuring, setMeasuring] = useState(false);
  const [loudness, setLoudness] = useState<{ lufs: number; peak: number } | null>(null);

  // Follow the project after commits, undo/redo and other edits.
  useEffect(() => setVolume(rack?.volume ?? 1), [rack?.volume]);
  useEffect(() => setPan(rack?.pan ?? 0), [rack?.pan]);
  useEffect(() => setName(bus.name), [bus.name]);
  // A measurement describes the mix it was taken from; drop it once the bus or any track changes.
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const measureEpoch = useRef(0);
  useEffect(() => {
    measureEpoch.current += 1;
    setLoudness(null);
    setMeasuring(false);
  }, [bus, tracks]);

  const base = useCallback((): AudioRack => ({ ...(rack ?? {}), effects: rack?.effects ?? [] }), [rack]);
  const timeline = () => useProjectStore.getState().project.timeline;
  const dimmed = bus.muted || (anySolo && !bus.solo);

  const measure = async () => {
    const epoch = measureEpoch.current;
    setMeasuring(true);
    try {
      const analysis = await analyzeBusLoudnessNow(bus.id);
      // The mix changed while this ran: the result describes a mix that no longer exists.
      if (epoch === measureEpoch.current) setLoudness({ lufs: analysis.integrated, peak: analysis.truePeak });
    } catch (error) {
      if (epoch === measureEpoch.current) toast.error(error instanceof Error ? error.message : "Could not measure this bus.");
    } finally {
      if (epoch === measureEpoch.current) setMeasuring(false);
    }
  };

  return (
    <div
      className={cn(
        "flex w-[148px] min-w-[148px] shrink-0 flex-col items-center gap-2 rounded-lg border-t-2 bg-bg-2 p-3",
        dimmed && "opacity-60",
      )}
      style={{ borderTopColor: bus.color ?? "var(--accent)" }}
      data-testid={`bus-strip-${bus.id}`}
      data-bus-name={bus.name}
    >
      <div className="flex w-full items-center gap-1">
        <Input
          value={name}
          aria-label={`Bus name ${bus.name}`}
          data-testid={`bus-name-${bus.id}`}
          className="h-6 min-w-0 flex-1 px-1 text-xs font-medium"
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={() => {
            const next = name.trim();
            if (!next) setName(bus.name);
            else if (next !== bus.name) void commitRoutingPlan(planUpdateBus(timeline(), bus.id, { name: next }));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 shrink-0 text-fg-muted hover:text-status-error"
          aria-label={`Remove bus ${bus.name}`}
          data-testid={`bus-remove-${bus.id}`}
          onClick={() => void commitRoutingPlan(planRemoveBus(timeline(), bus.id))}
        >
          <X size={12} aria-hidden />
        </Button>
      </div>

      <MixerLevelMeters levels={levels} label={bus.name} />
      <PeakHoldReadout levels={levels} label={bus.name} testId={`bus-peak-${bus.id}`} />

      <PanKnob
        label={`${bus.name} pan control`}
        value={pan}
        onChange={(next) => {
          setPan(next);
          previewBusRack(bus.id, { ...base(), pan: next });
        }}
        onCommit={(next) => void setAudioRack(bus.id, { ...base(), pan: next })}
        disabled={dimmed}
      />
      <Fader
        label={`${bus.name} volume fader`}
        value={volume}
        onChange={(next) => {
          setVolume(next);
          previewBusRack(bus.id, { ...base(), volume: next });
        }}
        onCommit={(next) => void setAudioRack(bus.id, { ...base(), volume: next })}
        disabled={bus.muted}
      />

      <div className="flex w-full flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Output</span>
        <OutputSelect
          value={bus.output}
          buses={buses}
          busId={bus.id}
          label={bus.name}
          testId={`bus-output-${bus.id}`}
          onChange={(output) => void commitRoutingPlan(planSetBusOutput(timeline(), bus.id, output ?? null))}
        />
      </div>

      <AudioRackSection target={bus.id} label={bus.name} rack={rack} />

      <div className="flex gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Mute ${bus.name}`}
          aria-pressed={bus.muted}
          data-testid={`bus-mute-${bus.id}`}
          className={cn(
            "h-7 rounded px-2 text-xs font-bold",
            bus.muted ? "bg-status-error text-fg hover:bg-status-error/90" : "bg-border-strong text-fg-muted hover:bg-hover",
          )}
          onClick={() => void commitRoutingPlan(planUpdateBus(timeline(), bus.id, { muted: !bus.muted }))}
        >
          M
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Solo ${bus.name}`}
          aria-pressed={bus.solo}
          data-testid={`bus-solo-${bus.id}`}
          className={cn(
            "h-7 rounded px-2 text-xs font-bold",
            bus.solo ? "bg-status-warning text-bg hover:bg-status-warning/90" : "bg-border-strong text-fg-muted hover:bg-hover",
          )}
          onClick={() => void commitRoutingPlan(planUpdateBus(timeline(), bus.id, { solo: !bus.solo }))}
        >
          S
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Automate ${bus.name} volume`}
              data-testid={`bus-auto-${bus.id}`}
              className={cn(
                "h-7 rounded px-2 text-xs font-bold",
                bus.automation?.volume?.length ? "text-accent" : "bg-border-strong text-fg-muted hover:bg-hover",
              )}
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
              title={`${bus.name} volume`}
              points={bus.automation?.volume}
              baseLevel={rack?.volume ?? 1}
              max={4}
              testId={`bus-auto-editor-${bus.id}`}
              onCommit={(points) => void commitRoutingPlan(planSetBusAutomation(timeline(), bus.id, points))}
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex w-full flex-col items-stretch gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 w-full px-1 text-[11px]"
          disabled={measuring}
          aria-label={`Measure loudness of ${bus.name}`}
          data-testid={`bus-measure-${bus.id}`}
          onClick={() => void measure()}
        >
          {measuring ? "Measuring…" : "Measure LUFS"}
        </Button>
        {loudness && (
          <span className="text-center font-mono text-[10px] text-fg-muted" data-testid={`bus-lufs-${bus.id}`}>
            {lufsText(loudness.lufs)} LUFS / {lufsText(loudness.peak)} dBTP
          </span>
        )}
      </div>
    </div>
  );
});
