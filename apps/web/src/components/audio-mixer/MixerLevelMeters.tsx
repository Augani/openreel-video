import type { CSSProperties } from "react";
import { Progress } from "@openreel/ui";
import { meterChannelNames, type SignalLevels } from "../../services/audio-mixer-meter";
import { volumeToDb } from "./types";

export function MixerLevelMeters({
  levels,
  label,
  className = "w-4",
}: {
  levels: SignalLevels;
  label: string;
  className?: string;
}) {
  const surround = levels.length === 6;
  const names = meterChannelNames(levels.length);
  const bars = (
    <div
      className={`flex h-32 [@media(max-height:820px)]:h-24 shrink-0 gap-0.5 ${surround ? "w-full" : className}`}
      data-testid={surround ? "surround-meters" : undefined}
    >
      {levels.map(({ peak, rms }, index) => {
        // Stereo keeps its "left"/"right" wording; a 5.1 mix names the speaker (L R C LFE Ls Rs).
        const channelName = surround ? names[index] : index === 0 ? "left" : "right";
        const percent = Math.min(100, Math.max(0, rms * 100));
        const peakPercent = Math.min(100, Math.max(0, peak * 100));
        const db = Math.max(-60, volumeToDb(peak));
        const valueText = peak > 0 ? `${db.toFixed(1)} dBFS` : "−∞ dBFS";
        const color =
          peak >= 1
            ? "[&>div]:bg-status-error"
            : peak > 0.75
              ? "[&>div]:bg-status-warning"
              : "[&>div]:bg-accent";
        return (
          <div
            key={index}
            className="relative h-full min-w-0 flex-1"
            title={`${label} ${channelName}: ${valueText}`}
            data-meter-channel={surround ? names[index] : undefined}
          >
            <Progress
              role="meter"
              aria-label={`${label} ${channelName} level`}
              aria-valuemin={-60}
              aria-valuemax={12}
              aria-valuenow={db}
              aria-valuetext={valueText}
              value={percent}
              className={`h-full w-full rounded-sm bg-bg-2 [&>div]:absolute [&>div]:bottom-0 [&>div]:h-[var(--mixer-level)] [&>div]:!transform-none ${color}`}
              style={{ "--mixer-level": `${percent}%` } as CSSProperties}
            />
            {peak > 0 && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 h-0.5 bg-fg"
                style={{ bottom: `calc(${peakPercent}% - 1px)` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
  if (!surround) return bars;
  return (
    <div className={`flex w-full shrink-0 flex-col gap-0.5`}>
      {bars}
      <div className="flex w-full gap-0.5" aria-hidden>
        {names.map((name) => (
          <span key={name} className="min-w-0 flex-1 text-center font-mono text-[8px] leading-none text-fg-muted">
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
