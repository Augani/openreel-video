import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceExportMatch } from "../../services/export-source-match";
import { ExportDialog } from "./ExportDialog";
import {
  ExportPresetsManager,
  exportPresetsManager,
} from "../../services/export-presets";
import { checkBrowserExportCapability } from "@openreel/core";

vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return {
    ...actual,
    checkBrowserExportCapability: vi.fn(async () => ({
      supported: true,
      reason: null,
    })),
    estimateExportTime: vi.fn(() => null),
    getCodecRecommendations: vi.fn(() => []),
    getDeviceProfile: vi.fn(() => new Promise<never>(() => undefined)),
  };
});

const SOURCE_MATCH: SourceExportMatch = {
  width: 4000,
  height: 2400,
  frameRate: 30,
  bitrate: 60_000,
  sourceName: "source-match.mp4",
};

describe("ExportDialog", () => {
  afterEach(async () => {
    await act(async () => {});
    cleanup();
    vi.mocked(checkBrowserExportCapability).mockResolvedValue({
      supported: true,
      reason: null,
    });
  });

  it("exports source settings from the quick action", async () => {
    const onClose = vi.fn();
    const onExport = vi.fn();

    render(
      <ExportDialog
        isOpen
        onClose={onClose}
        onExport={onExport}
        duration={1}
        sourceMatch={SOURCE_MATCH}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Quick Export" }));

    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "mp4",
        codec: "h264",
        width: 4000,
        height: 2400,
        frameRate: 30,
        bitrate: 60_000,
      }),
      "download",
    );
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => {});
  });

  it("updates custom output dimensions when switching to a different project", async () => {
    const onExport = vi.fn();
    const { rerender } = render(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        onExport={onExport}
        duration={5}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Custom Settings" }), {
      button: 0,
      ctrlKey: false,
    });
    rerender(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        onExport={onExport}
        duration={5}
        projectWidth={1080}
        projectHeight={1920}
        frameRate={60}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Export Video" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1080, height: 1920, frameRate: 60 }),
      "download",
    );
  });

  it("saves Custom-tab edits as a named preset that matches the dialog and survives reload", async () => {
    localStorage.clear();
    render(
      <ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} duration={5} />,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Custom Settings" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(document.getElementById("export-bitrate") as HTMLInputElement, {
      target: { value: "4321" },
    });
    fireEvent.change(screen.getByLabelText("New preset name"), {
      target: { value: "My tuned" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save current settings" }));
    const saved = new ExportPresetsManager().getCustomPresets();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("My tuned");
    expect(saved[0].settings).toMatchObject({ bitrate: 4321, codec: "h264" });
    await act(async () => {});
    cleanup();
    render(
      <ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} duration={5} />,
    );
    fireEvent.click(await screen.findByRole("radio", { name: "Custom" }));
    expect(await screen.findAllByText("My tuned")).not.toHaveLength(0);
    for (const p of exportPresetsManager.getCustomPresets()) {
      exportPresetsManager.deleteCustomPreset(p.id);
    }
  });

  it("prevents empty timeline exports through both normal and quick actions", async () => {
    const onExport = vi.fn();
    render(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        onExport={onExport}
        duration={0}
        sourceMatch={SOURCE_MATCH}
      />,
    );
    expect(screen.getByRole("button", { name: "Export Video" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quick Export" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Add a clip");
    expect(onExport).not.toHaveBeenCalled();

    await act(async () => {});
  });

  it("exports the chosen In/Out section through the normal and quick actions", async () => {
    const onExport = vi.fn();
    render(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        onExport={onExport}
        duration={6}
        markedRange={{ startTime: 2, endTime: 4 }}
        sourceMatch={SOURCE_MATCH}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Marked In/Out" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Export Video" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ range: { startTime: 2, endTime: 4 } }),
      "download",
    );
    fireEvent.click(screen.getByRole("button", { name: "Quick Export" }));
    expect(onExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ range: { startTime: 2, endTime: 4 } }),
      "download",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Entire timeline" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Export Video" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ range: undefined }),
      "download",
    );
  });

  it("disables section export until valid In and Out points exist", async () => {
    const { rerender } = render(
      <ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} duration={6} />,
    );
    expect(screen.getByRole("radio", { name: "Marked In/Out" })).toBeDisabled();
    rerender(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        onExport={vi.fn()}
        duration={6}
        markedRange={{ startTime: 2, endTime: 7 }}
      />,
    );
    expect(screen.getByRole("radio", { name: "Marked In/Out" })).toBeDisabled();

    await act(async () => {});
  });

  it("shows the browser's codec failure and blocks the export action", async () => {
    vi.mocked(checkBrowserExportCapability).mockResolvedValue({
      supported: false,
      reason: "This browser cannot encode H.264. Try WebM.",
    });
    const onExport = vi.fn();
    render(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        onExport={onExport}
        duration={5}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Try WebM"),
    );
    expect(screen.getByRole("button", { name: "Export Video" })).toBeDisabled();
    expect(onExport).not.toHaveBeenCalled();
  });

  it("offers preset save/delete in the Presets tab and shows saved presets in the picker", async () => {
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} duration={1} />);
    expect(await screen.findByTestId("export-preset-manager")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New preset name"), { target: { value: "Dialog preset" } });
    fireEvent.click(screen.getByRole("button", { name: "Save current settings" }));
    expect(await screen.findByText("Dialog preset")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(screen.queryByText("Dialog preset")).toBeNull());
  });

  it("offers image sequence and GIF export on its own tab instead of the video buttons", async () => {
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} onAddToQueue={vi.fn()} duration={2} />);
    const tab = screen.getByRole("tab", { name: "Images & GIF" });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(await screen.findByTestId("export-still-panel")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Export Video" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to queue" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export image sequence" })).toBeTruthy();
  });
});
