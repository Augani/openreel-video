import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveFfmpegPath } from "./ffmpeg-path";
import { isSoftwareEncoder } from "./encode-args";

const run = promisify(execFile);

export function parseEncoders(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    // The legend block ("V..... = Video") shares the flag column; require a real
    // encoder identifier so it is skipped.
    .filter((line) => /^[VAS][.A-Z]{5}\s+[A-Za-z0-9_-]+\s/.test(line))
    .map((line) => line.split(/\s+/)[1])
    .filter(Boolean);
}

type Codec = "h264" | "h265" | "hevc" | "av1" | "prores" | "vp9" | "dnxhr";

const PREFERENCE: Partial<Record<Codec, Partial<Record<NodeJS.Platform | "any", string[]>>>> = {
  h264: {
    darwin: ["h264_videotoolbox"],
    win32: ["h264_nvenc", "h264_qsv", "h264_amf"],
    linux: ["h264_nvenc", "h264_vaapi"],
    any: ["libx264"],
  },
  hevc: {
    darwin: ["hevc_videotoolbox"],
    win32: ["hevc_nvenc", "hevc_qsv", "hevc_amf"],
    linux: ["hevc_nvenc", "hevc_vaapi"],
    any: ["libx265"],
  },
  av1: {
    win32: ["av1_nvenc", "av1_qsv", "av1_amf"],
    linux: ["av1_nvenc", "av1_vaapi"],
    any: ["libsvtav1"],
  },
  prores: {
    darwin: ["prores_videotoolbox", "prores_ks"],
    any: ["prores_ks"],
  },
  vp9: {
    any: ["libvpx-vp9"],
  },
  dnxhr: {
    any: ["dnxhd"],
  },
};

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
  const ordered = mode === "smallest" ? softwareFirst : hardwareFirst;
  const pick = ordered.find((c) => available.includes(c));
  if (pick) return pick;
  return (
    [...hardwareFirst, ...softwareFirst].find(
      (c) => available.includes(c) && isSoftwareEncoder(c),
    ) ??
    [...hardwareFirst].find((c) => available.includes(c)) ??
    null
  );
}

let encodersPromise: Promise<string[]> | null = null;

/** `ffmpeg -encoders` listing, cached for the process lifetime. */
export function probeEncoders(): Promise<string[]> {
  encodersPromise ??= run(resolveFfmpegPath(), ["-hide_banner", "-encoders"], { maxBuffer: 4 * 1024 * 1024 })
    .then(({ stdout }) => parseEncoders(stdout))
    .catch(() => {
      encodersPromise = null;
      return [];
    });
  return encodersPromise;
}

const HARDWARE_ENCODER = /_(videotoolbox|nvenc|qsv|amf|vaapi)$/;

export function isHardwareEncoder(encoder: string): boolean {
  return HARDWARE_ENCODER.test(encoder);
}

/** Args for a one-frame encode to the null muxer; exits non-zero when the encoder cannot start. */
export function buildSmokeTestArgs(encoder: string): string[] {
  const args = ["-hide_banner", "-v", "error"];
  if (encoder.endsWith("_vaapi")) args.push("-vaapi_device", "/dev/dri/renderD128");
  args.push("-f", "lavfi", "-i", "color=c=black:s=640x360:r=25:d=0.2");
  if (encoder.endsWith("_vaapi")) args.push("-vf", "format=nv12,hwupload");
  args.push("-frames:v", "1", "-c:v", encoder, "-f", "null", "-");
  return args;
}

async function smokeTest(encoder: string): Promise<boolean> {
  try {
    await run(resolveFfmpegPath(), buildSmokeTestArgs(encoder), { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

/** A failed hardware smoke test may be transient (device busy, driver warming up), so retry after this. */
export const NEGATIVE_RETRY_MS = 60_000;

interface VerifierDeps {
  list: () => Promise<string[]>;
  smoke: (encoder: string) => Promise<boolean>;
  now: () => number;
}

interface SmokeEntry {
  promise: Promise<boolean>;
  /** Set when the test settles; negative results expire NEGATIVE_RETRY_MS after this. */
  failedAt: number | null;
}

/**
 * Listed encoders with hardware candidates filtered to those that actually
 * encode a frame here (a listed encoder can still fail without the device or
 * driver). Software encoders pass through. Positive results are cached for the
 * process lifetime; negative ones are retried after NEGATIVE_RETRY_MS.
 */
export function createEncoderVerifier(deps: VerifierDeps): () => Promise<string[]> {
  const entries = new Map<string, SmokeEntry>();

  const check = (encoder: string): Promise<boolean> => {
    const existing = entries.get(encoder);
    if (existing && (existing.failedAt === null || deps.now() - existing.failedAt < NEGATIVE_RETRY_MS)) {
      return existing.promise;
    }
    const entry: SmokeEntry = { promise: Promise.resolve(false), failedAt: null };
    entry.promise = deps.smoke(encoder).catch(() => false).then((ok) => {
      if (!ok) entry.failedAt = deps.now();
      return ok;
    });
    entries.set(encoder, entry);
    return entry.promise;
  };

  return async () => {
    const listed = await deps.list();
    const results = await Promise.all(
      listed.map(async (e) => (isHardwareEncoder(e) ? ((await check(e)) ? e : null) : e)),
    );
    return results.filter((e): e is string => e !== null);
  };
}

export const getVerifiedEncoders = createEncoderVerifier({
  list: probeEncoders,
  smoke: smokeTest,
  now: Date.now,
});

/**
 * Best H.264 encoder for the proxy/transcode jobs. VAAPI is excluded: it needs
 * `-vaapi_device` and a `hwupload` filter that these arg builders do not emit.
 */
export function pickH264Encoder(platform: NodeJS.Platform, available: string[]): string {
  return selectEncoder("h264", platform, available.filter((e) => !e.endsWith("_vaapi"))) ?? "libx264";
}

export async function getBestH264Encoder(platform: NodeJS.Platform = process.platform): Promise<string> {
  return pickH264Encoder(platform, await getVerifiedEncoders());
}

/** Fire-and-forget; call after first paint so the probes stay off the startup path. */
export function warmEncoderProbe(): void {
  void getVerifiedEncoders();
}
