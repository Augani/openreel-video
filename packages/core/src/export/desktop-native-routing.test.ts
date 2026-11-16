import { describe, it, expect, vi } from "vitest";

// export-engine pulls in the decode worker module, which reads `self` at load time.
vi.hoisted(() => {
  (globalThis as { self?: unknown }).self ??= globalThis;
});
import { desktopExportRequiresNativeEncoder, exportSettingsRequireNativeEncoder } from "./export-engine";

describe("desktopExportRequiresNativeEncoder", () => {
  it("sends HDR (PQ / HLG) H.265 to the sidecar on desktop while the web check stays WebCodecs-eligible", () => {
    for (const hdr of ["pq", "hlg"] as const) {
      const s = { codec: "h265", format: "mp4", hdr } as const;
      expect(desktopExportRequiresNativeEncoder(s)).toBe(true);
      expect(exportSettingsRequireNativeEncoder(s)).toBe(false);
    }
  });

  it("leaves SDR H.264/H.265 on the fast WebCodecs path", () => {
    expect(desktopExportRequiresNativeEncoder({ codec: "h264", format: "mp4" })).toBe(false);
    expect(desktopExportRequiresNativeEncoder({ codec: "h265", format: "mp4", hdr: "none" })).toBe(false);
  });

  it("keeps everything the web check already requires natively", () => {
    expect(desktopExportRequiresNativeEncoder({ codec: "prores", format: "mov" })).toBe(true);
    expect(desktopExportRequiresNativeEncoder({ codec: "dnxhr", format: "mxf" })).toBe(true);
    expect(desktopExportRequiresNativeEncoder({ codec: "h264", format: "mp4", colorDepth: 10 })).toBe(true);
  });
});
