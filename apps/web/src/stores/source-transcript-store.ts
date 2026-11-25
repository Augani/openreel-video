import { createStore, useStore, type StoreApi } from "zustand";
import {
  createSourceTranscriptRecord,
  resolveCachedTranscript,
  sourceTranscriptOf,
  type MediaItem,
  type SourceTranscriptRecord,
  type Subtitle,
  type Transcript,
} from "@openreel/core";
import { hashMediaBlob } from "../services/source-transcripts/media-hash";
import { getSourceTranscriptStorage, type SourceTranscriptStorage } from "../services/source-transcripts/storage";

/**
 * Per-asset transcripts of the project's media (loaded on demand; this module is only imported by the lazy Source
 * monitor Transcript tab). A transcript is cached in IndexedDB by media hash; this store holds what is loaded for the
 * media items of the open project. Transcripts are an analysis cache, not timeline edits, so nothing here touches
 * undo history.
 */
export type SourceTranscriptStatus =
  | "idle"
  | "checking"
  | "offline"
  | "none"
  | "transcribing"
  | "ready"
  | "error";

export interface SourceTranscriptEntry {
  status: SourceTranscriptStatus;
  mediaHash?: string;
  record?: SourceTranscriptRecord;
  /** Built once per record; word list for display, search and selection. */
  transcript?: Transcript;
  progress?: number | null;
  message?: string;
  error?: string;
  /** Set when the media was relinked to different content and the earlier transcript was dropped. */
  relinked?: boolean;
}

export interface SourceTranscriptDeps {
  storage: SourceTranscriptStorage;
  hash: (blob: Blob) => Promise<string>;
  blobOf: (media: MediaItem) => Promise<Blob | null>;
  transcribe: (media: MediaItem, onProgress: (fraction: number | null, message: string) => void) => Promise<Subtitle[]>;
}

export interface SourceTranscriptState {
  entries: Record<string, SourceTranscriptEntry>;
  /** Hash a media id had when last seen, to notice a relink. */
  seenHash: Record<string, string>;
  /** Look the media's transcript up in the cache (hashes the file, never transcribes). */
  refresh: (media: MediaItem) => Promise<SourceTranscriptEntry>;
  refreshAll: (items: readonly MediaItem[]) => Promise<void>;
  transcribe: (media: MediaItem) => Promise<SourceTranscriptEntry>;
  /** Use cues from a transcript file instead of transcribing. */
  adopt: (media: MediaItem, cues: readonly Subtitle[], engine: string) => Promise<SourceTranscriptEntry>;
  remove: (media: MediaItem) => Promise<void>;
}

const withTranscript = (record: SourceTranscriptRecord): Pick<SourceTranscriptEntry, "record" | "transcript"> => ({
  record,
  transcript: sourceTranscriptOf(record),
});

export function createSourceTranscriptStore(deps: SourceTranscriptDeps): StoreApi<SourceTranscriptState> {
  const running = new Map<string, Promise<SourceTranscriptEntry>>();

  return createStore<SourceTranscriptState>((set, get) => {
    const put = (mediaId: string, entry: SourceTranscriptEntry) => {
      set((state) => ({ entries: { ...state.entries, [mediaId]: entry } }));
      return entry;
    };
    const patch = (mediaId: string, change: Partial<SourceTranscriptEntry>) =>
      put(mediaId, { ...(get().entries[mediaId] ?? { status: "idle" }), ...change });

    const refresh = async (media: MediaItem): Promise<SourceTranscriptEntry> => {
      const blob = await deps.blobOf(media);
      if (!blob) return put(media.id, { status: "offline" });
      const hash = await deps.hash(blob);
      const previousHash = get().seenHash[media.id];
      const relinked = previousHash !== undefined && previousHash !== hash;
      set((state) => ({ seenHash: { ...state.seenHash, [media.id]: hash } }));
      if (!relinked) {
        const current = get().entries[media.id];
        if (current?.mediaHash === hash && (current.status === "ready" || current.status === "transcribing")) return current;
      }
      const { raw } = await deps.storage.get(hash);
      const resolved = resolveCachedTranscript(raw, hash, media.metadata.duration);
      if (resolved.record) return put(media.id, { status: "ready", mediaHash: hash, ...withTranscript(resolved.record) });
      return put(media.id, { status: "none", mediaHash: hash, ...(relinked ? { relinked: true } : {}) });
    };

    const finish = async (media: MediaItem, cues: readonly Subtitle[], engine: string, hash: string) => {
      if (!cues.length) {
        return put(media.id, { status: "error", mediaHash: hash, error: "No speech was found in this clip." });
      }
      const record = createSourceTranscriptRecord({
        mediaHash: hash,
        duration: media.metadata.duration,
        cues,
        engine,
      });
      await deps.storage.save(record);
      return put(media.id, { status: "ready", mediaHash: hash, ...withTranscript(record) });
    };

    return {
      entries: {},
      seenHash: {},
      refresh,
      refreshAll: async (items) => {
        for (const media of items) {
          if (media.type === "image") continue;
          try {
            await refresh(media);
          } catch {
            put(media.id, { status: "error", error: "This media could not be read." });
          }
        }
      },
      transcribe: (media) => {
        const active = running.get(media.id);
        if (active) return active;
        const job = (async () => {
          try {
            const blob = await deps.blobOf(media);
            if (!blob) return put(media.id, { status: "offline" });
            const hash = await deps.hash(blob);
            set((state) => ({ seenHash: { ...state.seenHash, [media.id]: hash } }));
            patch(media.id, { status: "transcribing", mediaHash: hash, progress: 0, message: "Starting…", error: undefined });
            const cues = await deps.transcribe(media, (progress, message) =>
              patch(media.id, { status: "transcribing", progress, message }),
            );
            return await finish(media, cues, "whisper", hash);
          } catch (error) {
            const cancelled = error instanceof DOMException && error.name === "AbortError";
            return put(media.id, {
              status: cancelled ? "none" : "error",
              ...(cancelled ? {} : { error: error instanceof Error ? error.message : "Transcription failed." }),
              ...(get().entries[media.id]?.mediaHash ? { mediaHash: get().entries[media.id].mediaHash } : {}),
            });
          } finally {
            running.delete(media.id);
          }
        })();
        running.set(media.id, job);
        return job;
      },
      adopt: async (media, cues, engine) => {
        const blob = await deps.blobOf(media);
        if (!blob) return put(media.id, { status: "offline" });
        const hash = await deps.hash(blob);
        set((state) => ({ seenHash: { ...state.seenHash, [media.id]: hash } }));
        return finish(media, cues, engine, hash);
      },
      remove: async (media) => {
        const hash = get().entries[media.id]?.mediaHash;
        if (hash) await deps.storage.remove(hash);
        put(media.id, { status: "none", ...(hash ? { mediaHash: hash } : {}) });
      },
    };
  });
}

let singleton: StoreApi<SourceTranscriptState> | null = null;

/** The app's store: real hashing, IndexedDB cache and the on-device Whisper pipeline (loaded on first transcription). */
export function getSourceTranscriptStore(): StoreApi<SourceTranscriptState> {
  singleton ??= createSourceTranscriptStore({
    storage: getSourceTranscriptStorage(),
    hash: hashMediaBlob,
    blobOf: async (media) => {
      const { mediaBlobOf } = await import("../services/source-transcripts/transcribe");
      return mediaBlobOf(media);
    },
    transcribe: async (media, onProgress) => {
      const { transcribeMediaTracked } = await import("../services/source-transcripts/transcribe");
      return transcribeMediaTracked(media, { onProgress });
    },
  });
  return singleton;
}

export function useSourceTranscripts<T>(selector: (state: SourceTranscriptState) => T): T {
  return useStore(getSourceTranscriptStore(), selector);
}
