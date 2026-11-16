import "../../test/install-local-storage-mock";
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
  TitleEngine,
  TemplateEngine,
} from "@openreel/core";
import { TemplateGallery } from "./TemplateGallery";
import { useEngineStore } from "../../stores/engine-store";
import { useProjectStore } from "../../stores/project-store";
import { templateCloudService } from "../../services/template-cloud-service";
import { templateProjectFixture } from "../../test/template-fixture";
vi.mock("../../services/template-cloud-service", () => ({
  templateCloudService: { listScriptableTemplates: vi.fn(async () => []) },
}));
let engine: TemplateEngine,
  local: ReturnType<TemplateEngine["createFromProject"]>;
beforeEach(() => {
  vi.clearAllMocks();
  useEngineStore.setState({
    titleEngine: new TitleEngine(),
    graphicsEngine: new GraphicsEngine(),
  });
  useProjectStore.getState().loadProject(templateProjectFixture());
  engine = new TemplateEngine();
  local = engine.createFromProject(templateProjectFixture(), {
    name: "Local originals",
    description: "All shaded content",
    category: "custom",
    placeholders: [],
    tags: [],
  });
  vi.spyOn(engine, "initialize").mockResolvedValue();
  vi.spyOn(engine, "listTemplates").mockResolvedValue([
    {
      id: local.id,
      name: local.name,
      category: local.category,
      thumbnailUrl: null,
      placeholderCount: 0,
      duration: 2,
    },
  ]);
  vi.spyOn(engine, "loadTemplate").mockResolvedValue(local);
  vi.spyOn(useEngineStore.getState(), "getTemplateEngine").mockResolvedValue(
    engine,
  );
  vi.mocked(templateCloudService.listScriptableTemplates).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("full shadcn responsive template gallery", () => {
  it("shows built-ins and local summaries while cloud is pending, loading full originals only on selection", async () => {
    vi.mocked(templateCloudService.listScriptableTemplates).mockReturnValueOnce(
      new Promise(() => {}),
    );
    render(<TemplateGallery />);
    expect(
      await screen.findByRole("button", { name: "YouTube Intro" }),
    ).toBeEnabled();
    expect(
      await screen.findByRole("button", { name: "Local originals" }),
    ).toBeEnabled();
    expect(engine.loadTemplate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Local originals" }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleName(
      "Local originals",
    );
    expect(engine.loadTemplate).toHaveBeenCalledOnce();
    expect(engine.loadTemplate).toHaveBeenCalledWith(local.id);
  });
  it("preserves trimmed case-insensitive name, description and tag search", async () => {
    render(<TemplateGallery />);
    await screen.findByRole("button", { name: "YouTube Intro" });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search templates" }),
      { target: { value: "  ANIMATED  " } },
    );
    expect(
      screen.getByRole("button", { name: "YouTube Intro" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Local originals" }),
    ).not.toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search templates" }),
      { target: { value: "none matches" } },
    );
    expect(screen.getByText("No templates found")).toBeInTheDocument();
  });
  it("ignores a late local selection after a different template was chosen", async () => {
    let finish!: (value: typeof local) => void;
    vi.mocked(engine.loadTemplate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<TemplateGallery />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Local originals" }),
    );
    await waitFor(() => expect(engine.loadTemplate).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "YouTube Intro" }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleName(
      "YouTube Intro",
    );
    await act(async () => finish(local));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("YouTube Intro");
  });
  it("reports selection failures and leaves the source project unchanged", async () => {
    const before = useProjectStore.getState().project;
    vi.mocked(engine.loadTemplate).mockRejectedValueOnce(
      new Error("Read failed"),
    );
    render(<TemplateGallery />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Local originals" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Read failed");
    expect(useProjectStore.getState().project).toBe(before);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("aborts its exact cloud read on unmount", async () => {
    vi.mocked(templateCloudService.listScriptableTemplates).mockReturnValueOnce(
      new Promise(() => {}),
    );
    const view = render(<TemplateGallery />);
    await screen.findByRole("button", { name: "YouTube Intro" });
    const signal = vi.mocked(templateCloudService.listScriptableTemplates).mock
      .calls[0][0]!.signal!;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
