import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../../../stores/project-store";
import { GeneralPanel } from "./GeneralPanel";

describe("GeneralPanel project frame rate", () => {
  const originalUpdateSettings = useProjectStore.getState().updateSettings;
  const originalProject = useProjectStore.getState().project;
  const updateSettings = vi.fn();

  beforeEach(() => {
    updateSettings.mockResolvedValue({ success: true });
    useProjectStore.setState({
      project: {
        ...originalProject,
        settings: { ...originalProject.settings, frameRate: 30 },
      },
      updateSettings: updateSettings as unknown as typeof originalUpdateSettings,
    });
  });

  afterEach(() => {
    cleanup();
    updateSettings.mockReset();
    useProjectStore.setState({
      project: originalProject,
      updateSettings: originalUpdateSettings,
    });
  });

  it("changes the project editing timebase to 60 fps", async () => {
    render(<GeneralPanel />);

    const selector = screen.getByRole("combobox", {
      name: "Editing frame rate",
    });
    expect(selector).toHaveTextContent("30 fps");
    fireEvent.keyDown(selector, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "60 fps" }));

    expect(updateSettings).toHaveBeenCalledWith({ frameRate: 60 });
  });
});
