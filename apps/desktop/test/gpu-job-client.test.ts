import { describe, it, expect, vi } from "vitest";
import { normalizePresign, buildSubmitBody, GpuJobClient } from "../src/main/gpu/job-client";

function clientWith(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const tokenProvider = { getToken: vi.fn(async () => "tok"), invalidate: vi.fn() };
  const client = new GpuJobClient({
    gpuBaseUrl: "https://gpu.test",
    brokerBaseUrl: "https://broker.test",
    bundleId: "com.openreel.video",
    tokenProvider,
    fetchFn: fetchImpl as unknown as typeof fetch,
  });
  return { client, tokenProvider };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe("normalizePresign", () => {
  it("accepts the canonical shape (uploadURL/mediaKey)", () => {
    const r = normalizePresign({ uploadURL: "https://r2/put", mediaKey: "jobs/a/b/file.mp4", headers: { "Content-Type": "video/mp4" } });
    expect(r).toEqual({ uploadUrl: "https://r2/put", mediaKey: "jobs/a/b/file.mp4", headers: { "Content-Type": "video/mp4" } });
  });
  it("accepts the broker shape (putUrl/objectKey)", () => {
    const r = normalizePresign({ putUrl: "https://r2/put", objectKey: "jobs/a/b/file.mp4" });
    expect(r.uploadUrl).toBe("https://r2/put");
    expect(r.mediaKey).toBe("jobs/a/b/file.mp4");
    expect(r.headers).toEqual({});
  });
  it("throws when both url aliases are missing", () => {
    expect(() => normalizePresign({ mediaKey: "k" })).toThrow();
  });
});

describe("buildSubmitBody", () => {
  it("JSON-only when no mediaKey", () => {
    const { body, contentType } = buildSubmitBody({ kind: "music_generation", params: { prompt: "lofi" } });
    expect(contentType).toBe("application/json");
    expect(JSON.parse(body)).toEqual({ kind: "music_generation", params: { prompt: "lofi" } });
  });
  it("JSON wrapper with mediaKey + mediaFilename", () => {
    const { body } = buildSubmitBody({ kind: "upscale", params: { context: { clipID: "c1" } }, mediaKey: "jobs/x/y/in.mp4", mediaFilename: "in.mp4" });
    expect(JSON.parse(body)).toEqual({
      request: { kind: "upscale", params: { context: { clipID: "c1" } } },
      mediaKey: "jobs/x/y/in.mp4",
      mediaFilename: "in.mp4",
    });
  });
});

describe("GpuJobClient.submitJob", () => {
  it("sends Bearer + X-Bundle-ID and returns the created job", async () => {
    const seen: { init?: RequestInit } = {};
    const { client } = clientWith(async (_url, init) => {
      seen.init = init;
      return jsonResponse(200, { jobID: "job1", status: "queued", manifestURL: "/jobs/job1/manifest" });
    });
    const res = await client.submitJob({ kind: "upscale", params: {}, mediaKey: "jobs/a/b/in.mp4", mediaFilename: "in.mp4" });
    expect(res.jobID).toBe("job1");
    const headers = seen.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-Bundle-ID"]).toBe("com.openreel.video");
  });

  it("surfaces a 503 as a retryable error carrying Retry-After", async () => {
    const { client } = clientWith(async () => jsonResponse(503, { error: "queue_full" }, { "retry-after": "30" }));
    await expect(client.submitJob({ kind: "upscale", params: {}, mediaKey: "k", mediaFilename: "f" })).rejects.toMatchObject({ status: 503, retryAfterSeconds: 30 });
  });

  it("on a 401 invalidates the token and retries once", async () => {
    let n = 0;
    const { client, tokenProvider } = clientWith(async () => {
      n += 1;
      return n === 1 ? jsonResponse(401, { error: "invalid_token" }) : jsonResponse(200, { jobID: "j", status: "queued" });
    });
    const res = await client.submitJob({ kind: "denoise", params: {}, mediaKey: "k", mediaFilename: "f" });
    expect(res.jobID).toBe("j");
    expect(tokenProvider.invalidate).toHaveBeenCalledTimes(1);
    expect(n).toBe(2);
  });
});

describe("GpuJobClient.jobStatus", () => {
  it("GETs /jobs/{id} and returns the status payload", async () => {
    const { client } = clientWith(async (url) => {
      expect(url).toBe("https://gpu.test/jobs/job1");
      return jsonResponse(200, { jobID: "job1", status: "processing", progress: 0.5, queuePosition: 0, pendingAhead: 0 });
    });
    const s = await client.jobStatus("job1");
    expect(s.status).toBe("processing");
    expect(s.progress).toBe(0.5);
  });
});
