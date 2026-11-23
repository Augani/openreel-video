import { useEffect, useState } from "react";
import { ocioSettingsKey, type OcioProjectSettings } from "@openreel/core/color/ocio/settings";
import type { OcioInspection } from "@openreel/core/color/ocio/runtime";

/**
 * Lazy access to the OCIO runtime from the editor UI: the runtime (YAML reader, transform compiler, shader generator) is
 * its own chunk and loads the first time a project in OCIO mode, or the OCIO dialog, needs to know what a config contains.
 */

const cache = new Map<string, Promise<OcioInspection | { error: string }>>();

export async function inspectOcio(configText: string, files: Readonly<Record<string, string>>, key: string): Promise<OcioInspection | { error: string }> {
  let hit = cache.get(key);
  if (!hit) {
    hit = import("@openreel/core/color/ocio/runtime").then(({ inspectOcioConfig }) => {
      try {
        return inspectOcioConfig(configText, files);
      } catch (error) {
        return { error: error instanceof Error ? error.message : "The OCIO config could not be read." };
      }
    });
    cache.set(key, hit);
    if (cache.size > 6) cache.delete(cache.keys().next().value as string);
  }
  return hit;
}

/** What the project's OCIO config contains (null while loading, `{ error }` when it cannot be read). */
export function useOcioInspection(settings: OcioProjectSettings | undefined): OcioInspection | { error: string } | null {
  const [state, setState] = useState<{ key: string; value: OcioInspection | { error: string } } | null>(null);
  const key = settings ? ocioSettingsKey({ ...settings, workingSpace: "", defaultInputSpace: "", display: "", view: "", looks: [] }) : null;
  useEffect(() => {
    if (!settings || !key) return;
    let live = true;
    void inspectOcio(settings.configText, settings.files, key).then((value) => {
      if (live) setState({ key, value });
    });
    return () => {
      live = false;
    };
  }, [settings, key]);
  return state && state.key === key ? state.value : null;
}
