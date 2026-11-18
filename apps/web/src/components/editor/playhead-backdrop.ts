import { useSyncExternalStore } from "react";
import type { Project } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";

/**
 * The thumbnail of the topmost video/image clip under the playhead (or, when the playhead is over a gap, the first
 * clip on the timeline). Library cards draw their presets over this so the user sees the preset on their own footage.
 */
export function playheadBackdropUrl(project: Pick<Project, "timeline" | "mediaLibrary">, playhead: number): string | null {
  const media = new Map(project.mediaLibrary.items.map((item) => [item.id, item]));
  let fallback: string | null = null;
  const tracks = project.timeline.tracks;
  for (let i = tracks.length - 1; i >= 0; i--) {
    const track = tracks[i];
    if (track.type === "audio" || track.type === "text" || track.type === "graphics") continue;
    for (const clip of track.clips) {
      const url = media.get(clip.mediaId)?.thumbnailUrl ?? null;
      if (!url) continue;
      if (playhead >= clip.startTime && playhead < clip.startTime + clip.duration) return url;
      fallback ??= url;
    }
  }
  return fallback;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  let cached = images.get(url);
  if (!cached) {
    cached = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    images.set(url, cached);
    if (images.size > 24) images.delete(images.keys().next().value as string);
  }
  return cached;
}

/** Draws `image` into the frame like CSS object-fit: cover. */
export type DrawableFrame = HTMLImageElement | HTMLCanvasElement;

export function drawCover(ctx: CanvasRenderingContext2D, image: DrawableFrame, w: number, h: number): void {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Draws `image` contained (never cropped) and centred on a black frame, as the Program monitor places a clip. */
export function drawContain(ctx: CanvasRenderingContext2D, image: DrawableFrame, w: number, h: number): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const scale = Math.min(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** The real frame under the playhead is decoded this long after the playhead settles (never while playing). */
const FRAME_DEBOUNCE_MS = 300;

/**
 * One shared backdrop for every card that asks for it. Library panels mount dozens of cards at once; each used to
 * subscribe to the stores and decode its own copy of the playhead frame (a 4K decode per card). Now the first
 * consumer starts a single subscription and a single decode, and the last one stops them.
 */
const listeners = new Set<() => void>();
let decodedFrame: HTMLCanvasElement | null = null;
let thumbnailImage: HTMLImageElement | null = null;
let current: DrawableFrame | null = null;
let stopShared: (() => void) | null = null;

function publish(): void {
  const next = decodedFrame ?? thumbnailImage;
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

function startShared(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let token = 0;
  let lastKey = "";
  let thumbUrl: string | null = null;
  let live = true;
  const decode = () => {
    const project = useProjectStore.getState().project;
    const { playheadPosition, playbackState } = useTimelineStore.getState();
    if (playbackState === "playing") return;
    // One decode per (clip under the playhead, frame): the stores also fire on unrelated edits.
    const clip = project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((candidate) => playheadPosition >= candidate.startTime && playheadPosition < candidate.startTime + candidate.duration);
    const key = `${clip?.id ?? ""}@${Math.round(playheadPosition * 12)}:${project.mediaLibrary.items.length}`;
    if (key === lastKey) return;
    lastKey = key;
    const mine = ++token;
    void import("./playhead-frame")
      .then((module) => module.decodePlayheadFrame(project, playheadPosition))
      .then((decoded) => {
        if (mine !== token) return;
        decodedFrame = decoded;
        publish();
      })
      .catch(() => {
        if (mine !== token) return;
        decodedFrame = null;
        publish();
      });
  };
  const updateThumbnail = () => {
    const url = playheadBackdropUrl(useProjectStore.getState().project, useTimelineStore.getState().playheadPosition);
    if (url === thumbUrl) return;
    thumbUrl = url;
    if (!url) {
      thumbnailImage = null;
      publish();
      return;
    }
    void loadImage(url).then((image) => {
      if (!live || thumbUrl !== url) return;
      thumbnailImage = image;
      publish();
    });
  };
  const schedule = () => {
    updateThumbnail();
    clearTimeout(timer);
    timer = setTimeout(decode, FRAME_DEBOUNCE_MS);
  };
  schedule();
  const offProject = useProjectStore.subscribe(schedule);
  const offTimeline = useTimelineStore.subscribe(schedule);
  return () => {
    live = false;
    token++;
    clearTimeout(timer);
    offProject();
    offTimeline();
    decodedFrame = null;
    thumbnailImage = null;
    current = null;
  };
}

function subscribeBackdrop(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) stopShared = startShared();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopShared?.();
      stopShared = null;
    }
  };
}

const backdropSnapshot = (): DrawableFrame | null => current;

/**
 * The footage under the playhead: the media thumbnail at once, then the real decoded frame at the footage's own
 * aspect (crisp at card size) once it exists. Null when the project has no media yet (cards then use their own
 * fallback). Shared by every card on screen.
 */
export function usePlayheadBackdrop(): DrawableFrame | null {
  return useSyncExternalStore(subscribeBackdrop, backdropSnapshot, backdropSnapshot);
}
