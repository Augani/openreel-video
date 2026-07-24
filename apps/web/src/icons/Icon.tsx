import type { JSX } from "react";
import type { CSSProperties, Ref } from "react";
import {
  Box,
  Braces,
  Check,
  ChevronDown,
  Clock,
  Columns3,
  Copy,
  Crosshair,
  Diamond,
  Download,
  Film,
  Images,
  MessageSquare,
  Minus,
  Music,
  Play,
  Redo2,
  Repeat,
  RotateCcw,
  Search,
  Send,
  Settings,
  Share,
  Sparkles,
  SlidersHorizontal,
  SquarePlus,
  Star,
  Undo2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "arrow.counterclockwise": RotateCcw,
  "arrow.uturn.backward": Undo2,
  "arrow.uturn.forward": Redo2,
  bolt: Zap,
  "bubble.left.and.text.bubble.right": MessageSquare,
  checkmark: Check,
  "chevron.down": ChevronDown,
  clock: Clock,
  cube: Box,
  curlybraces: Braces,
  diamond: Diamond,
  film: Film,
  gear: Settings,
  magnifyingglass: Search,
  minus: Minus,
  "music.note": Music,
  paperplane: Send,
  "photo.on.rectangle": Images,
  play: Play,
  "play.fill": Play,
  "plus.square": SquarePlus,
  "rectangle.split.3x1": Columns3,
  repeat: Repeat,
  scope: Crosshair,
  "slider.horizontal.3": SlidersHorizontal,
  sparkles: Sparkles,
  "square.and.arrow.down": Download,
  "square.and.arrow.up": Share,
  "square.on.square": Copy,
  star: Star,
  xmark: X,
};

export function Icon({
  name,
  size = 16,
  className,
  ariaHidden = false,
  ariaLabel,
  style,
  ref,
}: {
  name: string;
  size?: number;
  className?: string;
  ariaHidden?: boolean;
  ariaLabel?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLSpanElement>;
}): JSX.Element | null {
  const Glyph = ICONS[name];
  if (!Glyph) return null;
  const dimension = Number.isFinite(size) && size > 0 ? size : 16;
  return (
    <span
      ref={ref}
      className={className}
      role={ariaHidden ? undefined : "img"}
      aria-hidden={ariaHidden || undefined}
      aria-label={ariaHidden ? undefined : (ariaLabel ?? name)}
      style={{
        display: "inline-flex",
        width: dimension,
        height: dimension,
        color: "currentColor",
        lineHeight: 0,
        ...style,
      }}
    >
      <Glyph width={dimension} height={dimension} aria-hidden />
    </span>
  );
}

export function hasIcon(name: string): boolean {
  return name in ICONS;
}

export const iconNames: readonly string[] = Object.keys(ICONS);
