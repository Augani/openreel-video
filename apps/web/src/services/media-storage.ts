import { StorageEngine } from "@openreel/core";
import type { MediaRecord, MediaMetadata } from "@openreel/core";

const storage = new StorageEngine();

export async function saveMediaBlob(
  projectId: string,
  mediaId: string,
  blob: Blob,
  metadata: MediaMetadata,
): Promise<void> {
  const record: MediaRecord = {
    id: mediaId,
    projectId,
    blob,
    metadata,
  };

  await storage.saveMedia(record);
}

export async function loadMediaBlob(mediaId: string): Promise<Blob | null> {
  const record = await storage.loadMedia(mediaId);
  return record?.blob || null;
}

export async function loadMediaRecord(
  mediaId: string,
): Promise<MediaRecord | null> {
  return storage.loadMedia(mediaId);
}

export async function loadProjectMedia(
  projectId: string,
): Promise<MediaRecord[]> {
  return storage.getMediaByProject(projectId);
}

export async function deleteMediaBlob(mediaId: string): Promise<void> {
  await storage.deleteMedia(mediaId);
}

export async function deleteProjectMedia(projectId: string): Promise<void> {
  const records = await storage.getMediaByProject(projectId);
  for (const record of records) {
    await storage.deleteMedia(record.id);
  }
}

export async function getStorageStats(): Promise<{
  used: number;
  quota: number;
  mediaCount: number;
}> {
  const usage = await storage.getStorageUsage();
  return {
    used: usage.used,
    quota: usage.quota,
    mediaCount: usage.mediaItems,
  };
}
