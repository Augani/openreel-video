import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionExecutor, type MediaItem } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { useProjectStore } from "../stores/project-store";
import { useKieAIStore, type PendingKieAITask } from "../stores/kieai-store";
import {
  pollTaskOnce,
  type TaskRecord,
} from "../services/kieai/image-generation";
import {
  createPendingKieAIPlaceholder,
  registerAcceptedImageTask,
} from "../services/kieai/image-task-registration";
import { KieAIError } from "../services/kieai/types";
import { useKieAIPoller } from "./useKieAIPoller";
vi.mock("../services/kieai/image-generation", async (original) => ({
  ...(await original<typeof import("../services/kieai/image-generation")>()),
  pollTaskOnce: vi.fn(),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function project(name: string, items: MediaItem[] = []) {
  const executor = new ActionExecutor();
  const project = createEmptyProject(name);
  const result = { ...project, mediaLibrary: { items } };
  useProjectStore.setState({
    hasOpenProject: true,
    project: result,
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
  });
  return result;
}
function task(options: Partial<PendingKieAITask> = {}, withPlaceholder = true) {
  const origin = project("Origin");
  const value: PendingKieAITask = {
    taskId: "task",
    mediaId: "media",
    projectId: origin.id,
    type: "image",
    suggestedName: "result.png",
    createdAt: Date.now(),
    retries: 0,
    failed: false,
    ...options,
  };
  useProjectStore.setState({
    project: {
      ...origin,
      mediaLibrary: {
        items: withPlaceholder ? [createPendingKieAIPlaceholder(value)] : [],
      },
    },
  });
  useKieAIStore.getState().addTask(value);
  return { value, origin: useProjectStore.getState().project };
}
const success: TaskRecord = {
  taskId: "task",
  model: "z-image",
  state: "success",
  resultJson: { resultUrls: ["https://cdn.kie.ai/result.png"] },
  createTime: "",
  updateTime: "",
};
const waiting: TaskRecord = {
  ...success,
  state: "generating",
  resultJson: null,
};
const originalReplace = useProjectStore.getState().replacePlaceholderMedia;
const replace = vi.fn();
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T00:00:00Z"));
  vi.mocked(pollTaskOnce).mockReset().mockResolvedValue(waiting);
  useKieAIStore.setState({ tasks: [] });
  replace.mockReset().mockResolvedValue(undefined);
  useProjectStore.setState({ replacePlaceholderMedia: replace });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["image"], { type: "image/png" }),
    }),
  );
});
afterEach(() => {
  cleanup();
  useProjectStore.setState({ replacePlaceholderMedia: originalReplace });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("KieAI poll ownership", () => {
  it("retains an originating task and skips its download after switching projects", async () => {
    task();
    const pending = deferred<TaskRecord>();
    vi.mocked(pollTaskOnce).mockReturnValueOnce(pending.promise);
    renderHook(() => useKieAIPoller());
    await advance(5000);
    expect(pollTaskOnce).toHaveBeenCalledOnce();
    act(() => {
      project("Next");
    });
    expect(vi.mocked(pollTaskOnce).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => pending.resolve(success));
    expect(fetch).not.toHaveBeenCalled();
    expect(useKieAIStore.getState().tasks).toHaveLength(1);
  });
  it("resumes an originating task when that project opens again", async () => {
    const { origin } = task();
    const pending = deferred<TaskRecord>();
    vi.mocked(pollTaskOnce)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(success);
    renderHook(() => useKieAIPoller());
    await advance(5000);
    act(() => {
      project("Next");
    });
    await act(async () => pending.resolve(success));
    act(() => {
      const executor = new ActionExecutor();
      useProjectStore.setState({
        project: origin,
        actionExecutor: executor,
        actionHistory: executor.getHistory(),
      });
    });
    await advance(25000);
    expect(pollTaskOnce).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledOnce();
    expect(useKieAIStore.getState().tasks).toHaveLength(0);
  });
  it("does not publish or discard work after changing projects during download", async () => {
    task();
    const download = deferred<Blob>();
    vi.mocked(pollTaskOnce).mockResolvedValueOnce(success);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      blob: () => download.promise,
    } as Response);
    renderHook(() => useKieAIPoller());
    await advance(5000);
    expect(fetch).toHaveBeenCalledOnce();
    act(() => {
      project("Next");
    });
    expect(
      (vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal).aborted,
    ).toBe(true);
    await act(async () => download.resolve(new Blob(["image"])));
    expect(replace).not.toHaveBeenCalled();
    expect(useKieAIStore.getState().tasks[0]).toMatchObject({
      failed: false,
      retries: 0,
    });
  });
  it("retains the receipt after a same-project reload during placeholder decoding", async () => {
    const { origin } = task();
    const decode = deferred<void>();
    replace.mockReturnValueOnce(decode.promise);
    vi.mocked(pollTaskOnce).mockResolvedValueOnce(success);
    renderHook(() => useKieAIPoller());
    await advance(5000);
    expect(replace).toHaveBeenCalledOnce();
    act(() => {
      const executor = new ActionExecutor();
      useProjectStore.setState({
        project: origin,
        actionExecutor: executor,
        actionHistory: executor.getHistory(),
      });
    });
    await act(async () => decode.resolve());
    expect(useKieAIStore.getState().tasks).toHaveLength(1);
  });
  it("stops removed work and ignores late responses", async () => {
    task();
    const pending = deferred<TaskRecord>();
    vi.mocked(pollTaskOnce).mockReturnValueOnce(pending.promise);
    renderHook(() => useKieAIPoller());
    await advance(5000);
    act(() => useKieAIStore.getState().removeTask("task"));
    expect(vi.mocked(pollTaskOnce).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => pending.resolve(success));
    expect(fetch).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
  it("preserves a media item that the user replaced while polling", async () => {
    task();
    const pending = deferred<TaskRecord>();
    vi.mocked(pollTaskOnce).mockReturnValueOnce(pending.promise);
    renderHook(() => useKieAIPoller());
    await advance(5000);
    const real = new Blob(["replacement"], { type: "image/png" });
    act(() => {
      const state = useProjectStore.getState();
      useProjectStore.setState({
        project: {
          ...state.project,
          mediaLibrary: {
            items: state.project.mediaLibrary.items.map((item) => ({
              ...item,
              blob: real,
              isPending: false,
              isPlaceholder: false,
              kieaiTaskId: undefined,
            })),
          },
        },
      });
    });
    await act(async () => pending.resolve(success));
    expect(fetch).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project.mediaLibrary.items[0]?.blob).toBe(
      real,
    );
  });
  it("hydrates a late receipt once under Strict Mode and keeps the original thumbnail", async () => {
    task(
      {
        needsPlaceholder: true,
        sourcePreviewUrl: "data:image/png;base64,eA==",
      },
      false,
    );
    renderHook(() => useKieAIPoller(), { wrapper: StrictMode });
    expect(useProjectStore.getState().project.mediaLibrary.items).toEqual([
      expect.objectContaining({
        id: "media",
        thumbnailUrl: "data:image/png;base64,eA==",
        kieaiTaskId: "task",
      }),
    ]);
    expect(useKieAIStore.getState().tasks[0]?.needsPlaceholder).toBe(false);
    await advance(5000);
    expect(pollTaskOnce).toHaveBeenCalledOnce();
  });
  it("aborts owned transport on unmount without failing the pending receipt", async () => {
    task();
    const pending = deferred<TaskRecord>();
    vi.mocked(pollTaskOnce).mockReturnValueOnce(pending.promise);
    const hook = renderHook(() => useKieAIPoller());
    await advance(5000);
    hook.unmount();
    expect(vi.mocked(pollTaskOnce).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () =>
      pending.reject(new DOMException("Aborted", "AbortError")),
    );
    expect(useKieAIStore.getState().tasks[0]).toMatchObject({
      failed: false,
      retries: 0,
    });
  });
});
describe("KieAI polling lifecycle", () => {
  it("downloads and replaces only its managed placeholder, then removes the completed receipt", async () => {
    task();
    vi.mocked(pollTaskOnce).mockResolvedValueOnce(success);
    renderHook(() => useKieAIPoller());
    await advance(5000);
    expect(fetch).toHaveBeenCalledWith("https://cdn.kie.ai/result.png", {
      signal: expect.any(AbortSignal),
    });
    expect(replace).toHaveBeenCalledWith(
      "media",
      expect.any(Blob),
      "result.png",
    );
    expect(useKieAIStore.getState().tasks).toHaveLength(0);
  });
  it.each(["unapproved host", "HTTP error", "empty blob", "invalid result"])(
    "keeps %s failures retryable",
    async (kind) => {
      task();
      vi.mocked(pollTaskOnce).mockResolvedValueOnce(
        kind === "unapproved host"
          ? {
              ...success,
              resultJson: {
                resultUrls: ["https://invalid.example/result.png"],
              },
            }
          : kind === "invalid result"
            ? { ...success, resultJson: "bad json" }
            : success,
      );
      if (kind === "HTTP error")
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 503,
        } as Response);
      if (kind === "empty blob")
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          blob: async () => new Blob(),
        } as Response);
      renderHook(() => useKieAIPoller());
      await advance(5000);
      expect(useKieAIStore.getState().tasks[0]?.failed).toBe(true);
      expect(
        useProjectStore.getState().project.mediaLibrary.items[0],
      ).toMatchObject({ isPending: false, kieaiError: true });
      expect(replace).not.toHaveBeenCalled();
    },
  );
  it("marks a server failure without a download", async () => {
    task();
    vi.mocked(pollTaskOnce).mockResolvedValueOnce({
      ...success,
      state: "fail",
      failMsg: "failed",
    });
    renderHook(() => useKieAIPoller());
    await advance(5000);
    expect(fetch).not.toHaveBeenCalled();
    expect(useKieAIStore.getState().tasks[0]).toMatchObject({
      failed: true,
      retries: 0,
    });
  });
  it("stops at ten consecutive polling errors", async () => {
    task();
    vi.mocked(pollTaskOnce).mockRejectedValue(new Error("offline"));
    renderHook(() => useKieAIPoller());
    await advance(5000);
    for (let index = 1; index < 10; index++) await advance(30000);
    expect(pollTaskOnce).toHaveBeenCalledTimes(10);
    expect(useKieAIStore.getState().tasks[0]).toMatchObject({
      failed: true,
      retries: 10,
    });
    await advance(300000);
    expect(pollTaskOnce).toHaveBeenCalledTimes(10);
  });
  it("resets the consecutive retry count after a successful progress response", async () => {
    task();
    vi.mocked(pollTaskOnce)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(waiting)
      .mockRejectedValueOnce(new Error("offline again"));
    renderHook(() => useKieAIPoller());
    await advance(5000);
    expect(useKieAIStore.getState().tasks[0]?.retries).toBe(1);
    await advance(30000);
    expect(useKieAIStore.getState().tasks[0]?.retries).toBe(0);
    await advance(30000);
    expect(useKieAIStore.getState().tasks[0]).toMatchObject({
      retries: 1,
      failed: false,
    });
  });
  it("stops immediately on authentication errors and can retry after recovery", async () => {
    task();
    vi.mocked(pollTaskOnce).mockRejectedValueOnce(new KieAIError(401, "key"));
    renderHook(() => useKieAIPoller());
    await advance(5000);
    expect(useKieAIStore.getState().tasks[0]).toMatchObject({
      failed: true,
      retries: 0,
    });
    act(() => {
      useProjectStore.getState().setKieAIItemState("media", true, false);
      useKieAIStore.getState().retryTask("task");
    });
    await advance(25000);
    expect(pollTaskOnce).toHaveBeenCalledTimes(2);
    expect(useKieAIStore.getState().tasks[0]?.failed).toBe(false);
  });
});

it("restores an accepted receipt after a refresh whose project snapshot predates the placeholder", () => {
  const origin = project("Origin");
  const executor = useProjectStore.getState().actionExecutor;
  registerAcceptedImageTask({
    taskId: "task",
    mediaId: "media",
    projectId: origin.id,
    executor,
    suggestedName: "result.png",
    previewUrl: "data:image/png;base64,eA==",
  });
  const reloaded = new ActionExecutor();
  useProjectStore.setState({
    project: origin,
    actionExecutor: reloaded,
    actionHistory: reloaded.getHistory(),
  });
  renderHook(() => useKieAIPoller());
  expect(useProjectStore.getState().project.mediaLibrary.items).toEqual([
    expect.objectContaining({
      id: "media",
      kieaiTaskId: "task",
      thumbnailUrl: "data:image/png;base64,eA==",
    }),
  ]);
  expect(useKieAIStore.getState().tasks).toHaveLength(1);
});

it("respects deletion, then resumes the same receipt when Undo restores the placeholder", async () => {
  const { origin } = task();
  renderHook(() => useKieAIPoller());
  act(() => {
    const state = useProjectStore.getState();
    useProjectStore.setState({
      project: { ...state.project, mediaLibrary: { items: [] } },
    });
  });
  expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(0);
  expect(useKieAIStore.getState().tasks[0]?.detached).toBe(true);
  await advance(5000);
  expect(pollTaskOnce).not.toHaveBeenCalled();
  act(() => {
    useProjectStore.setState({ project: origin });
  });
  expect(useKieAIStore.getState().tasks[0]?.detached).toBe(false);
  await advance(25000);
  expect(pollTaskOnce).toHaveBeenCalledOnce();
});
it("does not resurrect a deleted placeholder after task-store rehydration", async () => {
  const { origin } = task();
  const hook = renderHook(() => useKieAIPoller());
  act(() => {
    useProjectStore.setState({
      project: { ...origin, mediaLibrary: { items: [] } },
    });
  });
  expect(useKieAIStore.getState().tasks[0]?.detached).toBe(true);
  hook.unmount();
  const serialized = localStorage.getItem("kieai-pending-tasks")!;
  useKieAIStore.setState({ tasks: [] });
  localStorage.setItem("kieai-pending-tasks", serialized);
  await useKieAIStore.persist.rehydrate();
  const executor = new ActionExecutor();
  useProjectStore.setState({
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
  });
  renderHook(() => useKieAIPoller());
  expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(0);
  await advance(30000);
  expect(pollTaskOnce).not.toHaveBeenCalled();
  expect(useKieAIStore.getState().tasks[0]?.detached).toBe(true);
});
it("does not confuse its own successful publication with a user replacement", async () => {
  task();
  vi.mocked(pollTaskOnce).mockResolvedValueOnce(success);
  replace.mockImplementationOnce(async () => {
    const state = useProjectStore.getState();
    useProjectStore.setState({
      project: {
        ...state.project,
        mediaLibrary: {
          items: state.project.mediaLibrary.items.map((item) => ({
            ...item,
            blob: new Blob(["result"], { type: "image/png" }),
            isPlaceholder: false,
            isPending: false,
            kieaiTaskId: undefined,
          })),
        },
      },
    });
    await Promise.resolve();
    return true;
  });
  renderHook(() => useKieAIPoller());
  await advance(5000);
  expect(useKieAIStore.getState().tasks).toHaveLength(0);
  expect(
    useProjectStore.getState().project.mediaLibrary.items[0]?.isPending,
  ).toBe(false);
});
it("retains a receipt when the project store declines a stale publication", async () => {
  task();
  vi.mocked(pollTaskOnce).mockResolvedValueOnce(success);
  replace.mockImplementationOnce(async () => {
    const state = useProjectStore.getState();
    useProjectStore.setState({
      project: { ...state.project, mediaLibrary: { items: [] } },
    });
    await Promise.resolve();
    return false;
  });
  renderHook(() => useKieAIPoller());
  await advance(5000);
  expect(useKieAIStore.getState().tasks[0]).toMatchObject({
    taskId: "task",
    detached: true,
  });
  expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(0);
});
it("restores a failed receipt as a visible retryable placeholder", () => {
  task({ restorePlaceholder: true }, false);
  useKieAIStore.getState().markFailed("task");
  renderHook(() => useKieAIPoller());
  expect(
    useProjectStore.getState().project.mediaLibrary.items[0],
  ).toMatchObject({
    id: "media",
    isPending: false,
    isPlaceholder: true,
    kieaiError: true,
    kieaiTaskId: "task",
  });
  expect(pollTaskOnce).not.toHaveBeenCalled();
});
