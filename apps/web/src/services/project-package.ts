import { createProjectSerializer, createStorageEngine, type MediaItem, type Project } from "@openreel/core";
import { copyMediaBlobInChunks, needsStableMediaCopy } from "./stable-media-blob";

// Media remains in Blob slices rather than being base64 encoded or copied into
// a single JavaScript buffer. The same package can be streamed to a file.
const MAGIC = "OREELPACK01\n";
const HEADER_BYTES = 16;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const serializer = createProjectSerializer(createStorageEngine());

interface PackageAsset { id: string; size: number; type: string }
interface PackageManifest { version: 1; projectJson: string; assets: PackageAsset[] }
export interface PackageProgress { completed: number; total: number; name: string }
export interface PackageOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PackageProgress) => void;
  resolveMedia?: (item: MediaItem) => Promise<Blob | null>;
}

function checkCancelled(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

export function projectMediaSummary(project: Project) {
  return {
    count: project.mediaLibrary.items.length,
    bytes: project.mediaLibrary.items.reduce((total, item) => total + (item.blob?.size ?? item.metadata.fileSize ?? 0), 0),
    missing: project.mediaLibrary.items.filter((item) => !item.blob && !item.fileHandle).map((item) => item.name),
  };
}

export async function createProjectPackage(project: Project, options: PackageOptions = {}): Promise<Blob> {
  checkCancelled(options.signal);
  const ids = new Set<string>();
  const media: Blob[] = [];
  const assets: PackageAsset[] = [];
  for (const item of project.mediaLibrary.items) {
    checkCancelled(options.signal);
    if (!item.id || ids.has(item.id)) throw new Error("The project contains duplicate or missing media identifiers.");
    ids.add(item.id);
    const blob = item.blob instanceof Blob ? item.blob
      : item.fileHandle ? await item.fileHandle.getFile()
      : await options.resolveMedia?.(item);
    checkCancelled(options.signal);
    if (!(blob instanceof Blob) || blob.size === 0) {
      throw new Error(`Relink “${item.name}” before downloading a backup. Its original media is missing.`);
    }
    assets.push({ id: item.id, size: blob.size, type: blob.type });
    media.push(blob);
    options.onProgress?.({ completed: media.length, total: project.mediaLibrary.items.length, name: item.name });
  }
  const cleanProject: Project = { ...project, mediaLibrary: { ...project.mediaLibrary, items: project.mediaLibrary.items.map((item) => ({
    ...item, thumbnailUrl: null, filmstripThumbnails: undefined, waveformData: null, isPlaceholder: false,
  })) } };
  const manifest: PackageManifest = { version: 1, projectJson: serializer.exportToJson(cleanProject), assets };
  const encoded = new TextEncoder().encode(JSON.stringify(manifest));
  if (encoded.byteLength > MAX_MANIFEST_BYTES) throw new Error("The project metadata is too large to package.");
  const header = new Uint8Array(HEADER_BYTES);
  header.set(new TextEncoder().encode(MAGIC));
  new DataView(header.buffer).setUint32(12, encoded.byteLength, true);
  checkCancelled(options.signal);
  return new Blob([header, encoded, ...media], { type: "application/octet-stream" });
}

export async function readProjectPackage(file: Blob, options: Pick<PackageOptions, "signal" | "onProgress"> = {}): Promise<Project> {
  checkCancelled(options.signal);
  if (file.size < HEADER_BYTES) throw new Error("This is not an OpenReel project backup.");
  const header = await file.slice(0, HEADER_BYTES).arrayBuffer();
  if (new TextDecoder().decode(header.slice(0, 12)) !== MAGIC) throw new Error("This is not an OpenReel project backup.");
  const length = new DataView(header).getUint32(12, true);
  if (!length || length > MAX_MANIFEST_BYTES || HEADER_BYTES + length > file.size) throw new Error("The backup metadata is incomplete or invalid.");
  let manifest: PackageManifest;
  try { manifest = JSON.parse(await file.slice(HEADER_BYTES, HEADER_BYTES + length).text()) as PackageManifest; }
  catch { throw new Error("The backup metadata could not be read."); }
  checkCancelled(options.signal);
  if (manifest.version !== 1 || typeof manifest.projectJson !== "string" || !Array.isArray(manifest.assets)) throw new Error("This backup version is not supported.");
  const result = serializer.importFromJsonWithValidation(manifest.projectJson);
  if (!result.project || !result.validation.valid) throw new Error(result.validation.errors.join(" ") || "The project in this backup is invalid.");
  const project = result.project;
  const ids = new Set(project.mediaLibrary.items.map((item) => item.id));
  if (ids.size !== project.mediaLibrary.items.length || manifest.assets.length !== ids.size) throw new Error("The backup media list does not match the project.");
  const blobs = new Map<string, Blob>();
  let offset = HEADER_BYTES + length;
  for (const asset of manifest.assets) {
    checkCancelled(options.signal);
    if (!asset || !ids.has(asset.id) || blobs.has(asset.id) || !Number.isSafeInteger(asset.size) || asset.size <= 0 ||
      typeof asset.type !== "string" || !Number.isSafeInteger(offset + asset.size) || offset + asset.size > file.size) {
      throw new Error("The backup contains incomplete or invalid media.");
    }
    const blob = file.slice(offset, offset + asset.size, asset.type);
    // Safari loses a disk-backed slice's offset when reopening it from IDB.
    // Detach these originals in bounded chunks before they enter the project.
    blobs.set(asset.id, needsStableMediaCopy(blob) ? await copyMediaBlobInChunks(blob, options.signal) : blob);
    offset += asset.size;
    options.onProgress?.({ completed: blobs.size, total: ids.size, name: project.mediaLibrary.items.find((item) => item.id === asset.id)?.name ?? asset.id });
  }
  if (offset !== file.size) throw new Error("The backup contains unexpected trailing data.");
  return { ...project, mediaLibrary: { ...project.mediaLibrary, items: project.mediaLibrary.items.map((item) => ({
    ...item, blob: blobs.get(item.id)!, fileHandle: null, isPlaceholder: false,
    thumbnailUrl: null, filmstripThumbnails: undefined, waveformData: null,
  })) } };
}

/** Open as an independent copy so backups cannot overwrite stored originals. */
export function copyPackagedProject(project: Project): Project {
  const mediaIds = new Map(project.mediaLibrary.items.map((item) => [item.id, crypto.randomUUID()]));
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== "object" || value instanceof Blob) return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
      /^(mediaId|sourceMediaId|assetId|backgroundMediaId)$/.test(key) && typeof entry === "string" && mediaIds.has(entry)
        ? mediaIds.get(entry) : rewrite(entry),
    ]));
  };
  const copied = rewrite(project) as Project;
  return { ...copied, id: crypto.randomUUID(), createdAt: Date.now(), modifiedAt: Date.now(), mediaLibrary: {
    ...copied.mediaLibrary, items: copied.mediaLibrary.items.map((item) => ({ ...item, id: mediaIds.get(item.id)! })),
  } };
}
