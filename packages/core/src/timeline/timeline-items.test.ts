import { describe, expect, it } from "vitest";
import type { Clip, MediaItem, Project, Track } from "../types";
import type { TextClip } from "../text/types";
import {
  UNIVERSAL_TRACKS_CAPABILITY,
  getMediaItemCapabilities,
  createTimelineClipCapabilityResolver,
  getCompoundClipId,
  getProjectClipCapabilities,
  getTimelineItemCapabilities,
  getTimelineItems,
  getTrackItems,
  getVisibleTrackRenderOrder,
  trackHasAudioItems,
  trackHasVisualItems,
  withUniversalTracksCapability,
} from "./timeline-items";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

const clip = (id: string, mediaId: string, trackId = "mixed"): Clip => ({
  id,
  mediaId,
  trackId,
  startTime: id === "audio-clip" ? 2 : 0,
  duration: 2,
  inPoint: 0,
  outPoint: 2,
  effects: [],
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
});

const track: Track = {
  id: "mixed",
  type: "text",
  name: "Legacy Text 1",
  clips: [clip("video-clip", "video"), clip("audio-clip", "audio")],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
};

const media = (
  id: string,
  type: MediaItem["type"],
  hasVideo: boolean,
  hasAudio: boolean,
): MediaItem => ({
  id,
  name: id,
  type,
  fileHandle: null,
  blob: null,
  thumbnailUrl: null,
  waveformData: null,
  metadata: {
    duration: 2,
    width: hasVideo ? 1920 : 0,
    height: hasVideo ? 1080 : 0,
    frameRate: hasVideo ? 30 : 0,
    codec: "test",
    sampleRate: hasAudio ? 48000 : 0,
    channels: hasAudio ? 2 : 0,
    fileSize: 1,
    hasVideo,
    hasAudio,
  },
});

const textClip: TextClip = {
  id: "text-clip",
  trackId: "mixed",
  startTime: 4,
  duration: 2,
  text: "Mixed",
  style: {
    fontFamily: "Inter",
    fontSize: 24,
    fontWeight: 400,
    fontStyle: "normal",
    color: "#fff",
    textAlign: "center",
    verticalAlign: "middle",
    lineHeight: 1.2,
    letterSpacing: 0,
  },
  transform,
  keyframes: [],
};

const project: Project = {
  id: "project",
  name: "Mixed",
  createdAt: 1,
  modifiedAt: 1,
  settings: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
  },
  mediaLibrary: {
    items: [
      media("video", "video", true, true),
      media("audio", "audio", false, true),
    ],
  },
  timeline: { tracks: [track], subtitles: [], duration: 6, markers: [] },
  textClips: [textClip],
};

describe("universal timeline item model", () => {
  it("keeps imported still images visual when stream metadata hasVideo is false", () => {
    const importedImage = media("image", "image", false, false);
    const mixedTrackProject: Project = {
      ...project,
      mediaLibrary: {
        items: [...project.mediaLibrary.items, importedImage],
      },
      timeline: {
        ...project.timeline,
        tracks: [
          {
            ...track,
            clips: [
              clip("video-clip", "video"),
              {
                ...clip("image-clip", "image"),
                startTime: 2,
              },
            ],
          },
        ],
      },
    };

    expect(getMediaItemCapabilities(importedImage)).toEqual({
      visual: true,
      audio: false,
    });
    expect(
      getTimelineItemCapabilities(
        getTrackItems(mixedTrackProject, "mixed").find(
          (item) => item.id === "image-clip",
        )!,
      ),
    ).toMatchObject({ visual: true, audio: false });
    expect(trackHasVisualItems(mixedTrackProject, "mixed")).toBe(true);
  });

  it("renders lower timeline tracks first and keeps index zero on top", () => {
    const top = { ...track, id: "top", hidden: false };
    const hidden = { ...track, id: "hidden", hidden: true };
    const bottom = { ...track, id: "bottom", hidden: false };

    expect(
      getVisibleTrackRenderOrder([top, hidden, bottom]).map(
        ({ track: orderedTrack, originalIndex }) => [
          orderedTrack.id,
          originalIndex,
        ],
      ),
    ).toEqual([
      ["bottom", 2],
      ["top", 0],
    ]);
  });

  it("resolves media and overlays from one legacy-typed track", () => {
    expect(getTrackItems(project, "mixed").map((item) => item.kind)).toEqual([
      "media",
      "media",
      "text",
    ]);
    expect(getTimelineItems(project)).toHaveLength(3);
  });

  it("derives visual and audio behavior from content instead of track type", () => {
    const items = getTrackItems(project, "mixed");
    const video = items.find((item) => item.id === "video-clip")!;
    const audio = items.find((item) => item.id === "audio-clip")!;
    const text = items.find((item) => item.id === "text-clip")!;

    expect(getTimelineItemCapabilities(video)).toMatchObject({
      visual: true,
      audio: true,
    });
    expect(getTimelineItemCapabilities(audio)).toMatchObject({
      visual: false,
      audio: true,
    });
    expect(getTimelineItemCapabilities(text)).toMatchObject({
      visual: true,
      audio: false,
      textEditable: true,
    });
    expect(trackHasVisualItems(project, "mixed")).toBe(true);
    expect(trackHasAudioItems(project, "mixed")).toBe(true);
  });

  it("marks a project with the reader requirement exactly once", () => {
    const once = withUniversalTracksCapability(project);
    const twice = withUniversalTracksCapability(once);
    expect(once.capabilities).toContain(UNIVERSAL_TRACKS_CAPABILITY);
    expect(once.minimumReaderVersion).toBe("1.2.0");
    expect(twice).toBe(once);
  });
});


describe("compound source capabilities", () => {
  const definition = (id: string, clips: Clip[]): NonNullable<Project["compoundClips"]>[number] => ({
    id, name: id, color: "#888", createdAt: 0, modifiedAt: 0,
    content: { clips, tracks: [{ ...track, clips }], duration: 2 },
  });
  it("resolves audio and visual descendants without requiring a proxy media asset", () => {
    const definitions = [definition("audio", [clip("a", "audio")]), definition("visual", [clip("v", "still")]),
      definition("both", [clip("nested-a", "compound:audio"), clip("nested-v", "compound:visual")])];
    const library = { items: [...project.mediaLibrary.items, media("still", "image", false, false)] };
    const resolve = createTimelineClipCapabilityResolver(library, definitions);
    expect(resolve(clip("p", "compound:audio"))).toEqual({ audio: true, visual: false });
    expect(resolve(clip("p", "compound:visual"))).toEqual({ audio: false, visual: true });
    expect(resolve(clip("p", "compound:both"))).toEqual({ audio: true, visual: true });
    const owned = { ...project, mediaLibrary: library, compoundClips: definitions, timeline: { ...project.timeline, tracks: [{ ...track, clips: [clip("p", "compound:both")] }] } };
    expect(trackHasAudioItems(owned, track.id)).toBe(true);
    expect(trackHasVisualItems(owned, track.id)).toBe(true);
  });
  it("supports metadata and legacy ids and gives metadata precedence", () => {
    expect(getCompoundClipId(clip("p", "compound:legacy"))).toBe("legacy");
    const proxy = { ...clip("p", "compound:legacy"), metadata: { compoundClipId: "audio" } };
    expect(getCompoundClipId(proxy)).toBe("audio");
    expect(createTimelineClipCapabilityResolver(project.mediaLibrary, [definition("audio", [clip("a", "audio")])])(proxy)).toEqual({ audio: true, visual: false });
  });
  it("bounds cyclic/missing definitions and preserves valid siblings from each root path", () => {
    const resolve = createTimelineClipCapabilityResolver(project.mediaLibrary, [
      definition("one", [clip("cycle-two", "compound:two"), clip("a", "audio")]),
      definition("two", [clip("cycle-one", "compound:one")]),
    ]);
    expect(resolve(clip("missing", "compound:missing"))).toEqual({ audio: false, visual: false });
    expect(resolve(clip("one", "compound:one"))).toEqual({ audio: true, visual: false });
    expect(resolve(clip("two", "compound:two"))).toEqual({ audio: true, visual: false });
  });
  it("invalidates the per-project index on a recorded mutable revision", () => {
    const owned = { ...project, mediaLibrary: { items: [media("changed", "audio", false, true)] }, compoundClips: [definition("audio", [clip("a", "changed")])] };
    const proxy = clip("p", "compound:audio");
    expect(getProjectClipCapabilities(owned, proxy).audio).toBe(true);
    owned.mediaLibrary.items[0] = { ...owned.mediaLibrary.items[0], metadata: { ...owned.mediaLibrary.items[0].metadata, hasAudio: false } };
    owned.modifiedAt++;
    expect(getProjectClipCapabilities(owned, proxy)).toEqual({ audio: false, visual: false });
  });
});

describe("per-track item lookup", () => {
  const other: Track = { ...track, id: "other", name: "Other", clips: [clip("other-clip", "audio", "other")] };
  const multi: Project = {
    ...project,
    timeline: { ...project.timeline, tracks: [track, other] },
    textClips: [textClip, { ...textClip, id: "other-text", trackId: "other", startTime: 1 }],
  };

  it("getTrackItems matches filtering the whole timeline by track", () => {
    for (const id of ["mixed", "other", "ghost"]) {
      const viaAll = getTimelineItems(multi).filter((item) => item.trackId === id);
      expect(getTrackItems(multi, id).map((i) => [i.id, i.kind, i.startTime])).toEqual(viaAll.map((i) => [i.id, i.kind, i.startTime]));
    }
    expect(getTrackItems(multi, "other").map((i) => i.id)).toEqual(["other-clip", "other-text"]);
  });

  it("resolves media through the index and survives in-place library edits", () => {
    const library = [media("video", "video", true, true), media("audio", "audio", false, true)];
    const live: Project = { ...multi, mediaLibrary: { items: library } };
    const mediaOf = (project: Project, id: string) => {
      const item = getTrackItems(project, "mixed").find((i) => i.id === id);
      return item?.kind === "media" ? item.mediaItem : undefined;
    };
    expect(mediaOf(live, "video-clip")).toBe(library[0]);
    // In-place replacement keeps the same array and length: the stale entry must not be returned.
    const replaced = media("video", "image", true, false);
    library[0] = replaced;
    expect(mediaOf(live, "video-clip")).toBe(replaced);
    // Items appended later are found; removed items resolve to undefined.
    library.push(media("late", "video", true, true));
    const withLate: Project = { ...live, timeline: { ...live.timeline, tracks: [{ ...track, clips: [clip("c-late", "late")] }] } };
    expect(mediaOf(withLate, "c-late")?.id).toBe("late");
    library.splice(0, 2);
    expect(mediaOf(live, "video-clip")).toBeUndefined();
  });
});
