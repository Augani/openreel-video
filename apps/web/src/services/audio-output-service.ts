import { getAudioOutputRouter, type AudioOutputEvent } from "@openreel/core";
import { toast } from "../stores/notification-store";
import { useSettingsStore } from "../stores/settings-store";

/** Toast copy for each routing event; null = stay silent. Exported for tests. */
export function describeAudioOutputEvent(event: AudioOutputEvent): { level: "warning" | "success"; title: string; message: string } | null {
  if (event.type === "fallback") {
    return {
      level: "warning",
      title: event.reason === "unplugged" ? `${event.requestedLabel} disconnected` : `Could not use ${event.requestedLabel}`,
      message: "Audio is playing on the system default output. It switches back when the device returns.",
    };
  }
  if (event.type === "restored") {
    return { level: "success", title: `Back on ${event.label}`, message: "Audio output returned to your chosen device." };
  }
  return null;
}

/**
 * Keeps the preview's monitor device in sync with the remembered preference and reports unplug /
 * replug. Start once while the editor is mounted; the returned function stops it.
 */
export function startAudioOutputService(): () => void {
  const router = getAudioOutputRouter();
  const apply = (id: string, label: string) => {
    router.rememberLabel(id, label);
    void router.setPreferredDevice(id);
  };
  const initial = useSettingsStore.getState();
  apply(initial.audioOutputDeviceId, initial.audioOutputDeviceLabel);
  const stopStore = useSettingsStore.subscribe(
    (state) => `${state.audioOutputDeviceId}\u0000${state.audioOutputDeviceLabel}`,
    () => {
      const state = useSettingsStore.getState();
      if (state.audioOutputDeviceId !== router.getPreferredDeviceId()) apply(state.audioOutputDeviceId, state.audioOutputDeviceLabel);
    },
  );
  const stopEvents = router.subscribe((event) => {
    const description = describeAudioOutputEvent(event);
    if (description) toast[description.level](description.title, description.message);
  });
  router.startWatching();
  return () => {
    stopStore();
    stopEvents();
    router.stopWatching();
  };
}
