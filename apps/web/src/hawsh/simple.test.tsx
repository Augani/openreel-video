import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InspectorSection } from "../components/editor/inspector/shell/InspectorSection";
import { HIDDEN_AI_FEATURES, HIDDEN_ASSET_TABS, isHiddenSection } from "./simple";

describe("simple editor", () => {
  it("hides only the agreed inspector sections", () => {
    for (const id of ["keyframes", "multicam", "motion-tracking", "masking", "transform-3d", "particle-effects", "text-behind-subject", "motion-path", "color-grading", "background-removal"]) {
      expect(isHiddenSection(id)).toBe(true);
    }
    for (const id of ["transform", "speed", "speed-curves", "auto-cut-silence", "auto-captions", "text-properties", undefined]) {
      expect(isHiddenSection(id)).toBe(false);
    }
  });

  it("hides recipes, templates and the site-duplicate AI tiles", () => {
    expect([...HIDDEN_ASSET_TABS].sort()).toEqual(["recipes", "templates"]);
    expect([...HIDDEN_AI_FEATURES].sort()).toEqual(["multicam", "music", "templates", "tts"]);
  });

  it("renders nothing for a hidden section and the section for a visible one", () => {
    const { container } = render(<InspectorSection title="Masking" sectionId="masking">inside</InspectorSection>);
    expect(container.textContent).toBe("");
    render(<InspectorSection title="Speed" sectionId="speed" defaultOpen>speed body</InspectorSection>);
    expect(screen.getByText("speed body")).toBeTruthy();
  });
});
