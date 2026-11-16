interface SplitEditBadgeProps {
  /** Seconds this audio clip's edge sits from its linked picture's edge; + is later. */
  offsets: { start: number; end: number };
  frameRate: number;
}

const label = (seconds: number, frameRate: number): string | null => {
  const frames = Math.round(seconds * frameRate);
  if (frames === 0) return null;
  // Later than the picture is an L-cut (audio trails), earlier a J-cut (audio leads).
  return `${frames > 0 ? "L +" : "J −"}${Math.abs(frames)}f`;
};

/**
 * Shows how far a linked clip's head and tail sit from its picture's: the pair
 * stays linked, and the offset is what makes it a J-cut or L-cut.
 */
export function SplitEditBadge({ offsets, frameRate }: SplitEditBadgeProps) {
  const start = label(offsets.start, frameRate);
  const end = label(offsets.end, frameRate);
  if (!start && !end) return null;
  const pill =
    "absolute top-0.5 z-30 pointer-events-none rounded px-1 font-mono text-[9px] leading-[14px] bg-amber-400 text-black shadow";
  return (
    <>
      {start && (
        <span data-split-edit-offset="start" className={`${pill} left-2.5`}>
          {start}
        </span>
      )}
      {end && (
        <span data-split-edit-offset="end" className={`${pill} right-2.5`}>
          {end}
        </span>
      )}
    </>
  );
}
