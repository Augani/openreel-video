import "../../test/install-local-storage-mock";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  GraphicsEngine,
  TitleEngine,
  TemplateEngine,
  type ScriptableTemplate,
} from "@openreel/core";
import { TemplatePreviewModal } from "./TemplatePreviewModal";
import { useProjectStore } from "../../stores/project-store";
import { useEngineStore } from "../../stores/engine-store";
import { autoSaveManager } from "../../services/auto-save";
import { templateProjectFixture } from "../../test/template-fixture";

vi.mock("../../hooks/useAnalytics", () => ({
  useAnalytics: () => ({ track: vi.fn() }),
  AnalyticsEvents: { TEMPLATE_USED: "template_used" },
}));
vi.mock("../../services/media-storage", () => ({
  saveMediaBlob: vi.fn(async () => {}),
  deleteMediaBlob: vi.fn(async () => {}),
  loadMediaBlob: vi.fn(),
}));
vi.mock("../../utils/media-recovery", () => ({
  restoreMediaItem: vi.fn(async (item: unknown) => item),
}));
let template: ScriptableTemplate;
beforeEach(() => {
  vi.clearAllMocks();
  useEngineStore.setState({
    titleEngine: new TitleEngine(),
    graphicsEngine: new GraphicsEngine(),
  });
  useProjectStore
    .getState()
    .loadProject(templateProjectFixture("Current edit"));
  const engine = new TemplateEngine();
  template = {
    ...engine.createFromProject(templateProjectFixture(), {
      name: "Test template",
      description: "A complete project",
      category: "custom",
      placeholders: [],
      tags: [],
    }),
    placeholders: [],
  };
  vi.spyOn(useEngineStore.getState(), "getTemplateEngine").mockResolvedValue(
    engine,
  );
  vi.spyOn(useProjectStore.getState(), "forceSave").mockResolvedValue();
  vi.spyOn(autoSaveManager, "forceSave").mockResolvedValue();
  vi.spyOn(autoSaveManager, "clearProjectSaves").mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("scriptable template project replacement", () => {
  it("saves current work and recovery before hydrating a new project and calling onApply", async () => {
    const before = useProjectStore.getState().project,
      applied = vi.fn();
    let finish!: () => void;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <TemplatePreviewModal
        template={template}
        onClose={() => {}}
        onApply={applied}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use Template" }));
    await waitFor(() =>
      expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce(),
    );
    expect(useProjectStore.getState().project).toBe(before);
    expect(autoSaveManager.forceSave).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(applied).toHaveBeenCalledOnce());
    const current = useProjectStore.getState().project;
    expect(current.id).not.toBe(before.id);
    expect(current.textClips).toEqual(template.projectContent!.textClips);
    expect(useEngineStore.getState().titleEngine!.getAllTextClips()).toEqual(
      current.textClips,
    );
    expect(autoSaveManager.forceSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: current.id }),
    );
  });
  it("keeps current work and skips onApply when saving fails", async () => {
    const before = useProjectStore.getState().project,
      applied = vi.fn();
    vi.mocked(useProjectStore.getState().forceSave).mockRejectedValueOnce(
      new Error("Storage full"),
    );
    render(
      <TemplatePreviewModal
        template={template}
        onClose={() => {}}
        onApply={applied}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use Template" }));
    await screen.findByText("Storage full");
    expect(useProjectStore.getState().project).toBe(before);
    expect(autoSaveManager.forceSave).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
  });
});
