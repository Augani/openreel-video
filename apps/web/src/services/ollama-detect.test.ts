import { afterEach, describe, expect, it, vi } from "vitest";
import { detectOllama } from "./ollama-detect";

function setBridge(probe?: () => Promise<unknown>) {
  (window as unknown as { openreel?: unknown }).openreel = { platform: "desktop", ollama: probe ? { probe } : undefined };
}
afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
  vi.useRealTimers();
});

describe("detectOllama", () => {
  it("returns detected models from the main-process probe", async () => {
    setBridge(async () => ({ reachable: true, models: [{ name: "llama3.1:8b", sizeBytes: 4 }, { name: "" }] }));
    expect(await detectOllama()).toEqual({ reachable: true, models: [{ name: "llama3.1:8b", sizeBytes: 4 }] });
  });

  it("is silent when there is no bridge (web build)", async () => {
    expect(await detectOllama()).toEqual({ reachable: false, models: [] });
    setBridge(undefined);
    expect(await detectOllama()).toEqual({ reachable: false, models: [] });
  });

  it("is silent when the probe rejects (CORS or IPC failure)", async () => {
    setBridge(async () => {
      throw new Error("blocked by CORS");
    });
    expect(await detectOllama()).toEqual({ reachable: false, models: [] });
  });

  it("gives up after the timeout when the probe hangs", async () => {
    vi.useFakeTimers();
    setBridge(() => new Promise(() => undefined));
    const pending = detectOllama(500);
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toEqual({ reachable: false, models: [] });
  });

  it("rejects malformed payloads", async () => {
    setBridge(async () => ({ reachable: true, models: "nope" }));
    expect(await detectOllama()).toEqual({ reachable: false, models: [] });
  });
});
