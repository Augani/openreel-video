import { describe, expect, it } from "vitest";
import {
  DEFAULT_CODEX_LOCAL_ENDPOINT,
  buildCodexLocalUrl,
  normalizeCodexLocalEndpoint,
  parseCodexTextResponse,
} from "./codex-local";

describe("codex-local", () => {
  it("normalizes loopback endpoints", () => {
    expect(normalizeCodexLocalEndpoint(" http://127.0.0.1:14567/ ")).toBe(DEFAULT_CODEX_LOCAL_ENDPOINT);
    expect(buildCodexLocalUrl("http://localhost:14567/", "/v1/text")).toBe("http://localhost:14567/v1/text");
  });

  it("rejects non-loopback endpoints", () => {
    expect(() => normalizeCodexLocalEndpoint("https://example.com")).toThrow(/loopback/);
    expect(() => normalizeCodexLocalEndpoint("file:///tmp/socket")).toThrow(/http or https/);
  });

  it("parses common text response shapes", () => {
    expect(parseCodexTextResponse({ text: " revised " }, "fallback")).toBe("revised");
    expect(parseCodexTextResponse({ output_text: "output" }, "fallback")).toBe("output");
    expect(parseCodexTextResponse({ choices: [{ message: { content: "choice" } }] }, "fallback")).toBe("choice");
    expect(parseCodexTextResponse({}, "fallback")).toBe("fallback");
  });
});
