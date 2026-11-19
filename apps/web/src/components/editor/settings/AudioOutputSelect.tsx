import { useCallback, useEffect, useId, useState } from "react";
import { getAudioOutputRouter, type AudioOutputDevice } from "@openreel/core";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from "@openreel/ui";
import { useSettingsStore } from "../../../stores/settings-store";

const DEFAULT_VALUE = "default";

/** Output devices from the shared router, kept fresh as devices are plugged and unplugged. */
export function useAudioOutputDevices(): { devices: AudioOutputDevice[]; support: ReturnType<ReturnType<typeof getAudioOutputRouter>["getSupport"]>; labelsHidden: boolean; fallbackActive: boolean; requestAccess: () => Promise<void> } {
  const router = getAudioOutputRouter();
  const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
  const [fallbackActive, setFallbackActive] = useState(router.isFallbackActive());
  const refresh = useCallback(async () => {
    setDevices(await router.listDevices());
    setFallbackActive(router.isFallbackActive());
  }, [router]);
  useEffect(() => {
    void refresh();
    const stop = router.subscribe((event) => {
      if (event.type === "devices") setDevices([...event.devices]);
      setFallbackActive(router.isFallbackActive());
    });
    router.startWatching();
    return stop;
  }, [router, refresh]);
  const labelsHidden = devices.some((device) => !device.isDefault && /^Audio output \d+$/.test(device.label));
  const requestAccess = useCallback(async () => {
    await router.requestDeviceAccess();
    await refresh();
  }, [router, refresh]);
  return { devices, support: router.getSupport(), labelsHidden, fallbackActive, requestAccess };
}

/**
 * Monitor output picker shared by Preferences and the Audio Mixer. The choice is remembered; when
 * the device is unplugged playback continues on the system default and this shows the device as
 * disconnected until it returns.
 */
export function AudioOutputSelect({ className, compact = false, testId = "audio-output-select" }: { className?: string; compact?: boolean; testId?: string }) {
  const deviceId = useSettingsStore((state) => state.audioOutputDeviceId);
  const deviceLabel = useSettingsStore((state) => state.audioOutputDeviceLabel);
  const { devices, support, labelsHidden, fallbackActive, requestAccess } = useAudioOutputDevices();
  const statusId = useId();
  const selected = deviceId || DEFAULT_VALUE;
  const missing = deviceId !== "" && !devices.some((device) => device.deviceId === deviceId) && devices.length > 0;
  const unsupported = support === "none";
  const choose = (value: string) => {
    const id = value === DEFAULT_VALUE ? "" : value;
    const label = devices.find((device) => device.deviceId === id)?.label ?? "";
    useSettingsStore.getState().setAudioOutputDevice(id, label);
  };
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} data-testid={testId}>
      <Select value={selected} onValueChange={choose} disabled={unsupported}>
        <SelectTrigger
          aria-label="Audio output device"
          aria-describedby={statusId}
          data-testid={`${testId}-trigger`}
          className={cn("min-w-0 rounded-md bg-bg-2 px-2 text-xs", compact ? "h-7 w-[170px]" : "h-8 w-full")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VALUE}>System default</SelectItem>
          {missing && <SelectItem value={deviceId}>{`${deviceLabel || "Saved device"} (disconnected)`}</SelectItem>}
          {devices.filter((device) => !device.isDefault).map((device) => (
            <SelectItem key={device.deviceId} value={device.deviceId}>{device.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={statusId} role="status" className="text-[11px] leading-4 text-fg-2" data-testid={`${testId}-status`}>
        {unsupported
          ? "This browser can't choose an output device; audio plays on the system default."
          : missing || fallbackActive
            ? `${deviceLabel || "The saved device"} is disconnected. Playing on the system default until it returns.`
            : support === "element"
              ? "Routed through a media element in this browser; expect slightly higher latency."
              : compact ? "" : "Applies to preview playback and scrubbing. Exports are not affected."}
      </p>
      {labelsHidden && !unsupported && (
        <Button type="button" variant="outline" size="sm" className="h-7 w-fit px-2 text-xs" onClick={() => void requestAccess()} data-testid={`${testId}-reveal`}>
          Show device names
        </Button>
      )}
    </div>
  );
}
