import { findMissingRackPlugins, getNativePluginEffects, pluginRackTargets, readNativePluginParams, type Clip } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { toast } from "../stores/notification-store";

/**
 * Missing plugins are reported when a project opens and bypassed at render time; they are never dropped from the project
 * (the effect keeps its state chunk, so installing the plugin later brings the sound back).
 */

export interface MissingNativePlugin {
  /** The clip carrying the plugin; absent for a plugin on a track or bus rack. */
  readonly clipId?: string;
  /** The track or bus carrying the plugin (rack plugins only). */
  readonly rackTarget?: string;
  readonly rackTargetName?: string;
  readonly effectId: string;
  readonly pluginId: string;
  readonly name: string;
  readonly reason: string;
}

const clipsOf = (): Clip[] => useProjectStore.getState().project.timeline.tracks.flatMap((track) => track.clips);

/** Plugins the project uses that the host cannot run now, with the reason. `usable` null = there is no host at all. */
export function findProjectMissingPlugins(usable: ReadonlySet<string> | null, reasons: ReadonlyMap<string, string> = new Map()): MissingNativePlugin[] {
  const missing: MissingNativePlugin[] = [];
  for (const clip of clipsOf()) {
    for (const effect of getNativePluginEffects(clip.audioEffects)) {
      const params = readNativePluginParams(effect);
      if (usable?.has(params.pluginId)) continue;
      missing.push({
        clipId: clip.id,
        effectId: effect.id,
        pluginId: params.pluginId,
        name: params.name,
        reason: usable === null ? "plugin hosting needs the OpenReel desktop app" : (reasons.get(params.pluginId) ?? "it is not installed on this computer"),
      });
    }
  }
  const unavailable = (reasons: ReadonlyMap<string, string>, pluginId: string): string =>
    usable === null ? "plugin hosting needs the OpenReel desktop app" : (reasons.get(pluginId) ?? "it is not installed on this computer");
  for (const rackPlugin of findMissingRackPlugins(useProjectStore.getState().project.timeline, usable)) {
    missing.push({ rackTarget: rackPlugin.target, rackTargetName: rackPlugin.targetName, effectId: rackPlugin.effectId, pluginId: rackPlugin.pluginId, name: rackPlugin.name, reason: unavailable(reasons, rackPlugin.pluginId) });
  }
  return missing;
}

let lastReportedProject: string | null = null;

async function reportForOpenProject(): Promise<void> {
  const clips = clipsOf();
  if (!clips.some((clip) => getNativePluginEffects(clip.audioEffects).length > 0) && pluginRackTargets(useProjectStore.getState().project.timeline).length === 0) return;
  const bridge = window.openreel?.plughost;
  let usable: Set<string> | null = null;
  const reasons = new Map<string, string>();
  if (bridge) {
    try {
      const scan = await bridge.scan();
      usable = new Set(scan.plugins.filter((p) => p.status === "ok").map((p) => p.id));
      for (const plugin of scan.plugins) if (plugin.status !== "ok" && plugin.statusReason) reasons.set(plugin.id, plugin.statusReason);
    } catch {
      usable = new Set();
    }
  }
  const missing = findProjectMissingPlugins(usable, reasons);
  if (missing.length === 0) return;
  const names = [...new Set(missing.map((m) => m.name))];
  toast.warning(
    names.length === 1 ? `Plugin missing: ${names[0]}` : `${names.length} plugins missing`,
    `${names.join(", ")} cannot run (${missing[0].reason}). The ${missing.every((m) => m.rackTarget) ? "track, bus or master" : "clip"} plays without ${names.length === 1 ? "it" : "them"}; the plugin and its settings stay in the project, so the sound comes back when it is available.`,
  );
}

let started = false;

/** Desktop only (called from the entry once): reports plugins a project needs but this machine lacks, whenever a project opens. */
export function startNativePluginReport(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const check = (id: string | null): void => {
    if (id === lastReportedProject) return;
    lastReportedProject = id;
    if (id) setTimeout(() => void reportForOpenProject(), 0);
  };
  useProjectStore.subscribe((state) => check(state.project?.id ?? null));
  // This module loads lazily with the engines, often after the project is already open.
  check(useProjectStore.getState().project?.id ?? null);
}
