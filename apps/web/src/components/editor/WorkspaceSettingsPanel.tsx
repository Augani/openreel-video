import { keyboardShortcuts } from "../../services/keyboard-shortcuts";
import { useEffect, useState } from "react";
import {
  Button,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Switch,
  Progress,
  ScrollArea,
} from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useThemeStore } from "../../stores/theme-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import {
  previewProxyCache,
  usePreviewProxyStore,
} from "../../stores/preview-proxy-store";
import { WorkspaceTabs, workspaceTabPanel } from "./WorkspacePrimitives";

function SettingSelect({
  label,
  value,
  options,
  onChange,
  swatch = false,
}: {
  label: string;
  value: string;
  options: readonly [string, string][];
  onChange: (v: string) => void;
  swatch?: boolean;
}) {
  return (
    <label className="workspace-setting-row">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              <span className="workspace-setting-option">
                {swatch && <span className="workspace-setting-swatch" style={{ backgroundColor: value }} aria-hidden="true" />}
                {label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
export function WorkspaceSettingsPanel() {
  const [tab, setTab] = useState("project");
  const projectSettings = useProjectStore((s) => s.project.settings);
  const backgroundColor = useProjectStore((s) => s.project.timeline.layoutBackgroundColor);
  const update = useProjectStore((s) => s.updateSettings);
  const theme = useThemeStore();
  const autoSave = useSettingsStore((s) => s.autoSave);
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval);
  const waveforms = useUIStore((s) => s.showWaveforms);
  const autoProxy4k = useUIStore((s) => s.autoProxy4k);
  const hardwareAcceleration = useUIStore((s) => s.hardwareAcceleration);
  const proxies = usePreviewProxyStore((s) => s.entries);
  const proxyBytes = Object.values(proxies).reduce(
    (sum, entry) => sum + (entry.blob?.size ?? 0),
    0,
  );
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>(
    {},
  );
  useEffect(() => {
    void navigator.storage
      ?.estimate()
      .then(setStorage)
      .catch(() => {});
  }, []);
  return (
    <div className="workspace-settings-panel flex flex-col h-full min-h-0">
      <WorkspaceTabs
        label="Settings sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "project", label: "Project" },
          { value: "shortcuts", label: "Shortcuts" },
          { value: "account", label: "Account" },
        ]}
      />
      <ScrollArea
        {...workspaceTabPanel("Settings sections", tab)}
        className="flex-1 min-h-0"
      >
        <div className="workspace-settings-content">
          {tab === "project" ? (
            <>
              <h3>PROJECT</h3>
              <SettingSelect
                label="Resolution"
                value={`${projectSettings.width}x${projectSettings.height}`}
                options={Array.from(
                  new Set([
                    `${projectSettings.width}x${projectSettings.height}`,
                    "1920x1080",
                    "3840x2160",
                    "1280x720",
                    "1080x1920",
                    "1080x1080",
                    "1080x1350",
                  ]),
                ).map((v) => [v, v.replace("x", " × ")])}
                onChange={(v) => {
                  const [width, height] = v.split("x").map(Number);
                  void update({ width, height });
                }}
              />
              <SettingSelect
                label="Frame rate"
                value={String(projectSettings.frameRate)}
                options={Array.from(
                  new Set([
                    projectSettings.frameRate,
                    24,
                    25,
                    30,
                    50,
                    60,
                    120,
                  ]),
                ).map((v) => [String(v), `${v} fps`])}
                onChange={(v) => {
                  void update({ frameRate: Number(v) });
                }}
              />
              <SettingSelect
                label="Aspect ratio"
                value={String(projectSettings.width / projectSettings.height)}
                options={[
                  [String(16 / 9), "16:9 Landscape"],
                  [String(9 / 16), "9:16 Portrait"],
                  ["1", "1:1 Square"],
                  ["0.8", "4:5 Portrait"],
                  ...(![16 / 9, 9 / 16, 1, 0.8].includes(
                    projectSettings.width / projectSettings.height,
                  )
                    ? [
                        [
                          String(
                            projectSettings.width / projectSettings.height,
                          ),
                          `${projectSettings.width} × ${projectSettings.height}`,
                        ] as [string, string],
                      ]
                    : []),
                ]}
                onChange={(v) => {
                  const ratio = Number(v);
                  void update({
                    width: ratio >= 1 ? Math.round(1080 * ratio) : 1080,
                    height: ratio >= 1 ? 1080 : Math.round(1080 / ratio),
                  });
                }}
              />
              <SettingSelect
                label="Sample rate"
                value={String(projectSettings.sampleRate)}
                options={Array.from(
                  new Set([projectSettings.sampleRate, 48000, 44100, 96000]),
                ).map((rate) => [String(rate), `${rate / 1000} kHz`])}
                onChange={(v) => {
                  void update({ sampleRate: Number(v) });
                }}
              />
              <SettingSelect
                label="Background"
                swatch
                value={backgroundColor ?? "#000000"}
                options={[
                  ["#000000", "Black"],
                  ["#ffffff", "White"],
                  ["#00ff00", "Green"],
                  ...(!["#000000", "#ffffff", "#00ff00"].includes(backgroundColor ?? "#000000")
                    ? [[backgroundColor!, "Custom"] as [string, string]] : []),
                ]}
                onChange={(v) => {
                  void useProjectStore
                    .getState()
                    .setCanvasBackground("color", v);
                }}
              />
              <h3 className="workspace-settings-editor-heading">EDITOR</h3>
              <div className="workspace-setting-row workspace-theme-row">
                <span>Theme</span>
                <div className="workspace-theme-options">
                  {(
                    [
                      ["dark", "Dark"],
                      ["light", "Light"],
                      ["auto", "System"],
                    ] as const
                  ).map(([v, label]) => (
                    <Button
                      key={v}
                      variant="ghost"
                      aria-pressed={theme.mode === v}
                      onClick={() => theme.setMode(v)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <label className="workspace-switch-row">
                <span>Auto-save every {autoSaveInterval === 1 ? "minute" : `${autoSaveInterval} minutes`}</span>
                <Switch
                  checked={autoSave}
                  onCheckedChange={(v) => {
                    useSettingsStore.getState().setAutoSave(v);
                  }}
                />
              </label>
              <label className="workspace-switch-row">
                <span>Use proxy media for 4K</span>
                <Switch
                  aria-label="Use proxy media for 4K"
                  checked={autoProxy4k}
                  onCheckedChange={useUIStore.getState().setAutoProxy4k}
                />
              </label>
              <label
                className="workspace-switch-row"
                title="Use GPU rendering for the preview when available."
              >
                <span>Hardware acceleration</span>
                <Switch
                  aria-label="Hardware acceleration"
                  checked={hardwareAcceleration}
                  onCheckedChange={(enabled) => {
                    useTimelineStore.getState().pause();
                    useUIStore.getState().setHardwareAcceleration(enabled);
                  }}
                />
              </label>
              <label className="workspace-switch-row">
                <span>Show waveforms on video clips</span>
                <Switch
                  checked={waveforms}
                  onCheckedChange={useUIStore.getState().setShowWaveforms}
                />
              </label>
              <div className="workspace-storage-card">
                <div className="flex justify-between">
                  <span>Local storage</span>
                  <span className="font-mono">
                    {storage.quota
                      ? `${((storage.usage ?? 0) / 1e9).toFixed(1)} / ${(storage.quota / 1e9).toFixed(0)} GB`
                      : "Unavailable"}
                  </span>
                </div>
                <Progress
                  value={
                    storage.quota
                      ? ((storage.usage ?? 0) / storage.quota) * 100
                      : undefined
                  }
                />
                <p>
                  Preview proxies · {(proxyBytes / 1e6).toFixed(1)} MB ·{" "}
                  <Button
                    variant="link"
                    aria-label="Clear preview cache"
                    className="workspace-clear-preview-cache"
                    disabled={!Object.keys(proxies).length}
                    onClick={() =>
                      Object.keys(proxies).forEach((id) =>
                        previewProxyCache.remove(id),
                      )
                    }
                  >
                    Clear cache
                  </Button>
                </p>
              </div>
            </>
          ) : (
            <>
              <h3>
                {tab === "shortcuts"
                  ? "KEYBOARD SHORTCUTS"
                  : "ACCOUNT & CONNECTIONS"}
              </h3>
              <p className="text-fg-3 text-xs mb-4">
                {tab === "shortcuts"
                  ? "Customize the shortcuts for your editing workflow."
                  : "Manage your AI providers, models and API keys."}
              </p>
              <Button
                variant="secondary"
                onClick={() =>
                  tab === "shortcuts"
                    ? keyboardShortcuts.runCommand("view.showShortcuts")
                    : useSettingsStore.getState().openSettings("ai-editor")
                }
              >
                Open {tab === "shortcuts" ? "shortcut settings" : "AI settings"}
              </Button>
              {tab === "account" && (
                <Button
                  variant="ghost"
                  className="mt-2 text-xs"
                  onClick={() => useSettingsStore.getState().openSettings()}
                >
                  Editor preferences & API keys…
                </Button>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
