import { describe, it, expect, vi, afterEach } from "vitest";
import {
  WebGpuTokenProvider,
  WebGpuJobClient,
  normalizePresign,
  buildSubmitBody,
  GpuRequestError,
} from "./gpu-web-client";

function jsonRes(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function binRes(bytes: ArrayBuffer, mime: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": mime }),
    arrayBuffer: async () => bytes,
  } as unknown as Response;
}

const stubTokenProvider = () => ({
  getToken: vi.fn().mockResolvedValue("tok"),
  invalidate: vi.fn(),
});

function makeClient(tokenProvider: ReturnType<typeof stubTokenProvider>): WebGpuJobClient {
  return new WebGpuJobClient({
    gpuBaseUrl: "https://gpu",
    brokerBaseUrl: "https://broker",
    bundleId: "com.openreel.video",
    tokenProvider,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizePresign", () => {
  it("maps putUrl/objectKey to uploadUrl/mediaKey", () => {
    const out = normalizePresign({ putUrl: "https://r2/put", objectKey: "jobs/a/b/in.mp4" });
    expect(out.uploadUrl).toBe("https://r2/put");
    expect(out.mediaKey).toBe("jobs/a/b/in.mp4");
    expect(out.headers).toEqual({});
  });

  it("also accepts uploadURL/mediaKey aliases", () => {
    const out = normalizePresign({ uploadURL: "https://r2/put", mediaKey: "jobs/x" });
    expect(out.uploadUrl).toBe("https://r2/put");
    expect(out.mediaKey).toBe("jobs/x");
  });

  it("throws when fields missing", () => {
    expect(() => normalizePresign({})).toThrow();
  });
});

describe("buildSubmitBody", () => {
  it("wraps request with mediaKey when media present", () => {
    const body = JSON.parse(buildSubmitBody({ kind: "upscale", params: { a: 1 }, mediaKey: "jobs/x", mediaFilename: "in.mp4" }));
    expect(body).toEqual({ request: { kind: "upscale", params: { a: 1 } }, mediaKey: "jobs/x", mediaFilename: "in.mp4" });
  });

  it("sends bare request when no media", () => {
    const body = JSON.parse(buildSubmitBody({ kind: "musicGeneration", params: { prompt: "x" } }));
    expect(body).toEqual({ kind: "musicGeneration", params: { prompt: "x" } });
  });
});

describe("WebGpuTokenProvider", () => {
  it("mints via challenge then token and caches", async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ challengeId: "c1" }))
      .mockResolvedValueOnce(jsonRes({ token: "tok", exp }));
    vi.stubGlobal("fetch", fetchMock);

    const tp = new WebGpuTokenProvider("https://broker", "com.openreel.video", "inst-1");
    expect(await tp.getToken()).toBe("tok");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const challengeBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(challengeBody).toEqual({ platform: "desktop", instanceId: "inst-1" });
    expect(fetchMock.mock.calls[0][1].headers["X-Bundle-ID"]).toBe("com.openreel.video");

    expect(await tp.getToken()).toBe("tok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws GpuRequestError when challenge fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({}, { ok: false, status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const tp = new WebGpuTokenProvider("https://broker", "b", "inst");
    await expect(tp.getToken()).rejects.toBeInstanceOf(GpuRequestError);
  });
});

describe("WebGpuJobClient", () => {
  it("uploads a blob via presigned PUT and returns mediaKey", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ putUrl: "https://r2/put", objectKey: "jobs/sub/uuid/in.mp4" }))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(stubTokenProvider());
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" });
    const { mediaKey } = await client.uploadMedia({ blob, filename: "in.mp4", contentType: "video/mp4" });

    expect(mediaKey).toBe("jobs/sub/uuid/in.mp4");
    expect(fetchMock.mock.calls[0][0]).toBe("https://broker/auth/upload-url");
    const putCall = fetchMock.mock.calls[1];
    expect(putCall[0]).toBe("https://r2/put");
    expect(putCall[1].method).toBe("PUT");
    expect(putCall[1].headers["Content-Type"]).toBe("video/mp4");
    expect(putCall[1].body).toBe(blob);
  });

  it("submits a job with request+mediaKey body and auth headers", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({ jobID: "j1", status: "queued" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(stubTokenProvider());
    const created = await client.submitJob({ kind: "upscale", params: { a: 1 }, mediaKey: "jobs/x", mediaFilename: "in.mp4" });

    expect(created.jobID).toBe("j1");
    expect(fetchMock.mock.calls[0][0]).toBe("https://gpu/jobs");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ request: { kind: "upscale", params: { a: 1 } }, mediaKey: "jobs/x", mediaFilename: "in.mp4" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
    expect(fetchMock.mock.calls[0][1].headers["X-Bundle-ID"]).toBe("com.openreel.video");
  });

  it("throws retryable GpuRequestError on 503 queue full", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers({ "retry-after": "5" }) } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(stubTokenProvider());
    await expect(client.submitJob({ kind: "upscale", params: {}, mediaKey: "jobs/x" })).rejects.toMatchObject({
      status: 503,
      retryAfterSeconds: 5,
    });
  });

  it("invalidates token and retries once on 401", async () => {
    const tokenProvider = stubTokenProvider();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers() } as unknown as Response)
      .mockResolvedValueOnce(jsonRes({ jobID: "j1", status: "processing" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(tokenProvider);
    const status = await client.jobStatus("j1");

    expect(status.status).toBe("processing");
    expect(tokenProvider.invalidate).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("downloads an artifact as bytes + mime", async () => {
    const bytes = new Uint8Array([9, 8, 7]).buffer;
    const fetchMock = vi.fn().mockResolvedValueOnce(binRes(bytes, "image/png"));
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(stubTokenProvider());
    const out = await client.downloadArtifact("j1", "out/result.png");

    expect(out.mime).toBe("image/png");
    expect(new Uint8Array(out.bytes)).toEqual(new Uint8Array([9, 8, 7]));
    expect(fetchMock.mock.calls[0][0]).toBe("https://gpu/jobs/j1/artifacts/out/result.png");
  });
});
