import React, { useCallback, useMemo } from "react";
import type { ChannelStripState } from "./types";
import { volumeToDb, formatDb, formatPan } from "./types";

export interface ChannelStripProps {
  channel: ChannelStripState;
  onVolumeChange: (trackId: string, volume: number) => void;
  onPanChange: (trackId: string, pan: number) => void;
  onMuteToggle: (trackId: string) => void;
  onSoloToggle: (trackId: string) => void;
  hasSoloedTracks: boolean;
}

/**
 * Level meter component for displaying audio levels
 */
const LevelMeter: React.FC<{ level: number; peak: number }> = ({
  level,
  peak,
}) => {
  // Convert to percentage for display
  const levelPercent = Math.min(100, Math.max(0, level * 100));
  const peakPercent = Math.min(100, Math.max(0, peak * 100));

  // Determine color based on level
  const getColor = (percent: number) => {
    if (percent > 90) return "bg-red-500";
    if (percent > 75) return "bg-yellow-500";
    return "bg-pink-500";
  };

  return (
    <div className="flex gap-0.5 h-32 w-4">
      {/* Left channel */}
      <div className="flex-1 bg-gray-800 rounded-sm overflow-hidden relative">
        <div
          className={`absolute bottom-0 left-0 right-0 transition-all duration-75 ${getColor(
            levelPercent,
          )}`}
          style={{ height: `${levelPercent}%` }}
        />
        {/* Peak indicator */}
        <div
          className="absolute left-0 right-0 h-0.5 bg-white"
          style={{ bottom: `${peakPercent}%` }}
        />
      </div>
      {/* Right channel (mirror for stereo) */}
      <div className="flex-1 bg-gray-800 rounded-sm overflow-hidden relative">
        <div
          className={`absolute bottom-0 left-0 right-0 transition-all duration-75 ${getColor(
            levelPercent,
          )}`}
          style={{ height: `${levelPercent}%` }}
        />
        <div
          className="absolute left-0 right-0 h-0.5 bg-white"
          style={{ bottom: `${peakPercent}%` }}
        />
      </div>
    </div>
  );
};

/**
 * Fader component for volume control
 */
const Fader: React.FC<{
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(parseFloat(e.target.value));
    },
    [onChange],
  );

  const dbValue = volumeToDb(value);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-gray-400 font-mono w-12 text-center">
        {formatDb(dbValue)} dB
      </span>
      <input
        type="range"
        min="0"
        max="4"
        step="0.01"
        value={value}
        onChange={handleChange}
        disabled={disabled}
        className="h-24 w-2 appearance-none bg-gray-700 rounded-full cursor-pointer
 [writing-mode:vertical-lr] [direction:rtl]
 disabled:opacity-50 disabled:cursor-not-allowed
 [&::-webkit-slider-thumb]:appearance-none
 [&::-webkit-slider-thumb]:w-4
 [&::-webkit-slider-thumb]:h-6
 [&::-webkit-slider-thumb]:bg-gray-300
 [&::-webkit-slider-thumb]:rounded
 [&::-webkit-slider-thumb]:cursor-pointer
 [&::-webkit-slider-thumb]:shadow-md
 [&::-moz-range-thumb]:w-4
 [&::-moz-range-thumb]:h-6
 [&::-moz-range-thumb]:bg-gray-300
 [&::-moz-range-thumb]:rounded
 [&::-moz-range-thumb]:cursor-pointer
 [&::-moz-range-thumb]:border-0"
        aria-label="Volume fader"
      />
    </div>
  );
};

/**
 * Pan knob component
 */
const PanKnob: React.FC<{
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(parseFloat(e.target.value));
    },
    [onChange],
  );

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-gray-400 font-mono">
        {formatPan(value)}
      </span>
      <input
        type="range"
        min="-1"
        max="1"
        step="0.01"
        value={value}
        onChange={handleChange}
        disabled={disabled}
        className="w-16 h-2 appearance-none bg-gray-700 rounded-full cursor-pointer
 disabled:opacity-50 disabled:cursor-not-allowed
 [&::-webkit-slider-thumb]:appearance-none
 [&::-webkit-slider-thumb]:w-3
 [&::-webkit-slider-thumb]:h-3
 [&::-webkit-slider-thumb]:bg-blue-500
 [&::-webkit-slider-thumb]:rounded-full
 [&::-webkit-slider-thumb]:cursor-pointer
 [&::-moz-range-thumb]:w-3
 [&::-moz-range-thumb]:h-3
 [&::-moz-range-thumb]:bg-blue-500
 [&::-moz-range-thumb]:rounded-full
 [&::-moz-range-thumb]:cursor-pointer
 [&::-moz-range-thumb]:border-0"
        aria-label="Pan control"
      />
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
export const ChannelStrip: React.FC<ChannelStripProps> = ({
  channel,
  onVolumeChange,
  onPanChange,
  onMuteToggle,
  onSoloToggle,
  hasSoloedTracks,
}) => {
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

  const handleMuteClick = useCallback(() => {
    onMuteToggle(channel.trackId);
  }, [channel.trackId, onMuteToggle]);

  const handleSoloClick = useCallback(() => {
    onSoloToggle(channel.trackId);
  }, [channel.trackId, onSoloToggle]);

  // Determine if this channel is effectively muted
  // (either explicitly muted, or not soloed when other tracks are soloed)
  const isEffectivelyMuted = useMemo(() => {
    if (channel.muted) return true;
    if (hasSoloedTracks && !channel.solo) return true;
    return false;
  }, [channel.muted, channel.solo, hasSoloedTracks]);

  // Track type icon
  const trackTypeIcon = channel.trackType === "audio" ? "🎵" : "🎬";

  return (
    <div
      className={`flex flex-col items-center gap-2 p-3 bg-gray-800 rounded-lg min-w-[80px]
 ${isEffectivelyMuted ? "opacity-60" : ""}`}
      data-testid={`channel-strip-${channel.trackId}`}
    >
      {/* Track name */}
      <div
        className="text-xs text-gray-300 font-medium truncate w-full text-center"
        title={channel.trackName}
      >
        <span className="mr-1">{trackTypeIcon}</span>
        {channel.trackName}
      </div>

      {/* Level meter */}
      <LevelMeter level={channel.rmsLevel} peak={channel.peakLevel} />

      {/* Pan control (Requirement 20.3) */}
      <PanKnob
        value={channel.pan}
        onChange={handlePanChange}
        disabled={isEffectivelyMuted}
      />

      {/* Volume fader (Requirement 20.2) */}
      <Fader
        value={channel.volume}
        onChange={handleVolumeChange}
        disabled={channel.muted}
      />

      {/* Mute/Solo buttons */}
      <div className="flex gap-1">
        {/* Mute button */}
        <button
          onClick={handleMuteClick}
          className={`px-2 py-1 text-xs font-bold rounded transition-colors
 ${
   channel.muted
     ? "bg-red-600 text-white"
     : "bg-gray-700 text-gray-400 hover:bg-gray-600"
 }`}
          aria-label={channel.muted ? "Unmute track" : "Mute track"}
          aria-pressed={channel.muted}
        >
          M
        </button>

        {/* Solo button */}
        <button
          onClick={handleSoloClick}
          className={`px-2 py-1 text-xs font-bold rounded transition-colors
 ${
   channel.solo
     ? "bg-yellow-500 text-black"
     : "bg-gray-700 text-gray-400 hover:bg-gray-600"
 }`}
          aria-label={channel.solo ? "Unsolo track" : "Solo track"}
          aria-pressed={channel.solo}
        >
          S
        </button>
      </div>
    </div>
  );
};

export default ChannelStrip;
