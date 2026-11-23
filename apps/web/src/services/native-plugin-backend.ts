import {
  NativePluginCancelledError,
  NativePluginRenderError,
  NativePluginUnavailableError,
  setNativePluginBackend,
  type NativePluginBackend,
} from "@openreel/core";

/**
 * The desktop host behind hosted audio plugins: renders go to the main process, which runs them in an out-of-process helper
 * (so a crashing plugin cannot take the editor down). A render comes back as a structured outcome: "unavailable" (not
 * installed / blocked) is bypassed and reported, "failed" fails loudly. Installed once; a no-op in the browser build.
 */
export function createDesktopNativePluginBackend(): NativePluginBackend | null {
  const bridge = typeof window === "undefined" ? undefined : window.openreel?.plughost;
  if (!bridge) return null;
  return {
    async render(request, options) {
      const jobId = crypto.randomUUID();
      const offProgress = options?.onProgress ? bridge.onProgress((event) => event.jobId === jobId && options.onProgress?.(event.fraction)) : null;
      let cancelled = false;
      const watcher = setInterval(() => {
        if (options?.signal?.aborted && !cancelled) {
          cancelled = true;
          void bridge.cancel(jobId);
        }
      }, 100);
      try {
        const outcome = await bridge.render({
          jobId,
          pluginId: request.pluginId,
          ...(request.state ? { state: request.state } : {}),
          values: { ...request.values },
          automation: Object.fromEntries(Object.entries(request.automation).map(([key, lane]) => [key, lane.map(([t, v]) => [t, v] as const)])),
          channels: request.channels.map((channel) => channel.slice()),
          sampleRate: request.sampleRate,
        });
        if (outcome.ok && outcome.result) return outcome.result;
        if (outcome.kind === "cancelled") throw new NativePluginCancelledError();
        if (outcome.kind === "unavailable") throw new NativePluginUnavailableError(request.pluginId, outcome.message ?? "the plugin is not available");
        throw new NativePluginRenderError(request.pluginId, outcome.message ?? "the plugin failed");
      } finally {
        clearInterval(watcher);
        offProgress?.();
      }
    },
  };
}

export function installDesktopNativePluginBackend(): boolean {
  const backend = createDesktopNativePluginBackend();
  setNativePluginBackend(backend ?? undefined);
  return backend !== null;
}

installDesktopNativePluginBackend();
