import { memo, useEffect, useMemo, useState } from "react";
import { SUBTITLE_STYLE_PRESETS, type TextStyle } from "@openreel/core";
import { cn } from "@openreel/ui";
import { TextPresetPreview, type PreviewLine } from "../TextPresetPreview";
import { getReferenceCaptionStyle } from "./reference-caption-style";

export const CAPTION_SAMPLE = "Words that stick";

export function captionStyleLabel(id: string): string {
  return id === "pop-words" ? "Pop words" : id === "default" ? "Classic" : id[0].toUpperCase() + id.slice(1).replaceAll("-", " ");
}

/** The text style a caption preset actually produces: the authored reference style when the workspace applies it, else the subtitle preset. */
export function captionPreviewStyle(preset: string, referenceStyles: boolean): Partial<TextStyle> {
  const reference = referenceStyles ? getReferenceCaptionStyle(preset, 1080) : undefined;
  if (reference) return reference;
  const subtitle = SUBTITLE_STYLE_PRESETS[preset === "pop-words" ? "modern" : preset] ?? SUBTITLE_STYLE_PRESETS.default;
  return {
    fontFamily: subtitle.fontFamily,
    fontSize: subtitle.fontSize * 3.4,
    fontWeight: 700,
    color: subtitle.color,
    backgroundColor: subtitle.backgroundColor,
    strokeWidth: 0,
  };
}

function highlightColorFor(style: Partial<TextStyle>): string {
  const bg = style.backgroundColor;
  const opaque = !!bg && bg !== "transparent" && !/rgba\(.*,\s*0?\.\d+\)/.test(bg);
  return opaque ? "#c2410c" : "#34D399";
}

const StyleCard = memo(function StyleCard({ id, selected, highlightOnHover, disabled, onSelect, referenceStyles }: {
  id: string; selected: boolean; highlightOnHover: boolean; disabled?: boolean; onSelect: () => void; referenceStyles: boolean;
}) {
  const [word, setWord] = useState(-1);
  const style = useMemo(() => captionPreviewStyle(id, referenceStyles), [id, referenceStyles]);
  const words = CAPTION_SAMPLE.split(" ").length;
  useEffect(() => {
    if (word < 0) return;
    const timer = window.setTimeout(() => setWord((word + 1) % words), 420);
    return () => window.clearTimeout(timer);
  }, [word, words]);
  const lines = useMemo<PreviewLine[]>(
    () => [{
      text: CAPTION_SAMPLE, style, x: 0.5, y: 0.72, boost: 2.6,
      highlight: highlightOnHover && word >= 0 ? { word, color: highlightColorFor(style) } : undefined,
    }],
    [style, word, highlightOnHover],
  );
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${captionStyleLabel(id)} caption style`}
      disabled={disabled}
      onClick={onSelect}
      onMouseEnter={() => setWord(0)}
      onMouseLeave={() => setWord(-1)}
      onFocus={() => setWord(0)}
      onBlur={() => setWord(-1)}
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-[8px] border bg-bg-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        selected ? "border-accent" : "border-border hover:border-fg-muted",
      )}
    >
      <span className="block aspect-video w-full overflow-hidden bg-black"><TextPresetPreview lines={lines} /></span>
      <span className={cn("truncate px-2 py-1 text-[11px] font-medium", selected ? "text-accent" : "text-fg-2")}>{captionStyleLabel(id)}</span>
    </button>
  );
});

/** Caption style picker: each card is the preset rendered by the real title renderer over the playhead frame; hovering walks the word highlight. */
export function CaptionStyleCards({ presets, value, onChange, referenceStyles, disabled, highlightOnHover = true }: {
  presets: readonly string[]; value: string; onChange: (value: string) => void; referenceStyles: boolean; disabled?: boolean; highlightOnHover?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Caption style" className="grid grid-cols-2 gap-2">
      {presets.map((id) => (
        <StyleCard key={id} id={id} selected={value === id} highlightOnHover={highlightOnHover} disabled={disabled} referenceStyles={referenceStyles} onSelect={() => onChange(id)} />
      ))}
    </div>
  );
}
