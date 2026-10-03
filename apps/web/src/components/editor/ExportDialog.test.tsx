import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceExportMatch } from "../../services/export-source-match";
import { ExportDialog } from "./ExportDialog";
import { checkBrowserExportCapability } from "@openreel/core";

vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return {
    ...actual,
    checkBrowserExportCapability: vi.fn(() => new Promise<never>(() => undefined)),
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
  afterEach(() => {
    cleanup();
    vi.mocked(checkBrowserExportCapability).mockImplementation(() => new Promise<never>(() => undefined));
  });

  it("keeps the source-match shortcut in the presets view", () => {
    render(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        onExport={vi.fn()}
        duration={1}
        sourceMatch={SOURCE_MATCH}
      />,
    );

    expect(screen.getByTestId("quick-export-card")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Custom Settings" }));

    expect(screen.queryByTestId("quick-export-card")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Quality & encoding" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Audio" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Enhance quality" }),
    ).toBeInTheDocument();
  });

  it("exports source settings from the quick action", () => {
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
  });

  it("defaults to the project's dimensions and frame rate with a usable export action", () => {
    const onExport = vi.fn();
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={5} projectWidth={1080} projectHeight={1920} frameRate={24} />);
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 1920, frameRate: 24, format: "mp4", codec: "h264" }), "download");
  });

  it("updates custom output dimensions when switching to a different project", () => {
    const onExport = vi.fn();
    const { rerender } = render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={5} />);
    fireEvent.click(screen.getByRole("radio", { name: "Custom Settings" }));
    rerender(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={5} projectWidth={1080} projectHeight={1920} frameRate={60} />);
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 1920, frameRate: 60 }), "download");
  });

  it("prevents empty timeline exports through both normal and quick actions", () => {
    const onExport = vi.fn();
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={0} sourceMatch={SOURCE_MATCH} />);
    expect(screen.getByRole("button", { name: "Export Video" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quick Export" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Add a clip");
    expect(onExport).not.toHaveBeenCalled();
  });

  it("keeps audio-only presets out of the video export flow", () => {
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} duration={5} />);
    expect(screen.queryByText("Audio", { selector: "button" })).not.toBeInTheDocument();
    expect(screen.queryByText("MP3 High Quality")).not.toBeInTheDocument();
  });

  it("shows the browser's codec failure and blocks the export action", async () => {
    vi.mocked(checkBrowserExportCapability).mockResolvedValue({ supported: false, reason: "This browser cannot encode H.264. Try WebM." });
    const onExport = vi.fn();
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={5} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Try WebM"));
    expect(screen.getByRole("button", { name: "Export Video" })).toBeDisabled();
    expect(onExport).not.toHaveBeenCalled();
  });

  it("recommends a small source without upscaling or suggesting native-only codecs", () => {
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} duration={5} projectWidth={640} projectHeight={360} frameRate={24} />);
    expect(screen.getByRole("checkbox", { name: "Project settings" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "YouTube 4K" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "4K ProRes HQ" })).not.toBeInTheDocument();
  });
});
