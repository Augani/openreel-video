import React, { useState } from "react";
import { Check } from "@/icons/lucide-compat";
import { EffectLivePreview } from "../../panels/effect-previews/EffectLivePreview";
import type { PreviewEffectDef } from "../../panels/effect-previews/preview-engine";

/** Keyboard focus (not a mouse click's focus) starts a card's preview, like hover does. */
function isKeyboardFocus(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

interface LookCardProps {
  /** What the card renders: the look's own effect chain / grade, on the footage under the playhead. */
  def: PreviewEffectDef;
  label: string;
  detail?: string;
  ariaLabel: string;
  /** True only while this look is what the clip actually has. */
  applied?: boolean;
  disabled?: boolean;
  /**
   * Before / after: when set, the left half of the preview shows this def (what the clip looks like now) and the
   * right half the card's own result, split by a divider.
   */
  before?: PreviewEffectDef | null;
  onApply: () => void;
  /** Small icon buttons overlaid on the preview (delete, apply as input ...). Siblings of the card button, never nested. */
  actions?: React.ReactNode;
}

/** A look / LUT card: a real-footage preview (poster, plays on hover or keyboard focus), its name and what it does. */
export const LookCard: React.FC<LookCardProps> = ({
  def,
  label,
  detail,
  ariaLabel,
  applied = false,
  disabled = false,
  before = null,
  onApply,
  actions,
}) => {
  const [isHover, setIsHover] = useState(false);
  const [isFocus, setIsFocus] = useState(false);
  return (
    <div className="group/look relative min-w-0" data-look-card={def.id}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={applied}
        // aria-disabled, not disabled: a disabled button gets no hover or focus, so locked-track cards could never preview.
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) onApply();
        }}
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        onFocus={(event) => setIsFocus(isKeyboardFocus(event.currentTarget))}
        onBlur={() => setIsFocus(false)}
        className={`block w-full min-w-0 overflow-hidden rounded-[7px] border bg-bg-1 text-left transition-[border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${
          applied ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50"
        }`}
      >
        <span className="relative block aspect-video overflow-hidden bg-bg-3">
          <EffectLivePreview def={def} active={isHover || isFocus} />
          {before ? (
            <>
              <span data-look-before className="absolute inset-0 block" style={{ clipPath: "inset(0 50% 0 0)" }}>
                <EffectLivePreview def={before} active={isHover || isFocus} />
              </span>
              <span aria-hidden className="absolute inset-y-0 left-1/2 block w-px -translate-x-1/2 bg-white/80 shadow-[0_0_2px_rgba(0,0,0,0.6)]" />
              <span aria-hidden className="absolute bottom-1 left-1 rounded bg-black/55 px-1 py-px text-[8px] uppercase text-white/85">Before</span>
              <span aria-hidden className="absolute bottom-1 right-1 rounded bg-black/55 px-1 py-px text-[8px] uppercase text-white/85">After</span>
            </>
          ) : null}
          {applied && !before ? (
            <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white">
              <Check size={10} aria-hidden />
            </span>
          ) : null}
        </span>
        <span className="block border-t border-border px-2 py-1.5">
          <span className="block truncate text-[10.5px] font-bold leading-tight text-fg">{label}</span>
          {detail ? <span className="mt-0.5 line-clamp-2 text-[9.5px] leading-tight text-fg-2">{detail}</span> : null}
        </span>
      </button>
      {actions ? (
        <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/look:opacity-100">
          {actions}
        </div>
      ) : null}
    </div>
  );
};

export const lookIconButton =
  "flex h-5 min-w-5 items-center justify-center rounded bg-black/65 px-1 text-[9px] font-semibold text-white/90 backdrop-blur-sm outline-none hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-ring";
