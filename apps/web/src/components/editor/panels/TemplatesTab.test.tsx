import "../../../test/install-local-storage-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GraphicsEngine,
  TemplateEngine,
  TitleEngine,
  type Template,
} from "@openreel/core";
import { TemplatesTab } from "./TemplatesTab";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { autoSaveManager } from "../../../services/auto-save";
import { templateProjectFixture } from "../../../test/template-fixture";
vi.mock("../../../services/media-storage", () => ({
  saveMediaBlob: vi.fn(async () => {}),
  deleteMediaBlob: vi.fn(async () => {}),
  loadMediaBlob: vi.fn(),
}));
vi.mock("../../../utils/media-recovery", () => ({
  restoreMediaItem: vi.fn(async (item: unknown) => item),
}));
let engine: TemplateEngine, template: Template;
beforeEach(() => {
  useEngineStore.setState({
    titleEngine: new TitleEngine(),
    graphicsEngine: new GraphicsEngine(),
  });
  useProjectStore
    .getState()
    .loadProject(templateProjectFixture("Current edit"));
  engine = new TemplateEngine();
  template = engine.createFromProject(templateProjectFixture(), {
    name: "Motion template",
    description: "Complete project",
    category: "motion",
    placeholders: [],
    tags: [],
  });
  vi.spyOn(engine, "initialize").mockResolvedValue();
  vi.spyOn(engine, "listTemplates").mockResolvedValue([
    {
      id: template.id,
      name: template.name,
      category: template.category,
      duration: 2,
      thumbnailUrl: null,
      placeholderCount: 0,
    },
  ]);
  vi.spyOn(engine, "loadTemplate").mockResolvedValue(template);
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
describe("full shadcn template grid", () => {
  it("allows cancel before application and persists before hydrating a new shaded project", async () => {
    const before = useProjectStore.getState().project;
    render(<TemplatesTab />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Motion template" }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useProjectStore.getState().forceSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Motion template" }));
    await screen.findByRole("dialog");
    let finish!: () => void;
    vi.mocked(autoSaveManager.forceSave).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Template" }));
    await waitFor(() =>
      expect(autoSaveManager.forceSave).toHaveBeenCalledOnce(),
    );
    expect(useProjectStore.getState().project).toBe(before);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => finish());
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(useProjectStore.getState().project.textClips).toEqual(
      template.projectContent!.textClips,
    );
    expect(useEngineStore.getState().titleEngine!.getAllTextClips()).toEqual(
      template.projectContent!.textClips,
    );
  });
  it("shows storage errors and keeps the source and configuration available for retry", async () => {
    const before = useProjectStore.getState().project;
    vi.mocked(useProjectStore.getState().forceSave).mockRejectedValueOnce(
      new Error("Storage full"),
    );
    render(<TemplatesTab />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Motion template" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Apply Template" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage full");
    expect(useProjectStore.getState().project).toBe(before);
    expect(
      screen.getByRole("button", { name: "Apply Template" }),
    ).toBeEnabled();
  });
});
