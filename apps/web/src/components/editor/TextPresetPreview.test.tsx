import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "@openreel/core";
import { fitPreviewStyle } from "./TextPresetPreview";
import { playheadBackdropUrl } from "./playhead-backdrop";
import { CaptionStyleCards, captionPreviewStyle, captionStyleLabel } from "./inspector/CaptionStyleCards";

afterEach(cleanup);

const style = (over: Partial<TextStyle>): TextStyle => ({ ...DEFAULT_TEXT_STYLE, ...over });
// A fixed-advance measurer: 0.5em per character plus tracking, like a real face at any size.
const measure = (text: string) => (s: TextStyle) => text.length * (s.fontSize * 0.5 + s.letterSpacing);

describe("scale-to-fit preset previews", () => {
  it("keeps short text at its frame-relative size", () => {
    const fitted = fitPreviewStyle(measure("Hi"), style({ fontSize: 96 }), 2.4);
    expect(fitted.fontSize).toBeCloseTo(((96 * 180) / 1080) * 2.4, 6);
  });

  it("shrinks text that would overflow the card, scaling tracking with it", () => {
    const text = "Caption text here that is far too long for the card";
    const fitted = fitPreviewStyle(measure(text), style({ fontSize: 96, letterSpacing: 12 }), 2.4);
    expect(measure(text)(fitted)).toBeLessThanOrEqual(320 * 0.8 + 1e-6);
    expect(fitted.letterSpacing / fitted.fontSize).toBeCloseTo(12 / 96, 6);
  });

  it("lifts tiny presets to a legible floor", () => {
    const fitted = fitPreviewStyle(measure("Sub"), style({ fontSize: 24 }), 2.4, 180 * 0.14);
    expect(fitted.fontSize).toBeCloseTo(180 * 0.14, 6);
  });
});

describe("playhead backdrop", () => {
  const project = {
    mediaLibrary: { items: [{ id: "a", thumbnailUrl: "blob:a" }, { id: "b", thumbnailUrl: "blob:b" }, { id: "c", thumbnailUrl: null }] },
    timeline: {
      tracks: [
        { id: "v1", type: "video", clips: [{ mediaId: "a", startTime: 0, duration: 4 }, { mediaId: "b", startTime: 4, duration: 4 }] },
        { id: "au", type: "audio", clips: [{ mediaId: "c", startTime: 0, duration: 8 }] },
      ],
    },
  } as unknown as Parameters<typeof playheadBackdropUrl>[0];

  it("uses the clip under the playhead", () => {
    expect(playheadBackdropUrl(project, 1)).toBe("blob:a");
    expect(playheadBackdropUrl(project, 5)).toBe("blob:b");
  });

  it("falls back to the first clip over a gap and to null with no media", () => {
    expect(playheadBackdropUrl(project, 99)).toBe("blob:a");
    expect(playheadBackdropUrl({ mediaLibrary: { items: [] }, timeline: { tracks: [] } } as never, 0)).toBeNull();
  });
});

describe("caption style cards", () => {
  it("resolves the style each preset really produces", () => {
    expect(captionPreviewStyle("pop-words", true)).toMatchObject({ backgroundColor: "#f5d547", color: "#111111" });
    expect(captionPreviewStyle("cinematic", true)).toMatchObject({ fontFamily: "Georgia" });
    expect(captionStyleLabel("pop-words")).toBe("Pop words");
  });

  it("is a radio group of named cards and reports the chosen style", () => {
    const onChange = vi.fn();
    render(<CaptionStyleCards presets={["pop-words", "bold"]} value="pop-words" onChange={onChange} referenceStyles />);
    expect(screen.getByRole("radiogroup", { name: "Caption style" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Pop words caption style" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Bold caption style" }));
    expect(onChange).toHaveBeenCalledWith("bold");
  });
});
