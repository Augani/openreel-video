/**
 * Colour-managed export through the ffmpeg sidecar.
 *
 * The renderer converts each rendered frame to planar YCbCr in the output
 * colour space (BT.2020 primaries, BT.2020 non-constant-luminance matrix, the
 * PQ / HLG / BT.709 transfer; see packages/core/src/export/color-output.ts)
 * and sends those planes. ffmpeg therefore receives raw `yuv*p*` frames that
 * are already in the target space: it does no colour conversion, it only
 * tags the stream and encodes it. Nothing here touches Rec.709 SDR exports,
 * which keep the existing RGBA pipe and `scale` conversion.
 */

export interface NativeColorOutput {
  primaries: "bt709" | "bt2020";
  transfer: "bt709" | "pq" | "hlg";
  bitDepth: 8 | 10;
  /** Chroma sampling of the frames the renderer sends (4:4:4 for ProRes 4444). */
  chroma: "420" | "444";
}

const FFMPEG_TRC: Record<NativeColorOutput["transfer"], string> = {
  bt709: "bt709",
  pq: "smpte2084",
  hlg: "arib-std-b67",
};

export function isNativeColorOutput(value: unknown): value is NativeColorOutput {
  const c = value as Partial<NativeColorOutput> | null;
  return (
    !!c &&
    (c.primaries === "bt709" || c.primaries === "bt2020") &&
    (c.transfer === "bt709" || c.transfer === "pq" || c.transfer === "hlg") &&
    (c.bitDepth === 8 || c.bitDepth === 10) &&
    (c.chroma === "420" || c.chroma === "444")
  );
}

/** ffmpeg pixel format of the raw frames on the pipe. */
export function rawInputPixelFormat(c: NativeColorOutput): string {
  return `yuv${c.chroma}p${c.bitDepth === 10 ? "10le" : ""}`;
}

/** Bytes of one raw frame on the pipe. */
export function rawFrameBytes(width: number, height: number, c: NativeColorOutput): number {
  const samples = c.chroma === "444" ? width * height * 3 : width * height + 2 * (width / 2) * (height / 2);
  return samples * (c.bitDepth === 10 ? 2 : 1);
}

function matrixName(c: NativeColorOutput): string {
  return c.primaries === "bt2020" ? "bt2020nc" : "bt709";
}

/** `-vf setparams` stamps the colour on every frame (the ProRes and mov muxers read it from the frames, not the codec options). */
export function colorFilterArgs(c: NativeColorOutput): string[] {
  return [
    "-vf",
    `setparams=colorspace=${matrixName(c)}:color_primaries=${c.primaries}:color_trc=${FFMPEG_TRC[c.transfer]}:range=tv`,
  ];
}

export function colorTagArgs(c: NativeColorOutput): string[] {
  return [
    "-colorspace", matrixName(c),
    "-color_primaries", c.primaries,
    "-color_trc", FFMPEG_TRC[c.transfer],
    "-color_range", "tv",
  ];
}

/**
 * Mastering display of the HDR10 SEI: Display-P3 primaries with D65 white,
 * 1000 cd/m2 peak, 0.0001 cd/m2 black (the usual HDR10 grading monitor).
 */
export const HDR10_MASTER_DISPLAY = "G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)";
/**
 * Content light level of the HDR10 SEI. The picture is rendered scene-referred (highlights above SDR white are
 * kept), so 203 nits would be wrong and a display could clip to it. The measured MaxCLL / MaxFALL of a render is
 * not known when the encoder starts, so the values declared are those of the mastering display above: a 1000 nit
 * peak and a 400 nit frame average.
 */
export const HDR10_MAX_CLL = "1000,400";

/** `-x265-params` for libx265 (empty when the stream needs nothing beyond the ffmpeg tags). */
export function x265ColorParams(c: NativeColorOutput): string {
  const params = [
    `colorprim=${c.primaries}`,
    `transfer=${FFMPEG_TRC[c.transfer]}`,
    `colormatrix=${matrixName(c)}`,
    "range=limited",
  ];
  if (c.transfer === "pq") {
    params.push("hdr10=1", "hdr10-opt=1", "repeat-headers=1", `master-display=${HDR10_MASTER_DISPLAY}`, `max-cll=${HDR10_MAX_CLL}`);
  } else if (c.transfer === "hlg") {
    params.push("repeat-headers=1");
  }
  return params.join(":");
}
