import type { JSX } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";

import { EditorBootstrapGate } from "./EditorBootstrapGate";
import { useDesktopEditorBootstrap } from "./useDesktopEditorBootstrap";

vi.mock("./useDesktopEditorBootstrap");

const mockedHook = vi.mocked(useDesktopEditorBootstrap);

const Sentinel = (): JSX.Element => (
  <div data-testid="editor-child">editor body</div>
);

beforeEach(() => {
  mockedHook.mockReset();
});

describe("EditorBootstrapGate", () => {
  it("shows the branded loading state and hides children while not ready", () => {
    mockedHook.mockReturnValue({ ready: false, error: null });
    const { container }: RenderResult = render(
      <EditorBootstrapGate>
        <Sentinel />
      </EditorBootstrapGate>,
    );
    expect(screen.getByText("Loading editor…")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.queryByTestId("editor-child")).toBeNull();
  });

  it("renders children once ready", () => {
    mockedHook.mockReturnValue({ ready: true, error: null });
    render(
      <EditorBootstrapGate>
        <Sentinel />
      </EditorBootstrapGate>,
    );
    expect(screen.getByTestId("editor-child")).toBeTruthy();
    expect(screen.queryByText("Loading editor…")).toBeNull();
  });

  it("shows the error message when bootstrap fails", () => {
    mockedHook.mockReturnValue({ ready: false, error: new Error("boom") });
    render(
      <EditorBootstrapGate>
        <Sentinel />
      </EditorBootstrapGate>,
    );
    expect(screen.getByText(/boom/)).toBeTruthy();
    expect(screen.queryByTestId("editor-child")).toBeNull();
  });
});
