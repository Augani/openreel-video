import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioOutputRouter, setAudioOutputRouterForTests, type AudioOutputEvent } from "@openreel/core";
import { useNotificationStore } from "../stores/notification-store";
import { useSettingsStore } from "../stores/settings-store";
import { describeAudioOutputEvent, startAudioOutputService } from "./audio-output-service";

describe("describeAudioOutputEvent", () => {
  it("warns on fallback, confirms on restore, stays quiet otherwise", () => {
    const unplugged: AudioOutputEvent = { type: "fallback", reason: "unplugged", requestedId: "h", requestedLabel: "USB Headset" };
    expect(describeAudioOutputEvent(unplugged)).toMatchObject({ level: "warning", title: "USB Headset disconnected" });
    expect(describeAudioOutputEvent({ ...unplugged, reason: "error" })).toMatchObject({ level: "warning", title: "Could not use USB Headset" });
    expect(describeAudioOutputEvent({ type: "restored", deviceId: "h", label: "USB Headset" })).toMatchObject({ level: "success", title: "Back on USB Headset" });
    expect(describeAudioOutputEvent({ type: "applied", deviceId: "h", label: "USB Headset" })).toBeNull();
    expect(describeAudioOutputEvent({ type: "devices", devices: [] })).toBeNull();
  });
});

describe("startAudioOutputService", () => {
  afterEach(() => {
    setAudioOutputRouterForTests(null);
    useSettingsStore.getState().setAudioOutputDevice("");
    useNotificationStore.getState().clearAll();
  });

  function boot() {
    let list = [
      { deviceId: "default", label: "Default - Speakers", kind: "audiooutput" },
      { deviceId: "headset-id", label: "USB Headset", kind: "audiooutput" },
    ] as MediaDeviceInfo[];
    const handlers = new Set<() => void>();
    const router = new AudioOutputRouter({
      mediaDevices: {
        enumerateDevices: async () => list,
        addEventListener: (_t: string, h: () => void) => handlers.add(h),
        removeEventListener: (_t: string, h: () => void) => handlers.delete(h),
      } as never,
    });
    setAudioOutputRouterForTests(router);
    const setSinkId = vi.fn(async () => undefined);
    router.attach({ destination: {}, setSinkId } as unknown as AudioContext, { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode);
    return { router, setSinkId, unplug: async () => { list = list.slice(0, 1); handlers.forEach((h) => h()); await router.reconcile(); } };
  }

  it("applies the remembered device, follows preference changes and toasts on unplug", async () => {
    useSettingsStore.getState().setAudioOutputDevice("headset-id", "USB Headset");
    const { router, setSinkId, unplug } = boot();
    const stop = startAudioOutputService();
    await vi.waitFor(() => expect(setSinkId).toHaveBeenCalledWith("headset-id"));
    expect(router.getActiveDeviceId()).toBe("headset-id");

    await unplug();
    const toasts = useNotificationStore.getState().notifications;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ type: "warning", title: "USB Headset disconnected" });
    expect(router.getActiveDeviceId()).toBe("");
    expect(useSettingsStore.getState().audioOutputDeviceId).toBe("headset-id"); // still remembered

    useSettingsStore.getState().setAudioOutputDevice("default");
    await vi.waitFor(() => expect(router.getPreferredDeviceId()).toBe(""));
    stop();
  });

  it("persists the choice under the settings store key", () => {
    useSettingsStore.getState().setAudioOutputDevice("headset-id", "USB Headset");
    expect(JSON.parse(localStorage.getItem("openreel-settings") ?? "{}").state).toMatchObject({
      audioOutputDeviceId: "headset-id",
      audioOutputDeviceLabel: "USB Headset",
    });
  });
});
