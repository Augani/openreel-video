import React, { useEffect, useRef, useState } from "react";
import type { ScriptableTemplate } from "@openreel/core";

/** The part of a catalog entry a thumbnail needs. */
export interface TemplateThumbSource {
  readonly id: string;
  readonly name: string;
  readonly thumbnailUrl: string | null;
  readonly template?: ScriptableTemplate;
}

/** Thumbnails of the built-in templates are rendered at build time and committed (see scripts/render-template-thumbs). */
export const bundledTemplateThumbnailUrl = (id: string): string | null =>
  id.startsWith("builtin-") ? `${import.meta.env.BASE_URL}template-thumbs/${id}.webp` : null;

/**
 * One template thumbnail for every surface (one instance per template: callers key it by id): the committed render
 * for built-ins, the template's own thumbnail when it has one, otherwise a frame the lazy renderer draws once the
 * card is near the viewport. Never an icon on a gradient: while it loads the box is a plain skeleton. Fills its
 * (16:9) parent.
 */
export const TemplateThumb: React.FC<{
  template: TemplateThumbSource;
  className?: string;
  alt?: string;
  eager?: boolean;
}> = ({ template, className = "", alt = "", eager = false }) => {
  const [broken, setBroken] = useState(false);
  const [drawn, setDrawn] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const src = drawn ?? (broken ? null : (template.thumbnailUrl ?? bundledTemplateThumbnailUrl(template.id)));

  useEffect(() => {
    if (src) return undefined;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void import("./template-thumbnail").then((m) => {
      if (!cancelled) stop = m.renderWhenVisible(host.current, template, setDrawn);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [src, template]);

  return (
    <div ref={host} data-template-thumb={template.id} className={`relative h-full w-full overflow-hidden bg-bg-3 ${className}`}>
      {src ? (
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </div>
  );
};
