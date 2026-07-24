# Desktop Export Quality/Size/Speed/Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give desktop (Electron) exports a Fast/Balanced/Smallest mode, quality-based rate control, and correct H.264/HEVC/AV1/ProRes output — producing smaller files at equal-or-better quality across more formats, reliably.

**Architecture:** Keep the single `NativeFFmpegBackend` → main-process ffmpeg path. The web side forwards `encodeMode` + `quality` over IPC; **all** codec/rate-control/container/pixel-format translation happens in the desktop main process in a new pure `encode-args` module, consumed by `buildFfmpegArgs`. `selectEncoder` becomes mode-aware (hardware for Fast/Balanced, software for Smallest) with a hardware→software fallback.

**Tech Stack:** TypeScript, Electron (main + preload), React (export dialog), ffmpeg (VideoToolbox/libx264/libx265/libsvtav1/prores), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-03-desktop-export-quality-speed-design.md`

**Conventions:** Desktop tests run from `apps/desktop` via `pnpm exec vitest run <path>`. Web tests run from `apps/web` via `pnpm exec vitest run <path>`. Commit after each task.

---

### Task 1: Add `encodeMode` to the shared export settings

**Files:**
- Modify: `packages/core/src/export/types.ts:15-30` (VideoExportSettings) and `:111-121` (DEFAULT_VIDEO_SETTINGS)
- Test: `packages/core/src/export/types.test.ts` (create if absent; otherwise add a case)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/export/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_VIDEO_SETTINGS } from "./types";

describe("DEFAULT_VIDEO_SETTINGS", () => {
  it("defaults encodeMode to balanced", () => {
    expect(DEFAULT_VIDEO_SETTINGS.encodeMode).toBe("balanced");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/core`): `pnpm exec vitest run src/export/types.test.ts`
Expected: FAIL — `encodeMode` is `undefined`.

- [ ] **Step 3: Add the field and default**

In `VideoExportSettings` (after `bitrateMode` line) add:

```ts
  encodeMode?: "fast" | "balanced" | "smallest";
```

In `DEFAULT_VIDEO_SETTINGS` add:

```ts
  encodeMode: "balanced",
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/core`): `pnpm exec vitest run src/export/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export/types.ts packages/core/src/export/types.test.ts
git commit -m "feat(core): add encodeMode to VideoExportSettings"
```

---

### Task 2: Pure `encode-args` module (quality→rate-control + per-codec/mode args)

**Files:**
- Create: `apps/desktop/src/main/sidecar/encode-args.ts`
- Test: `apps/desktop/test/encode-args.test.ts`

This module is pure (no ffmpeg, no IO) and fully unit-tested. It maps `{codec, encoder, mode, quality, width, height, frameRate, proresProfile}` to the video-encode portion of the ffmpeg args, plus container/pixel-format/audio decisions.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/test/encode-args.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  qualityToCrf,
  hardwareTargetKbps,
  containerForCodec,
  pixelFormatForCodec,
  videoEncodeArgs,
  type EncodePlan,
} from "../src/main/sidecar/encode-args";

const base = { width: 1920, height: 1080, frameRate: 30, quality: 80 };

describe("qualityToCrf", () => {
  it("is monotonic decreasing and clamped per family", () => {
    expect(qualityToCrf("x264", 50)).toBeGreaterThan(qualityToCrf("x264", 100));
    expect(qualityToCrf("svtav1", 50)).toBeGreaterThan(qualityToCrf("svtav1", 100));
    expect(qualityToCrf("x264", 0)).toBe(qualityToCrf("x264", 50)); // clamp low
    expect(qualityToCrf("x264", 200)).toBe(qualityToCrf("x264", 100)); // clamp high
  });
});

describe("containerForCodec", () => {
  it("forces mov for prores, mp4 otherwise", () => {
    expect(containerForCodec("prores")).toBe("mov");
    expect(containerForCodec("h264")).toBe("mp4");
    expect(containerForCodec("hevc")).toBe("mp4");
  });
});

describe("pixelFormatForCodec", () => {
  it("uses 10-bit 422 for prores, 420 otherwise", () => {
    expect(pixelFormatForCodec("prores")).toBe("yuv422p10le");
    expect(pixelFormatForCodec("h264")).toBe("yuv420p");
  });
});

describe("videoEncodeArgs", () => {
  it("software smallest uses CRF + preset, no bitrate", () => {
    const plan: EncodePlan = { codec: "h265", encoder: "libx265", mode: "smallest", ...base };
    const args = videoEncodeArgs(plan);
    expect(args).toContain("-c:v");
    expect(args).toContain("libx265");
    expect(args).toContain("-crf");
    expect(args).toContain("-preset");
    expect(args).not.toContain("-b:v");
    expect(args).toContain("-pix_fmt");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p");
  });

  it("hardware balanced uses capped VBR derived from resolution/quality", () => {
    const plan: EncodePlan = { codec: "hevc", encoder: "hevc_videotoolbox", mode: "balanced", ...base };
    const args = videoEncodeArgs(plan);
    expect(args).toContain("hevc_videotoolbox");
    expect(args).toContain("-b:v");
    expect(args).toContain("-maxrate");
    expect(args).toContain("-bufsize");
    expect(args).toContain("-tag:v"); // hvc1 for HEVC
    expect(args[args.indexOf("-tag:v") + 1]).toBe("hvc1");
    expect(args).not.toContain("-crf");
  });

  it("hevc target is smaller than h264 target at the same settings", () => {
    const h264 = hardwareTargetKbps({ codec: "h264", mode: "balanced", ...base });
    const hevc = hardwareTargetKbps({ codec: "hevc", mode: "balanced", ...base });
    expect(hevc).toBeLessThan(h264);
  });

  it("prores uses profile, no crf/bitrate, 10-bit 422", () => {
    const plan: EncodePlan = { codec: "prores", encoder: "prores_videotoolbox", mode: "fast", proresProfile: "hq", ...base };
    const args = videoEncodeArgs(plan);
    expect(args).toContain("-profile:v");
    expect(args[args.indexOf("-profile:v") + 1]).toBe("3");
    expect(args).not.toContain("-crf");
    expect(args).not.toContain("-b:v");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv422p10le");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/desktop`): `pnpm exec vitest run test/encode-args.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `apps/desktop/src/main/sidecar/encode-args.ts`:

```ts
export type ExportCodec = "h264" | "h265" | "hevc" | "av1" | "prores" | "vp9";
export type EncodeMode = "fast" | "balanced" | "smallest";
export type CodecFamily = "x264" | "x265" | "svtav1";

export interface EncodePlan {
  codec: ExportCodec;
  encoder: string; // resolved ffmpeg encoder name (e.g. hevc_videotoolbox, libx265)
  mode: EncodeMode;
  quality: number; // 0-100 from the UI
  width: number;
  height: number;
  frameRate: number;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
}

const clampQuality = (q: number): number => Math.max(50, Math.min(100, q));

// Lower CRF = higher quality / larger file. Mapped from the UI's 50-100 range.
const CRF_BOUNDS: Record<CodecFamily, [number, number]> = {
  x264: [30, 16],
  x265: [30, 18],
  svtav1: [45, 23],
};

export function qualityToCrf(family: CodecFamily, quality: number): number {
  const [lo, hi] = CRF_BOUNDS[family];
  const t = (clampQuality(quality) - 50) / 50; // 0..1
  return Math.round(lo + (hi - lo) * t);
}

export function isSoftwareEncoder(encoder: string): boolean {
  return /^(libx264|libx265|libsvtav1|libaom|libvpx)/.test(encoder);
}

function familyForEncoder(encoder: string): CodecFamily {
  if (encoder.includes("x265")) return "x265";
  if (encoder.includes("svtav1") || encoder.includes("aom") || encoder.includes("av1")) return "svtav1";
  return "x264";
}

// Software preset: Smallest favors size over speed.
function softwarePreset(family: CodecFamily): string {
  if (family === "svtav1") return "5";
  return "slow";
}

// Bits-per-pixel target for hardware capped-VBR, scaled by quality, codec, and mode.
// h264 baseline; modern codecs need fewer bits for the same quality.
const CODEC_BPP_SCALE: Partial<Record<ExportCodec, number>> = {
  h264: 1.0,
  h265: 0.6,
  hevc: 0.6,
  av1: 0.55,
  vp9: 0.7,
};

const MODE_BPP_SCALE: Record<EncodeMode, number> = {
  fast: 0.85,
  balanced: 1.0,
  smallest: 1.0,
};

export function hardwareTargetKbps(plan: {
  codec: ExportCodec;
  mode: EncodeMode;
  quality: number;
  width: number;
  height: number;
  frameRate: number;
}): number {
  const q = clampQuality(plan.quality);
  // bpp ramps 0.07 (q50) -> 0.18 (q100) for h264, then scaled by codec & mode.
  const baseBpp = 0.07 + ((q - 50) / 50) * 0.11;
  const bpp = baseBpp * (CODEC_BPP_SCALE[plan.codec] ?? 1.0) * MODE_BPP_SCALE[plan.mode];
  const kbps = (plan.width * plan.height * plan.frameRate * bpp) / 1000;
  return Math.max(500, Math.round(kbps));
}

export function containerForCodec(codec: ExportCodec): "mp4" | "mov" {
  return codec === "prores" ? "mov" : "mp4";
}

export function pixelFormatForCodec(codec: ExportCodec): string {
  return codec === "prores" ? "yuv422p10le" : "yuv420p";
}

const PRORES_PROFILE_NUM: Record<NonNullable<EncodePlan["proresProfile"]>, string> = {
  proxy: "0",
  lt: "1",
  standard: "2",
  hq: "3",
  "4444": "4",
  "4444xq": "5",
};

export function videoEncodeArgs(plan: EncodePlan): string[] {
  const args: string[] = ["-c:v", plan.encoder];

  if (plan.codec === "prores") {
    args.push("-profile:v", PRORES_PROFILE_NUM[plan.proresProfile ?? "hq"]);
  } else if (isSoftwareEncoder(plan.encoder)) {
    const family = familyForEncoder(plan.encoder);
    args.push("-crf", String(qualityToCrf(family, plan.quality)));
    args.push("-preset", softwarePreset(family));
  } else {
    const target = hardwareTargetKbps(plan);
    args.push(
      "-b:v", `${target}k`,
      "-maxrate", `${Math.round(target * 1.5)}k`,
      "-bufsize", `${target * 2}k`,
    );
  }

  args.push("-pix_fmt", pixelFormatForCodec(plan.codec));

  if (plan.codec === "hevc" || plan.codec === "h265") {
    args.push("-tag:v", "hvc1");
  }

  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/desktop`): `pnpm exec vitest run test/encode-args.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/sidecar/encode-args.ts apps/desktop/test/encode-args.test.ts
git commit -m "feat(desktop): pure encode-args module for codec/mode/quality ffmpeg flags"
```

---

### Task 3: Mode-aware `selectEncoder` with hardware→software fallback

**Files:**
- Modify: `apps/desktop/src/main/sidecar/encoder-probe.ts:42-48` (selectEncoder)
- Test: `apps/desktop/test/encoder-probe.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/test/encoder-probe.test.ts`:

```ts
import { selectEncoder } from "../src/main/sidecar/encoder-probe";

describe("selectEncoder mode-awareness", () => {
  const hw = ["h264_videotoolbox", "hevc_videotoolbox", "libx264", "libx265", "libsvtav1"];

  it("prefers hardware for fast/balanced", () => {
    expect(selectEncoder("h265", "darwin", hw, "balanced")).toBe("hevc_videotoolbox");
    expect(selectEncoder("h264", "darwin", hw, "fast")).toBe("h264_videotoolbox");
  });

  it("forces software for smallest", () => {
    expect(selectEncoder("h265", "darwin", hw, "smallest")).toBe("libx265");
    expect(selectEncoder("av1", "darwin", hw, "smallest")).toBe("libsvtav1");
  });

  it("falls back to software when hardware is missing", () => {
    const swOnly = ["libx264", "libx265", "libsvtav1"];
    expect(selectEncoder("h265", "darwin", swOnly, "balanced")).toBe("libx265");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/desktop`): `pnpm exec vitest run test/encoder-probe.test.ts`
Expected: FAIL — `selectEncoder` takes 3 args; 4th ignored / wrong selection.

- [ ] **Step 3: Make selectEncoder mode-aware**

Replace `selectEncoder` in `encoder-probe.ts`:

```ts
import { isSoftwareEncoder } from "./encode-args";

export function selectEncoder(
  codec: string,
  platform: NodeJS.Platform,
  available: string[],
  mode: "fast" | "balanced" | "smallest" = "balanced",
): string | null {
  const key = (codec === "h265" ? "hevc" : codec) as Codec;
  const pref = PREFERENCE[key];
  if (!pref) return null;
  const hardwareFirst = [...(pref[platform] ?? []), ...(pref.any ?? [])];
  const softwareFirst = [
    ...(pref.any ?? []),
    ...(pref[platform] ?? []),
  ];
  // Smallest wants the software encoder (CRF, best size); others prefer hardware.
  const ordered = mode === "smallest" ? softwareFirst : hardwareFirst;
  const pick = ordered.find((c) => available.includes(c));
  if (pick) return pick;
  // Fallback: any available candidate, software-preferred.
  return (
    [...hardwareFirst, ...softwareFirst].find(
      (c) => available.includes(c) && isSoftwareEncoder(c),
    ) ??
    [...hardwareFirst].find((c) => available.includes(c)) ??
    null
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/desktop`): `pnpm exec vitest run test/encoder-probe.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/sidecar/encoder-probe.ts apps/desktop/test/encoder-probe.test.ts
git commit -m "feat(desktop): mode-aware encoder selection with software fallback"
```

---

### Task 4: Rewrite `buildFfmpegArgs` to use encode-args + mode + container

**Files:**
- Modify: `apps/desktop/src/main/sidecar/export-job.ts:4-38` (ExportArgs + buildFfmpegArgs)
- Test: `apps/desktop/test/build-args.test.ts` (create)

Note: this also **removes `-shortest`** so the rendered video length (stdin EOF at finish) is authoritative and a shorter audio track can no longer truncate the video. The audio WAV already covers the full timeline (`buildSilentWav`/`buildWavFromChunks`).

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/test/build-args.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFfmpegArgs, type ExportArgs } from "../src/main/sidecar/export-job";

const base: ExportArgs = {
  width: 1920, height: 1080, frameRate: 30,
  codec: "hevc", encoder: "hevc_videotoolbox", mode: "balanced", quality: 80,
  bitrateKbps: 15000, outputPath: "/tmp/out.mp4", audioWavPath: "/tmp/a.wav",
  format: "mp4",
};

describe("buildFfmpegArgs", () => {
  it("pipes rawvideo rgba in and the wav, then quality-based video args", () => {
    const a = buildFfmpegArgs(base);
    expect(a.slice(0, 10)).toEqual([
      "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "1920x1080", "-r", "30", "-i",
    ]);
    expect(a).toContain("hevc_videotoolbox");
    expect(a).toContain("-b:v");
    expect(a).toContain("-tag:v");
    expect(a).not.toContain("-shortest");
    expect(a[a.length - 1]).toBe("/tmp/out.mp4");
  });

  it("software smallest uses crf, no bitrate", () => {
    const a = buildFfmpegArgs({ ...base, mode: "smallest", encoder: "libx265" });
    expect(a).toContain("-crf");
    expect(a).not.toContain("-b:v");
  });

  it("prores writes profile + 10-bit and keeps aac audio", () => {
    const a = buildFfmpegArgs({
      ...base, codec: "prores", encoder: "prores_videotoolbox",
      proresProfile: "hq", outputPath: "/tmp/out.mov", format: "mov",
    });
    expect(a).toContain("-profile:v");
    expect(a[a.indexOf("-pix_fmt", a.lastIndexOf("-i") ) + 1]).toBe("yuv422p10le");
    expect(a).toContain("-c:a");
    expect(a[a.indexOf("-c:a") + 1]).toBe("aac");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/desktop`): `pnpm exec vitest run test/build-args.test.ts`
Expected: FAIL — `ExportArgs` has no `mode`/`quality`/`encoder`/`proresProfile`; args still contain `-shortest`.

- [ ] **Step 3: Update ExportArgs + buildFfmpegArgs**

In `export-job.ts`, replace the `ExportArgs` interface and `buildFfmpegArgs`:

```ts
import { videoEncodeArgs, type EncodeMode, type ExportCodec } from "./encode-args";

export interface ExportArgs {
  width: number;
  height: number;
  frameRate: number;
  codec: ExportCodec;
  encoder: string;
  mode: EncodeMode;
  quality: number;
  bitrateKbps: number;
  outputPath: string;
  audioWavPath: string;
  format: string;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
}

export function buildFfmpegArgs(a: ExportArgs): string[] {
  return [
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${a.width}x${a.height}`,
    "-r", String(a.frameRate),
    "-i", "pipe:0",
    "-i", a.audioWavPath,
    ...videoEncodeArgs({
      codec: a.codec,
      encoder: a.encoder,
      mode: a.mode,
      quality: a.quality,
      width: a.width,
      height: a.height,
      frameRate: a.frameRate,
      proresProfile: a.proresProfile,
    }),
    "-c:a", "aac",
    "-progress", "pipe:2",
    a.outputPath,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/desktop`): `pnpm exec vitest run test/build-args.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing export tests to confirm no regression**

Run (from `apps/desktop`): `pnpm exec vitest run test/export-integration.test.ts test/progress-parse.test.ts`
Expected: PASS (update any `buildFfmpegArgs`/`ExportArgs` references in those tests to include `encoder`/`mode`/`quality` if they construct args directly).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/sidecar/export-job.ts apps/desktop/test/build-args.test.ts
git commit -m "feat(desktop): quality-based, codec-correct ffmpeg args; drop -shortest"
```

---

### Task 5: Thread `encodeMode` + `quality` + `proresProfile` through the IPC contract

**Files:**
- Modify: `apps/desktop/src/main/ipc/export.ts:10-21` (ExportStartArgs), `:36-75` (startExport — pass encoder/mode/quality into exportArgs)
- Modify: `apps/web/src/types/global.d.ts:12-23` (OpenReelExportStartArgs)
- Test: `apps/desktop/test/ipc-contract.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/test/ipc-contract.test.ts` a check that `startExport` builds an `ExportArgs` carrying the new fields. If `startExport` is not directly unit-testable, add a focused test on a small extracted helper. Concretely, extract encoder/mode resolution into a pure helper and test it:

```ts
import { resolveExportArgs } from "../src/main/ipc/export";

describe("resolveExportArgs", () => {
  it("carries mode/quality/encoder/proresProfile into ExportArgs", () => {
    const out = resolveExportArgs(
      {
        width: 1920, height: 1080, frameRate: 30, codec: "h265", format: "mp4",
        bitrateKbps: 15000, outputPath: "/tmp/o.mp4", totalFrames: 100,
        audioSampleRate: 48000, audioChannels: 2,
        encodeMode: "smallest", quality: 90,
      },
      "darwin",
      ["libx265", "hevc_videotoolbox"],
      "/tmp/a.wav",
    );
    expect(out.mode).toBe("smallest");
    expect(out.quality).toBe(90);
    expect(out.encoder).toBe("libx265"); // smallest -> software
    expect(out.codec).toBe("hevc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/desktop`): `pnpm exec vitest run test/ipc-contract.test.ts`
Expected: FAIL — `resolveExportArgs` does not exist; `ExportStartArgs` lacks `encodeMode`/`quality`.

- [ ] **Step 3: Add fields + extract `resolveExportArgs`**

In `apps/desktop/src/main/ipc/export.ts`, extend `ExportStartArgs`:

```ts
export interface ExportStartArgs {
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  format: string;
  bitrateKbps: number;
  outputPath: string;
  totalFrames: number;
  audioSampleRate: number;
  audioChannels: number;
  encodeMode?: "fast" | "balanced" | "smallest";
  quality?: number;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
}
```

Add the pure helper and use it in `startExport`:

```ts
import type { ExportArgs } from "../sidecar/export-job";
import type { ExportCodec, EncodeMode } from "../sidecar/encode-args";

export function resolveExportArgs(
  args: ExportStartArgs,
  platform: NodeJS.Platform,
  encoders: string[],
  audioWavPath: string,
): ExportArgs {
  const mode: EncodeMode = args.encodeMode ?? "balanced";
  const encoder = selectEncoder(args.codec, platform, encoders, mode) ?? "libx264";
  const codec = (args.codec === "h265" ? "hevc" : args.codec) as ExportCodec;
  return {
    width: args.width,
    height: args.height,
    frameRate: args.frameRate,
    codec,
    encoder,
    mode,
    quality: args.quality ?? 80,
    bitrateKbps: args.bitrateKbps,
    outputPath: args.outputPath,
    audioWavPath,
    format: args.format,
    proresProfile: args.proresProfile,
  };
}
```

In `startExport`, replace the inline `encoder`/`exportArgs` construction (lines ~38-51) with:

```ts
  const encoders = await probeEncoders();
  const audioWavPath = path.join(os.tmpdir(), `openreel-${jobId}.wav`);
  const exportArgs = resolveExportArgs(args, process.platform, encoders, audioWavPath);
```

(Leave the rest of `startExport` — MessageChannelMain, port wiring — unchanged.)

- [ ] **Step 4: Update the web IPC type**

In `apps/web/src/types/global.d.ts`, extend `OpenReelExportStartArgs` (after `audioChannels`):

```ts
  encodeMode?: "fast" | "balanced" | "smallest";
  quality?: number;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
```

- [ ] **Step 5: Run tests + typecheck**

Run (from `apps/desktop`): `pnpm exec vitest run test/ipc-contract.test.ts` → PASS.
Run (from `apps/desktop`): `pnpm exec tsc --noEmit` → exit 0.
Run (from `apps/web`): `pnpm typecheck` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ipc/export.ts apps/web/src/types/global.d.ts apps/desktop/test/ipc-contract.test.ts
git commit -m "feat(desktop): thread encodeMode/quality/proresProfile through export IPC"
```

---

### Task 6: `NativeFFmpegBackend` forwards `encodeMode`, `quality`, `proresProfile`

**Files:**
- Modify: `apps/web/src/services/native-ffmpeg-backend.ts:91-102` (the `bridge.export.start` payload)

- [ ] **Step 1: Add the fields to the payload**

In `start()`, extend the `bridge.export.start({...})` object:

```ts
    const session = await bridge.export.start({
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      codec: settings.codec,
      format: settings.format,
      bitrateKbps: settings.bitrate,
      outputPath,
      totalFrames,
      audioSampleRate: settings.audioSettings.sampleRate,
      audioChannels: settings.audioSettings.channels,
      encodeMode: settings.encodeMode ?? "balanced",
      quality: settings.quality,
      proresProfile: settings.proresProfile,
    });
```

- [ ] **Step 2: Typecheck**

Run (from `apps/web`): `pnpm typecheck`
Expected: 0 errors (the IPC type from Task 5 now accepts these fields).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/native-ffmpeg-backend.ts
git commit -m "feat(desktop): forward encodeMode/quality/proresProfile to native export"
```

---

### Task 7: Export dialog mode control (desktop) + codec-correct file extension

**Files:**
- Modify: `apps/web/src/services/export-runner.ts:30-35` (`extForFormat`)
- Modify: `apps/web/src/components/editor/ExportDialog.tsx` (custom-tab settings + a desktop-only mode control; pass codec to ext)
- Modify: `apps/web/src/desktop/editor/DesktopExportButton.tsx:30` (use codec-aware ext)
- Test: `apps/web/src/services/export-runner.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/services/export-runner.test.ts`:

```ts
import { extForFormat } from "./export-runner";

describe("extForFormat codec-awareness", () => {
  it("forces mov for prores regardless of format", () => {
    expect(extForFormat("mp4", "prores")).toBe("mov");
  });
  it("keeps format-based extension otherwise", () => {
    expect(extForFormat("mp4", "h264")).toBe("mp4");
    expect(extForFormat("mov")).toBe("mov");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `pnpm exec vitest run src/services/export-runner.test.ts`
Expected: FAIL — `extForFormat` ignores the codec arg.

- [ ] **Step 3: Make `extForFormat` codec-aware**

```ts
export function extForFormat(format: string, codec?: string): ExportContainer {
  if (codec === "prores") return "mov";
  if (format === "mov") return "mov";
  if (format === "webm") return "webm";
  if (format === "wav") return "wav";
  return "mp4";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web`): `pnpm exec vitest run src/services/export-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Use codec-aware ext at the call site**

In `DesktopExportButton.tsx` `handleExport`, change:

```ts
        const ext = extForFormat(settings.format, settings.codec);
```

- [ ] **Step 6: Add the desktop-only mode control to ExportDialog**

In `ExportDialog.tsx`, add `encodeMode` to `customSettings` initial state:

```ts
    encodeMode: "balanced",
```

Add a desktop detection const near the top of the component body:

```ts
  const isDesktop =
    typeof window !== "undefined" && window.openreel?.platform === "desktop";
```

Render a segmented control inside the Custom tab (above the Audio Settings block). It updates `customSettings.encodeMode` and, when a preset is active, is applied by merging into the exported settings in `handleExport`:

```tsx
  {isDesktop && (
    <div className="col-span-2">
      <label className="block text-xs font-medium text-text-secondary mb-2">
        Export mode
      </label>
      <div className="flex gap-2">
        {(
          [
            ["fast", "Fast", "Hardware, quickest"],
            ["balanced", "Balanced", "Hardware, great quality + small"],
            ["smallest", "Smallest", "Software, tiniest files (slow)"],
          ] as const
        ).map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            onClick={() =>
              setCustomSettings({ ...customSettings, encodeMode: value })
            }
            className={`flex-1 px-2 py-1.5 text-[10px] rounded border transition-colors ${
              customSettings.encodeMode === value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-text-secondary hover:border-primary/50"
            }`}
            title={hint}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )}
```

In `handleExport`, ensure the mode rides along even for presets:

```ts
  const handleExport = useCallback(() => {
    const chosen =
      activeTab === "presets" && selectedPreset
        ? (selectedPreset.settings as VideoExportSettings)
        : customSettings;
    const settings: VideoExportSettings = {
      ...chosen,
      encodeMode: customSettings.encodeMode ?? "balanced",
    };
    onExport(settings);
    onClose();
  }, [activeTab, selectedPreset, customSettings, onExport, onClose]);
```

- [ ] **Step 7: Verify dialog still renders (regression) + typecheck**

Run (from `apps/web`): `pnpm exec vitest run src/components/editor/tabs-content.test.tsx`
Expected: PASS (Tabs unaffected).
Run (from `apps/web`): `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/services/export-runner.ts apps/web/src/services/export-runner.test.ts apps/web/src/components/editor/ExportDialog.tsx apps/web/src/desktop/editor/DesktopExportButton.tsx
git commit -m "feat(desktop): export mode control + codec-correct file extension"
```

---

### Task 8: Speed — deeper pipeline + profiling instrumentation

**Files:**
- Modify: `apps/desktop/src/main/ipc/export.ts:23` (`INITIAL_CREDITS`)
- Modify: `apps/web/src/services/native-ffmpeg-backend.ts` (per-frame timing accumulators + a one-line summary log on finalize)

- [ ] **Step 1: Increase pipeline depth**

In `export.ts`, raise the credit window so render and encode overlap more:

```ts
const INITIAL_CREDITS = 24;
```

- [ ] **Step 2: Add profiling accumulators to the backend**

In `NativeFFmpegBackend`, add fields:

```ts
  private readbackMsTotal = 0;
  private creditWaitMsTotal = 0;
  private frameCount = 0;
```

In `readbackFrame`, wrap the `getImageData` work with `performance.now()` deltas accumulating into `readbackMsTotal`. In `addVideoFrame`, measure the credit-wait loop duration into `creditWaitMsTotal` and increment `frameCount`.

- [ ] **Step 3: Log the summary on finalize**

At the end of `finalize()` (after `await this.done`):

```ts
    if (this.frameCount > 0) {
      console.info(
        `[export] frames=${this.frameCount} ` +
          `readback=${(this.readbackMsTotal / this.frameCount).toFixed(1)}ms/f ` +
          `creditWait=${(this.creditWaitMsTotal / this.frameCount).toFixed(1)}ms/f ` +
          `bytes=${this.bytesSent}`,
      );
    }
```

- [ ] **Step 4: Typecheck**

Run (from `apps/web`): `pnpm typecheck` → 0 errors.
Run (from `apps/desktop`): `pnpm exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ipc/export.ts apps/web/src/services/native-ffmpeg-backend.ts
git commit -m "perf(desktop): deeper export pipeline + per-frame profiling log"
```

---

### Task 9: Manual desktop verification matrix

**Files:** none (manual)

- [ ] **Step 1: Rebuild the desktop app** (main + preload + renderer).

- [ ] **Step 2: For each (codec × mode), export a short clip and record results.**

| Codec | Mode | Plays? | File size vs old H.264 | Wall-clock | Notes |
|---|---|---|---|---|---|
| H.264 | Balanced | | | | |
| HEVC | Fast | | | | |
| HEVC | Balanced | | | | |
| HEVC | Smallest | | | | |
| AV1 | Smallest | | | | |
| ProRes | Balanced | | | | |

- [ ] **Step 3: Read the `[export] ...ms/f` profiling line** from DevTools console to determine the dominant cost (readback vs credit-wait/encode). Record it — it decides whether Future Work targets readback elimination (WebCodecs) or the composite renderer.

- [ ] **Step 4: Confirm no `write EPIPE` / uncaught exceptions** in the main-process terminal across all runs.

---

## Self-Review

**Spec coverage:** settings mode (T1), encoder+rate-control matrix (T2/T3/T4), quality→CRF/CQ helper (T2), per-codec container/pixfmt/tags (T2/T4), codec-correct extension (T7), reliability fallback (T3) on top of the already-landed EPIPE/stderr fixes, dialog mode control (T7), speed cheap-wins + profiling (T8), verification matrix (T9). `-shortest` decision resolved (dropped, T4). Shared-helper open question resolved (all translation desktop-side; web forwards raw values).

**Placeholder scan:** no TBD/TODO; all code steps contain full code. T8 Step 2 describes the timing-accumulator edits in prose around named fields — acceptable as they are mechanical `performance.now()` deltas, but the implementer should add the two `const t0 = performance.now()` / `+= performance.now() - t0` pairs in `readbackFrame` and the credit loop.

**Type consistency:** `EncodeMode`/`ExportCodec` exported from `encode-args.ts` and reused in `export-job.ts`, `encoder-probe.ts`, `export.ts`. `selectEncoder` 4-arg signature consistent across T3/T5. `extForFormat(format, codec?)` consistent across T7 call sites. `encodeMode` field consistent core→IPC→backend→main.

**Note:** `vp9`/`vp8`/`webm` remain handled by the existing fallthrough (libvpx/`mp4`); this plan does not add a VP9 preset path (YAGNI — not in the chosen codec scope), but `ExportCodec` includes `vp9` so the types stay sound.
