import {
  createProjectSerializer,
  createStorageEngine,
  type MediaItem,
  type Project,
} from "@openreel/core";
import {
  fontMimeType,
  planProjectFonts,
  type FontEmbedEntry,
  type FontEmbedStatus,
  type FontFileSource,
  type PackagedFont,
} from "./font-embedding";
import {
  copyMediaBlobInChunks,
  needsStableMediaCopy,
} from "./stable-media-blob";

// Media remains in Blob slices rather than being base64 encoded or copied into
// a single JavaScript buffer. The same package can be streamed to a file.
const MAGIC = "OREELPACK01\n";
const HEADER_BYTES = 16;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const serializer = createProjectSerializer(createStorageEngine());

interface PackageAsset {
  id: string;
  size: number;
  type: string;
}
/** A font the project uses. Only `embedded*` records carry bytes (size > 0). */
interface PackageFontRecord {
  family: string;
  status: FontEmbedStatus;
  size?: number;
  type?: string;
  fsType?: number | null;
  url?: string;
  note?: string;
}
interface PackageManifest {
  version: 1;
  projectJson: string;
  assets: PackageAsset[];
  /** Absent in packages written before font embedding. */
  fonts?: PackageFontRecord[];
}
export interface ProjectPackageContents {
  project: Project;
  /** Fonts carried inside the package (license permitting). */
  fonts: PackagedFont[];
  /** Every font the project used when packaged, including those not embedded. */
  fontRecords: FontEmbedEntry[];
}
interface PackageProgress {
  completed: number;
  total: number;
  name: string;
}
interface PackageOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PackageProgress) => void;
  resolveMedia?: (item: MediaItem) => Promise<Blob | null>;
  /** Bytes of an uploaded/local font by family; null for any other font. */
  resolveFont?: FontFileSource;
  /** True for registered user fonts, so a font whose bytes are missing is reported rather than treated as a system font. */
  isUserFont?: (family: string) => boolean;
  /** Receives how each font used by the project was handled (embedded, restricted, web...). */
  onFontReport?: (entries: readonly FontEmbedEntry[]) => void;
}

function checkCancelled(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

export function projectMediaSummary(project: Pick<Project, "mediaLibrary">) {
  return {
    count: project.mediaLibrary.items.length,
    bytes: project.mediaLibrary.items.reduce(
      (total, item) => total + (item.blob?.size ?? item.metadata.fileSize ?? 0),
      0,
    ),
    missing: project.mediaLibrary.items
      .filter((item) => !item.blob && !item.fileHandle)
      .map((item) => item.name),
  };
}

export async function createProjectPackage(
  project: Project,
  options: PackageOptions = {},
): Promise<Blob> {
  checkCancelled(options.signal);
  const ids = new Set<string>();
  const media: Blob[] = [];
  const assets: PackageAsset[] = [];
  for (const item of project.mediaLibrary.items) {
    checkCancelled(options.signal);
    if (!item.id || ids.has(item.id))
      throw new Error(
        "The project contains duplicate or missing media identifiers.",
      );
    ids.add(item.id);
    const blob =
      item.blob instanceof Blob
        ? item.blob
        : item.fileHandle
          ? await item.fileHandle.getFile()
          : await options.resolveMedia?.(item);
    checkCancelled(options.signal);
    if (!(blob instanceof Blob) || blob.size === 0) {
      throw new Error(
        `Relink “${item.name}” before downloading a backup. Its original media is missing.`,
      );
    }
    assets.push({ id: item.id, size: blob.size, type: blob.type });
    media.push(blob);
    options.onProgress?.({
      completed: media.length,
      total: project.mediaLibrary.items.length,
      name: item.name,
    });
  }
  const cleanProject: Project = {
    ...project,
    mediaLibrary: {
      ...project.mediaLibrary,
      items: project.mediaLibrary.items.map(({ thumbnailPixelAspect: _marker, ...item }) => ({
        ...item,
        thumbnailUrl: null,
        filmstripThumbnails: undefined,
        waveformData: null,
        isPlaceholder: false,
      })),
    },
  };
  const plan = await planProjectFonts(project, options.resolveFont ?? (async () => null), { isUserFont: options.isUserFont });
  checkCancelled(options.signal);
  const fontBlobs: Blob[] = [];
  const fonts: PackageFontRecord[] = plan.entries.map((entry) => {
    const record: PackageFontRecord = {
      family: entry.family,
      status: entry.status,
      fsType: entry.fsType,
      url: entry.url,
      note: entry.note,
    };
    const data = plan.payloads.get(entry.family);
    if (data) {
      const type = fontMimeType(data);
      fontBlobs.push(new Blob([data], { type }));
      record.size = data.byteLength;
      record.type = type;
    }
    return record;
  });
  options.onFontReport?.(plan.entries);
  const manifest: PackageManifest = {
    version: 1,
    projectJson: serializer.exportToJson(cleanProject),
    assets,
    fonts,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(manifest));
  if (encoded.byteLength > MAX_MANIFEST_BYTES)
    throw new Error("The project metadata is too large to package.");
  const header = new Uint8Array(HEADER_BYTES);
  header.set(new TextEncoder().encode(MAGIC));
  new DataView(header.buffer).setUint32(12, encoded.byteLength, true);
  checkCancelled(options.signal);
  return new Blob([header, encoded, ...media, ...fontBlobs], {
    type: "application/octet-stream",
  });
}

export async function readProjectPackage(
  file: Blob,
  options: Pick<PackageOptions, "signal" | "onProgress"> = {},
): Promise<Project> {
  return (await readProjectPackageContents(file, options)).project;
}

export async function readProjectPackageContents(
  file: Blob,
  options: Pick<PackageOptions, "signal" | "onProgress"> = {},
): Promise<ProjectPackageContents> {
  checkCancelled(options.signal);
  if (file.size < HEADER_BYTES)
    throw new Error("This is not an OpenReel project backup.");
  const header = await file.slice(0, HEADER_BYTES).arrayBuffer();
  if (new TextDecoder().decode(header.slice(0, 12)) !== MAGIC)
    throw new Error("This is not an OpenReel project backup.");
  const length = new DataView(header).getUint32(12, true);
  if (
    !length ||
    length > MAX_MANIFEST_BYTES ||
    HEADER_BYTES + length > file.size
  )
    throw new Error("The backup metadata is incomplete or invalid.");
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(
      await file.slice(HEADER_BYTES, HEADER_BYTES + length).text(),
    ) as PackageManifest;
  } catch {
    throw new Error("The backup metadata could not be read.");
  }
  checkCancelled(options.signal);
  if (
    manifest.version !== 1 ||
    typeof manifest.projectJson !== "string" ||
    !Array.isArray(manifest.assets)
  )
    throw new Error("This backup version is not supported.");
  const result = serializer.importFromJsonWithValidation(manifest.projectJson);
  if (!result.project || !result.validation.valid)
    throw new Error(
      result.validation.errors.join(" ") ||
        "The project in this backup is invalid.",
    );
  const project = result.project;
  const ids = new Set(project.mediaLibrary.items.map((item) => item.id));
  if (
    ids.size !== project.mediaLibrary.items.length ||
    manifest.assets.length !== ids.size
  )
    throw new Error("The backup media list does not match the project.");
  const blobs = new Map<string, Blob>();
  let offset = HEADER_BYTES + length;
  for (const asset of manifest.assets) {
    checkCancelled(options.signal);
    if (
      !asset ||
      !ids.has(asset.id) ||
      blobs.has(asset.id) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      typeof asset.type !== "string" ||
      !Number.isSafeInteger(offset + asset.size) ||
      offset + asset.size > file.size
    ) {
      throw new Error("The backup contains incomplete or invalid media.");
    }
    const blob = file.slice(offset, offset + asset.size, asset.type);
    // Safari loses a disk-backed slice's offset when reopening it from IDB.
    // Detach these originals in bounded chunks before they enter the project.
    blobs.set(
      asset.id,
      needsStableMediaCopy(blob)
        ? await copyMediaBlobInChunks(blob, options.signal)
        : blob,
    );
    offset += asset.size;
    options.onProgress?.({
      completed: blobs.size,
      total: ids.size,
      name:
        project.mediaLibrary.items.find((item) => item.id === asset.id)?.name ??
        asset.id,
    });
  }
  const fontRecords: FontEmbedEntry[] = [];
  const fonts: PackagedFont[] = [];
  if (manifest.fonts !== undefined && !Array.isArray(manifest.fonts))
    throw new Error("The backup contains invalid font data.");
  for (const record of manifest.fonts ?? []) {
    checkCancelled(options.signal);
    if (!record || typeof record.family !== "string" || !record.family)
      throw new Error("The backup contains invalid font data.");
    fontRecords.push({
      family: record.family,
      usages: [],
      status: record.status,
      fsType: record.fsType,
      url: record.url,
      note: record.note ?? "",
    });
    if (record.size === undefined) continue;
    if (
      !Number.isSafeInteger(record.size) ||
      record.size <= 0 ||
      !Number.isSafeInteger(offset + record.size) ||
      offset + record.size > file.size ||
      (record.status !== "embedded" && record.status !== "embedded-readonly")
    )
      throw new Error("The backup contains incomplete or invalid fonts.");
    fonts.push({
      family: record.family,
      data: file.slice(offset, offset + record.size, record.type || "font/sfnt"),
      readOnly: record.status === "embedded-readonly",
    });
    offset += record.size;
  }
  if (offset !== file.size)
    throw new Error("The backup contains unexpected trailing data.");
  const restored: Project = {
    ...project,
    mediaLibrary: {
      ...project.mediaLibrary,
      items: project.mediaLibrary.items.map(({ thumbnailPixelAspect: _marker, ...item }) => ({
        ...item,
        blob: blobs.get(item.id)!,
        fileHandle: null,
        isPlaceholder: false,
        thumbnailUrl: null,
        filmstripThumbnails: undefined,
        waveformData: null,
      })),
    },
  };
  return { project: restored, fonts, fontRecords };
}

/** Open as an independent copy so backups cannot overwrite stored originals. */
export function copyPackagedProject(project: Project): Project {
  const mediaIds = new Map(
    project.mediaLibrary.items.map((item) => [item.id, crypto.randomUUID()]),
  );
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== "object" || value instanceof Blob)
      return value;
    if (
      ArrayBuffer.isView(value) ||
      value instanceof ArrayBuffer ||
      value instanceof Date
    )
      return structuredClone(value);
    if (value instanceof Map)
      return new Map(
        [...value].map(([key, entry]) => [rewrite(key), rewrite(entry)]),
      );
    if (value instanceof Set) return new Set([...value].map(rewrite));
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /^(mediaId|sourceMediaId|assetId|backgroundMediaId)$/.test(key) &&
        typeof entry === "string" &&
        mediaIds.has(entry)
          ? mediaIds.get(entry)
          : rewrite(entry),
      ]),
    );
  };
  const copied = rewrite(project) as Project;
  return {
    ...copied,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    mediaLibrary: {
      ...copied.mediaLibrary,
      items: copied.mediaLibrary.items.map((item) => ({
        ...item,
        id: mediaIds.get(item.id)!,
      })),
    },
  };
}
