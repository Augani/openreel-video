import { decodeLosslessJpeg } from "./lossless-jpeg";
import {
  RawDecodeError,
  readTiff,
  tagNumber,
  tagNumbers,
  tagString,
  type TiffFile,
  type TiffIfd,
} from "./tiff";

/**
 * DNG (Adobe Digital Negative, an open TIFF/TIFF-EP profile) decoder. It is
 * also the frame decoder of CinemaDNG, whose frames are plain DNG files.
 *
 * Supported: Bayer CFA (any of the four 2x2 layouts) and LinearRaw (3 samples
 * per pixel); uncompressed 8 to 16 bit (bit-packed or not) and lossless JPEG
 * (compression 7); strips or tiles; LinearizationTable; ActiveArea;
 * DefaultCrop; the DNG colour model (ColorMatrix1/2, ForwardMatrix1/2,
 * CameraCalibration, AsShotNeutral/AsShotWhiteXY, BaselineExposure).
 *
 * Not supported (reported as a clear `RawDecodeError`): lossy / deflate / float
 * DNG, X-Trans and other non-2x2 CFA layouts, 4-colour sensors, opcode lists.
 */

export type CfaColor = 0 | 1 | 2; // 0 = R, 1 = G, 2 = B

export interface DngRaw {
  readonly format: "dng";
  /** Full stored size in pixels (including any masked border). */
  readonly width: number;
  readonly height: number;
  readonly samplesPerPixel: 1 | 3;
  /** Sensor samples; `width * samplesPerPixel * height` values. */
  readonly data: Uint16Array;
  /** Colour of the 2x2 CFA cells in reading order (TL, TR, BL, BR). Unused for LinearRaw. */
  readonly cfa: readonly [CfaColor, CfaColor, CfaColor, CfaColor];
  /** Black level per 2x2 cell (or per channel for LinearRaw). */
  readonly blackLevel: readonly [number, number, number, number];
  readonly whiteLevel: number;
  /** Top, left, bottom, right of the sensor's active area. */
  readonly activeArea: readonly [number, number, number, number];
  /** Left, top, width, height of the default crop, relative to the active area. */
  readonly crop: readonly [number, number, number, number];
  /** TIFF orientation 1..8. */
  readonly orientation: number;
  readonly colorMatrix1: readonly number[] | null;
  readonly colorMatrix2: readonly number[] | null;
  readonly forwardMatrix1: readonly number[] | null;
  readonly forwardMatrix2: readonly number[] | null;
  readonly cameraCalibration1: readonly number[] | null;
  readonly cameraCalibration2: readonly number[] | null;
  readonly analogBalance: readonly number[] | null;
  /** EXIF light source code, e.g. 17 = Standard light A, 21 = D65. */
  readonly illuminant1: number;
  readonly illuminant2: number;
  /** Camera neutral (white balance as shot), RGB, or null. */
  readonly asShotNeutral: readonly number[] | null;
  readonly asShotWhiteXY: readonly [number, number] | null;
  /** Stops of exposure the camera maker recommends (DNG BaselineExposure). */
  readonly baselineExposure: number;
  readonly make?: string;
  readonly model?: string;
  /** CinemaDNG frame rate tag, when the file carries one. */
  readonly frameRate?: number;
  readonly bitsPerSample: number;
  readonly compression: "none" | "lossless-jpeg";
}

const T = {
  NewSubfileType: 254,
  Width: 256,
  Height: 257,
  BitsPerSample: 258,
  Compression: 259,
  Photometric: 262,
  Make: 271,
  Model: 272,
  StripOffsets: 273,
  Orientation: 274,
  SamplesPerPixel: 277,
  RowsPerStrip: 278,
  StripByteCounts: 279,
  PlanarConfig: 284,
  Predictor: 317,
  TileWidth: 322,
  TileLength: 323,
  TileOffsets: 324,
  TileByteCounts: 325,
  SampleFormat: 339,
  CFARepeatPatternDim: 33421,
  CFAPattern: 33422,
  DNGVersion: 50706,
  LinearizationTable: 50712,
  BlackLevelRepeatDim: 50713,
  BlackLevel: 50714,
  WhiteLevel: 50717,
  DefaultCropOrigin: 50719,
  DefaultCropSize: 50720,
  ColorMatrix1: 50721,
  ColorMatrix2: 50722,
  CameraCalibration1: 50723,
  CameraCalibration2: 50724,
  AnalogBalance: 50727,
  AsShotNeutral: 50728,
  AsShotWhiteXY: 50729,
  BaselineExposure: 50730,
  CalibrationIlluminant1: 50778,
  CalibrationIlluminant2: 50779,
  ActiveArea: 50829,
  ForwardMatrix1: 50964,
  ForwardMatrix2: 50965,
  CinemaDngFrameRate: 51044,
} as const;

const PHOTOMETRIC_CFA = 32803;
const PHOTOMETRIC_LINEAR_RAW = 34892;
const MAX_PIXELS = 400_000_000;
/** Largest tile / strip block (in samples) the decoder will allocate for one block. */
const MAX_BLOCK_SAMPLES = 1 << 28;

function allIfds(file: TiffFile): TiffIfd[] {
  const out: TiffIfd[] = [];
  const walk = (ifd: TiffIfd) => {
    out.push(ifd);
    ifd.subIfds.forEach(walk);
  };
  file.ifds.forEach(walk);
  return out;
}

export function looksLikeDng(buffer: ArrayBuffer | Uint8Array): boolean {
  try {
    const file = readTiff(buffer);
    return file.ifds.some((ifd) => ifd.entries.has(T.DNGVersion));
  } catch {
    return false;
  }
}

const CFA_COLOR_OF: Readonly<Record<number, CfaColor>> = { 0: 0, 1: 1, 2: 2 };

function matrixOrNull(values: number[], n: number): readonly number[] | null {
  return values.length === n && values.every(Number.isFinite) ? values : null;
}

/** MSB-first bit unpacking of `bits`-wide samples (the DNG packed layout for 10/12/14 bit). */
function unpackBits(src: Uint8Array, count: number, bits: number, out: Uint16Array, outOffset: number): void {
  if (bits === 16) {
    for (let i = 0; i < count; i++) out[outOffset + i] = (src[i * 2] << 8) | src[i * 2 + 1];
    return;
  }
  if (bits === 8) {
    for (let i = 0; i < count; i++) out[outOffset + i] = src[i];
    return;
  }
  let acc = 0;
  let have = 0;
  let p = 0;
  const mask = (1 << bits) - 1;
  for (let i = 0; i < count; i++) {
    while (have < bits) {
      acc = ((acc << 8) | (p < src.length ? src[p] : 0)) >>> 0;
      p++;
      have += 8;
    }
    out[outOffset + i] = (acc >>> (have - bits)) & mask;
    have -= bits;
    acc &= (1 << have) - 1;
  }
}

function toLittleEndian16(file: TiffFile, src: Uint8Array): Uint8Array {
  if (file.littleEndian) {
    // 16-bit little-endian: swap so unpackBits (MSB-first) can read it uniformly.
    const swapped = new Uint8Array(src.length);
    for (let i = 0; i + 1 < src.length; i += 2) {
      swapped[i] = src[i + 1];
      swapped[i + 1] = src[i];
    }
    return swapped;
  }
  return src;
}

export function decodeDng(buffer: ArrayBuffer | Uint8Array): DngRaw {
  const file = readTiff(buffer);
  const ifds = allIfds(file);
  const ifd0 = file.ifds[0];

  let best: { ifd: TiffIfd; area: number } | null = null;
  for (const ifd of ifds) {
    const photometric = tagNumber(file, ifd, T.Photometric);
    if (photometric !== PHOTOMETRIC_CFA && photometric !== PHOTOMETRIC_LINEAR_RAW) continue;
    const area = (tagNumber(file, ifd, T.Width) ?? 0) * (tagNumber(file, ifd, T.Height) ?? 0);
    if (!best || area > best.area) best = { ifd, area };
  }
  if (!best) {
    throw new RawDecodeError(
      file.ifds[0].entries.has(T.DNGVersion)
        ? "This DNG holds no raw image (it only has a rendered preview)."
        : "This TIFF is not a raw image (no CFA or LinearRaw data).",
    );
  }
  const ifd = best.ifd;
  const num = (tag: number) => tagNumber(file, ifd, tag);
  const nums = (tag: number) => {
    const own = tagNumbers(file, ifd, tag);
    return own.length ? own : tagNumbers(file, ifd0, tag);
  };

  const width = num(T.Width) ?? 0;
  const height = num(T.Height) ?? 0;
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) throw new RawDecodeError("Corrupt DNG: implausible image size.");
  const photometric = num(T.Photometric);
  const spp = (num(T.SamplesPerPixel) ?? 1) as number;
  const isLinear = photometric === PHOTOMETRIC_LINEAR_RAW;
  if (isLinear ? spp !== 3 : spp !== 1) {
    throw new RawDecodeError(isLinear ? "Unsupported DNG: LinearRaw with a channel count other than 3." : "Unsupported DNG: CFA with several samples per pixel.");
  }
  if ((num(T.PlanarConfig) ?? 1) !== 1) throw new RawDecodeError("Unsupported DNG: planar sample layout.");
  const sampleFormat = num(T.SampleFormat) ?? 1;
  if (sampleFormat !== 1) throw new RawDecodeError("Unsupported DNG: floating-point or signed samples.");
  const bits = tagNumbers(file, ifd, T.BitsPerSample)[0] ?? 0;
  if (!(bits >= 8 && bits <= 16)) throw new RawDecodeError(`Unsupported DNG: ${bits}-bit samples (8 to 16 supported).`);
  const compressionCode = num(T.Compression) ?? 1;
  if (compressionCode !== 1 && compressionCode !== 7) {
    throw new RawDecodeError(
      compressionCode === 8 || compressionCode === 34892
        ? "Unsupported DNG: lossy or deflate-compressed raw data."
        : `Unsupported DNG compression ${compressionCode}.`,
    );
  }
  if ((num(T.Predictor) ?? 1) !== 1) throw new RawDecodeError("Unsupported DNG: predictor-coded raw data.");

  let cfa: [CfaColor, CfaColor, CfaColor, CfaColor] = [0, 1, 1, 2];
  if (!isLinear) {
    const dim = tagNumbers(file, ifd, T.CFARepeatPatternDim);
    if (dim.length !== 2 || dim[0] !== 2 || dim[1] !== 2) {
      throw new RawDecodeError(
        dim.length === 2 && dim[0] === 6
          ? "Unsupported sensor: X-Trans (6x6) color filter array."
          : "Unsupported sensor: only 2x2 Bayer color filter arrays are supported.",
      );
    }
    const pattern = tagNumbers(file, ifd, T.CFAPattern);
    if (pattern.length !== 4 || pattern.some((c) => CFA_COLOR_OF[c] === undefined)) {
      throw new RawDecodeError("Unsupported sensor: not a three-colour (RGB) Bayer array.");
    }
    cfa = pattern.map((c) => CFA_COLOR_OF[c]) as typeof cfa;
  }

  const stride = width * spp;
  const tileWidth = num(T.TileWidth);
  const tileLength = num(T.TileLength);
  const compression = compressionCode === 7 ? "lossless-jpeg" : "none";
  const tiled = !!(tileWidth && tileLength);
  if (tiled && (tileWidth! * tileLength! * spp > MAX_BLOCK_SAMPLES || tileWidth! < 1 || tileLength! < 1)) {
    throw new RawDecodeError("Corrupt DNG: implausible tile size.");
  }
  const tileOffsets = tiled ? tagNumbers(file, ifd, T.TileOffsets) : tagNumbers(file, ifd, T.StripOffsets);
  const tileCounts = tiled ? tagNumbers(file, ifd, T.TileByteCounts) : tagNumbers(file, ifd, T.StripByteCounts);
  // A hostile header can claim a huge image in a few bytes. Sample data needs at least 1 bit per sample (lossless
  // JPEG codes are at least one bit) or `bits` per sample (uncompressed), so refuse before allocating the image.
  const dataBytes = tileOffsets.reduce((sum, offset, i) => sum + Math.min(tileCounts[i] ?? file.bytes.length - offset, Math.max(0, file.bytes.length - offset)), 0);
  const minBits = (compression === "lossless-jpeg" ? 1 : bits) * stride * height;
  if (dataBytes * 8 < minBits) throw new RawDecodeError("Truncated DNG: the raw data is smaller than the image size claims.");
  const data = new Uint16Array(stride * height);

  const copyBlock = (block: Uint8Array, x0: number, y0: number, bw: number, bh: number): void => {
    const rowSamples = bw * spp;
    let samples: Uint16Array;
    if (compression === "lossless-jpeg") {
      const jpeg = decodeLosslessJpeg(block);
      if (jpeg.width * jpeg.components !== rowSamples || jpeg.height < bh) {
        throw new RawDecodeError("Corrupt DNG: compressed block size does not match the directory.");
      }
      samples = jpeg.data;
    } else {
      const need = Math.ceil((rowSamples * bits) / 8);
      if (block.length < need * bh) throw new RawDecodeError("Truncated DNG: raw data ends early.");
      samples = new Uint16Array(rowSamples * bh);
      const src = bits === 16 ? toLittleEndian16(file, block) : block;
      for (let r = 0; r < bh; r++) {
        const rowStart = r * need;
        if (rowStart + need > src.length) throw new RawDecodeError("Truncated DNG: raw data ends early.");
        unpackBits(src.subarray(rowStart, rowStart + need), rowSamples, bits, samples, r * rowSamples);
      }
    }
    for (let r = 0; r < bh && y0 + r < height; r++) {
      const copyLen = Math.min(rowSamples, stride - x0 * spp);
      data.set(samples.subarray(r * rowSamples, r * rowSamples + copyLen), (y0 + r) * stride + x0 * spp);
    }
  };

  if (tiled) {
    const offsets = tileOffsets;
    const counts = tileCounts;
    const across = Math.ceil(width / tileWidth);
    const down = Math.ceil(height / tileLength);
    if (offsets.length < across * down || counts.length < across * down) throw new RawDecodeError("Corrupt DNG: tile table is incomplete.");
    for (let ty = 0; ty < down; ty++) {
      for (let tx = 0; tx < across; tx++) {
        const i = ty * across + tx;
        if (offsets[i] + counts[i] > file.bytes.length) throw new RawDecodeError("Truncated DNG: a tile is outside the file.");
        copyBlock(file.bytes.subarray(offsets[i], offsets[i] + counts[i]), tx * tileWidth, ty * tileLength, tileWidth, tileLength);
      }
    }
  } else {
    const offsets = tileOffsets;
    const counts = tileCounts;
    const rowsPerStrip = Math.min(num(T.RowsPerStrip) ?? height, height);
    if (rowsPerStrip < 1) throw new RawDecodeError("Corrupt DNG: invalid rows per strip.");
    if (offsets.length === 0) throw new RawDecodeError("Corrupt DNG: no image data.");
    for (let s = 0; s < offsets.length; s++) {
      const y0 = s * rowsPerStrip;
      if (y0 >= height) break;
      const rows = Math.min(rowsPerStrip, height - y0);
      const byteCount = counts[s] ?? file.bytes.length - offsets[s];
      if (offsets[s] + byteCount > file.bytes.length) throw new RawDecodeError("Truncated DNG: a strip is outside the file.");
      copyBlock(file.bytes.subarray(offsets[s], offsets[s] + byteCount), 0, y0, width, rows);
    }
  }

  const table = tagNumbers(file, ifd, T.LinearizationTable);
  if (table.length) {
    const max = table.length - 1;
    for (let i = 0; i < data.length; i++) data[i] = table[Math.min(data[i], max)];
  }

  const white = nums(T.WhiteLevel)[0] ?? 2 ** bits - 1;
  const blackRaw = nums(T.BlackLevel);
  const blackDim = nums(T.BlackLevelRepeatDim);
  let black: [number, number, number, number] = [0, 0, 0, 0];
  if (blackRaw.length === 1) black = [blackRaw[0], blackRaw[0], blackRaw[0], blackRaw[0]];
  else if (blackRaw.length === 4 && (blackDim.length === 0 || (blackDim[0] === 2 && blackDim[1] === 2))) black = [blackRaw[0], blackRaw[1], blackRaw[2], blackRaw[3]];
  else if (blackRaw.length === 3 && isLinear) black = [blackRaw[0], blackRaw[1], blackRaw[2], blackRaw[1]];
  else if (blackRaw.length >= 4) black = [blackRaw[0], blackRaw[1], blackRaw[2], blackRaw[3]];

  const area = nums(T.ActiveArea);
  const activeArea: [number, number, number, number] =
    area.length === 4 && area[2] > area[0] && area[3] > area[1] && area[2] <= height && area[3] <= width
      ? [area[0], area[1], area[2], area[3]]
      : [0, 0, height, width];
  const aw = activeArea[3] - activeArea[1];
  const ah = activeArea[2] - activeArea[0];
  const origin = nums(T.DefaultCropOrigin);
  const size = nums(T.DefaultCropSize);
  let crop: [number, number, number, number] = [0, 0, aw, ah];
  if (origin.length === 2 && size.length === 2 && size[0] > 0 && size[1] > 0 && origin[0] + size[0] <= aw && origin[1] + size[1] <= ah) {
    crop = [origin[0], origin[1], size[0], size[1]];
  }

  const neutral = nums(T.AsShotNeutral);
  const wxy = nums(T.AsShotWhiteXY);
  const orientation = tagNumber(file, ifd0, T.Orientation) ?? num(T.Orientation) ?? 1;

  return {
    format: "dng",
    width,
    height,
    samplesPerPixel: isLinear ? 3 : 1,
    data,
    cfa,
    blackLevel: black,
    whiteLevel: white,
    activeArea,
    crop,
    orientation: orientation >= 1 && orientation <= 8 ? orientation : 1,
    colorMatrix1: matrixOrNull(nums(T.ColorMatrix1), 9),
    colorMatrix2: matrixOrNull(nums(T.ColorMatrix2), 9),
    forwardMatrix1: matrixOrNull(nums(T.ForwardMatrix1), 9),
    forwardMatrix2: matrixOrNull(nums(T.ForwardMatrix2), 9),
    cameraCalibration1: matrixOrNull(nums(T.CameraCalibration1), 9),
    cameraCalibration2: matrixOrNull(nums(T.CameraCalibration2), 9),
    analogBalance: matrixOrNull(nums(T.AnalogBalance), 3),
    illuminant1: nums(T.CalibrationIlluminant1)[0] ?? 0,
    illuminant2: nums(T.CalibrationIlluminant2)[0] ?? 0,
    asShotNeutral: matrixOrNull(neutral, 3),
    asShotWhiteXY: wxy.length === 2 ? [wxy[0], wxy[1]] : null,
    baselineExposure: nums(T.BaselineExposure)[0] ?? 0,
    make: tagString(file, ifd0, T.Make),
    model: tagString(file, ifd0, T.Model),
    frameRate: (() => { const fr = nums(T.CinemaDngFrameRate)[0]; return fr && fr > 0 && fr < 1000 ? fr : undefined; })(),
    bitsPerSample: bits,
    compression,
  };
}
