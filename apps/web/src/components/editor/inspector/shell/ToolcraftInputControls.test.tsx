import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ToolcraftNumberFieldGroup,
  ToolcraftNumberInputControl,
  ToolcraftSegmentedControl,
  ToolcraftSelectControl,
  ToolcraftSwitchControl,
  ToolcraftTextInputControl,
} from "@openreel/ui";

describe("Toolcraft input controls", () => {
  it("updates text inputs through the shared control surface", () => {
    const onChange = vi.fn();

    render(
      <ToolcraftTextInputControl
        ariaLabel="Layer name"
        value="Headline"
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Layer name" }), {
      target: { value: "Subtitle" },
    });

    expect(onChange).toHaveBeenCalledWith("Subtitle");
  });

  it("keeps empty select options available for clearable controls", () => {
    const onChange = vi.fn();

    render(
      <ToolcraftSelectControl
        ariaLabel="Shader"
        value=""
        options={[
          { value: "", label: "None" },
          { value: "aurora", label: "Aurora" },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Shader" }), {
      target: { value: "aurora" },
    });

    expect(onChange).toHaveBeenCalledWith("aurora");
  });

  it("toggles switches with the compact Toolcraft switch", () => {
    const onCheckedChange = vi.fn();

    render(
      <ToolcraftSwitchControl
        ariaLabel="Loop playback"
        checked={false}
        onCheckedChange={onCheckedChange}
        showLabel={false}
      />,
    );

    const switches = screen.getAllByRole("switch", { name: "Loop playback" });

    expect(switches).toHaveLength(1);
    expect(switches[0]).not.toHaveAttribute("tabindex", "-1");

    fireEvent.click(switches[0]);

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("commits number input drafts on blur", () => {
    const onChange = vi.fn();

    render(
      <ToolcraftNumberInputControl
        ariaLabel="Font size"
        value={24}
        min={8}
        max={72}
        onChange={onChange}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: "Font size" });
    fireEvent.change(input, { target: { value: "96" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenLastCalledWith(72);
  });

  it("updates grouped numeric fields", () => {
    const onChange = vi.fn();

    render(
      <ToolcraftNumberFieldGroup
        label="Position"
        fields={[
          { axis: "X", value: "0", onChange },
          { axis: "Y", value: "10", onChange: vi.fn() },
        ]}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Position X" }), {
      target: { value: "42" },
    });

    expect(onChange).toHaveBeenCalledWith("42");
  });

  it("selects segmented options", () => {
    const onChange = vi.fn();

    render(
      <ToolcraftSegmentedControl
        value="solid"
        options={[
          { value: "solid", label: "Solid" },
          { value: "shader", label: "Shader" },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Shader" }));

    expect(onChange).toHaveBeenCalledWith("shader");
  });
});
