import React, { useMemo, useState } from "react";
import { Button } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { EffectLivePreview, EffectPreviewProvider } from "../panels/effect-previews/EffectLivePreview";
import type { PreviewEffectDef } from "../panels/effect-previews/preview-engine";
import { overlayCardAspect } from "../panels/effect-previews/overlay-card-geometry";

/** The built-in overlay templates the Overlays tab offers, in display order. */
export const OVERLAY_CARDS = [
  { id: "overlay-progress-bar", name: "Progress bar" },
  { id: "cinema-letterbox", name: "Letterbox 2.39" },
  { id: "overlay-follow-callout", name: "Follow callout" },
  { id: "cinema-light-frame", name: "Frame border" },
] as const;

function isKeyboardFocus(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

const OverlayCard: React.FC<{
  id: string;
  name: string;
  sequence: { width: number; height: number };
  onApply: (id: string) => void;
}> = ({ id, name, sequence, onApply }) => {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const def = useMemo<PreviewEffectDef>(
    () => ({
      // The cache key: overlays are laid out in sequence pixels, so another sequence size is another picture.
      id: `overlay:${id}:${sequence.width}x${sequence.height}`,
      kind: "overlay",
      type: "overlay",
      params: { templateId: id, sequenceWidth: sequence.width, sequenceHeight: sequence.height },
    }),
    [id, sequence.width, sequence.height],
  );
  return (
    <Button
      variant="ghost"
      data-overlay-card={id}
      aria-label={`${name}. Click to add over the selected clip.`}
      onClick={() => onApply(id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(event) => setFocus(isKeyboardFocus(event.currentTarget))}
      onBlur={() => setFocus(false)}
    >
      <div className="workspace-overlay-thumb" style={{ aspectRatio: String(overlayCardAspect(sequence)) }}>
        <EffectLivePreview def={def} active={hover || focus} />
      </div>
      <span>{name}</span>
    </Button>
  );
};

/**
 * The Overlays catalog: every card is the real overlay (resolved from its editing template and drawn by the
 * title / graphics engines) over the footage at the playhead, or over the bundled sample scene when the project
 * has no visual media. Hover or keyboard focus plays the overlay's own animation.
 */
export const OverlayCards: React.FC<{ onApply: (id: string) => void }> = ({ onApply }) => {
  const width = useProjectStore((state) => state.project.settings.width);
  const height = useProjectStore((state) => state.project.settings.height);
  const sequence = useMemo(() => ({ width, height }), [width, height]);
  return (
    <EffectPreviewProvider natural>
      <div className="workspace-graphic-overlays">
        {OVERLAY_CARDS.map((card) => (
          <OverlayCard key={card.id} id={card.id} name={card.name} sequence={sequence} onApply={onApply} />
        ))}
      </div>
    </EffectPreviewProvider>
  );
};
