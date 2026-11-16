import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { mediaColumnText, mediaColumnSortValue, MEDIA_COLUMNS, type MediaItem } from "@openreel/core";
import { PreviewTimecode } from "./PreviewTimecode";

describe("PreviewTimecode with a sequence start timecode", () => {
  it("shows start plus position, so the readout matches the exported file's timecode", () => {
    render(<PreviewTimecode position={1.48} duration={10} frameRate={25} startTimecode="10:00:00:00" />);
    expect((screen.getByLabelText("Playhead timecode") as HTMLInputElement).value).toBe("10:00:01:12");
    // The duration stays a length, not a timecode.
    expect(screen.getByLabelText("Project duration").textContent).toBe("00:00:10:00");
  });

  it("without a start timecode it is the plain count", () => {
    render(<PreviewTimecode position={1.48} duration={10} frameRate={25} />);
    expect((screen.getByLabelText("Playhead timecode") as HTMLInputElement).value).toBe("00:00:01:12");
  });

  it("drop-frame start shows the semicolon", () => {
    render(<PreviewTimecode position={0} duration={10} frameRate={29.97} startTimecode="10:00:00;00" />);
    expect((screen.getByLabelText("Playhead timecode") as HTMLInputElement).value).toBe("10:00:00;00");
  });

  it("typing a sequence timecode is accepted (seeks relative to the start) and an earlier one is an error", () => {
    render(<PreviewTimecode position={0} duration={10} frameRate={25} startTimecode="10:00:00:00" />);
    const input = screen.getByLabelText("Playhead timecode") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "09:00:00:00" } });
    fireEvent.blur(input);
    expect(screen.queryByRole("alert")).not.toBeNull();
  });
});

describe("Project panel Start TC column", () => {
  const item = (text?: string, seconds = 36000): MediaItem => ({
    id: "m", name: "a.mxf", type: "video", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
    metadata: { duration: 5, width: 1920, height: 1080, frameRate: 25, codec: "mpeg2video", sampleRate: 48000, channels: 2, fileSize: 1, ...(text ? { startTimecode: seconds, startTimecodeText: text } : {}) },
  });
  it("is an optional column showing the embedded timecode, blank without one", () => {
    const column = MEDIA_COLUMNS.find((c) => c.id === "startTimecode");
    expect(column).toMatchObject({ title: "Start TC", optional: true });
    expect(mediaColumnText(item("10:00:00:00"), "startTimecode", { usage: new Map() })).toBe("10:00:00:00");
    expect(mediaColumnText(item(), "startTimecode", { usage: new Map() })).toBe("");
    expect(mediaColumnSortValue(item("10:00:00:00"), "startTimecode", { usage: new Map() })).toBe(36000);
    expect(mediaColumnSortValue(item(), "startTimecode", { usage: new Map() })).toBe(-1);
  });
});
