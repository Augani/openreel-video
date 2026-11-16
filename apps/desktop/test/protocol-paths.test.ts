import { describe, it, expect } from "vitest";
import path from "node:path";
import { cacheControlFor, resolveAppPath } from "../src/main/protocol-paths";

const root = path.resolve("/tmp/renderer");

describe("resolveAppPath", () => {
  it("maps root and /motion to index.html with SPA fallback", () => {
    for (const p of ["/", "", "/motion"]) {
      const r = resolveAppPath(root, p);
      expect(r).toMatchObject({ kind: "ok", pathname: "/index.html", spaFallback: true });
    }
  });
  it("only falls back to the SPA for extensionless paths", () => {
    expect(resolveAppPath(root, "/editor")).toMatchObject({ kind: "ok", spaFallback: true });
    expect(resolveAppPath(root, "/assets/a-1.js")).toMatchObject({ kind: "ok", spaFallback: false });
    expect(resolveAppPath(root, "/x.wasm")).toMatchObject({ kind: "ok", spaFallback: false });
  });
  it("rejects malformed escapes with bad-request", () => {
    expect(resolveAppPath(root, "/%E0%A4%A")).toEqual({ kind: "bad-request" });
  });
  it("rejects traversal", () => {
    expect(resolveAppPath(root, "/../secret")).toEqual({ kind: "forbidden" });
    expect(resolveAppPath(root, "/%2e%2e/secret")).toEqual({ kind: "forbidden" });
  });
});

describe("cacheControlFor", () => {
  it("marks only hashed /assets files immutable", () => {
    expect(cacheControlFor("/assets/index-Bx3k9Qz_1.js")).toContain("immutable");
    expect(cacheControlFor("/assets/worker-a1b2c3d4.wasm")).toContain("immutable");
    expect(cacheControlFor("/assets/logo.png")).toBe("no-cache");
    expect(cacheControlFor("/other/index-Bx3k9Qz_1.js")).toBe("no-cache");
    expect(cacheControlFor("/index.html")).toBe("no-cache");
  });
});
