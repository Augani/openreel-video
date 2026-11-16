import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MissingFontsBanner } from "./MissingFontsBanner";
import { useProjectStore } from "../../stores/project-store";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MissingFontsBanner", () => {
  it("lists a missing font, where it is used and the fallback", async () => {
    // Width depends on the generic fallback, i.e. the family is not installed.
    let font = "";
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
      get font() { return font; },
      set font(v: string) { font = v; },
      measureText: () => ({ width: font.includes("monospace") ? 100 : 90 }),
    })) as unknown as HTMLCanvasElement["getContext"]);
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        textClips: [
          {
            id: "t1", trackId: "x", startTime: 0, duration: 1, text: "Hello", keyframes: [],
            style: { fontFamily: "Zzyzx Nonexistent Display", fontSize: 40, fontWeight: "normal" },
          },
        ] as unknown as typeof project.textClips,
      },
    });
    render(<MissingFontsBanner />);
    await waitFor(() => {
      expect(screen.queryByTestId("missing-fonts-banner")).not.toBeNull();
    });
    const text = screen.getByTestId("missing-fonts-banner").textContent ?? "";
    expect(text).toContain("Zzyzx Nonexistent Display");
    expect(text).toContain('Text clip "Hello"');
    expect(text).toContain("system default sans-serif");
  });
});
