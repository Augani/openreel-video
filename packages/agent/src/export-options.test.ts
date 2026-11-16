import { describe, expect, it } from "vitest";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool, toMcpTools } from "./registry";
import { makeEmptyProject } from "./test-fixtures";
import { checkExportRequest, parseExportRequest, resolveFormatAndCodec, usesExtendedExportOptions } from "./export-options";
import type {
  EditingHost,
  ExportOptionsCatalog,
  ExportQueueBridge,
  ExportQueueJobInfo,
  FileAccessResolveResult,
  JobResult,
  QueueExportRequest,
} from "./host";

const catalog: ExportOptionsCatalog = {
  platform: "desktop",
  formats: [
    {
      id: "mp4",
      container: "MPEG-4",
      codecs: ["h264", "h265"],
      bitDepths: [8, 10],
      hdr: ["sdr", "pq", "hlg"],
      available: true,
      codecOptions: [
        { codec: "h264", bitDepths: [8], hdr: ["sdr"] },
        { codec: "h265", bitDepths: [8, 10], hdr: ["sdr", "pq", "hlg"] },
      ],
    },
    { id: "mov", container: "QuickTime", codecs: ["h264", "prores"], bitDepths: [8, 10], hdr: ["sdr"], available: true, codecOptions: [{ codec: "h264", bitDepths: [8], hdr: ["sdr"] }, { codec: "prores", bitDepths: [10], hdr: ["sdr"] }] },
    { id: "webm", container: "WebM", codecs: ["vp9"], bitDepths: [8], hdr: ["sdr"], available: true },
    { id: "mxf", container: "MXF", codecs: [], bitDepths: [], hdr: ["sdr"], available: false, reason: "needs the desktop encoder" },
  ],
  presets: [
    { id: "mp4", label: "MP4 Standard", kind: "video", format: "mp4", codec: "h264", width: 1920, height: 1080, frameRate: 30, bitrateKbps: 12000 },
    { id: "youtube-4k", label: "YouTube 4K", kind: "video", format: "mp4", codec: "h264", width: 3840, height: 2160, frameRate: 30, bitrateKbps: 50000 },
    { id: "wav", label: "Audio Only (WAV)", kind: "audio", format: "wav" },
  ],
  resolutions: [{ label: "1080p", width: 1920, height: 1080 }],
  frameRates: [24, 30, 60],
  audioLayouts: ["mono", "stereo", "5.1"],
  hdr: { supported: true },
  timecode: { supported: true },
};

const parse = (args: Record<string, unknown>) => {
  const parsed = parseExportRequest(args);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value;
};

describe("parseExportRequest", () => {
  it("refuses VBR for codecs without rate control", () => {
    const withAv1 = { ...catalog, formats: catalog.formats.map((f) => (f.id === "mp4" ? { ...f, codecs: [...f.codecs, "av1"] } : f)) };
    const issue = checkExportRequest({ codec: "av1", rateControl: "vbr" }, withAv1);
    expect(issue?.code).toBe("UNSUPPORTED");
    expect(issue?.message).toMatch(/av1/);
    expect(checkExportRequest({ codec: "prores", format: "mov", maxBitrateKbps: 9000 }, catalog)?.code).toBe("UNSUPPORTED");
    expect(checkExportRequest({ codec: "h264", rateControl: "vbr", bitrateKbps: 8000, maxBitrateKbps: 12000 }, catalog)).toBeNull();
  });

  it("bitrateMode maps to rate control: vbr1 one-pass, vbr2 two-pass, cbr pins the peak to the target", () => {
    expect(parse({ bitrateMode: "vbr1", bitrateKbps: 8000 })).toMatchObject({ rateControl: "vbr", bitrateKbps: 8000 });
    expect(parse({ bitrateMode: "vbr2", bitrateKbps: 8000, maxBitrateKbps: 12000 })).toMatchObject({ rateControl: "vbr2", bitrateKbps: 8000, maxBitrateKbps: 12000 });
    expect(parse({ bitrateMode: "cbr", bitrateKbps: 8000 })).toMatchObject({ rateControl: "vbr", maxBitrateKbps: 8000 });
    expect(parseExportRequest({ bitrateMode: "cbr" }).ok).toBe(false);
    expect(parseExportRequest({ bitrateMode: "cbr", bitrateKbps: 8000, maxBitrateKbps: 9000 }).ok).toBe(false);
    expect(parseExportRequest({ bitrateMode: "abr" }).ok).toBe(false);
    expect(parseExportRequest({ bitrateMode: "vbr2", rateControl: "vbr" }).ok).toBe(false);
  });

  it("two-pass is accepted on the desktop for H.264 / H.265 and refused with a reason elsewhere", () => {
    expect(checkExportRequest({ codec: "h264", rateControl: "vbr2", bitrateKbps: 8000, maxBitrateKbps: 12000 }, catalog)).toBeNull();
    const web = checkExportRequest({ codec: "h264", rateControl: "vbr2", bitrateKbps: 8000 }, { ...catalog, platform: "web" });
    expect(web?.code).toBe("UNSUPPORTED");
    expect(web?.message).toMatch(/two-pass/i);
    expect(checkExportRequest({ codec: "vp9", format: "webm", rateControl: "vbr2", bitrateKbps: 8000 }, catalog)?.code).toBe("UNSUPPORTED");
    expect(checkExportRequest({ codec: "h264", rateControl: "vbr2" }, catalog)?.code).toBe("INVALID_PARAMS");
    expect(checkExportRequest({ codec: "h265", hdr: "pq", rateControl: "vbr2", bitrateKbps: 8000 }, catalog)?.code).toBe("UNSUPPORTED");
  });

  it("two-pass is refused with a reason when the sequence is Rec.2020 even for SDR output", () => {
    const issue = checkExportRequest({ codec: "h264", rateControl: "vbr2", bitrateKbps: 8000 }, { ...catalog, colorManaged: true });
    expect(issue?.code).toBe("UNSUPPORTED");
    expect(issue?.message).toMatch(/Rec\.2020/);
    expect(checkExportRequest({ codec: "h264", rateControl: "vbr", bitrateKbps: 8000 }, { ...catalog, colorManaged: true })).toBeNull();
  });

  it("accepts the full spec parameter set", () => {
    const value = parse({
      format: "mov", presetId: "mp4", codec: "prores", bitDepth: 10, hdr: "sdr", width: 3840, height: 2160, frameRate: 23.976,
      bitrateKbps: 8000, audioChannels: "5.1", timecode: true, targetLufs: -23, truePeakCeilingDb: -2, outputPath: "/Users/me/Movies/out.mov", overwrite: true,
    });
    expect(value).toMatchObject({ format: "mov", codec: "prores", bitDepth: 10, hdr: "sdr", audioChannels: "5.1", timecode: true, overwrite: true });
  });

  it("rejects out-of-domain values with INVALID_PARAMS", () => {
    for (const bad of [{ format: "avi" }, { codec: "mp3" }, { bitDepth: 12 }, { hdr: "dolby" }, { width: 1920.5 }, { frameRate: -1 }, { audioChannels: "7.1" }, { targetLufs: 5 }, { truePeakCeilingDb: 3 }, { overwrite: true }]) {
      const parsed = parseExportRequest(bad);
      expect(parsed.ok, JSON.stringify(bad)).toBe(false);
      if (!parsed.ok) expect(parsed.issue.code).toBe("INVALID_PARAMS");
    }
  });

  it("parses rate control and rejects a peak below the average", () => {
    expect(parse({ bitrateKbps: 8000, maxBitrateKbps: 12000, rateControl: "vbr" })).toMatchObject({ bitrateKbps: 8000, maxBitrateKbps: 12000, rateControl: "vbr" });
    expect(parseExportRequest({ bitrateKbps: 8000, maxBitrateKbps: 4000 }).ok).toBe(false);
    expect(parseExportRequest({ rateControl: "abr" }).ok).toBe(false);
    expect(usesExtendedExportOptions({ maxBitrateKbps: 9000 })).toBe(true);
  });

  it("treats preset and bitrate as aliases of presetId and bitrateKbps", () => {
    expect(parse({ preset: "4k", bitrate: 9000 })).toMatchObject({ presetId: "4k", bitrateKbps: 9000 });
  });

  it("knows what the legacy surface is", () => {
    expect(usesExtendedExportOptions({ format: "mp4", targetLufs: -16 })).toBe(false);
    expect(usesExtendedExportOptions({ outputPath: "/a/b.mp4", overwrite: true })).toBe(false);
    expect(usesExtendedExportOptions({ hdr: "pq" })).toBe(true);
  });
});

describe("checkExportRequest against get_export_options", () => {
  it("allows combinations the catalog offers", () => {
    expect(checkExportRequest(parse({}), catalog)).toBeNull();
    expect(checkExportRequest(parse({ codec: "h265", hdr: "pq", bitDepth: 10 }), catalog)).toBeNull();
    expect(checkExportRequest(parse({ format: "mov", codec: "prores" }), catalog)).toBeNull();
    expect(checkExportRequest(parse({ presetId: "youtube-4k", outputPath: "/Users/me/Movies/x.mp4" }), catalog)).toBeNull();
  });

  it("infers the container and codec from partial requests", () => {
    expect(resolveFormatAndCodec(parse({ codec: "prores" }), catalog)).toEqual({ format: "mov", codec: "prores" });
    expect(resolveFormatAndCodec(parse({ codec: "vp9" }), catalog)).toEqual({ format: "webm", codec: "vp9" });
    expect(resolveFormatAndCodec(parse({ hdr: "hlg" }), catalog)).toEqual({ format: "mp4", codec: "h265" });
    expect(resolveFormatAndCodec(parse({ presetId: "youtube-4k" }), catalog)).toEqual({ format: "mp4", codec: "h264" });
  });

  it("answers UNSUPPORTED with a hint that lists valid alternatives", () => {
    const hdrH264 = checkExportRequest(parse({ codec: "h264", hdr: "pq" }), catalog);
    expect(hdrH264).toMatchObject({ code: "UNSUPPORTED" });
    expect(hdrH264?.hint).toMatch(/h265/);

    const webm10 = checkExportRequest(parse({ format: "webm", bitDepth: 10 }), catalog);
    expect(webm10?.code).toBe("UNSUPPORTED");
    expect(webm10?.hint).toMatch(/8/);

    const mxf = checkExportRequest(parse({ format: "mxf" }), catalog);
    expect(mxf?.code).toBe("UNSUPPORTED");
    expect(mxf?.message).toMatch(/desktop encoder/);
    expect(mxf?.hint).toMatch(/mp4: h264, h265/);

    const wrongCodec = checkExportRequest(parse({ format: "webm", codec: "h265" }), catalog);
    expect(wrongCodec?.hint).toMatch(/webm supports: vp9/);
  });

  it("reports an unavailable codec with its reason", () => {
    const withReason: ExportOptionsCatalog = {
      ...catalog,
      formats: catalog.formats.map((f) => (f.id === "mov" ? { ...f, codecs: ["h264"], unavailableCodecs: [{ codec: "prores", reason: "no ProRes encoder in this build" }] } : f)),
    };
    const result = checkExportRequest(parse({ format: "mov", codec: "prores" }), withReason);
    expect(result?.message).toMatch(/no ProRes encoder/);
  });

  it("blocks HDR when the machine cannot encode it, naming why", () => {
    const noHdr: ExportOptionsCatalog = {
      ...catalog,
      hdr: { supported: false, reason: "no 10-bit HEVC encoder" },
      formats: catalog.formats.map((f) =>
        f.id === "mp4" ? { ...f, hdr: ["sdr" as const], codecOptions: [{ codec: "h264", bitDepths: [8 as const], hdr: ["sdr" as const] }, { codec: "h265", bitDepths: [8 as const], hdr: ["sdr" as const] }] } : f,
      ),
    };
    const result = checkExportRequest(parse({ hdr: "pq" }), noHdr);
    expect(result?.code).toBe("UNSUPPORTED");
    expect(result?.message).toMatch(/no 10-bit HEVC encoder/);
  });

  it("checks presets, audio layout, timecode and the output extension", () => {
    expect(checkExportRequest(parse({ presetId: "nope" }), catalog)).toMatchObject({ code: "INVALID_PARAMS" });
    expect(checkExportRequest(parse({ presetId: "nope" }), catalog)?.hint).toMatch(/youtube-4k/);
    expect(checkExportRequest(parse({ presetId: "wav" }), catalog)?.message).toMatch(/audio preset/);
    expect(checkExportRequest(parse({ timecode: true }), catalog)?.code).toBe("UNSUPPORTED");
    expect(checkExportRequest(parse({ format: "mov", timecode: true }), catalog)).toBeNull();
    expect(checkExportRequest(parse({ outputPath: "/Users/me/Movies/out.mov" }), catalog)).toMatchObject({ code: "INVALID_PARAMS" });
    expect(checkExportRequest(parse({ audioChannels: "5.1" }), { ...catalog, audioLayouts: ["stereo"] })?.hint).toMatch(/stereo/);
  });
});

function exportHost(options: { files?: (paths: readonly string[]) => FileAccessResolveResult; job?: (params: Record<string, unknown>) => JobResult } = {}) {
  const jobs: Array<[string, Record<string, unknown>]> = [];
  const queued: QueueExportRequest[] = [];
  const bridge: ExportQueueBridge = {
    enqueue: async (request) => {
      queued.push(request);
      const job: ExportQueueJobInfo = { id: "job-1", outputName: "Project.mp4", sequenceName: "Project", presetLabel: "Custom", status: "running", progress: 0, elapsedMs: 0, usePreviews: true };
      return job;
    },
    list: () => [],
    cancel: () => ({ found: false }),
  };
  const host = Object.assign(new HeadlessHost(makeEmptyProject()), {
    exportOptions: async () => catalog,
    exportQueue: bridge,
    runJob: async (kind: string, params: Record<string, unknown>): Promise<JobResult> => {
      jobs.push([kind, params]);
      return options.job ? options.job(params) : { ok: true, data: { path: "/tmp/openreel-export-1.mp4", bytes: 3 } };
    },
    ...(options.files
      ? {
          files: {
            resolve: async (paths: readonly string[]) => options.files!(paths),
            readBytes: async () => new Uint8Array(),
          },
        }
      : {}),
  }) as EditingHost;
  return { host, jobs, queued };
}

describe("get_export_options", () => {
  it("is a read-only tool that returns the catalog", async () => {
    expect(getTool("get_export_options")).toMatchObject({ readOnly: true, expensive: false });
    expect(toMcpTools().some((t) => t.name === "get_export_options")).toBe(true);
    const { host } = exportHost();
    const result = await executeTool("get_export_options", {}, host);
    expect(result.ok).toBe(true);
    const data = result.data as ExportOptionsCatalog;
    expect(data.formats.map((f) => f.id)).toEqual(["mp4", "mov", "webm", "mxf"]);
    expect(data.presets.some((p) => p.id === "youtube-4k")).toBe(true);
    expect(data.audioLayouts).toEqual(["mono", "stereo", "5.1"]);
    expect(data.formats.find((f) => f.id === "mxf")).toMatchObject({ available: false, reason: expect.any(String) });
  });

  it("answers UNSUPPORTED on a host without the live app", async () => {
    const result = await executeTool("get_export_options", {}, new HeadlessHost(makeEmptyProject()));
    expect(result.error).toMatchObject({ code: "UNSUPPORTED" });
  });
});

describe("export_video", () => {
  it("advertises every spec parameter in its input schema", () => {
    const props = Object.keys((getTool("export_video")!.inputSchema as { properties: Record<string, unknown> }).properties);
    for (const key of ["format", "presetId", "codec", "bitDepth", "hdr", "width", "height", "frameRate", "bitrateKbps", "audioChannels", "timecode", "targetLufs", "truePeakCeilingDb", "outputPath", "overwrite"]) {
      expect(props, key).toContain(key);
    }
    expect(getTool("export_video")).toMatchObject({ expensive: true, readOnly: false });
  });

  it("keeps the legacy call shape for a plain export", async () => {
    const { host, jobs } = exportHost();
    const result = await executeTool("export_video", { format: "mp4", targetLufs: -16 }, host);
    expect(result.ok).toBe(true);
    expect(jobs).toEqual([["exportVideo", { format: "mp4", targetLufs: -16 }]]);
  });

  it("passes resolved format and codec for extended options", async () => {
    const { host, jobs } = exportHost();
    await executeTool("export_video", { hdr: "pq" }, host);
    expect(jobs[0]?.[1]).toMatchObject({ format: "mp4", codec: "h265", hdr: "pq", extended: true });
  });

  it("refuses an unsupported combination before starting a job", async () => {
    const { host, jobs } = exportHost();
    const result = await executeTool("export_video", { codec: "h264", hdr: "hlg" }, host);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNSUPPORTED");
    expect(result.error?.hint).toMatch(/h265/);
    expect(jobs).toEqual([]);
  });

  it("returns NO_PROJECT with a hint", async () => {
    const { host } = exportHost();
    const closed = Object.assign(host, { requireOpenProject: () => { throw new Error("No project is open"); } });
    const result = await executeTool("export_video", {}, closed);
    expect(result.error).toMatchObject({ code: "NO_PROJECT" });
    expect(result.error?.hint).toMatch(/create_project/);
  });

  it("checks outputPath against the allowed roots before exporting", async () => {
    const { host, jobs } = exportHost({
      files: (paths) => ({
        resolved: paths.filter((p) => p.startsWith("/Users/me/Movies/")).map((p) => ({ path: p, realPath: p, kind: "file" as const, sizeBytes: 0, exists: p.endsWith("exists.mp4") })),
        rejected: paths.filter((p) => !p.startsWith("/Users/me/Movies/")).map((p) => ({ path: p, code: "OUTSIDE_ALLOWED_ROOTS" as const, message: "Outside the allowed folders" })),
      }),
    });
    const outside = await executeTool("export_video", { outputPath: "/etc/out.mp4" }, host);
    expect(outside.error).toMatchObject({ code: "OUTSIDE_ALLOWED_ROOTS" });
    expect(outside.error?.hint).toMatch(/allowedRoots/);

    const exists = await executeTool("export_video", { outputPath: "/Users/me/Movies/exists.mp4" }, host);
    expect(exists.error).toMatchObject({ code: "INVALID_PARAMS" });
    expect(exists.error?.hint).toMatch(/overwrite:true/);
    expect(jobs).toEqual([]);

    const fine = await executeTool("export_video", { outputPath: "/Users/me/Movies/exists.mp4", overwrite: true }, host);
    expect(fine.ok, JSON.stringify(fine)).toBe(true);
    // A plain export with an outputPath keeps the proven legacy encoder path.
    expect(jobs[0]?.[1]).toEqual({ outputPath: "/Users/me/Movies/exists.mp4", overwrite: true });
  });

  it("needs the desktop app for outputPath", async () => {
    const { host } = exportHost();
    const result = await executeTool("export_video", { outputPath: "/Users/me/Movies/x.mp4" }, host);
    expect(result.error).toMatchObject({ code: "UNSUPPORTED" });
  });

  it("propagates a coded job failure with its hint", async () => {
    const { host } = exportHost({ job: () => ({ ok: false, error: "disk full", code: "UNREADABLE", hint: "Free some space." }) });
    const result = await executeTool("export_video", {}, host);
    expect(result.error).toEqual({ code: "UNREADABLE", message: "disk full", hint: "Free some space." });
  });
});

describe("queue_export", () => {
  it("accepts the new options and hands them to the queue bridge", async () => {
    const { host, queued } = exportHost({ files: (paths) => ({ resolved: paths.map((p) => ({ path: p, realPath: p, kind: "file" as const, sizeBytes: 0, exists: false })), rejected: [] }) });
    const result = await executeTool(
      "queue_export",
      { codec: "h265", hdr: "pq", bitDepth: 10, audioChannels: "stereo", targetLufs: -14, outputPath: "/Users/me/Movies/hdr.mp4", filename: "hdr.mp4" },
      host,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(queued[0]).toMatchObject({ format: "mp4", codec: "h265", hdr: "pq", bitDepth: 10, audioChannels: "stereo", targetLufs: -14, outputPath: "/Users/me/Movies/hdr.mp4", overwrite: false });
  });

  it("refuses an unsupported combination with UNSUPPORTED and a hint", async () => {
    const { host, queued } = exportHost();
    const result = await executeTool("queue_export", { format: "webm", hdr: "pq" }, host);
    expect(result.error?.code).toBe("UNSUPPORTED");
    expect(result.error?.hint).toBeTruthy();
    expect(queued).toEqual([]);
  });

  it("still accepts the old quick preset ids and bitrate", async () => {
    const { host, queued } = exportHost();
    const ok = await executeTool("queue_export", { preset: "mp4", bitrate: 9000 }, host);
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(queued[0]).toMatchObject({ preset: "mp4", bitrate: 9000 });
  });
});
