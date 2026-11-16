import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { VideoExportSettings } from "@openreel/core";
import { ExportBroadcastOptions } from "./ExportBroadcastOptions";

const settings = (over: Partial<VideoExportSettings> = {}): VideoExportSettings => ({
  format: "mxf", codec: "xdcamhd422", width: 1920, height: 1080, frameRate: 25, bitrate: 0, bitrateMode: "cbr", quality: 100, keyframeInterval: 1,
  audioSettings: { format: "wav", sampleRate: 48000, bitDepth: 24, bitrate: 0, channels: 2 },
  ...over,
});

describe("ExportBroadcastOptions", () => {
  it("on the web build explains that broadcast delivery needs the desktop app, with no controls", () => {
    render(<ExportBroadcastOptions settings={settings()} onChange={vi.fn()} isDesktop={false} />);
    expect(screen.getByTestId("export-broadcast-web-note").textContent).toMatch(/desktop app/);
    expect(screen.queryByLabelText("Start timecode")).toBeNull();
  });

  it("renders nothing for formats that cannot carry the options", () => {
    const { container } = render(<ExportBroadcastOptions settings={settings({ format: "mp4", codec: "h264" })} onChange={vi.fn()} isDesktop />);
    expect(container.firstChild).toBeNull();
  });

  it("types a start timecode into the settings and falls back to the sequence's in the placeholder", () => {
    const onChange = vi.fn();
    render(<ExportBroadcastOptions settings={settings()} onChange={onChange} isDesktop sequenceStartTimecode="01:00:00:00" />);
    const input = screen.getByLabelText("Start timecode") as HTMLInputElement;
    expect(input.placeholder).toBe("01:00:00:00");
    fireEvent.change(input, { target: { value: "10:00:00:00" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ broadcast: { startTimecode: "10:00:00:00" } }));
  });

  it("flags an invalid timecode for the frame rate", () => {
    render(<ExportBroadcastOptions settings={settings({ broadcast: { startTimecode: "10:00:00:40" } })} onChange={vi.fn()} isDesktop />);
    expect((screen.getByLabelText("Start timecode") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
  });

  it("shows OP-Atom's file naming, the scan control for broadcast codecs and the track layout note", () => {
    render(<ExportBroadcastOptions settings={settings({ broadcast: { mxfPattern: "opatom", audioTracks: 8, extraTracks: "stems" } })} onChange={vi.fn()} isDesktop />);
    expect(screen.getByTestId("export-opatom-note").textContent).toMatch(/_V01\.mxf/);
    expect(screen.getByLabelText("Scan")).toBeTruthy();
    expect(screen.getByTestId("export-audio-tracks-note").textContent).toMatch(/stereo mix/i);
    expect(screen.getByLabelText("Extra audio tracks")).toBeTruthy();
  });

  it("has no scan control for ProRes and no MXF wrapper control in MOV", () => {
    render(<ExportBroadcastOptions settings={settings({ format: "mov", codec: "prores" })} onChange={vi.fn()} isDesktop />);
    expect(screen.queryByLabelText("Scan")).toBeNull();
    expect(screen.queryByLabelText("MXF wrapper")).toBeNull();
    expect(screen.getByLabelText("Audio tracks")).toBeTruthy();
  });
});
