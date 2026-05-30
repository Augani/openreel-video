import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InspectorTabs } from "./InspectorTabs";
import { getTabsForClipType } from "../clip-tabs.config";

describe("InspectorTabs", () => {
  const tabs = getTabsForClipType("video");

  it("renders a tab button per def", () => {
    render(<InspectorTabs tabs={tabs} activeId="transform" onSelect={() => {}} />);
    expect(screen.getAllByRole("tab")).toHaveLength(tabs.length);
  });

  it("marks the active tab aria-selected", () => {
    render(<InspectorTabs tabs={tabs} activeId="color" onSelect={() => {}} />);
    expect(screen.getByRole("tab", { name: /Color/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Transform/ })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelect with the tab id on click", () => {
    const onSelect = vi.fn();
    render(<InspectorTabs tabs={tabs} activeId="transform" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: /Effects/ }));
    expect(onSelect).toHaveBeenCalledWith("effects");
  });
});
