import { useEffect, useState, type CSSProperties } from "react";
import { Progress } from "@openreel/ui";
import { getRealtimeAudioGraph } from "@openreel/core";
import { useTimelineStore } from "../../../stores/timeline-store";
import {
  createStereoOutputMeter,
  OUTPUT_METER_FLOOR,
  type StereoOutputLevels,
} from "../../../services/stereo-output-meter";

export function StereoOutputMeters() {
  const playing = useTimelineStore((s) => s.playbackState === "playing");
  const [levels, setLevels] = useState<StereoOutputLevels>([
    OUTPUT_METER_FLOOR,
    OUTPUT_METER_FLOOR,
  ]);
  useEffect(() => {
    if (!playing) return;
    const meter = createStereoOutputMeter(getRealtimeAudioGraph());
    const update = () => {
      const next = meter.read();
      setLevels((previous) =>
        previous[0] === next[0] && previous[1] === next[1] ? previous : next,
      );
    };
    update();
    const interval = window.setInterval(update, 33);
    return () => {
      window.clearInterval(interval);
      meter.dispose();
    };
  }, [playing]);

  return (
    <div className="workspace-output-meters" aria-label="Stereo output levels">
      {(["Left", "Right"] as const).map((channel, index) => {
        const db = playing ? levels[index] : OUTPUT_METER_FLOOR;
        const percent = ((db - OUTPUT_METER_FLOOR) / -OUTPUT_METER_FLOOR) * 100;
        const label =
          db <= OUTPUT_METER_FLOOR ? "−∞ dBFS" : `${db.toFixed(1)} dBFS`;
        return (
          <div key={channel} title={`${channel} output: ${label}`}>
            <Progress
              role="meter"
              aria-label={`${channel} output level`}
              aria-valuemin={OUTPUT_METER_FLOOR}
              aria-valuemax={0}
              aria-valuenow={db}
              aria-valuetext={label}
              className="workspace-output-meter"
              value={percent}
              style={{ "--output-level": `${percent}%` } as CSSProperties}
            />
            <span>{channel[0]}</span>
          </div>
        );
      })}
    </div>
  );
}
