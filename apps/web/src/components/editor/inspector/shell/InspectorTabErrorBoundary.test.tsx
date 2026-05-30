import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InspectorTabErrorBoundary } from "./InspectorTabErrorBoundary";

function Boom(): JSX.Element {
  throw new Error("boom");
}

describe("InspectorTabErrorBoundary", () => {
  it("renders a fallback when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <InspectorTabErrorBoundary>
        <Boom />
      </InspectorTabErrorBoundary>,
    );
    expect(screen.getByText(/hit an error/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders children when they do not throw", () => {
    render(
      <InspectorTabErrorBoundary>
        <div>ok</div>
      </InspectorTabErrorBoundary>,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
