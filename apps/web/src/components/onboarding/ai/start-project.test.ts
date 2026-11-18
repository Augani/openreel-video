import { describe, expect, it, vi } from "vitest";
import { startProjectWithClips } from "./start-project";
import { FORMAT_CHOICES } from "./clips";

const [horizontal, vertical] = FORMAT_CHOICES;
const file = new File(["x"], "a.mp4", { type: "video/mp4" });

describe("startProjectWithClips retry", () => {
  it("applies a changed format to the existing project instead of ignoring it", async () => {
    const createProject = vi.fn();
    const updateSettings = vi.fn(async () => ({ success: true }));
    const result = await startProjectWithClips(
      { files: [file], format: vertical, existingProjectId: "p1", existingFormatId: horizontal.id },
      { createProject, updateSettings, importMedia: async () => ({ success: true }), markFormatChosen: vi.fn() },
    );
    expect(createProject).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith({ width: 1080, height: 1920, frameRate: expect.any(Number) });
    expect(result.projectId).toBe("p1");
    expect(result.imported).toEqual(["a.mp4"]);
  });

  it("leaves settings alone when the format did not change", async () => {
    const updateSettings = vi.fn(async () => ({ success: true }));
    await startProjectWithClips(
      { files: [file], format: horizontal, existingProjectId: "p1", existingFormatId: horizontal.id },
      { updateSettings, importMedia: async () => ({ success: true }), markFormatChosen: vi.fn() },
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
