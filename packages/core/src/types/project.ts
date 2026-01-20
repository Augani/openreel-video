import type { Timeline } from "./timeline";
import type { TextClip } from "../text/types";
import type { ShapeClip, SVGClip, StickerClip } from "../graphics/types";

export interface ProjectSettings {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly sampleRate: number;
  readonly channels: number;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly settings: ProjectSettings;
  readonly mediaLibrary: MediaLibrary;
  readonly timeline: Timeline;
  readonly textClips?: TextClip[];
  readonly shapeClips?: ShapeClip[];
  readonly svgClips?: SVGClip[];
  readonly stickerClips?: StickerClip[];
}

export interface MediaLibrary {
  readonly items: MediaItem[];
}

export interface MediaItem {
  readonly id: string;
  readonly name: string;
  readonly type: "video" | "audio" | "image";
  readonly fileHandle: FileSystemFileHandle | null;
  readonly blob: Blob | null;
  readonly metadata: MediaMetadata;
  readonly thumbnailUrl: string | null;
  readonly waveformData: Float32Array | null;
  readonly filmstripThumbnails?: FilmstripThumbnail[];
  readonly isPlaceholder?: boolean;
  readonly originalUrl?: string;
}

/** Thumbnail for filmstrip display in timeline */
export interface FilmstripThumbnail {
  readonly timestamp: number;
  readonly url: string;
}

export interface MediaMetadata {
  readonly duration: number; // In seconds
  readonly width: number; // For video/image
  readonly height: number; // For video/image
  readonly frameRate: number; // For video
  readonly codec: string;
  readonly sampleRate: number; // For audio
  readonly channels: number; // For audio
  readonly fileSize: number;
}
