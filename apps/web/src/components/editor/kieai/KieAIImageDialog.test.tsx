import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "../../../stores/notification-store";
import { selectOption } from "../../../test/select-option";
import { useKieAIPoller } from "../../../hooks/useKieAIPoller";
import {
  ASPECT_RATIO_OPTIONS,
  ASPECT_RATIO_OPTIONS_AUTO,
  ASPECT_RATIO_OPTIONS_BASIC,
} from "./forms/shared";
import { ActionExecutor } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useKieAIStore } from "../../../stores/kieai-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import {
  IMAGE_MODELS,
  createImageTask,
} from "../../../services/kieai/image-generation";
import { uploadFileStream } from "../../../services/kieai/file-upload";
import type { UploadedFile } from "../../../services/kieai/types";
import { KieAIImageDialog } from "./KieAIImageDialog";
vi.mock("../../../services/kieai/image-generation", async (original) => ({
  ...(await original<
    typeof import("../../../services/kieai/image-generation")
  >()),
  createImageTask: vi.fn(),
}));
vi.mock("../../../services/kieai/file-upload", () => ({
  uploadFileStream: vi.fn(),
}));
const source = new File(["source"], "source.png", { type: "image/png" });
const uploaded: UploadedFile = {
  fileId: "f",
  fileName: "source.png",
  originalName: "source.png",
  fileSize: 6,
  mimeType: "image/png",
  uploadPath: "openreel",
  fileUrl: "https://upload.example/source.png",
  downloadUrl: "",
  uploadTime: "",
  expiresAt: "",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function project(name = "Origin") {
  const executor = new ActionExecutor();
  const project = createEmptyProject(name);
  useProjectStore.setState({
    hasOpenProject: true,
    project,
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
  });
  return project;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createImageTask).mockReset().mockResolvedValue("task-1");
  vi.mocked(uploadFileStream).mockReset().mockResolvedValue(uploaded);
  useKieAIStore.setState({ tasks: [] });
  project();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function model(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
  const prompt = screen.getByRole("textbox", { name: "Prompt" });
  fireEvent.change(prompt, { target: { value: "A quiet landscape" } });
  fireEvent.click(screen.getByRole("button", { name: /^Generate with/ }));
}
describe("image dialog ownership", () => {
  it("does not create a remote task from an upload after the project is replaced", async () => {
    const upload = deferred<UploadedFile>();
    vi.mocked(uploadFileStream).mockReturnValueOnce(upload.promise);
    render(
      <KieAIImageDialog
        open
        onClose={vi.fn()}
        sourceFile={source}
        previewUrl={null}
      />,
    );
    await model("Seedream 5 Lite");
    await waitFor(() => expect(uploadFileStream).toHaveBeenCalledOnce());
    act(() => {
      project("Next");
    });
    await act(async () => upload.resolve(uploaded));
    expect(createImageTask).not.toHaveBeenCalled();
    expect(useKieAIStore.getState().tasks).toHaveLength(0);
    expect(useProjectStore.getState().project.mediaLibrary.items).toEqual([]);
  });
  it("keeps an accepted task when the dialog closes during submission without closing a later dialog", async () => {
    const pending = deferred<string>();
    vi.mocked(createImageTask).mockReturnValueOnce(pending.promise);
    const close = vi.fn();
    const origin = useProjectStore.getState().project.id;
    const view = render(
      <KieAIImageDialog
        open
        onClose={close}
        sourceFile={source}
        previewUrl={null}
      />,
    );
    await model("Z-Image");
    await waitFor(() => expect(createImageTask).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: /^(Cancel|Close)$/ }));
    view.rerender(
      <KieAIImageDialog
        open={false}
        onClose={close}
        sourceFile={source}
        previewUrl={null}
      />,
    );
    view.rerender(
      <KieAIImageDialog
        open
        onClose={close}
        sourceFile={source}
        previewUrl={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Qwen" }));
    await act(async () => pending.resolve("accepted-task"));
    expect(useKieAIStore.getState().tasks).toEqual([
      expect.objectContaining({ taskId: "accepted-task", projectId: origin }),
    ]);
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Qwen" })).toBeInTheDocument();
  });
});

const defaults = [
  {
    name: "Seedream 5 Lite",
    model: IMAGE_MODELS.SEEDREAM,
    input: {
      prompt: "A quiet landscape",
      image_urls: [uploaded.fileUrl],
      aspect_ratio: "1:1",
      quality: "basic",
    },
    upload: true,
  },
  {
    name: "Z-Image",
    model: IMAGE_MODELS.Z_IMAGE,
    input: { prompt: "A quiet landscape", aspect_ratio: "1:1" },
    upload: false,
  },
  {
    name: "Nano Banana 2",
    model: IMAGE_MODELS.NANO_BANANA2,
    input: {
      prompt: "A quiet landscape",
      aspect_ratio: "1:1",
      resolution: "2K",
      output_format: "png",
      image_input: [uploaded.fileUrl],
    },
    upload: true,
  },
  {
    name: "Flux 2 Pro",
    model: IMAGE_MODELS.FLUX2,
    input: {
      prompt: "A quiet landscape",
      input_urls: [uploaded.fileUrl],
      aspect_ratio: "1:1",
      resolution: "1K",
    },
    upload: true,
  },
  {
    name: "Grok Imagine",
    model: IMAGE_MODELS.GROK,
    input: { image_urls: [uploaded.fileUrl] },
    upload: true,
  },
  {
    name: "Qwen",
    model: IMAGE_MODELS.QWEN,
    input: {
      prompt: "A quiet landscape",
      image_url: uploaded.fileUrl,
      strength: 0.8,
      output_format: "png",
      acceleration: "regular",
    },
    upload: true,
  },
];
function open() {
  const close = vi.fn();
  const view = render(
    <KieAIImageDialog
      open
      onClose={close}
      sourceFile={source}
      previewUrl={null}
    />,
  );
  return { ...view, close };
}
async function readyForm(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
  const prompt = screen.queryByRole("textbox", { name: "Prompt" });
  if (prompt)
    fireEvent.change(prompt, { target: { value: "A quiet landscape" } });
}
async function generate() {
  fireEvent.click(screen.getByRole("button", { name: /^Generate with/ }));
  await waitFor(() => expect(createImageTask).toHaveBeenCalledOnce());
}
describe("preserved provider payloads", () => {
  it.each(defaults)(
    "submits the exact $name default payload and registers its placeholder",
    async (row) => {
      const { close } = open();
      await readyForm(row.name);
      await generate();
      expect(createImageTask).toHaveBeenCalledWith(row.model, row.input);
      await waitFor(() => expect(close).toHaveBeenCalledOnce());
      if (row.upload)
        expect(uploadFileStream).toHaveBeenCalledWith(
          source,
          {},
          expect.any(AbortSignal),
        );
      else expect(uploadFileStream).not.toHaveBeenCalled();
      const task = useKieAIStore.getState().tasks[0]!;
      expect(task).toMatchObject({
        taskId: "task-1",
        projectId: useProjectStore.getState().project.id,
        suggestedName: "source_kieai.png",
        needsPlaceholder: false,
      });
      expect(useProjectStore.getState().project.mediaLibrary.items).toEqual([
        expect.objectContaining({
          id: task.mediaId,
          isPending: true,
          isPlaceholder: true,
          kieaiTaskId: "task-1",
        }),
      ]);
    },
  );
  it.each([
    ...ASPECT_RATIO_OPTIONS.map((option) => ({
      name: "Seedream 5 Lite",
      option,
    })),
    ...ASPECT_RATIO_OPTIONS.map((option) => ({ name: "Flux 2 Pro", option })),
    ...ASPECT_RATIO_OPTIONS_AUTO.map((option) => ({
      name: "Nano Banana 2",
      option,
    })),
    ...ASPECT_RATIO_OPTIONS_BASIC.map((option) => ({
      name: "Z-Image",
      option,
    })),
  ])("keeps $name aspect ratio $option.value", async ({ name, option }) => {
    open();
    await readyForm(name);
    await selectOption(
      screen.getByRole("combobox", { name: "Aspect Ratio" }),
      option.label.replace(/\s+/g, " "),
    );
    await generate();
    expect(vi.mocked(createImageTask).mock.calls[0][1]).toMatchObject({
      aspect_ratio: option.value,
    });
  });
  it("retains every Qwen control and names JPEG output correctly", async () => {
    open();
    await readyForm("Qwen");
    const strength = screen.getByRole("slider", { name: "Strength" });
    fireEvent.keyDown(strength, { key: "Home" });
    fireEvent.keyDown(strength, { key: "ArrowRight" });
    await selectOption(
      screen.getByRole("combobox", { name: "Format" }),
      "JPEG",
    );
    await selectOption(
      screen.getByRole("combobox", { name: "Acceleration" }),
      "High (fastest)",
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Negative Prompt (optional)" }),
      { target: { value: "avoid text" } },
    );
    await generate();
    expect(createImageTask).toHaveBeenCalledWith(IMAGE_MODELS.QWEN, {
      prompt: "A quiet landscape",
      image_url: uploaded.fileUrl,
      strength: 0.05,
      output_format: "jpeg",
      acceleration: "high",
      negative_prompt: "avoid text",
    });
    expect(useKieAIStore.getState().tasks[0]?.suggestedName).toBe(
      "source_kieai.jpeg",
    );
  });
  it("retains high Seedream quality, Flux resolution and Nano Banana format/resolution", async () => {
    let view = open();
    await readyForm("Seedream 5 Lite");
    await selectOption(
      screen.getByRole("combobox", { name: "Quality" }),
      "High (4K)",
    );
    await generate();
    expect(vi.mocked(createImageTask).mock.calls[0][1]).toMatchObject({
      quality: "high",
    });
    view.unmount();
    vi.mocked(createImageTask).mockClear();
    view = open();
    await readyForm("Flux 2 Pro");
    await selectOption(
      screen.getByRole("combobox", { name: "Resolution" }),
      "2K",
    );
    await generate();
    expect(vi.mocked(createImageTask).mock.calls[0][1]).toMatchObject({
      resolution: "2K",
    });
    view.unmount();
    vi.mocked(createImageTask).mockClear();
    useKieAIStore.setState({ tasks: [] });
    open();
    await readyForm("Nano Banana 2");
    await selectOption(
      screen.getByRole("combobox", { name: "Resolution" }),
      "4K",
    );
    await selectOption(screen.getByRole("combobox", { name: "Format" }), "JPG");
    await generate();
    expect(vi.mocked(createImageTask).mock.calls[0][1]).toMatchObject({
      resolution: "4K",
      output_format: "jpg",
    });
    expect(useKieAIStore.getState().tasks[0]?.suggestedName).toBe(
      "source_kieai.jpg",
    );
  });
});
describe("owned image submission", () => {
  it("aborts an upload on close and ignores its late success", async () => {
    const pending = deferred<UploadedFile>();
    vi.mocked(uploadFileStream).mockReturnValueOnce(pending.promise);
    const view = open();
    await readyForm("Qwen");
    fireEvent.click(screen.getByRole("button", { name: "Generate with Qwen" }));
    await waitFor(() => expect(uploadFileStream).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(vi.mocked(uploadFileStream).mock.calls[0][2]?.aborted).toBe(true);
    await act(async () => pending.resolve(uploaded));
    expect(createImageTask).not.toHaveBeenCalled();
    expect(view.close).toHaveBeenCalledOnce();
  });
  it("prevents a duplicate request from rapid activation", async () => {
    const pending = deferred<UploadedFile>();
    vi.mocked(uploadFileStream).mockReturnValueOnce(pending.promise);
    open();
    await readyForm("Qwen");
    const button = screen.getByRole("button", { name: "Generate with Qwen" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(uploadFileStream).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(uploaded));
    expect(createImageTask).toHaveBeenCalledOnce();
  });
  it("preserves accepted receipts for a project that is no longer open", async () => {
    const pending = deferred<string>();
    vi.mocked(createImageTask).mockReturnValueOnce(pending.promise);
    const origin = useProjectStore.getState().project;
    const view = open();
    await model("Z-Image");
    await waitFor(() => expect(createImageTask).toHaveBeenCalledOnce());
    act(() => {
      project("Next");
    });
    await act(async () => pending.resolve("late-task"));
    expect(useProjectStore.getState().project.mediaLibrary.items).toEqual([]);
    expect(useKieAIStore.getState().tasks).toEqual([
      expect.objectContaining({
        taskId: "late-task",
        projectId: origin.id,
        needsPlaceholder: true,
      }),
    ]);
    expect(view.close).toHaveBeenCalledOnce();
    act(() => {
      const executor = new ActionExecutor();
      useProjectStore.setState({
        project: origin,
        actionExecutor: executor,
        actionHistory: executor.getHistory(),
      });
    });
    const hook = renderHook(() => useKieAIPoller());
    await waitFor(() =>
      expect(
        useProjectStore.getState().project.mediaLibrary.items,
      ).toHaveLength(1),
    );
    expect(useKieAIStore.getState().tasks[0]?.needsPlaceholder).toBe(false);
    hook.unmount();
  });
  it("keeps errors retryable and leaves no placeholder before acceptance", async () => {
    vi.mocked(uploadFileStream).mockRejectedValueOnce(
      new Error("Upload failed"),
    );
    open();
    await readyForm("Qwen");
    fireEvent.click(screen.getByRole("button", { name: "Generate with Qwen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed");
    expect(useKieAIStore.getState().tasks).toHaveLength(0);
    expect(useProjectStore.getState().project.mediaLibrary.items).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "A quiet landscape",
    );
    await generate();
  });
  it("ignores a stale error after source replacement and starts a clean view", async () => {
    const pending = deferred<UploadedFile>();
    vi.mocked(uploadFileStream).mockReturnValueOnce(pending.promise);
    const close = vi.fn();
    const view = render(
      <KieAIImageDialog
        open
        onClose={close}
        sourceFile={source}
        previewUrl={null}
      />,
    );
    await readyForm("Qwen");
    fireEvent.click(screen.getByRole("button", { name: "Generate with Qwen" }));
    view.rerender(
      <KieAIImageDialog
        open
        onClose={close}
        sourceFile={new File(["next"], "next.png")}
        previewUrl={null}
      />,
    );
    await act(async () => pending.reject(new Error("late")));
    expect(
      screen.getByRole("dialog", { name: "Create with KieAI" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });
});

it("reports a request failure after the dialog closes without adding ghost media", async () => {
  const pending = deferred<string>();
  vi.mocked(createImageTask).mockReturnValueOnce(pending.promise);
  const notify = vi.spyOn(toast, "error");
  open();
  await model("Z-Image");
  await waitFor(() => expect(createImageTask).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => pending.reject(new Error("Provider unavailable")));
  expect(notify).toHaveBeenCalledWith(
    "Image submission failed",
    "Provider unavailable",
  );
  expect(useKieAIStore.getState().tasks).toHaveLength(0);
  expect(useProjectStore.getState().project.mediaLibrary.items).toEqual([]);
});

it.each(["fileUrl", "downloadUrl", "url"])(
  "retains the %s upload-response URL fallback",
  async (field) => {
    const response = {
      ...uploaded,
      fileUrl: "",
      downloadUrl: "",
      [field]: "https://fallback.example/source.png",
    };
    vi.mocked(uploadFileStream).mockResolvedValueOnce(response);
    open();
    await readyForm("Qwen");
    await generate();
    expect(vi.mocked(createImageTask).mock.calls[0][1]).toMatchObject({
      image_url: "https://fallback.example/source.png",
    });
  },
);
it("keeps missing upload URLs retryable before creating any remote task", async () => {
  vi.mocked(uploadFileStream).mockResolvedValueOnce({
    ...uploaded,
    fileUrl: "",
    downloadUrl: "",
  });
  open();
  await readyForm("Qwen");
  fireEvent.click(screen.getByRole("button", { name: "Generate with Qwen" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "upload did not return an image URL",
  );
  expect(createImageTask).not.toHaveBeenCalled();
  expect(useKieAIStore.getState().tasks).toHaveLength(0);
});
it("keeps a missing task receipt visible without creating ghost media", async () => {
  vi.mocked(createImageTask).mockResolvedValueOnce("");
  open();
  await readyForm("Z-Image");
  fireEvent.click(
    screen.getByRole("button", { name: "Generate with Z-Image" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "provider did not return a task ID",
  );
  expect(useKieAIStore.getState().tasks).toHaveLength(0);
  expect(useProjectStore.getState().project.mediaLibrary.items).toEqual([]);
});
