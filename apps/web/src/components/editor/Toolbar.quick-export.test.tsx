import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toolbar } from "./Toolbar";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import type { ExportRunnerState } from "../../services/export-runner";

const phoneMode = vi.hoisted(() => ({ current: false }));
const runner = vi.hoisted(() => ({
  state: { isExporting: false, progress: 0, phase: "idle", error: null, complete: false } as ExportRunnerState,
  runExport: vi.fn(), runAudioExport: vi.fn(), showSavePicker: vi.fn(),
  markComplete: vi.fn(), beginExport: vi.fn(), finishExportSoon: vi.fn(), failExport: vi.fn(), cancel: vi.fn(), resetError: vi.fn(),
}));
vi.mock("../../services/export-runner", () => ({
  useExportRunner: () => runner,
  extForFormat: (format: string) => format,
  exportFilename: (name: string, ext: string) => `${name}.${ext}`,
}));
vi.mock("../../hooks/usePhoneEditor", () => ({ usePhoneEditor: () => phoneMode.current }));
vi.mock("../../hooks/useAnalytics", () => ({ useAnalytics: () => ({ track: vi.fn() }), AnalyticsEvents: { PROJECT_EXPORTED: "exported" } }));
vi.mock("./chat/AIConnectionDialog", () => ({ AIConnectionDialog: () => null }));
vi.mock("./ProjectPackageDialog", () => ({ ProjectPackageDialog: () => null }));
vi.mock("../../desktop/editor/DesktopExportButton", () => ({ DesktopExportButton: () => null }));
vi.mock("../../desktop/shell/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("./ScreenRecorder", () => ({ ScreenRecorder: () => null }));
vi.mock("./inspector/HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("./settings/SettingsDialog", () => ({ SettingsDialog: () => null }));
vi.mock("./CompressDialog", () => ({ CompressDialog: () => null }));
vi.mock("./WorkspaceSaveStatus", () => ({ WorkspaceSaveStatus: () => <span>Saved</span> }));
vi.mock("./ExportDialog", () => ({ ExportDialog: ({ isOpen, onExport }: { isOpen: boolean; onExport: (settings: { format: "mp4" }) => void }) => isOpen ? <div role="dialog">Export settings<button onClick={() => onExport({ format: "mp4" })}>Confirm export test</button></div> : null }));

const sink = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
const originalDesktop = window.openreel;
const originalRename = useProjectStore.getState().renameProject;
beforeEach(() => {
  vi.clearAllMocks();
  phoneMode.current = false;
  Object.assign(runner.state, { isExporting: false, progress: 0, phase: "idle", error: null, complete: false });
  runner.showSavePicker.mockResolvedValue(sink);
  const empty = createEmptyProject("Quick export QA");
  const project = { ...empty, settings: { ...empty.settings, width: 1280, height: 720, frameRate: 24 }, timeline: { ...empty.timeline, duration: 5 } };
  useProjectStore.setState({ project, renameProject: originalRename });
  useTimelineStore.setState({ loopStart: 1, loopEnd: 2, playbackLockedReason: null });
  useUIStore.setState({ activeModal: null, effectApplicationClipId: null, selectedItems: [], exportState: { isExporting: false, progress: 0, phase: "idle" } });
  Object.defineProperty(window, "openreel", { configurable: true, value: undefined });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "openreel", { configurable: true, value: originalDesktop });
});

async function openQuickMenu() {
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "File" }), { key: "ArrowDown" });
  const quick = await screen.findByRole("menuitem", { name: "Quick export" });
  fireEvent.keyDown(quick, { key: "ArrowRight" });
  return quick;
}

describe("shared header export and retained quick presets", () => {
  it("opens settings from one main Export button and preserves quick video settings in File", async () => {
    render(<Toolbar />);
    expect(screen.queryByRole("button", { name: "Export options" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Export settings");
    act(() => useUIStore.getState().closeModal());
    await openQuickMenu();
    expect(await screen.findByText("Entire timeline")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("menuitem", { name: /^MP4 Standard/ }));
    await waitFor(() => expect(runner.runExport).toHaveBeenCalledWith({ width: 1280, height: 720, frameRate: 24, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 }, "mp4", sink));
    expect(runner.runExport.mock.calls[0][0].range).toBeUndefined();
    expect(runner.showSavePicker).toHaveBeenCalledWith("Quick export QA.mp4", "mp4", { delivery: "download" });
  });
  it("retains 60fps and WAV audio export through the real menu actions", async () => {
    render(<Toolbar />);
    await openQuickMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /^1080p 60fps/ }));
    await waitFor(() => expect(runner.runExport).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1080, frameRate: 60, bitrate: 25000 }), "mp4", sink));
    await openQuickMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Audio Only \(WAV\)/ }));
    await waitFor(() => expect(runner.runAudioExport).toHaveBeenCalledWith({ format: "wav", sampleRate: 48000, channels: 2, bitDepth: 24 }, sink));
    expect(runner.markComplete).toHaveBeenCalledOnce();
    expect(runner.failExport).not.toHaveBeenCalled();
  });
  it("routes a native quick preset to the native encoder owner", async () => {
    Object.defineProperty(window, "openreel", { configurable: true, value: { platform: "desktop" } });
    const command = vi.fn();
    window.addEventListener("openreel:menu:quick-export", command);
    render(<Toolbar />);
    await openQuickMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /^4K Standard/ }));
    expect(command).toHaveBeenCalledOnce();
    expect(command.mock.calls[0][0].detail).toEqual({ preset: "4k" });
    expect(runner.showSavePicker).not.toHaveBeenCalled();
    window.removeEventListener("openreel:menu:quick-export", command);
  });
  it("disables quick export for an empty timeline and during an active export", async () => {
    render(<Toolbar />);
    act(() => useUIStore.getState().setExportState({ isExporting: true, progress: 20, phase: "encoding" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "File" }), { key: "ArrowDown" });
    expect(await screen.findByRole("menuitem", { name: "Quick export" })).toHaveAttribute("data-disabled");
    cleanup();
    const project = createEmptyProject("Empty");
    useProjectStore.setState({ project });
    render(<Toolbar />);
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "File" }), { key: "ArrowDown" });
    expect(await screen.findByRole("menuitem", { name: "Quick export" })).toHaveAttribute("data-disabled");
  });
});
