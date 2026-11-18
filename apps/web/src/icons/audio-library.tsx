type AudioLibraryIconName =
  | "play"
  | "pause"
  | "search"
  | "add"
  | "voiceover"
  | "speech";

// Paths copied from the supplied Audio component board.
const paths: Record<AudioLibraryIconName, string> = {
  play: "M7 4.5v15l12.5-7.5z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  search: "m20 20-3.5-3.5",
  add: "M12 5v14M5 12h14",
  voiceover:
    "M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 10v1a7 7 0 0 1-14 0v-1M12 18v4",
  speech: "M4 7V4h16v3M9 20h6M12 4v16",
};

export function AudioLibraryIcon({
  name,
  className,
}: {
  name: AudioLibraryIconName;
  className?: string;
}) {
  const solid = name === "play" || name === "pause";
  const size = name === "add" ? 15 : solid ? 12 : 14;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? "currentColor" : "none"}
      stroke={solid ? undefined : "currentColor"}
      strokeWidth={
        solid ? undefined : name === "voiceover" || name === "speech" ? 1.9 : 2
      }
      strokeLinecap={solid ? undefined : "round"}
      strokeLinejoin={name === "speech" ? "round" : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {name === "search" && <circle cx="11" cy="11" r="7" />}
      <path d={paths[name]} />
    </svg>
  );
}
