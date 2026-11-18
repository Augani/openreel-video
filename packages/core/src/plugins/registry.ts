/**
 * The set of installed effect plugins, their health and persistence.
 *
 * The registry is the single lookup the renderer (preview AND export), the
 * keyframe sampler and the UI share, so an effect resolves to the same plugin
 * everywhere. Persistence is pluggable: IndexedDB on the web, the user-data
 * plugins folder on desktop (both implemented in apps/web / apps/desktop).
 */

import { type LoadedPlugin } from "./package";
import { isPluginEffectType, pluginIdFromEffectType, PLUGIN_VERSION_PARAM } from "./manifest";

/** After this many consecutive failed frames a plugin is bypassed until it is reset/reinstalled. */
export const FAILURE_TRIP_THRESHOLD = 3;

export interface PluginStore {
  list(): Promise<LoadedPlugin[]>;
  put(plugin: LoadedPlugin): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface PluginHealth {
  readonly state: "ok" | "degraded" | "failed";
  readonly error?: string;
  readonly consecutiveFailures: number;
  /** True once the failure threshold was reached: the plugin is bypassed without running. */
  readonly tripped: boolean;
  /** WGSL path unusable (compile/runtime error) while a CPU fallback still works. */
  readonly gpuError?: string;
}

const HEALTHY: PluginHealth = { state: "ok", consecutiveFailures: 0, tripped: false };

type Listener = () => void;

export class PluginRegistry {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly health = new Map<string, PluginHealth>();
  private readonly resetEpochs = new Map<string, number>();
  private readonly listeners = new Set<Listener>();
  private revision = 0;
  private snapshot: readonly LoadedPlugin[] = [];

  constructor(private store: PluginStore | null = null) {}

  setStore(store: PluginStore | null): void {
    this.store = store;
  }

  /** Load every persisted plugin (call once at startup). */
  async hydrate(): Promise<void> {
    if (!this.store) return;
    const stored = await this.store.list();
    for (const plugin of stored) this.register(plugin);
  }

  /** In-memory install, e.g. from a freshly parsed package or a host IPC listing. */
  register(plugin: LoadedPlugin): void {
    this.plugins.set(plugin.manifest.id, plugin);
    this.health.delete(plugin.manifest.id);
    this.changed();
  }

  /** Install and persist. Replaces an installed plugin with the same id (an upgrade). */
  async install(plugin: LoadedPlugin): Promise<void> {
    await this.store?.put(plugin);
    this.register(plugin);
  }

  async uninstall(id: string): Promise<boolean> {
    const had = this.plugins.has(id);
    await this.store?.remove(id);
    this.plugins.delete(id);
    this.health.delete(id);
    this.changed();
    return had;
  }

  get(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Plugin for an effect type ("plugin:<id>"), if installed. */
  forEffectType(type: string): LoadedPlugin | undefined {
    const id = pluginIdFromEffectType(type);
    return id ? this.plugins.get(id) : undefined;
  }

  list(): readonly LoadedPlugin[] {
    return this.snapshot;
  }

  getHealth(id: string): PluginHealth {
    return this.health.get(id) ?? HEALTHY;
  }

  isBypassed(id: string): boolean {
    return this.getHealth(id).tripped;
  }

  reportSuccess(id: string): void {
    const h = this.health.get(id);
    if (!h || (h.consecutiveFailures === 0 && h.state !== "failed")) return;
    // keep a degraded GPU note: only the frame-level failure counter resets.
    const next: PluginHealth = h.gpuError
      ? { state: "degraded", consecutiveFailures: 0, tripped: false, gpuError: h.gpuError }
      : HEALTHY;
    this.health.set(id, next);
    this.changed();
  }

  reportFailure(id: string, error: string): void {
    const h = this.getHealth(id);
    const consecutiveFailures = h.consecutiveFailures + 1;
    this.health.set(id, {
      state: "failed",
      error,
      consecutiveFailures,
      tripped: consecutiveFailures >= FAILURE_TRIP_THRESHOLD,
      ...(h.gpuError ? { gpuError: h.gpuError } : {}),
    });
    this.changed();
  }

  /** The WGSL path failed but a CPU fallback exists, so the effect still renders. */
  reportGpuFailure(id: string, error: string): void {
    const h = this.getHealth(id);
    if (h.gpuError === error) return;
    this.health.set(id, { ...h, state: h.state === "failed" ? "failed" : "degraded", gpuError: error });
    this.changed();
  }

  /** Clear a tripped/failed state so the plugin is tried again. */
  resetHealth(id: string): void {
    this.resetEpochs.set(id, this.getResetEpoch(id) + 1);
    if (!this.health.has(id)) return;
    this.health.delete(id);
    this.changed();
  }

  /** Bumps on every retry request; the host uses it to forget sticky per-plugin failures (disabled GPU path, dead worker). */
  getResetEpoch(id: string): number {
    return this.resetEpochs.get(id) ?? 0;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Monotonic counter, usable as a React external-store snapshot. */
  getRevision(): number {
    return this.revision;
  }

  private changed(): void {
    this.revision++;
    this.snapshot = [...this.plugins.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* a broken listener must not break rendering */
      }
    }
  }
}

let singleton: PluginRegistry | null = null;

export function getPluginRegistry(): PluginRegistry {
  return (singleton ??= new PluginRegistry());
}

/** Test hook: replace (or clear) the shared registry. */
export function setPluginRegistryForTests(registry: PluginRegistry | null): void {
  singleton = registry;
}

/* -------------------------------------------------------------------------- */
/* What an effect on a clip resolves to                                        */
/* -------------------------------------------------------------------------- */

export type PluginEffectStatus =
  | { readonly kind: "ok"; readonly plugin: LoadedPlugin }
  | { readonly kind: "version-mismatch"; readonly plugin: LoadedPlugin; readonly storedVersion: string }
  | { readonly kind: "missing"; readonly id: string; readonly storedVersion: string | null }
  | { readonly kind: "bypassed"; readonly plugin: LoadedPlugin; readonly error: string };

/**
 * Resolve an effect to its plugin. `missing` is the placeholder state: the
 * effect (and every parameter) is kept in the project and simply not rendered
 * until the plugin is installed.
 */
export function describePluginEffect(
  effect: { readonly type: string; readonly params: Readonly<Record<string, unknown>> },
  registry: PluginRegistry = getPluginRegistry(),
): PluginEffectStatus | null {
  if (!isPluginEffectType(effect.type)) return null;
  const id = pluginIdFromEffectType(effect.type)!;
  const stored = typeof effect.params[PLUGIN_VERSION_PARAM] === "string" ? (effect.params[PLUGIN_VERSION_PARAM] as string) : null;
  const plugin = registry.get(id);
  if (!plugin) return { kind: "missing", id, storedVersion: stored };
  const health = registry.getHealth(id);
  if (health.tripped) return { kind: "bypassed", plugin, error: health.error ?? "plugin failed" };
  if (stored && stored !== plugin.manifest.version) return { kind: "version-mismatch", plugin, storedVersion: stored };
  return { kind: "ok", plugin };
}
