import { describe, it, expect, vi } from "vitest";
import { createGpuJobRunner, GpuTokenProvider, type GpuRunnerConfig } from "./gpu-job-runner";

function json(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const baseConfig: Omit<GpuRunnerConfig, "fetchFn"> = {
  gpuBaseUrl: "https://gpu.test",
  brokerBaseUrl: "https://broker.test",
  bundleId: "com.openreel.video",
  instanceId: "srv-1",
  pollIntervalMs: 1,
  sleep: async () => {},
  now: () => 1000,
};

describe("GpuTokenProvider", () => {
  it("mints a token via challenge then token, and caches it", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(200, { challengeId: "ch1" }))
      .mockResolvedValueOnce(json(200, { token: "jwt-1", exp: 9999 }));
    const provider = new GpuTokenProvider({ ...baseConfig, fetchFn: fetchFn as unknown as typeof fetch });

    expect(await provider.getToken()).toBe("jwt-1");
    expect(await provider.getToken()).toBe("jwt-1");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls[0][0] as string)).toContain("/auth/challenge");
    expect((fetchFn.mock.calls[1][0] as string)).toContain("/auth/token");
  });

  it("throws on a failed challenge", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(503, {}));
    const provider = new GpuTokenProvider({ ...baseConfig, fetchFn: fetchFn as unknown as typeof fetch });
    await expect(provider.getToken()).rejects.toThrow(/challenge failed/);
  });
});

describe("createGpuJobRunner", () => {
  function routedFetch(jobStatuses: Array<Record<string, unknown>>) {
    let pollIndex = 0;
    return vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/challenge")) return json(200, { challengeId: "ch1" });
      if (url.includes("/auth/token")) return json(200, { token: "jwt", exp: 9999 });
      if (url.endsWith("/jobs") && init?.method === "POST")
        return json(200, { jobID: "job1", status: "queued" });
      if (url.includes("/jobs/job1")) return json(200, jobStatuses[pollIndex++] ?? jobStatuses[jobStatuses.length - 1]);
      return json(404, {});
    });
  }

  it("submits a job and polls to success", async () => {
    const fetchFn = routedFetch([
      { jobID: "job1", status: "running", progress: 50 },
      { jobID: "job1", status: "succeeded", manifestURL: "https://gpu.test/m" },
    ]);
    const runner = createGpuJobRunner({ ...baseConfig, fetchFn: fetchFn as unknown as typeof fetch });

    const result = await runner("upscale", { mediaKey: "k" });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ jobID: "job1", status: "succeeded", manifestURL: "https://gpu.test/m" });
  });

  it("returns an error when the job fails", async () => {
    const fetchFn = routedFetch([{ jobID: "job1", status: "failed", error: "GPU OOM" }]);
    const runner = createGpuJobRunner({ ...baseConfig, fetchFn: fetchFn as unknown as typeof fetch });

    const result = await runner("exportVideo", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("GPU OOM");
  });

  it("times out when the job never reaches a terminal state", async () => {
    let t = 0;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/challenge")) return json(200, { challengeId: "ch1" });
      if (url.includes("/auth/token")) return json(200, { token: "jwt", exp: 9999 });
      if (url.endsWith("/jobs") && init?.method === "POST")
        return json(200, { jobID: "job1", status: "queued" });
      return json(200, { jobID: "job1", status: "running" });
    });
    const runner = createGpuJobRunner({
      ...baseConfig,
      fetchFn: fetchFn as unknown as typeof fetch,
      maxPollMs: 10,
      now: () => (t += 5),
    });
    const result = await runner("exportVideo", {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/);
  });

  it("re-mints the token and retries on a 401 from the job API", async () => {
    let tokenCalls = 0;
    let first = true;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/challenge")) return json(200, { challengeId: "ch1" });
      if (url.includes("/auth/token")) {
        tokenCalls++;
        return json(200, { token: `jwt-${tokenCalls}`, exp: 9999 });
      }
      if (url.endsWith("/jobs") && init?.method === "POST") {
        if (first) {
          first = false;
          return json(401, { error: "expired" });
        }
        return json(200, { jobID: "job1", status: "succeeded" });
      }
      return json(200, { jobID: "job1", status: "succeeded" });
    });
    const runner = createGpuJobRunner({ ...baseConfig, fetchFn: fetchFn as unknown as typeof fetch });
    const result = await runner("upscale", {});
    expect(result.ok).toBe(true);
    expect(tokenCalls).toBeGreaterThanOrEqual(2);
  });

  it("returns an error when submit is rejected", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/auth/challenge")) return json(200, { challengeId: "ch1" });
      if (url.includes("/auth/token")) return json(200, { token: "jwt", exp: 9999 });
      return json(500, {});
    });
    const runner = createGpuJobRunner({ ...baseConfig, fetchFn: fetchFn as unknown as typeof fetch });

    const result = await runner("transcribe", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("submit failed");
  });
});
