import { describe, expect, it, vi } from "vitest";
import { GpuJobClient, normalizePresign } from "./job-client";

function jsonRes(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe("desktop GpuJobClient", () => {
  it("normalizes optional download URL aliases", () => {
    const out = normalizePresign({
      putUrl: "https://r2/put",
      objectKey: "jobs/export.mp4",
      getUrl: "https://r2/get",
    });
    expect(out.downloadUrl).toBe("https://r2/get");
  });

  it("uploads ArrayBuffer bytes without copying into a second Uint8Array", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes({
          putUrl: "https://r2/put",
          objectKey: "jobs/export.mp4",
          downloadUrl: "https://r2/get",
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
      } as unknown as Response);
    const client = new GpuJobClient({
      gpuBaseUrl: "https://gpu",
      brokerBaseUrl: "https://broker",
      bundleId: "com.openreel.video",
      tokenProvider: {
        getToken: vi.fn().mockResolvedValue("tok"),
        invalidate: vi.fn(),
      },
      fetchFn,
    });

    const bytes = new ArrayBuffer(3);
    new Uint8Array(bytes).set([1, 2, 3]);
    const result = await client.uploadBytes({
      bytes,
      filename: "export.mp4",
      contentType: "video/mp4",
    });

    expect(result).toEqual({
      mediaKey: "jobs/export.mp4",
      downloadUrl: "https://r2/get",
    });
    const put = fetchFn.mock.calls[1];
    expect(put[0]).toBe("https://r2/put");
    expect(put[1].body).toBeInstanceOf(Uint8Array);
    expect((put[1].body as Uint8Array).buffer).toBe(bytes);
  });
});
