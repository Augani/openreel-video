import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ToolcraftBadge,
  ToolcraftClickableCard,
  ToolcraftFileDropControl,
  ToolcraftText,
} from "@openreel/ui";

describe("Toolcraft surface controls", () => {
  it("fires clickable-card actions through a button surface", () => {
    const onClick = vi.fn();

    render(
      <ToolcraftClickableCard label="Open templates" onClick={onClick}>
        Templates
      </ToolcraftClickableCard>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open templates" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("passes selected files through the file drop control", () => {
    const onFileSelect = vi.fn();
    const { container } = render(
      <ToolcraftFileDropControl
        accept=".svg"
        label="Import SVG"
        onFileSelect={onFileSelect}
      />,
    );
    const input = container.querySelector("input[type='file']");
    const file = new File(["<svg />"], "shape.svg", { type: "image/svg+xml" });

    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    expect(onFileSelect).toHaveBeenCalledWith(file);
  });

  it("renders text with max-line clamping metadata", () => {
    render(
      <ToolcraftText maxLines={2} type="supporting">
        Long supporting copy
      </ToolcraftText>,
    );

    expect(screen.getByText("Long supporting copy")).toHaveStyle({
      WebkitLineClamp: "2",
    });
  });

  it("renders badge labels on the shared Toolcraft badge surface", () => {
    render(<ToolcraftBadge label="video" />);

    expect(screen.getByText("video")).toBeInTheDocument();
  });
});
