import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { formatSoundDuration } from "./inspector/sound-library-format";
import { RecordingsPanel, isRecordingTake } from "./RecordingsPanel";
import type { MediaItem } from "@openreel/core";

const take = (name: string, extra: Partial<MediaItem> = {}) =>
  ({
    id: name,
    name,
    type: "video",
    metadata: { duration: 75, width: 1920, height: 1080 },
    ...extra,
  }) as unknown as MediaItem;

describe("formatSoundDuration", () => {
  it("keeps tenths so short SFX never read 00:00", () => {
    expect(formatSoundDuration(0.4)).toBe("0.4s");
    expect(formatSoundDuration(0.01)).toBe("0.1s");
    expect(formatSoundDuration(3.26)).toBe("3.3s");
  });
  it("uses one unit across SFX and music loops, never mixing in mm:ss", () => {
    const labels = [7.5, 8.7, 10.4, 10.8, 16, 4.8].map(formatSoundDuration);
    expect(labels).toEqual(["7.5s", "8.7s", "10.4s", "10.8s", "16.0s", "4.8s"]);
    expect(labels.every((label) => /^\d+\.\ds$/.test(label))).toBe(true);
    expect(formatSoundDuration(Number.NaN)).toBe("0.1s");
  });
  it("only switches to m:ss from a minute", () => {
    expect(formatSoundDuration(59.96)).toBe("1:00");
    expect(formatSoundDuration(75)).toBe("1:15");
  });
});

describe("RecordingsPanel", () => {
  it("only recognises recorder takes", () => {
    expect(isRecordingTake(take("Screen_20260101T101500.webm"))).toBe(true);
    expect(isRecordingTake(take("Narration", { type: "audio", metadata: { recordedTake: "voiceover" } as MediaItem["metadata"] }))).toBe(true);
    expect(isRecordingTake(take("Voice Over Take 1", { type: "audio" }))).toBe(true);
    expect(isRecordingTake(take("Sunrise_Sky.mp4"))).toBe(false);
  });
  it("keeps renamed takes through their recorder provenance", () => {
    expect(isRecordingTake(take("Interview take 2.webm", { metadata: { recordedTake: "screen" } as MediaItem["metadata"] }))).toBe(true);
  });
  it("lists takes with duration and wires Record and Add", () => {
    const onRecord = vi.fn();
    const onAdd = vi.fn();
    const items = [take("Screen_20260101T101500.webm"), take("clip.mp4")];
    render(<RecordingsPanel items={items} onVoiceOver={vi.fn()} onRecord={onRecord} onAddToTimeline={onAdd} onOpenInSource={vi.fn()} />);
    expect(screen.getByText(/1:15/)).toBeTruthy();
    expect(screen.queryByText("clip.mp4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Record screen or camera/ }));
    expect(onRecord).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Add Screen/ }));
    expect(onAdd).toHaveBeenCalledWith(items[0]);
  });
  it("shows an honest empty state", () => {
    render(<RecordingsPanel items={[]} onVoiceOver={vi.fn()} onRecord={vi.fn()} onAddToTimeline={vi.fn()} onOpenInSource={vi.fn()} />);
    expect(screen.getByText("No recordings yet")).toBeTruthy();
  });
});
