import type { Project, MediaMetadata } from "../types";

export const DB_VERSION = 3;

export const DB_NAME = "openreel-db";

export const STORES = {
  PROJECTS: "projects",
  MEDIA: "media",
  CACHE: "cache",
  WAVEFORMS: "waveforms",
  FILE_HANDLES: "fileHandles",
  DIR_HANDLES: "dirHandles",
} as const;

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly data: string; // Serialized ProjectFile JSON
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
}

export interface MediaRecord {
  readonly id: string;
  readonly projectId: string;
  readonly blob: Blob;
  readonly metadata: MediaMetadata;
}

export interface CacheRecord {
  readonly key: string; // `${projectId}:${clipId}:${time}`
  readonly data: ArrayBuffer;
  readonly timestamp: number; // For LRU eviction
  readonly size: number;
}

export interface WaveformRecord {
  readonly mediaId: string;
  readonly data: number[]; // Serialized from Float32Array
  readonly sampleRate: number;
}

/** Keyed by "${name}:${size}" — allows restoring assets by filename+size across sessions */
export interface FileHandleRecord {
  readonly key: string; // "${name}:${size}"
  readonly handle: FileSystemFileHandle;
}

/** Keyed by projectId — stores the last folder the user relinked from, per project */
export interface DirHandleRecord {
  readonly key: string; // projectId
  readonly handle: FileSystemDirectoryHandle;
  readonly folderName: string;
}

export interface StorageUsage {
  readonly used: number;
  readonly quota: number;
  readonly projects: number;
  readonly mediaItems: number;
}

export type StorageErrorCode =
  | "QUOTA_EXCEEDED"
  | "DATABASE_ERROR"
  | "SERIALIZATION_FAILED"
  | "DESERIALIZATION_FAILED"
  | "PROJECT_NOT_FOUND"
  | "MEDIA_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "BROWSER_NOT_SUPPORTED";

export interface StorageError {
  readonly code: StorageErrorCode;
  readonly message: string;
  readonly quotaInfo?: {
    readonly used: number;
    readonly available: number;
    readonly requested: number;
  };
}

export interface IStorageEngine {
  // Project operations
  saveProject(project: Project): Promise<void>;
  loadProject(id: string): Promise<Project | null>;
  listProjects(): Promise<ProjectSummary[]>;
  deleteProject(id: string): Promise<void>;

  // Media operations
  saveMedia(media: MediaRecord): Promise<void>;
  loadMedia(id: string): Promise<MediaRecord | null>;
  deleteMedia(id: string): Promise<void>;
  getMediaByProject(projectId: string): Promise<MediaRecord[]>;

  // Cache operations
  saveCache(record: CacheRecord): Promise<void>;
  loadCache(key: string): Promise<CacheRecord | null>;
  deleteCache(key: string): Promise<void>;
  clearCache(): Promise<void>;

  // Waveform operations
  saveWaveform(record: WaveformRecord): Promise<void>;
  loadWaveform(mediaId: string): Promise<WaveformRecord | null>;
  deleteWaveform(mediaId: string): Promise<void>;

  // File handle operations (for cross-session asset restoration)
  saveFileHandle(name: string, size: number, handle: FileSystemFileHandle): Promise<void>;
  loadFileHandle(name: string, size: number): Promise<FileSystemFileHandle | null>;
  saveDirectoryHandle(projectId: string, handle: FileSystemDirectoryHandle): Promise<void>;
  loadDirectoryHandle(projectId: string): Promise<{ handle: FileSystemDirectoryHandle; folderName: string } | null>;

  // Storage info
  getStorageUsage(): Promise<StorageUsage>;

  // Database management
  close(): void;
}
