import { memo } from "react";
import { getClipFadeEnvelopePoints, type Clip } from "@openreel/core";

/** The same fade envelope that preview/export schedule, drawn over the source peaks. */
function AudioClipFadeImpl({
  clip,
  width,
  music,
}: {
  clip: Clip;
  width: number;
  music: boolean;
}) {
  const points = getClipFadeEnvelopePoints({
    clipOffset: 0,
    rangeDuration: clip.duration,
    clipDuration: clip.duration,
    fadeIn: clip.fade?.fadeIn,
    fadeOut: clip.fade?.fadeOut,
    fadeOrigin: clip.fade?.origin,
  });
  if (!points.length || width <= 8) return null;
  const curve = points
    .map(
      ({ time, value }) =>
        `${4 + (time / clip.duration) * (width - 8)},${26 - value * 12}`,
    )
    .join(" ");
  const color = music ? "var(--c-music-waveform)" : "var(--c-audio-waveform)";
  return (
    <svg
      data-clip-fade
      aria-hidden
      className="absolute bottom-0 left-0 w-full pointer-events-none"
      height={28}
      viewBox={`0 0 ${width} 28`}
      preserveAspectRatio="none"
    >
      <polygon
        points={`4,26 ${curve} ${width - 4},26`}
        fill={color}
        opacity={0.12}
      />
      <polyline
        points={curve}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export const AudioClipFade = memo(AudioClipFadeImpl);
