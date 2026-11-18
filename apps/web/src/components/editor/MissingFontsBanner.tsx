import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import {
  collectFontUsages,
  createBrowserFontAvailability,
  findMissingProjectFonts,
  type MissingFont,
} from "../../services/project-fonts";

/**
 * Reports fonts the opened project (or template) uses that are not built in,
 * loaded or installed, with where they are used and the substitute font.
 */
export function MissingFontsBanner() {
  const project = useProjectStore((s) => s.project);
  const [missing, setMissing] = useState<MissingFont[]>([]);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const fonts = useMemo(
    () => ({ textClips: project.textClips, timeline: project.timeline, motionCompositions: project.motionCompositions }),
    [project.textClips, project.timeline, project.motionCompositions],
  );

  // Re-scan only when the set of families or their usage labels change, not
  // on every unrelated text edit.
  const signature = useMemo(() => JSON.stringify([...collectFontUsages(fonts)]), [fonts]);
  const fontsRef = useRef(fonts);
  fontsRef.current = fonts;
  const availabilityRef = useRef<ReturnType<typeof createBrowserFontAvailability> | null>(null);

  useEffect(() => {
    let active = true;
    const run = () => {
      if (!active) return;
      availabilityRef.current ??= createBrowserFontAvailability();
      setMissing(findMissingProjectFonts(fontsRef.current, availabilityRef.current));
    };
    // Give on-demand and uploaded faces a chance to register before reporting.
    const ready = typeof document !== "undefined" && document.fonts?.ready ? document.fonts.ready : Promise.resolve();
    void ready.then(run, run);
    return () => { active = false; };
  }, [signature]);

  if (missing.length === 0 || dismissedFor === project.id) return null;
  return (
    <div role="alert" data-testid="missing-fonts-banner" className="border-b border-border bg-status-warning/10 px-3 py-1.5 text-xs text-fg">
      <div className="flex items-center gap-2">
        <span className="font-semibold">Missing fonts ({missing.length}).</span>
        <span className="min-w-0 flex-1 text-fg-2">These fonts are not available on this device and will be substituted.</span>
        <Button type="button" size="sm" variant="secondary" onClick={() => setDismissedFor(project.id)}>Dismiss</Button>
      </div>
      <ul className="mt-1 list-disc pl-5 text-fg-2">
        {missing.map((font) => (
          <li key={font.family}>
            <span className="font-medium text-fg">{font.family}</span> in {font.usages.slice(0, 3).join(", ")}
            {font.usages.length > 3 ? ` and ${font.usages.length - 3} more` : ""}; falls back to {font.fallback}.
          </li>
        ))}
      </ul>
    </div>
  );
}
