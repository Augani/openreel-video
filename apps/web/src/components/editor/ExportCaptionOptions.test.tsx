import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptionExportSettings, Subtitle } from "@openreel/core";
import { ExportCaptionOptions } from "./ExportCaptionOptions";

const subs: Subtitle[] = [
  { id: "a", text: "Hello", startTime: 1, endTime: 3, language: "en" },
  { id: "b", text: "Hola", startTime: 1, endTime: 3, language: "es", captionTrackId: "es" },
];

const empty: CaptionExportSettings = { tracks: [] };

describe("ExportCaptionOptions", () => {
  afterEach(cleanup);

  it("explains an empty project", () => {
    render(<ExportCaptionOptions subtitles={[]} value={empty} onChange={() => undefined} format="mp4" isDesktop={false} frameRate={30} />);
    expect(screen.getByTestId("export-captions").textContent).toMatch(/no captions/);
  });

  it("lists one row per caption track with burn-in on by default", () => {
    render(<ExportCaptionOptions subtitles={subs} value={empty} onChange={() => undefined} format="mp4" isDesktop={false} frameRate={30} />);
    expect(screen.getByTestId("export-caption-track-default")).toBeTruthy();
    expect(screen.getByTestId("export-caption-track-es")).toBeTruthy();
    expect((screen.getByRole("switch", { name: /Burn in Default captions/ }) as HTMLElement).getAttribute("aria-checked")).toBe("true");
  });

  it("stores only the tracks that differ from the defaults", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ExportCaptionOptions subtitles={subs} value={empty} onChange={onChange} format="mp4" isDesktop={false} frameRate={30} />);
    fireEvent.click(screen.getByRole("switch", { name: /Burn in español|Burn in es/ }));
    expect(onChange).toHaveBeenLastCalledWith({ tracks: [{ captionTrackId: "es", burnIn: false, sidecar: "none", embedded: "none" }] });
    onChange.mockClear();
    // Switching it back to the default removes the entry again.
    rerender(
      <ExportCaptionOptions
        subtitles={subs}
        value={{ tracks: [{ captionTrackId: "es", burnIn: false, sidecar: "none", embedded: "none" }] }}
        onChange={onChange}
        format="mp4"
        isDesktop={false}
        frameRate={30}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /Burn in es/ }));
    expect(onChange).toHaveBeenLastCalledWith({ tracks: [] });
  });

  it("warns when the chosen delivery cannot be done here", () => {
    const value: CaptionExportSettings = { tracks: [{ captionTrackId: "", burnIn: true, sidecar: "none", embedded: "cea608" }] };
    const { rerender } = render(<ExportCaptionOptions subtitles={subs} value={value} onChange={() => undefined} format="mp4" isDesktop={false} frameRate={30} />);
    expect(screen.getByTestId("export-caption-warnings").textContent).toMatch(/desktop/);
    rerender(<ExportCaptionOptions subtitles={subs} value={value} onChange={() => undefined} format="mp4" isDesktop frameRate={30} />);
    expect(screen.getByTestId("export-caption-warnings").textContent).toMatch(/MOV/);
    rerender(<ExportCaptionOptions subtitles={subs} value={value} onChange={() => undefined} format="mov" isDesktop frameRate={30} />);
    expect(screen.queryByTestId("export-caption-warnings")).toBeNull();
  });
});
