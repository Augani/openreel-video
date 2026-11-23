import { promises as fs, createReadStream, createWriteStream } from "node:fs";
import type { Writable } from "node:stream";
import { planSphericalPatch } from "../../../../../packages/core/src/export/spherical-metadata";
import { normalizeVrProperties } from "../../../../../packages/core/src/vr/vr-properties";

/** Spherical (VR) delivery fields of a native export: written into the finished MP4 / MOV as st3d / sv3d boxes. */
export interface SphericalExportFields {
  layout: "mono" | "over-under" | "side-by-side";
  horizontalFov: number;
  verticalFov: number;
  /** Initial view direction (degrees): written as the sv3d pose and the V1 InitialView fields. */
  initialView?: { yaw: number; pitch: number; roll: number };
}

function copyRange(path: string, start: number, endExclusive: number, out: Writable): Promise<void> {
  if (endExclusive <= start) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const input = createReadStream(path, { start, end: endExclusive - 1 });
    input.on("error", reject);
    input.on("end", resolve);
    input.pipe(out, { end: false });
  });
}

function writeAll(out: Writable, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    out.write(bytes, (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Adds spherical metadata to a finished MP4 / MOV in place. ffmpeg writes the movie header in front of the media
 * data (+faststart), so the chunk offsets move with it; planSphericalPatch handles both orders. The new file is
 * written next to the old one and renamed over it, so a failure leaves the export untouched.
 */
export async function addSphericalMetadataToFile(path: string, fields: SphericalExportFields): Promise<void> {
  const handle = await fs.open(path, "r");
  let plan;
  let size: number;
  try {
    size = (await handle.stat()).size;
    plan = await planSphericalPatch(
      {
        size,
        read: async (start, length) => {
          const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - start)));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
          return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
        },
      },
      normalizeVrProperties({ projection: "equirectangular", ...fields }),
    );
  } finally {
    await handle.close();
  }
  if (!plan) throw new Error("The exported file is not an MP4 or MOV movie, so spherical metadata could not be added.");
  const temp = `${path}.vr-tmp`;
  const out = createWriteStream(temp);
  try {
    await copyRange(path, 0, plan.moovStart, out);
    await writeAll(out, plan.moov);
    await copyRange(path, plan.moovEnd, size, out);
    await new Promise<void>((resolve, reject) => {
      out.on("error", reject);
      out.end(resolve);
    });
    await fs.rename(temp, path);
  } catch (error) {
    out.destroy();
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
