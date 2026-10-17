import { useEffect, useMemo, useState } from "react";
import type { Project } from "@openreel/core";
import { collectProjectFonts, ensureFontFamily } from "../services/project-fonts";
import { toast } from "../stores/notification-store";

/** Repaint paused canvases when a newly requested font becomes available. */
export function useProjectFonts(project: Pick<Project, "textClips" | "timeline" | "motionCompositions">): number {
  const [revision, setRevision] = useState(0);
  const fonts = useMemo(() => JSON.stringify(collectProjectFonts(project)), [project]);
  useEffect(() => {
    if (!document.fonts) return;
    let active = true;
    const requests = JSON.parse(fonts) as ReturnType<typeof collectProjectFonts>;
    if (!requests.length) return;
    Promise.all(requests.map((font) => ensureFontFamily(font.family, font.weight, font.sample))).then(() => {
      if (active) setRevision((value) => value + 1);
    }).catch((error: unknown) => {
      if (active) toast.warning("Font unavailable", error instanceof Error ? error.message : "Choose another font or check your connection.");
    });
    return () => { active = false; };
  }, [fonts]);
  return revision;
}
