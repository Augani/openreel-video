import { desktopProxyDimensions } from "../../../../../packages/core/src/media/desktop-ingest";
import type { DesktopProxyProfile } from "../../../../../packages/core/src/types/project";

export interface ProxyArgsSpec {
  srcPath: string;
  /** Primary output (ProRes .mov or H.264 .mp4), usually a `.part` name; the muxer is given explicitly. */
  outPath: string;
  /** Second output for the H.264 preview twin of a ProRes proxy. */
  previewOutPath?: string;
  profile: DesktopProxyProfile;
  srcWidth: number;
  srcHeight: number;
  /** x264 / prores_ks worker threads. Kept below the core count so editing stays responsive. */
  threads: number;
  /** Decode acceleration; dropped on the retry after a failed run. */
  hwaccel?: boolean;
}

const H264_ARGS = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-g", "12", "-bf", "0", "-c:a", "aac", "-b:a", "128k"];
// ProRes 422 Proxy: prores_ks profile 0, 10-bit 4:2:2, PCM audio (what QuickTime / Premiere / Resolve expect).
// DNxHR LB: dnxhd encoder, 8-bit 4:2:2, resolution independent; PCM audio like ProRes.
const DNXHR_ARGS = ["-c:v", "dnxhd", "-profile:v", "dnxhr_lb", "-c:a", "pcm_s16le"];
const PRORES_ARGS = ["-c:v", "prores_ks", "-profile:v", "0", "-vendor", "apl0", "-c:a", "pcm_s16le"];

/** ffmpeg arguments for one proxy job: a single decode feeding one or two outputs. */
export function buildProxyArgs(spec: ProxyArgsSpec): string[] {
  const { width, height } = desktopProxyDimensions(spec.srcWidth, spec.srcHeight, spec.profile.size);
  if (!(width > 0) || !(height > 0)) throw new Error("The source frame size is unknown, so a proxy cannot be sized.");
  const scale = `scale=${width}:${height}:flags=bicubic`;
  const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];
  if (spec.hwaccel !== false) args.push("-hwaccel", "auto");
  args.push("-i", spec.srcPath, "-threads", String(Math.max(1, spec.threads)));
  const dnxhr = spec.profile.codec === "dnxhr-lb";
  const prores = spec.profile.codec === "prores-proxy";
  if (dnxhr && spec.previewOutPath) {
    args.push(
      "-filter_complex",
      `[0:v:0]${scale},split=2[a][b];[a]format=yuv422p[p];[b]format=yuv420p[h]`,
      "-map", "[p]", "-map", "0:a:0?", ...DNXHR_ARGS, "-f", "mov", spec.outPath,
      "-map", "[h]", "-map", "0:a:0?", ...H264_ARGS, "-movflags", "+faststart", "-f", "mp4", spec.previewOutPath,
    );
  } else if (dnxhr) {
    args.push("-vf", `${scale},format=yuv422p`, "-map", "0:v:0", "-map", "0:a:0?", ...DNXHR_ARGS, "-f", "mov", spec.outPath);
  } else if (prores && spec.previewOutPath) {
    args.push(
      "-filter_complex",
      `[0:v:0]${scale},split=2[a][b];[a]format=yuv422p10le[p];[b]format=yuv420p[h]`,
      "-map", "[p]", "-map", "0:a:0?", ...PRORES_ARGS, "-f", "mov", spec.outPath,
      "-map", "[h]", "-map", "0:a:0?", ...H264_ARGS, "-movflags", "+faststart", "-f", "mp4", spec.previewOutPath,
    );
  } else if (prores) {
    args.push("-vf", `${scale},format=yuv422p10le`, "-map", "0:v:0", "-map", "0:a:0?", ...PRORES_ARGS, "-f", "mov", spec.outPath);
  } else {
    args.push("-vf", `${scale},format=yuv420p`, "-map", "0:v:0", "-map", "0:a:0?", ...H264_ARGS, "-movflags", "+faststart", "-f", "mp4", spec.outPath);
  }
  // Machine-readable progress on stdout; stderr stays for errors.
  args.push("-progress", "pipe:1", "-nostats");
  return args;
}

/** `out_time_us` / `out_time_ms` (both microseconds in ffmpeg) of the last progress block, in seconds. */
export function parseProgressSeconds(text: string): number | null {
  const matches = [...text.matchAll(/out_time_(?:us|ms)=(-?\d+)/g)];
  const last = matches.at(-1);
  if (!last) return null;
  const micros = Number(last[1]);
  return Number.isFinite(micros) && micros >= 0 ? micros / 1_000_000 : null;
}
