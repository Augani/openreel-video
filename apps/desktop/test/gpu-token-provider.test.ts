import { describe, it, expect, vi } from "vitest";
import { GpuTokenProvider } from "../src/main/gpu/token-provider";

function fakeFetch(responses: Array<{ ok: boolean; status: number; json: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { ok: r.ok, status: r.status, json: async () => r.json } as unknown as Response;
  });
  return { fn, calls };
}

const okChallenge = { ok: true, status: 200, json: { challengeId: "ch1", challenge: "abc" } };
const okToken = (exp: number) => ({ ok: true, status: 200, json: { token: "tok", exp } });

describe("GpuTokenProvider", () => {
  it("mints via challenge then token and caches until near expiry", async () => {
    const now = () => 1_000_000; // ms
    const exp = Math.floor(now() / 1000) + 600;
    const { fn, calls } = fakeFetch([okChallenge, okToken(exp)]);
    const p = new GpuTokenProvider({
      brokerBaseUrl: "https://broker.test",
      bundleId: "com.openreel.video",
      instanceId: "inst-1",
      fetchFn: fn as unknown as typeof fetch,
      now,
    });
    expect(await p.getToken()).toBe("tok");
    expect(await p.getToken()).toBe("tok"); // cached, no new mint
    expect(calls.filter((c) => c.url.endsWith("/auth/challenge")).length).toBe(1);
    expect(calls.filter((c) => c.url.endsWith("/auth/token")).length).toBe(1);
    const chBody = JSON.parse(calls[0].init!.body as string);
    expect(chBody).toEqual({ platform: "desktop", instanceId: "inst-1" });
    const tokBody = JSON.parse(calls[1].init!.body as string);
    expect(tokBody).toEqual({ platform: "desktop", challengeId: "ch1" });
  });

  it("re-mints after invalidate()", async () => {
    const now = () => 1_000_000;
    const exp = Math.floor(now() / 1000) + 600;
    const { fn, calls } = fakeFetch([okChallenge, okToken(exp), okChallenge, okToken(exp)]);
    const p = new GpuTokenProvider({ brokerBaseUrl: "https://b", bundleId: "x", instanceId: "i", fetchFn: fn as unknown as typeof fetch, now });
    await p.getToken();
    p.invalidate();
    await p.getToken();
    expect(calls.filter((c) => c.url.endsWith("/auth/token")).length).toBe(2);
  });

  it("re-mints when the cached token is within 60s of expiry", async () => {
    let t = 1_000_000;
    const now = () => t;
    const exp = Math.floor(t / 1000) + 100; // expires in 100s
    const { fn, calls } = fakeFetch([okChallenge, okToken(exp), okChallenge, okToken(exp + 600)]);
    const p = new GpuTokenProvider({ brokerBaseUrl: "https://b", bundleId: "x", instanceId: "i", fetchFn: fn as unknown as typeof fetch, now });
    await p.getToken();
    t += 50_000; // now 50s before expiry -> within leeway
    await p.getToken();
    expect(calls.filter((c) => c.url.endsWith("/auth/token")).length).toBe(2);
  });

  it("throws on a failed challenge", async () => {
    const { fn } = fakeFetch([{ ok: false, status: 503, json: { error: "auth_unconfigured" } }]);
    const p = new GpuTokenProvider({ brokerBaseUrl: "https://b", bundleId: "x", instanceId: "i", fetchFn: fn as unknown as typeof fetch });
    await expect(p.getToken()).rejects.toThrow();
  });
});
