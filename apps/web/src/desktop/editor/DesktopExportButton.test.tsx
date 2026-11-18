import "../../test/install-local-storage-mock";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setEncoderBackendFactory } from "@openreel/core";
import { DesktopExportButton } from "./DesktopExportButton";
import { useTimelineStore } from "../../stores/timeline-store";
import { useProjectStore } from "../../stores/project-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useUIStore } from "../../stores/ui-store";
import type { ExportRunnerState } from "../../services/export-runner";
const runner = vi.hoisted(() => ({
  state: { isExporting: false, progress: 0, phase: "idle", error: null, complete: false } as ExportRunnerState,
  runExport: vi.fn(), runAudioExport: vi.fn(), showSavePicker: vi.fn(), markComplete: vi.fn(),
  beginExport: vi.fn(), finishExportSoon: vi.fn(), failExport: vi.fn(), cancel: vi.fn(), resetError: vi.fn(),
}));
vi.mock("../../services/export-runner", () => ({
  useExportRunner: () => runner,
  extForFormat: () => "mp4",
  exportFilename: () => "fixture.mp4",
}));
vi.mock("../../components/editor/ExportDialog", () => ({
  ExportDialog: ({
    isOpen,
    markedRange,
    onExport,
  }: {
    isOpen: boolean;
    markedRange: { startTime: number; endTime: number } | null;
    onExport: (settings: { format: "mp4"; codec: "h264" }) => void;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Export test">
        {markedRange
          ? `Range ${markedRange.startTime}–${markedRange.endTime}`
          : "Entire timeline"}
        <button onClick={() => onExport({ format: "mp4", codec: "h264" })}>Confirm export test</button>
      </div>
    ) : null,
}));
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(runner.state, { isExporting: false, progress: 0, phase: "idle", error: null, complete: false });
  runner.showSavePicker.mockResolvedValue({ abort: vi.fn() });
  const empty = createEmptyProject("Export regression");
  const project = { ...empty, timeline: { ...empty.timeline, duration: 5 } };
  useProjectStore.setState({
    project,
  });
  useTimelineStore.setState({ loopStart: 2, loopEnd: 5 });
});
afterEach(() => { cleanup(); setEncoderBackendFactory(null); });
describe("Native export entry points", () => {
  it("keeps cancellation available and ignores a second native Export menu command while busy", () => {
    Object.assign(runner.state, { isExporting: true, progress: 42.3 });
    render(<DesktopExportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
    expect(runner.cancel).toHaveBeenCalledOnce();
    fireEvent(window, new CustomEvent("openreel:menu:export"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("clears phone failures and opens native settings in the same retry action", () => {
    Object.assign(runner.state, { error: "Destination blocked" });
    render(<DesktopExportButton compact />);
    fireEvent.click(screen.getByRole("button", { name: "Retry export" }));
    expect(runner.resetError).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toHaveTextContent("Range 2–5");
  });
  it("runs a quick video preset with native delivery and no marked range", async () => {
    render(<DesktopExportButton />);
    fireEvent(window, new CustomEvent("openreel:menu:quick-export", { detail: { preset: "1080p-60" } }));
    await waitFor(() => expect(runner.runExport).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1080, frameRate: 60, bitrate: 25000 }), "mp4", expect.anything()));
    expect(runner.runExport.mock.calls[0][0].range).toBeUndefined();
  });
  it("writes WAV through the native writable and finishes its audio progress", async () => {
    render(<DesktopExportButton />);
    fireEvent(window, new CustomEvent("openreel:menu:quick-export", { detail: { preset: "wav" } }));
    await waitFor(() => expect(runner.runAudioExport).toHaveBeenCalledWith({ format: "wav", sampleRate: 48000, channels: 2, bitDepth: 24 }, expect.anything()));
    expect(runner.beginExport).toHaveBeenCalledWith(await runner.showSavePicker.mock.results[0].value);
    expect(runner.showSavePicker.mock.calls[0][1]).toBe("wav");
    expect(runner.markComplete).toHaveBeenCalledOnce();
    expect(runner.finishExportSoon).toHaveBeenCalledOnce();
  });
  it("ignores unknown presets, active exports and empty projects", async () => {
    render(<DesktopExportButton />);
    fireEvent(window, new CustomEvent("openreel:menu:quick-export", { detail: { preset: "unknown" } }));
    act(() => useUIStore.getState().setExportState({ isExporting: true, progress: 0, phase: "encoding" }));
    fireEvent(window, new CustomEvent("openreel:menu:quick-export", { detail: { preset: "mp4" } }));
    act(() => useProjectStore.setState({ project: createEmptyProject("Empty") }));
    fireEvent(window, new CustomEvent("openreel:menu:quick-export", { detail: { preset: "wav" } }));
    expect(runner.showSavePicker).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });
});
