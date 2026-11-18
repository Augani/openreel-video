import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getBuiltInGraphicTemplate, resolveParamValues, type GraphicInstance } from "@openreel/core";

const mocks = vi.hoisted(() => ({ setGraphicValue: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../../services/graphic-commands", () => ({
  setGraphicValue: mocks.setGraphicValue,
  downloadGraphicTemplate: vi.fn(),
  saveGraphicAsTemplate: vi.fn(),
  ungroupGraphicCommand: vi.fn(),
}));
vi.mock("../../../services/project-fonts", () => ({ ensureFontFamily: vi.fn(async () => undefined) }));
vi.mock("../inspector/font-options", () => ({ FONT_CATEGORIES: { Popular: ["Inter"] }, useCustomFonts: () => [] }));

import { GraphicParameterControls } from "./GraphicParameterControls";
import { GraphicInspector } from "./GraphicInspector";

const template = getBuiltInGraphicTemplate("builtin-lt-classic-bar")!;
const instance: GraphicInstance = {
  id: "graphic_1", name: "Classic Bar", trackId: "t", startTime: 0, duration: 5, template,
  values: resolveParamValues(template, {}),
};

afterEach(() => {
  cleanup();
  mocks.setGraphicValue.mockClear();
});

describe("graphic inspector controls", () => {
  it("shows only the exposed controls, grouped, and nothing else of the template", () => {
    render(<GraphicParameterControls instance={instance} />);
    const rows = document.querySelectorAll("[data-graphic-control]");
    expect([...rows].map((row) => row.getAttribute("data-graphic-control"))).toEqual(template.parameters.map((parameter) => parameter.id));
    expect(screen.getByText("Text")).toBeTruthy();
    expect(screen.getByText("Style")).toBeTruthy();
    expect(screen.queryByText("plate")).toBeNull();
  });

  it("commits a text edit once, on Enter or blur, not on every keystroke", () => {
    render(<GraphicParameterControls instance={instance} />);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "J" } });
    fireEvent.change(input, { target: { value: "Jo" } });
    fireEvent.change(input, { target: { value: "Jordan" } });
    expect(mocks.setGraphicValue).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(mocks.setGraphicValue).toHaveBeenCalledTimes(1);
    expect(mocks.setGraphicValue).toHaveBeenCalledWith("graphic_1", "name", "Jordan");
  });

  it("does not commit an unchanged value, and Escape discards the draft", () => {
    render(<GraphicParameterControls instance={instance} />);
    const input = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Something" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("Senior Correspondent");
    fireEvent.blur(input);
    expect(mocks.setGraphicValue).not.toHaveBeenCalled();
  });

  it("the checkbox control toggles through the command", () => {
    render(<GraphicParameterControls instance={instance} />);
    fireEvent.click(screen.getByRole("switch", { name: "Show title line" }));
    expect(mocks.setGraphicValue).toHaveBeenCalledWith("graphic_1", "showTitle", false);
  });

  it("says so when a template exposes nothing", () => {
    const bare = { ...instance, template: { ...template, parameters: [] } };
    render(<GraphicParameterControls instance={bare} />);
    expect(screen.getByText(/no exposed controls/i)).toBeTruthy();
  });

  it("the inspector header states the protected intro/outro and the minimum length", () => {
    render(<GraphicInspector instance={instance} />);
    expect(screen.getByTestId("graphic-inspector").textContent).toMatch(/Stretching keeps the intro and outro intact/);
  });
});
