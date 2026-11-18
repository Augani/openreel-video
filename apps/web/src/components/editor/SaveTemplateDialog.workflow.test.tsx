import "../../test/install-local-storage-mock";
import { Profiler } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { GraphicsEngine, TemplateEngine, TitleEngine } from "@openreel/core";
import { SaveTemplateDialog } from "./SaveTemplateDialog";
import { useProjectStore } from "../../stores/project-store";
import { useEngineStore } from "../../stores/engine-store";
import { templateCloudService } from "../../services/template-cloud-service";
import { templateEditorOwner } from "../../services/project-templates";
import { trackEditorDraftWrite } from "../../services/editor-field-drafts";

vi.mock("../../services/template-cloud-service", () => ({
  templateCloudService: {
    uploadTemplate: vi.fn(async () => ({ success: true })),
  },
}));
vi.mock("../../services/media-storage", () => ({
  loadMediaBlob: vi.fn(),
  saveMediaBlob: vi.fn(),
  deleteMediaBlob: vi.fn(),
}));
vi.mock("../../utils/media-recovery", () => ({
  restoreMediaItem: vi.fn(async (item: unknown) => item),
}));

let engine: TemplateEngine;
let getEngine: MockInstance<[], Promise<TemplateEngine>>;
let save: MockInstance<
  Parameters<TemplateEngine["saveTemplate"]>,
  ReturnType<TemplateEngine["saveTemplate"]>
>;
beforeEach(() => {
  vi.clearAllMocks();
  useEngineStore.setState({
    titleEngine: new TitleEngine(),
    graphicsEngine: new GraphicsEngine(),
  });
  useProjectStore.getState().createNewProject("Template form source");
  const state = useProjectStore.getState();
  state.createTextClip(
    state.project.timeline.tracks[0].id,
    0,
    "Retained shaded title",
    2,
    {
      shader: {
        shaderId: "paper-mesh-gradient",
        params: { color1: "#ee44aa" },
        progress: 0.37,
      },
    },
  );
  engine = new TemplateEngine();
  vi.spyOn(engine, "initialize").mockResolvedValue();
  save = vi.spyOn(engine, "saveTemplate").mockResolvedValue();
  getEngine = vi
    .spyOn(useEngineStore.getState(), "getTemplateEngine")
    .mockResolvedValue(engine);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fill() {
  fireEvent.change(screen.getByLabelText("Template Name"), {
    target: { value: "  Material template  " },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "  Keep the editable shade and its parameters.  " },
  });
  fireEvent.click(screen.getByRole("radio", { name: "Local" }));
}

describe("full shadcn template form and owned saves", () => {
  it("keeps the complete saved shade and metadata in a local template", async () => {
    render(<SaveTemplateDialog isOpen onClose={() => {}} />);
    fill();
    fireEvent.change(screen.getByLabelText("Tags (comma-separated)"), {
      target: { value: " shade, title, , paper " },
    });
    fireEvent.change(screen.getByLabelText("Author Name"), {
      target: { value: "  Local author  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Template" }));
    await screen.findByText("Template saved successfully!");
    const stored = save.mock.calls[0][0];
    expect(stored).toMatchObject({
      name: "Material template",
      description: "Keep the editable shade and its parameters.",
      category: "custom",
      tags: ["shade", "title", "paper"],
      author: "Local author",
    });
    expect(stored.projectContent!.textClips).toEqual(
      useProjectStore.getState().project.textClips,
    );
    expect(templateCloudService.uploadTemplate).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Local" })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Save Template" }),
    ).toBeDisabled();
  });

  it("retains limits, all categories and mutually exclusive destination controls", async () => {
    render(<SaveTemplateDialog isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Template Name"), {
      target: { value: "x".repeat(70) },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "x".repeat(600) },
    });
    expect(screen.getByLabelText("Template Name")).toHaveValue("x".repeat(50));
    expect(screen.getByLabelText("Description")).toHaveValue("x".repeat(500));
    expect(screen.getByRole("radio", { name: "Cloud" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Local" }));
    expect(screen.getByRole("radio", { name: "Cloud" })).not.toBeChecked();
    expect(
      screen.getByText("Saved on this device with the original media."),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Category" }), {
      key: "ArrowDown",
    });
    await screen.findByRole("option", { name: "Motion" });
    expect(screen.getAllByRole("option")).toHaveLength(11);
    fireEvent.click(screen.getByRole("option", { name: "Motion" }));
    expect(
      screen.getByRole("combobox", { name: "Category" }),
    ).toHaveTextContent("Motion");
  });

  it("waits for registered property writes before creating the template", async () => {
    let finish!: () => void;
    trackEditorDraftWrite(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
      templateEditorOwner(),
    );
    render(<SaveTemplateDialog isOpen onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save Template" }));
    await act(async () => {});
    expect(getEngine).not.toHaveBeenCalled();
    await act(async () => {
      const clip = useProjectStore.getState().project.textClips![0];
      try {
        useProjectStore
          .getState()
          .updateTextContent(clip.id, "Committed before template");
      } finally {
        finish();
      }
    });
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].projectContent!.textClips![0].text).toBe(
      "Committed before template",
    );
  });

  it("does not save an old project after the current owner changes during initialization", async () => {
    let finish!: (value: TemplateEngine) => void;
    getEngine.mockImplementationOnce(
      () =>
        new Promise<TemplateEngine>((resolve) => {
          finish = resolve;
        }),
    );
    render(<SaveTemplateDialog isOpen onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save Template" }));
    await waitFor(() => expect(getEngine).toHaveBeenCalledOnce());
    act(() => useProjectStore.getState().createNewProject("Another project"));
    await act(async () => {
      finish(engine);
    });
    expect(save).not.toHaveBeenCalled();
    expect(templateCloudService.uploadTemplate).not.toHaveBeenCalled();
  });

  it("allows preparation cancellation and rejects a late completion", async () => {
    let finish!: (value: TemplateEngine) => void;
    getEngine.mockImplementationOnce(
      () =>
        new Promise<TemplateEngine>((resolve) => {
          finish = resolve;
        }),
    );
    const close = vi.fn();
    render(<SaveTemplateDialog isOpen onClose={close} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save Template" }));
    await waitFor(() => expect(getEngine).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledOnce();
    await act(async () => {
      finish(engine);
    });
    expect(save).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Template saved successfully!"),
    ).not.toBeInTheDocument();
  });

  it("blocks duplicate submissions and close while the storage write is pending", async () => {
    let finish!: () => void;
    save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const close = vi.fn();
    render(<SaveTemplateDialog isOpen onClose={close} />);
    fill();
    const form = screen.getByRole("dialog").querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
    });
    expect(close).not.toHaveBeenCalled();
    await act(async () => {
      finish();
    });
    expect(
      screen.getByText("Template saved successfully!"),
    ).toBeInTheDocument();
  });

  it("retains editable metadata on storage failure and supports retry", async () => {
    save.mockRejectedValueOnce(new Error("Storage full"));
    render(<SaveTemplateDialog isOpen onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save Template" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage full");
    expect(screen.getByLabelText("Template Name")).toHaveValue(
      "  Material template  ",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Template" }));
    await screen.findByText("Template saved successfully!");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("does not let a previous success timer close a newly opened session", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const view = render(<SaveTemplateDialog isOpen onClose={close} />);
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Template" }));
    });
    expect(
      screen.getByText("Template saved successfully!"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    view.rerender(<SaveTemplateDialog isOpen={false} onClose={close} />);
    view.rerender(<SaveTemplateDialog isOpen onClose={close} />);
    fireEvent.change(screen.getByLabelText("Template Name"), {
      target: { value: "New session" },
    });
    act(() => vi.advanceTimersByTime(1600));
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Template Name")).toHaveValue("New session");
  });

  it("stays in the document while it plays its exit animation after closing", () => {
    const real = window.getComputedStyle.bind(window);
    // jsdom runs no CSS animations: report one on the closed dialog the way the browser does.
    vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element, pseudo?: string | null) => {
      const style = real(element, pseudo);
      return element.getAttribute("data-state") === "closed"
        ? new Proxy(style, { get: (target, key) => (key === "animationName" ? "dialog-out" : Reflect.get(target, key)) })
        : style;
    });
    const close = vi.fn();
    const view = render(<SaveTemplateDialog isOpen onClose={close} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "open");
    view.rerender(<SaveTemplateDialog isOpen={false} onClose={close} />);
    // Not unmounted at once (that was the lost animation): it is closing.
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "closed");
  });

  it("avoids form commits during sixty unrelated project revisions", () => {
    const commits = vi.fn();
    render(
      <Profiler id="template" onRender={commits}>
        <SaveTemplateDialog isOpen onClose={() => {}} />
      </Profiler>,
    );
    commits.mockClear();
    for (let index = 0; index < 60; index++)
      act(() =>
        useProjectStore.setState((state) => ({
          project: {
            ...state.project,
            modifiedAt: state.project.modifiedAt + 1,
          },
        })),
      );
    expect(commits).not.toHaveBeenCalled();
  });
});
