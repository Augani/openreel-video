import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OLLAMA_PROBE_TIMEOUT_MS, probeOllama, resolveOllamaHost } from "../src/main/ipc/ollama-probe";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("probeOllama", () => {
  it("lists models from /api/tags", async () => {
    const host = await serve((req, res) => {
      expect(req.url).toBe("/api/tags");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ models: [{ name: "llama3.1:8b", size: 4_900_000_000 }, { model: "qwen2.5:7b" }, { nope: 1 }] }));
    });
    expect(await probeOllama({ host })).toEqual({
      reachable: true,
      models: [{ name: "llama3.1:8b", sizeBytes: 4_900_000_000 }, { name: "qwen2.5:7b" }],
    });
  });

  it("is reachable with zero models when none are pulled", async () => {
    const host = await serve((_req, res) => res.end(JSON.stringify({ models: [] })));
    expect(await probeOllama({ host })).toEqual({ reachable: true, models: [] });
  });

  it("fails silently when nothing is listening", async () => {
    const host = await serve((_req, res) => res.end("{}"));
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
    expect(await probeOllama({ host })).toMatchObject({ reachable: false, models: [] });
  });

  it("times out at 500ms instead of hanging", async () => {
    const host = await serve(() => undefined);
    const started = Date.now();
    const result = await probeOllama({ host });
    expect(result).toEqual({ reachable: false, models: [], error: "timeout" });
    expect(Date.now() - started).toBeLessThan(OLLAMA_PROBE_TIMEOUT_MS + 1500);
  });

  it("treats a non-200 or garbage body as unreachable", async () => {
    const bad = await serve((_req, res) => {
      res.statusCode = 500;
      res.end("boom");
    });
    expect(await probeOllama({ host: bad })).toMatchObject({ reachable: false, models: [] });
    const garbage = await serve((_req, res) => res.end("<html>"));
    expect(await probeOllama({ host: garbage })).toMatchObject({ reachable: false, models: [] });
  });
});

describe("resolveOllamaHost", () => {
  it("defaults to loopback 11434", () => {
    expect(resolveOllamaHost({})).toBe("http://127.0.0.1:11434");
  });

  it("honours an override only for loopback http", () => {
    expect(resolveOllamaHost({ OPENREEL_OLLAMA_URL: "http://127.0.0.1:9999/x" })).toBe("http://127.0.0.1:9999");
    expect(resolveOllamaHost({ OPENREEL_OLLAMA_URL: "http://example.com:11434" })).toBe("http://127.0.0.1:11434");
    expect(resolveOllamaHost({ OPENREEL_OLLAMA_URL: "https://127.0.0.1:11434" })).toBe("http://127.0.0.1:11434");
    expect(resolveOllamaHost({ OPENREEL_OLLAMA_URL: "garbage" })).toBe("http://127.0.0.1:11434");
  });
});
