import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MediaItem, Project } from "@openreel/core";
import { sameProjectForPlayback, useStablePlaybackProject } from "./playback-project";

const item = (id: string, extra: Record<string, unknown> = {}): MediaItem =>
  ({ id, name: `${id}.mp4`, type: "video", blob: null, fileHandle: null, metadata: { width: 3840 }, thumbnailUrl: null, waveformData: null, ...extra }) as unknown as MediaItem;

const withFields = (base: MediaItem, extra: Record<string, unknown>): MediaItem => ({ ...base, ...extra }) as MediaItem;

const project = (items: MediaItem[], extra: Record<string, unknown> = {}): Project =>
  ({ id: "p", name: "P", timeline: { tracks: [] }, mediaLibrary: { items }, settings: { width: 3840 }, ...extra }) as unknown as Project;

describe("sameProjectForPlayback", () => {
  it("ignores a waveform, thumbnail or filmstrip arriving on a media item", () => {
    const a = project([item("a"), item("b")]);
    const [ia, ib] = a.mediaLibrary.items;
    const withWaveform = { ...a, mediaLibrary: { ...a.mediaLibrary, items: [withFields(ia, { waveformData: new Float32Array(4) }), ib] } } as Project;
    expect(sameProjectForPlayback(a, withWaveform)).toBe(true);
    const withThumbs = { ...a, mediaLibrary: { ...a.mediaLibrary, items: [ia, withFields(ib, { thumbnailUrl: "blob:x", filmstripThumbnails: [] })] } } as Project;
    expect(sameProjectForPlayback(a, withThumbs)).toBe(true);
  });

  it("does not ignore anything playback reads", () => {
    const a = project([item("a")]);
    const [ia] = a.mediaLibrary.items;
    const swap = (items: MediaItem[]): Project => ({ ...a, mediaLibrary: { ...a.mediaLibrary, items } }) as Project;
    expect(sameProjectForPlayback(a, swap([withFields(ia, { metadata: { width: 1920 } })]))).toBe(false);
    expect(sameProjectForPlayback(a, swap([withFields(ia, { blob: new Blob(["x"]) })]))).toBe(false);
    expect(sameProjectForPlayback(a, swap([withFields(ia, { proxy: { status: "ready" } })]))).toBe(false);
    expect(sameProjectForPlayback(a, swap([ia, item("b")]))).toBe(false);
    expect(sameProjectForPlayback(a, { ...a, timeline: { tracks: [] } } as unknown as Project)).toBe(false);
    expect(sameProjectForPlayback(a, { ...a, settings: { width: 1920 } } as unknown as Project)).toBe(false);
  });

  it("treats a shallow project copy with identical children as a change (in-place edits are published that way)", () => {
    const a = project([item("a")]);
    expect(sameProjectForPlayback(a, { ...a } as Project)).toBe(false);
    expect(sameProjectForPlayback(a, { ...a, modifiedAt: 2 } as unknown as Project)).toBe(false);
    expect(sameProjectForPlayback(a, { ...a, mediaLibrary: { ...a.mediaLibrary } } as Project)).toBe(false);
    expect(sameProjectForPlayback(a, { ...a, mediaLibrary: { ...a.mediaLibrary, items: [...a.mediaLibrary.items] } } as Project)).toBe(false);
  });

  it("keeps the identity for the background thumbnail write, which also bumps modifiedAt", () => {
    const a = project([item("a")], { modifiedAt: 1 });
    const [ia] = a.mediaLibrary.items;
    const thumbs = { ...a, mediaLibrary: { ...a.mediaLibrary, items: [withFields(ia, { thumbnailUrl: "data:x", filmstripThumbnails: [] })] }, modifiedAt: 2 } as unknown as Project;
    expect(sameProjectForPlayback(a, thumbs)).toBe(true);
  });
});

describe("useStablePlaybackProject", () => {
  it("keeps the identity across waveform writes and follows real edits", () => {
    const a = project([item("a")]);
    const waveform = { ...a, mediaLibrary: { ...a.mediaLibrary, items: [withFields(a.mediaLibrary.items[0], { waveformData: new Float32Array(2) })] } } as Project;
    const edited = { ...a, timeline: { tracks: [{ id: "t" }] } } as unknown as Project;
    const { result, rerender } = renderHook(({ p }) => useStablePlaybackProject(p), { initialProps: { p: a } });
    expect(result.current).toBe(a);
    rerender({ p: waveform });
    expect(result.current).toBe(a);
    rerender({ p: edited });
    expect(result.current).toBe(edited);
    const inPlace = { ...edited } as Project;
    rerender({ p: inPlace });
    expect(result.current).toBe(inPlace);
  });
});
