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
  type ExtendedPlaceholder,
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
let engine: TemplateEngine, template: ScriptableTemplate;
const field = (
  type: ExtendedPlaceholder["type"],
  defaultValue: unknown,
  label: string = type,
): ExtendedPlaceholder => ({
  id: type,
  label,
  type,
  required: true,
  defaultValue,
  targets: [],
});
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
  template = {
    ...engine.createFromProject(templateProjectFixture(), {
      name: "All fields",
      description: "Retain typed styles and values",
      category: "custom",
      placeholders: [],
      tags: [],
    }),
    scenes: [
      {
        id: "scene",
        label: "Opening",
        startTime: 0,
        endTime: 2,
        color: "#ee44aa",
      },
    ],
    placeholders: [
      field("text", "Words", "Words"),
      field("subtitle", "Caption", "Caption"),
      field("media", "source-ref", "Footage"),
      {
        ...field("number", 0.37, "Progress"),
        constraints: { min: 0, max: 1, step: 0.01 },
        uiHints: { inputType: "slider" },
      },
      field("boolean", false, "Enabled"),
      field("color", "#ee44aa", "Accent"),
      field("audio", "sound-ref", "Sound"),
      {
        ...field("font", "Inter", "Font"),
        constraints: { allowedFonts: ["Inter", "Poppins"] },
      },
      {
        ...field("animation", "fade", "Animation"),
        constraints: { allowedAnimations: ["fade", "slide"] },
      },
      ...[
        field("shape", { fill: { opacity: 0 } }, "Shape"),
        field("effect", { amount: 0.37 }, "Effect"),
        field(
          "transform",
          { opacity: 0, position: { x: 0, y: 0.37 } },
          "Transform",
        ),
        field("keyframe", [{ time: 0, value: 0.37 }], "Keyframes"),
        field(
          "style",
          {
            shader: {
              shaderId: "paper-mesh-gradient",
              params: { color1: "#ee44aa" },
              progress: 0.37,
            },
          },
          "Style",
        ),
      ].map((item) => ({
        ...item,
        uiHints: {
          inputType: "textarea" as const,
          advanced: true,
          group: "Advanced styles",
        },
      })),
    ],
  };
  vi.spyOn(useEngineStore.getState(), "getTemplateEngine").mockResolvedValue(
    engine,
  );
  vi.spyOn(engine, "applyScriptableTemplate");
  vi.spyOn(useProjectStore.getState(), "forceSave").mockResolvedValue();
  vi.spyOn(autoSaveManager, "forceSave").mockResolvedValue();
  vi.spyOn(autoSaveManager, "clearProjectSaves").mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("full shadcn typed template customization", () => {
  it("resolves selected video and audio originals with their actual names and metadata", async () => {
    const video = useProjectStore.getState().project.mediaLibrary.items[0],
      audioBlob = new Blob(["audio bytes"], { type: "audio/wav" });
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: {
          items: [
            ...state.project.mediaLibrary.items,
            {
              ...video,
              id: "audio-library",
              name: "Audio original.wav",
              type: "audio",
              blob: audioBlob,
              metadata: {
                ...video.metadata,
                width: 0,
                height: 0,
                fileSize: audioBlob.size,
              },
            },
          ],
        },
      },
    }));
    const applied = vi.fn();
    render(
      <TemplatePreviewModal
        template={template}
        onClose={() => {}}
        onApply={applied}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Original.mp4" }));
    fireEvent.click(screen.getByRole("radio", { name: "Audio original.wav" }));
    expect(screen.getByLabelText("Footage")).toHaveValue(video.id);
    expect(screen.getByLabelText("Sound")).toHaveValue("audio-library");
    fireEvent.click(screen.getByRole("button", { name: "Use Template" }));
    await waitFor(() => expect(applied).toHaveBeenCalledOnce());
    const values = vi.mocked(engine.applyScriptableTemplate).mock.calls[0][1];
    expect(values.media).toMatchObject({
      mediaBlob: video.blob,
      media: {
        type: "video",
        name: "Original.mp4",
        metadata: { duration: 2, codec: "h264" },
      },
    });
    expect(values.audio).toMatchObject({
      mediaBlob: audioBlob,
      media: {
        type: "audio",
        name: "Audio original.wav",
        metadata: { width: 0, height: 0, fileSize: audioBlob.size },
      },
    });
  });
  it("preserves all fourteen field types, exact decimals, false, zero, structured data and scenes", async () => {
    const applied = vi.fn();
    render(
      <TemplatePreviewModal
        template={template}
        onClose={() => {}}
        onApply={applied}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleName("All fields");
    expect(screen.getByText("Opening")).toBeInTheDocument();
    expect(screen.getByLabelText("Progress")).toHaveValue(0.37);
    expect(screen.queryByLabelText("Style")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Advanced Options (5)" }),
    );
    expect(
      JSON.parse((screen.getByLabelText("Style") as HTMLTextAreaElement).value),
    ).toEqual(
      template.placeholders.find((item) => item.id === "style")!.defaultValue,
    );
    fireEvent.change(screen.getByLabelText("Progress"), {
      target: { value: "0.375" },
    });
    fireEvent.change(screen.getByLabelText("Transform"), {
      target: { value: '{"opacity":0,"position":{"x":0,"y":0.37}}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use Template" }));
    await waitFor(() => expect(applied).toHaveBeenCalledOnce());
    const values = vi.mocked(engine.applyScriptableTemplate).mock.calls[0][1];
    expect(Object.keys(values)).toHaveLength(14);
    expect(values.number).toEqual({ type: "number", value: 0.375 });
    expect(values.boolean).toEqual({ type: "boolean", value: false });
    expect(values.transform.value).toEqual({
      opacity: 0,
      position: { x: 0, y: 0.37 },
    });
    expect(values.keyframe.value).toEqual([{ time: 0, value: 0.37 }]);
    expect(values.style.value).toEqual(
      template.placeholders.find((item) => item.id === "style")!.defaultValue,
    );
    expect(
      useProjectStore.getState().project.textClips![0].style.shader,
    ).toEqual(templateProjectFixture().textClips![0].style.shader);
  });
  it("keeps incomplete numeric and JSON drafts visible and blocks project writes until corrected", async () => {
    render(
      <TemplatePreviewModal
        template={template}
        onClose={() => {}}
        onApply={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Progress"), {
      target: { value: "" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Advanced Options (5)" }),
    );
    fireEvent.change(screen.getByLabelText("Style"), {
      target: { value: "{" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use Template" }));
    await screen.findByText("Progress must be a finite number");
    expect(
      screen.getByText("Style must contain a valid JSON object or array"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Progress")).toHaveValue(null);
    expect(screen.getByLabelText("Style")).toHaveValue("{");
    expect(engine.applyScriptableTemplate).not.toHaveBeenCalled();
    expect(useProjectStore.getState().forceSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset Progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset Style" }));
    expect(screen.getByLabelText("Progress")).toHaveValue(0.37);
    expect(
      JSON.parse((screen.getByLabelText("Style") as HTMLTextAreaElement).value),
    ).toHaveProperty("shader.progress", 0.37);
  });
  it("cancels initialization and prevents a late application after close", async () => {
    let finish!: (value: TemplateEngine) => void;
    vi.mocked(
      useEngineStore.getState().getTemplateEngine,
    ).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const close = vi.fn();
    render(
      <TemplatePreviewModal
        template={template}
        onClose={close}
        onApply={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use Template" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledOnce();
    await act(async () => finish(engine));
    expect(engine.applyScriptableTemplate).not.toHaveBeenCalled();
    expect(autoSaveManager.forceSave).not.toHaveBeenCalled();
  });
  it("disables fields and rejects duplicate submissions while saving", async () => {
    let finish!: () => void;
    vi.mocked(autoSaveManager.forceSave).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const applied = vi.fn();
    render(
      <TemplatePreviewModal
        template={template}
        onClose={() => {}}
        onApply={applied}
      />,
    );
    const form = screen.getByRole("dialog").querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() =>
      expect(autoSaveManager.forceSave).toHaveBeenCalledOnce(),
    );
    expect(screen.getByLabelText("Words")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Enabled" })).toBeDisabled();
    expect(engine.applyScriptableTemplate).toHaveBeenCalledOnce();
    await act(async () => finish());
    await waitFor(() => expect(applied).toHaveBeenCalledOnce());
  });
});
