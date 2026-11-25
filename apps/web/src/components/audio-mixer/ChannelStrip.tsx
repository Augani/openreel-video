import React, { memo, useCallback, useMemo } from "react";
import type { ChannelStripState } from "./types";
import { volumeToDb, formatDb, formatPan } from "./types";
import { Button, Slider, cn } from "@openreel/ui";
import { Film, Music } from "@/icons/lucide-compat";

import {
  isTrackSoloSuppressed,
  resolveSurroundPan,
  TRACK_AUTOMATION_MODES,
  TRACK_AUTOMATION_MODE_LABELS,
  type AudioBus,
  type TrackAutomationMode,
} from "@openreel/core";
import { useAutomationRecording } from "../../services/automation-recorder";
import { useProjectStore } from "../../stores/project-store";
import { SurroundPanner } from "./SurroundPanner";
import { setSurroundPan } from "../../services/surround-audio";
import { MixerLevelMeters } from "./MixerLevelMeters";
import { OutputSelect, PeakHoldReadout, SendsSection, assignTrackOutput } from "./routing-ui";
import { AudioRackSection } from "./AudioRackSection";

interface ChannelStripProps {
  channel: ChannelStripState;
  onVolumeChange: (trackId: string, volume: number) => void;
  onPanChange: (trackId: string, pan: number) => void;
  /** Fired when a fader/pan drag ends so the value is persisted as one undo step. */
  onVolumeCommit?: (trackId: string, volume: number) => void;
  onPanCommit?: (trackId: string, pan: number) => void;
  /** Fired when a fader / pan is grabbed, so Touch and Latch passes know when to start writing. */
  onControlTouch?: (trackId: string, lane: "volume" | "pan", value: number) => void;
  onMuteToggle: (trackId: string) => void;
  onSoloToggle: (trackId: string) => void;
  hasSoloedTracks: boolean;
  /** Submix buses of the sequence (output selector and send targets). */
  buses?: readonly AudioBus[];
  /** 5.1 sequence: the stereo pan knob becomes the surround panner. */
  surround?: boolean;
}

/**
 * Fader component for volume control
 */
export const Fader: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  /** Pointer went down on the control (before any move). */
  onTouch?: (value: number) => void;
  disabled?: boolean;
}> = ({ label, value, onChange, onCommit, onTouch, disabled }) => {
  const dbValue = volumeToDb(value);

  return (
    <div className="flex flex-col items-center gap-1" onPointerDownCapture={() => onTouch?.(value)}>
      <span className="text-xs text-fg-muted font-mono w-16 whitespace-nowrap text-center">
        {formatDb(dbValue)} dB
      </span>
      <Slider
        aria-label={label}
        aria-valuetext={`${formatDb(dbValue)} dB`}
        min={0}
        max={4}
        step={0.01}
        orientation="vertical"
        value={[value]}
        onValueChange={([next]) => onChange(next)}
        onValueCommit={([next]) => onCommit?.(next)}
        disabled={disabled}
        className="cursor-pointer data-[orientation=vertical]:h-24 [@media(max-height:820px)]:data-[orientation=vertical]:h-16 data-[orientation=vertical]:w-2 data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_[data-slot=slider-track]]:bg-border-strong [&_[data-slot=slider-range]]:bg-transparent [&_[role=slider]]:h-6 [&_[role=slider]]:w-4 [&_[role=slider]]:rounded [&_[role=slider]]:bg-fg-2 [&_[role=slider]]:shadow-md"
      />
    </div>
  );
};

/**
 * Pan knob component
 */
export const PanKnob: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  onTouch?: (value: number) => void;
  disabled?: boolean;
}> = ({ label, value, onChange, onCommit, onTouch, disabled }) => {
  return (
    <div className="flex flex-col items-center gap-1" onPointerDownCapture={() => onTouch?.(value)}>
      <span className="text-xs text-fg-muted font-mono">
        {formatPan(value)}
      </span>
      <Slider
        aria-label={label}
        aria-valuetext={formatPan(value)}
        min={-1}
        max={1}
        step={0.01}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
        onValueCommit={([next]) => onCommit?.(next)}
        disabled={disabled}
        className="h-2 w-16 cursor-pointer data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-border-strong [&_[data-slot=slider-range]]:bg-transparent [&_[role=slider]]:size-3 [&_[role=slider]]:bg-accent"
      />
    </div>
  );
};

const NO_BUSES: readonly AudioBus[] = [];

const MODE_TITLES: Record<TrackAutomationMode, string> = {
  off: "Off: the automation lanes are ignored",
  read: "Read: play the automation lanes",
  write: "Write: record fader and pan moves over the lanes while playing",
  touch: "Touch: record while a control is held, then return to the existing curve",
  latch: "Latch: start recording on touch and hold the last value until playback stops",
};

/**
 * Automation mode picker: red while a Write pass is recording, yellow when Touch / Latch is armed or recording.
 * Choosing a mode is one undo step.
 */
export const AutomationModeSelect: React.FC<{ trackId: string; trackName: string; mode: TrackAutomationMode }> = ({
  trackId,
  trackName,
  mode,
}) => {
  const armed = useAutomationRecording((state) => state.armed[trackId] === true);
  const writing = useAutomationRecording((state) => state.writing[trackId] === true);
  const recordingMode = mode === "write" || mode === "touch" || mode === "latch";
  const tone = !recordingMode
    ? "border-border-strong bg-bg text-fg-muted"
    : mode === "write"
      ? "border-status-error bg-status-error/20 text-status-error"
      : "border-status-warning bg-status-warning/20 text-status-warning";
  return (
    <div className="flex w-full items-center gap-1">
      <span
        aria-hidden
        data-testid={`automation-state-${trackId}`}
        data-state={writing ? "writing" : armed && recordingMode ? "armed" : "idle"}
        className={cn(
          "size-2 shrink-0 rounded-full",
          writing ? (mode === "write" ? "bg-status-error animate-pulse" : "bg-status-warning animate-pulse") : "bg-border-strong",
          armed && !writing && recordingMode && (mode === "write" ? "bg-status-error/50" : "bg-status-warning/50"),
        )}
      />
      <select
        aria-label={`Automation mode ${trackName}`}
        title={MODE_TITLES[mode]}
        data-testid={`automation-mode-${trackId}`}
        value={mode}
        onChange={(event) => void useProjectStore.getState().setTrackAutomationMode(trackId, event.target.value as TrackAutomationMode)}
        className={cn("h-6 min-w-0 flex-1 rounded border px-1 text-[11px] font-semibold", tone)}
      >
        {TRACK_AUTOMATION_MODES.map((option) => (
          <option key={option} value={option}>
            {TRACK_AUTOMATION_MODE_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
};

/**
 * ChannelStrip component
 *
 * - 20.1: Display channel strip for each audio track
 * - 20.2: Fader updates track volume in real-time
 * - 20.3: Pan knob positions audio in stereo field
 * - 20.4: Solo button mutes all other tracks
 * - 20.5: Mute button excludes track from mix
 */
export const ChannelStrip = memo(
  function ChannelStrip({
    channel,
    onVolumeChange,
    onPanChange,
    onVolumeCommit,
    onPanCommit,
    onControlTouch,
    onMuteToggle,
    onSoloToggle,
    hasSoloedTracks,
    buses = NO_BUSES,
    surround = false,
  }: ChannelStripProps) {
    const handleVolumeChange = useCallback(
      (volume: number) => {
        onVolumeChange(channel.trackId, volume);
      },
      [channel.trackId, onVolumeChange],
    );

    const handlePanChange = useCallback(
      (pan: number) => {
        onPanChange(channel.trackId, pan);
      },
      [channel.trackId, onPanChange],
    );

    const handleVolumeCommit = useCallback(
      (volume: number) => onVolumeCommit?.(channel.trackId, volume),
      [channel.trackId, onVolumeCommit],
    );
    const handlePanCommit = useCallback(
      (pan: number) => onPanCommit?.(channel.trackId, pan),
      [channel.trackId, onPanCommit],
    );

    const handleVolumeTouch = useCallback(
      (volume: number) => onControlTouch?.(channel.trackId, "volume", volume),
      [channel.trackId, onControlTouch],
    );
    const handlePanTouch = useCallback(
      (pan: number) => onControlTouch?.(channel.trackId, "pan", pan),
      [channel.trackId, onControlTouch],
    );

    const handleMuteClick = useCallback(() => {
      onMuteToggle(channel.trackId);
    }, [channel.trackId, onMuteToggle]);

    const handleSoloClick = useCallback(() => {
      onSoloToggle(channel.trackId);
    }, [channel.trackId, onSoloToggle]);

    const handleSoloSafeClick = useCallback(() => {
      void useProjectStore.getState().setTrackSoloSafe(channel.trackId, channel.soloSafe !== true);
    }, [channel.trackId, channel.soloSafe]);

    // Effectively muted: explicitly muted, or silenced by another track's solo (solo-safe tracks are exempt).
    const isEffectivelyMuted = useMemo(
      () => channel.muted || isTrackSoloSuppressed(channel, hasSoloedTracks),
      [channel.muted, channel.solo, channel.soloSafe, hasSoloedTracks], // eslint-disable-line react-hooks/exhaustive-deps
    );

    // Track type icon
    const TrackTypeIcon = channel.trackType === "audio" ? Music : Film;

    return (
      <div
        className={`flex flex-col items-center gap-2 p-3 bg-bg-2 rounded-lg min-w-[148px] w-[148px] shrink-0
 ${isEffectivelyMuted ? "opacity-60" : ""}`}
        data-testid={`channel-strip-${channel.trackId}`}
      >
        {/* Track name */}
        <div title={channel.trackName} className="w-full">
          <span className="text-xs text-fg-2 font-medium truncate w-full text-center">
            <TrackTypeIcon size={11} className="mr-1 inline-block align-[-1px]" aria-hidden />
            {channel.trackName}
          </span>
        </div>

        {/* Level meter */}
        <MixerLevelMeters levels={channel.levels} label={channel.trackName} />
        <PeakHoldReadout levels={channel.levels} label={channel.trackName} testId={`peak-${channel.trackId}`} />

        {/* Pan control (Requirement 20.3); a 5.1 sequence pans in the surround room instead */}
        {surround ? (
          <SurroundPanner
            label={`${channel.trackName} surround pan`}
            testId={`surround-track-${channel.trackId}`}
            pan={resolveSurroundPan(undefined, channel)}
            onChange={(next) => void setSurroundPan({ trackId: channel.trackId }, next)}
            onReset={channel.surroundPan ? () => void setSurroundPan({ trackId: channel.trackId }, null) : undefined}
            disabled={channel.muted}
          />
        ) : (
          <PanKnob
            label={`${channel.trackName} pan control`}
            value={channel.pan}
            onChange={handlePanChange}
            onCommit={handlePanCommit}
            onTouch={handlePanTouch}
            disabled={isEffectivelyMuted}
          />
        )}

        {/* Volume fader (Requirement 20.2) */}
        <Fader
          label={`${channel.trackName} volume fader`}
          value={channel.volume}
          onChange={handleVolumeChange}
          onCommit={handleVolumeCommit}
          onTouch={handleVolumeTouch}
          disabled={channel.muted}
        />

        {/* Track automation mode (Off / Read / Write / Touch / Latch) */}
        <AutomationModeSelect trackId={channel.trackId} trackName={channel.trackName} mode={channel.automationMode ?? "read"} />

        {/* Output assignment and sends (Audio Track Mixer routing) */}
        <div className="flex w-full flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Output</span>
          <OutputSelect
            value={channel.output}
            buses={buses}
            label={channel.trackName}
            testId={`track-output-${channel.trackId}`}
            onChange={(output) => void assignTrackOutput(channel.trackId, output)}
          />
        </div>
        <SendsSection trackId={channel.trackId} trackName={channel.trackName} sends={channel.sends} buses={buses} />

        {/* Effect rack */}
        <AudioRackSection
          target={channel.trackId}
          label={channel.trackName}
          rack={channel.rack}
        />

        {/* Mute/Solo buttons */}
        <div className="flex gap-1">
          {/* Mute button */}
          <Button
            aria-label={`Mute ${channel.trackName}`}
            aria-pressed={channel.muted}
            onClick={handleMuteClick}
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-7 rounded px-2 text-xs font-bold",
              channel.muted
                ? "bg-status-error text-fg hover:bg-status-error/90"
                : "bg-border-strong text-fg-muted hover:bg-hover",
            )}
          >
            <span className="truncate">{"M"}</span>
          </Button>

          {/* Solo button */}
          <Button
            aria-label={`Solo ${channel.trackName}`}
            aria-pressed={channel.solo}
            onClick={handleSoloClick}
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-7 rounded px-2 text-xs font-bold",
              channel.solo
                ? "bg-status-warning text-bg hover:bg-status-warning/90"
                : "bg-border-strong text-fg-muted hover:bg-hover",
            )}
          >
            <span className="truncate">{"S"}</span>
          </Button>

          {/* Solo Safe: keeps this track playing while other tracks are soloed */}
          <Button
            aria-label={`Solo Safe ${channel.trackName}`}
            aria-pressed={channel.soloSafe === true}
            title={channel.soloSafe === true ? "Solo Safe on: this track keeps playing while other tracks are soloed" : "Solo Safe: keep this track playing while other tracks are soloed"}
            data-testid={`solo-safe-${channel.trackId}`}
            onClick={handleSoloSafeClick}
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-7 rounded px-1.5 text-[10px] font-bold",
              channel.soloSafe === true
                ? "bg-accent text-bg hover:bg-accent/90"
                : "bg-border-strong text-fg-muted hover:bg-hover",
            )}
          >
            <span className="truncate">{"SF"}</span>
          </Button>
        </div>
      </div>
    );
  },
  (previous, next) => {
    const a = previous.channel,
      b = next.channel;
    return (
      a.trackId === b.trackId &&
      a.trackName === b.trackName &&
      a.trackType === b.trackType &&
      a.volume === b.volume &&
      a.pan === b.pan &&
      a.muted === b.muted &&
      a.solo === b.solo &&
      a.soloSafe === b.soloSafe &&
      a.automationMode === b.automationMode &&
      a.levels === b.levels &&
      a.rack === b.rack &&
      a.output === b.output &&
      a.sends === b.sends &&
      a.surroundPan === b.surroundPan &&
      previous.surround === next.surround &&
      previous.buses === next.buses &&
      previous.onVolumeCommit === next.onVolumeCommit &&
      previous.onPanCommit === next.onPanCommit &&
      previous.onControlTouch === next.onControlTouch &&
      previous.hasSoloedTracks === next.hasSoloedTracks &&
      previous.onVolumeChange === next.onVolumeChange &&
      previous.onPanChange === next.onPanChange &&
      previous.onMuteToggle === next.onMuteToggle &&
      previous.onSoloToggle === next.onSoloToggle
    );
  },
);
