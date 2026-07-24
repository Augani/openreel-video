import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { inflateSync } from "node:zlib";
import { renderAuroraPreview } from "../src/aurora-host/render-preview";
import {
  createAuroraFixtureAsset,
  createAuroraFixtureScene,
} from "./aurora-fixture";

interface AuroraGoldenFile {
  readonly width: number;
  readonly height: number;
  readonly pngBase64: string;
}

interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

const GOLDEN_URL = new URL("./goldens/aurora-preview-box.json", import.meta.url);

function decodePngBase64(base64: string): DecodedPng {
  const png = Buffer.from(base64, "base64");
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (let index = 0; index < signature.length; index += 1) {
    if (png[index] !== signature[index]) {
      throw new Error("Invalid PNG signature in Aurora golden");
    }
  }

  let width = 0;
  let height = 0;
  const idatChunks: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = png.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0 || idatChunks.length === 0) {
    throw new Error("Aurora golden PNG is missing IHDR or IDAT data");
  }

  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = width * 4 + 1;
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * stride;
    const filter = raw[rowOffset];
    if (filter !== 0) {
      throw new Error(`Unsupported PNG filter ${String(filter)} in Aurora golden`);
    }
    rgba.set(raw.subarray(rowOffset + 1, rowOffset + stride), row * width * 4);
  }

  return { width, height, rgba };
}

function comparePngDiff(
  actual: DecodedPng,
  expected: DecodedPng,
): { readonly meanAbsDiff: number; readonly maxDiff: number } {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `Aurora golden size mismatch: expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`,
    );
  }
  let totalDiff = 0;
  let maxDiff = 0;
  for (let index = 0; index < actual.rgba.length; index += 1) {
    const diff = Math.abs(actual.rgba[index]! - expected.rgba[index]!);
    totalDiff += diff;
    if (diff > maxDiff) maxDiff = diff;
  }
  return {
    meanAbsDiff: totalDiff / actual.rgba.length,
    maxDiff,
  };
}

describe("Aurora golden preview", () => {
  it("matches the committed golden preview within tolerance", async () => {
    const asset = createAuroraFixtureAsset();
    const scene = createAuroraFixtureScene(asset);
    const actual = await renderAuroraPreview({
      scene,
      assets: [asset],
      width: 96,
      height: 96,
      background: "#0f172a",
      quality: "preview",
    });

    if (process.env.UPDATE_AURORA_GOLDENS === "1") {
      const nextGolden: AuroraGoldenFile = {
        width: actual.width,
        height: actual.height,
        pngBase64: actual.pngBase64,
      };
      await fs.mkdir(new URL("./goldens/", import.meta.url), { recursive: true });
      await fs.writeFile(
        GOLDEN_URL,
        `${JSON.stringify(nextGolden, null, 2)}\n`,
        "utf8",
      );
    }

    const golden = JSON.parse(
      await fs.readFile(GOLDEN_URL, "utf8"),
    ) as AuroraGoldenFile;
    const diff = comparePngDiff(
      decodePngBase64(actual.pngBase64),
      decodePngBase64(golden.pngBase64),
    );

    expect(diff.meanAbsDiff).toBeLessThanOrEqual(0.25);
    expect(diff.maxDiff).toBeLessThanOrEqual(4);
  });
});
