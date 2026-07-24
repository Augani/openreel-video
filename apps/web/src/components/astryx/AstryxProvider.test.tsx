import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AstryxProvider } from "./AstryxProvider";

describe("AstryxProvider", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("uses the prebuilt theme without runtime style injection", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    render(
      <AstryxProvider>
        <div>Workspace</div>
      </AstryxProvider>,
    );

    expect(screen.getByText("Workspace").closest("[data-astryx-theme]"))
      .toHaveAttribute("data-astryx-theme", "neutral");
    expect(
      warning.mock.calls.some(([message]) =>
        String(message).includes("runtime style injection"),
      ),
    ).toBe(false);
  });
});
