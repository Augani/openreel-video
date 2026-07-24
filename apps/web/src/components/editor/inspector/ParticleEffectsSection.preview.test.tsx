import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PARTICLE_PRESETS } from "@openreel/core";
import { ParticleEffectsSection } from "./ParticleEffectsSection";

describe("ParticleEffectsSection preset previews", () => {
  afterEach(cleanup);

  it("shows every preset before selection and adds the chosen configuration", () => {
    const onAddEffect = vi.fn();
    render(
      <ParticleEffectsSection
        clipId="particle-clip"
        clipDuration={5}
        clipStartTime={2}
        effects={[]}
        onAddEffect={onAddEffect}
        onUpdateEffect={vi.fn()}
        onRemoveEffect={vi.fn()}
        onToggleEffect={vi.fn()}
        onUpdateTiming={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("particle-preset-preview")).toHaveLength(
      PARTICLE_PRESETS.length,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Celebration Confetti" }),
    );
    expect(
      screen.getByRole("button", { name: "Preview Celebration Confetti" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onAddEffect).toHaveBeenCalledTimes(1);
    expect(onAddEffect.mock.calls[0]?.[0]).toMatchObject({
      clipId: "particle-clip",
      type: "confetti",
      startTime: 2,
      duration: 5,
      enabled: true,
      config: {
        particleCount: 200,
        gravity: 200,
      },
    });
  });
});
