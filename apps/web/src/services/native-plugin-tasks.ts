import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import { onSharedNativePluginCache, type NativePluginRenderCache } from "@openreel/core";

/**
 * Reports the audio-plugin render cache (desktop VST3 / AU hosting) into the background-task panel. The cache owns the
 * work; this adapter listens to its status events, offers Cancel (abort the source's running jobs) and Retry (forget the
 * remembered failure and let the preview ask again). One row per source buffer while it is running or failed.
 */
const TITLE = "Audio plugin render";
/** Track / bus stems say what they are for ("Plugins on Track Drums"); a clip's own plugin render keeps the generic title. */
const titleFor = (cache: NativePluginRenderCache, buffer: AudioBuffer): string => {
  const label = cache.labelFor(buffer);
  return label ? `Plugins on ${label}` : TITLE;
};

export function watchNativePluginRenderTasks(): () => void {
  let unsubscribeStatus: (() => void) | null = null;
  const ids = new WeakMap<AudioBuffer, string>();
  let seq = 0;

  const attach = (cache: NativePluginRenderCache) => {
    unsubscribeStatus = cache.onStatus((buffer, status) => {
      const existing = ids.get(buffer);
      if (status.state === "ready" || status.state === "idle") {
        // "ready" is also emitted for cache hits; only close a row this adapter opened.
        if (!existing) return;
        ids.delete(buffer);
        const base = { id: existing, kind: "render" as const, source: "plugin-render", title: titleFor(cache, buffer) };
        backgroundTasks.upsert(status.state === "ready" ? { ...base, status: "completed", progress: 1 } : { ...base, status: "cancelled" });
        return;
      }
      const id = existing ?? `plugin-render:${Date.now()}-${++seq}`;
      ids.set(buffer, id);
      const base = { id, kind: "render" as const, source: "plugin-render", title: titleFor(cache, buffer) };
      if (status.state === "running") {
        backgroundTasks.upsert(
          { ...base, detail: "Rendering through the plugin", status: "running", progress: status.fraction },
          { cancel: () => void cache.cancelSource(buffer) },
        );
        return;
      }
      backgroundTasks.upsert(
        { ...base, status: "failed", error: status.error ?? "The plugin failed" },
        {
          retry: () => {
            cache.clearFailures();
            if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("openreel:preview-invalidate", { detail: { audioOnly: true } }));
          },
        },
      );
    });
  };

  const unsubscribeCreated = onSharedNativePluginCache(attach);
  return () => {
    unsubscribeCreated();
    unsubscribeStatus?.();
  };
}
