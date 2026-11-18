import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSecret } from "../secure-storage";
import {
  kieaiGet,
  kieaiPostForm,
  kieaiPostJson,
  KIEAI_API_BASE_URL,
  KIEAI_BASE_URL,
} from "./client";
import { uploadFileStream } from "./file-upload";
import {
  createImageTask,
  IMAGE_MODELS,
  pollTaskOnce,
} from "./image-generation";
vi.mock("../secure-storage", () => ({ getSecret: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.mocked(getSecret).mockReset().mockResolvedValue("test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 200,
        data: { taskId: "task", fileUrl: "https://upload.example/image.png" },
      }),
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("KieAI transport preservation", () => {
  it("keeps task creation JSON and its accepted receipt outside upload cancellation", async () => {
    expect(
      await createImageTask(IMAGE_MODELS.QWEN, {
        prompt: "Image",
        image_url: "source",
        strength: 0,
        seed: 0,
        enable_safety_checker: false,
      }),
    ).toBe("task");
    expect(fetch).toHaveBeenCalledWith(
      `${KIEAI_API_BASE_URL}/api/v1/jobs/createTask`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
        body: JSON.stringify({
          model: IMAGE_MODELS.QWEN,
          input: {
            prompt: "Image",
            image_url: "source",
            strength: 0,
            seed: 0,
            enable_safety_checker: false,
          },
        }),
      },
    );
    expect(vi.mocked(fetch).mock.calls[0][1]).not.toHaveProperty("signal");
  });
  it("keeps multipart bytes, upload path, custom name and browser boundary with a live signal", async () => {
    const file = new File(["image"], "source.png", { type: "image/png" });
    const controller = new AbortController();
    await uploadFileStream(
      file,
      { uploadPath: "custom", fileName: "new.png" },
      controller.signal,
    );
    expect(fetch).toHaveBeenCalledWith(
      `${KIEAI_BASE_URL}/api/file-stream-upload`,
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer test-key" },
        signal: controller.signal,
      }),
    );
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect(body.get("file")).toEqual(file);
    expect(body.get("uploadPath")).toBe("custom");
    expect(body.get("fileName")).toBe("new.png");
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).not.toHaveProperty(
      "Content-Type",
    );
  });
  it("keeps polling task query encoding and forwards its abort signal", async () => {
    const controller = new AbortController();
    await pollTaskOnce("task / 1", controller.signal);
    expect(fetch).toHaveBeenCalledWith(
      `${KIEAI_API_BASE_URL}/api/v1/jobs/recordInfo?taskId=task+%2F+1`,
      {
        signal: controller.signal,
        headers: { Authorization: "Bearer test-key" },
      },
    );
  });
  it.each(["upload", "read"])(
    "does not read credentials for an already cancelled %s",
    async (kind) => {
      const controller = new AbortController();
      controller.abort();
      const result =
        kind === "upload"
          ? kieaiPostForm("/upload", new FormData(), controller.signal)
          : kieaiGet("/status", {}, KIEAI_API_BASE_URL, controller.signal);
      await expect(result).rejects.toMatchObject({ name: "AbortError" });
      expect(getSecret).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["upload", "read"])(
    "skips %s transport cancelled while waiting for credentials",
    async (kind) => {
      const key = deferred<string>();
      vi.mocked(getSecret).mockReturnValueOnce(key.promise);
      const controller = new AbortController();
      const result =
        kind === "upload"
          ? kieaiPostForm("/upload", new FormData(), controller.signal)
          : kieaiGet("/status", {}, KIEAI_API_BASE_URL, controller.signal);
      const check = expect(result).rejects.toMatchObject({
        name: "AbortError",
      });
      controller.abort();
      key.resolve("test-key");
      await check;
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["upload", "read"])(
    "rejects an ignored, cancelled %s response after JSON resolves",
    async (kind) => {
      const json = deferred<{ code: number; data: object }>();
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => json.promise,
      } as Response);
      const controller = new AbortController();
      const result =
        kind === "upload"
          ? kieaiPostForm("/upload", new FormData(), controller.signal)
          : kieaiGet("/status", {}, KIEAI_API_BASE_URL, controller.signal);
      const check = expect(result).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      controller.abort();
      json.resolve({ code: 200, data: {} });
      await check;
    },
  );
  it("preserves missing-key, HTTP and API envelope failures", async () => {
    vi.mocked(getSecret).mockResolvedValueOnce(null);
    await expect(kieaiPostJson("/task", {})).rejects.toMatchObject({
      code: 401,
    });
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    } as Response);
    await expect(kieaiGet("/status", {})).rejects.toMatchObject({ code: 403 });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 402, msg: "Credit required", data: null }),
    } as Response);
    await expect(
      kieaiPostForm("/upload", new FormData()),
    ).rejects.toMatchObject({ code: 402 });
  });
});
