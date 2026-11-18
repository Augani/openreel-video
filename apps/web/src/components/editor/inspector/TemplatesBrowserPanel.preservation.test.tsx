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
import { TemplatesBrowserPanel } from "./TemplatesBrowserPanel";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { autoSaveManager } from "../../../services/auto-save";
import { templateCloudService } from "../../../services/template-cloud-service";
import { templateProjectFixture } from "../../../test/template-fixture";

vi.mock("../../../services/template-cloud-service", () => ({
  templateCloudService: {
    listTemplates: vi.fn(async () => []),
    getTemplate: vi.fn(),
  },
}));
vi.mock("../../../services/media-storage", () => ({
  saveMediaBlob: vi.fn(async () => {}),
  deleteMediaBlob: vi.fn(async () => {}),
  loadMediaBlob: vi.fn(),
}));
vi.mock("../../../utils/media-recovery", () => ({
  restoreMediaItem: vi.fn(async (item: unknown) => item),
}));
vi.mock("../SaveTemplateDialog", () => ({ SaveTemplateDialog: () => null }));
let engine: TemplateEngine, template: Template;
beforeEach(() => {
  vi.clearAllMocks();
  useEngineStore.setState({
    titleEngine: new TitleEngine(),
    graphicsEngine: new GraphicsEngine(),
  });
  useProjectStore
    .getState()
    .loadProject(templateProjectFixture("Current edit"));
  engine = new TemplateEngine();
  template = engine.createFromProject(templateProjectFixture(), {
    name: "Template One",
    description: "Complete template",
    category: "custom",
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
  vi.mocked(templateCloudService.listTemplates).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("template browser replacement preservation", () => {
  async function chooseTemplate() {
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Select Template One template",
      }),
    );
    await waitFor(() => expect(engine.loadTemplate).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole("button", { name: "Use This Template" }),
    );
  }
  it("saves current edits and recovery before loading an independent hydrated template project", async () => {
    const before = useProjectStore.getState().project;
    let finish!: () => void;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const applied = vi.fn();
    render(<TemplatesBrowserPanel onTemplateApplied={applied} />);
    await chooseTemplate();
    await waitFor(() =>
      expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce(),
    );
    expect(useProjectStore.getState().project).toBe(before);
    expect(autoSaveManager.forceSave).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(applied).toHaveBeenCalledOnce());
    const current = useProjectStore.getState().project;
    expect(current.name).toBe("Template One - Copy");
    expect(current.textClips).toEqual(template.projectContent!.textClips);
    expect(useEngineStore.getState().titleEngine!.getAllTextClips()).toEqual(
      current.textClips,
    );
    expect(current.mediaLibrary.items[0].id).not.toBe("original-media");
    expect(autoSaveManager.forceSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: current.id }),
    );
  });
  it("keeps the current edit when saving fails", async () => {
    const before = useProjectStore.getState().project;
    vi.mocked(useProjectStore.getState().forceSave).mockRejectedValueOnce(
      new Error("Storage full"),
    );
    render(<TemplatesBrowserPanel />);
    await chooseTemplate();
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage full");
    expect(useProjectStore.getState().project).toBe(before);
    expect(autoSaveManager.forceSave).not.toHaveBeenCalled();
  });
  it("reports selection errors without an unhandled rejection", async () => {
    vi.mocked(engine.loadTemplate).mockRejectedValueOnce(
      new Error("Read failed"),
    );
    render(<TemplatesBrowserPanel />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Select Template One template",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Read failed");
  });
});
