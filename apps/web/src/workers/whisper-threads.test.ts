import { describe, it, expect } from "vitest";
import { ortWasmPathsFor, pickOnnxThreads } from "./whisper-threads";

describe("pickOnnxThreads", () => {
  it("stays single-threaded without cross-origin isolation or on web", () => {
    expect(pickOnnxThreads(false, 16)).toBe(1);
    expect(pickOnnxThreads(true, 16)).toBe(1);
    expect(pickOnnxThreads(false, 16, true)).toBe(1);
  });
  it("on isolated desktop leaves one core free, caps at 8 and survives NaN cores", () => {
    expect(pickOnnxThreads(true, 4, true)).toBe(3);
    expect(pickOnnxThreads(true, 16, true)).toBe(8);
    expect(pickOnnxThreads(true, Number.NaN, true)).toBe(1);
  });
});

describe("ortWasmPathsFor", () => {
  it("is the sibling ort/ directory of the built worker (web root and desktop app:// alike)", () => {
    expect(ortWasmPathsFor("https://openreel.video/assets/whisper-worker-abc.js", false)).toBe("https://openreel.video/ort/");
    expect(ortWasmPathsFor("app://openreel/assets/whisper-worker-abc.js", false)).toBe("app://openreel/ort/");
  });

  it("is /ort/ on the dev server, whose worker lives under /src", () => {
    expect(ortWasmPathsFor("http://localhost:5173/src/workers/whisper-worker.ts?worker_file&type=module", true)).toBe("http://localhost:5173/ort/");
  });
});
