import { Slider } from "@openreel/ui";
import { formatFrameTimecode } from "../../utils/frame-timecode";
import { useT } from "@openreel/i18n/react";

export function PreviewScrubber({
  position,
  duration,
  frameRate,
  disabled,
  onSeek,
}: {
  position: number;
  duration: number;
  frameRate: number;
  disabled?: boolean;
  onSeek: (seconds: number) => void;
}) {
  const t = useT();
  return (
    <Slider
      className="workspace-preview-scrub"
      aria-label={t("Preview position")}
      aria-valuetext={formatFrameTimecode(position, frameRate)}
      min={0}
      max={Math.max(1 / frameRate, duration)}
      step={1 / frameRate}
      value={[Math.max(0, Math.min(duration, position))]}
      disabled={disabled || duration <= 0}
      onValueChange={([seconds]) => onSeek(seconds)}
    />
  );
}
