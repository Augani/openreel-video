import { describe, expect, it } from "vitest";
import { trackHasAudioItems, type Project } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { createMixerChannelSelector } from "./audio-mixer-channels";

function fixture() {
  const base = createEmptyProject("Channels");
  const types = ["audio", "video", "video", "video", "image", "audio"] as const;
  const media = types.map((type, i) => ({
    id: `media-${i}`,
    type,
    name: `Media ${i}`,
    blob: null,
    fileHandle: null,
    thumbnailUrl: null,
    waveformData: null,
    metadata: {
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "test",
      fileSize: 100,
      sampleRate: i === 1 ? 48000 : 0,
      channels: 0,
      ...(i === 2 ? { hasAudio: true } : i === 5 ? { hasAudio: false } : {}),
    },
  }));
  const tracks = media.map((item, i) => ({
    id: `track-${i}`,
    name: `Track ${i}`,
    type: i === 0 ? ("graphics" as const) : ("video" as const),
    muted: i === 2,
    solo: false,
    hidden: false,
    locked: false,
    transitions: [],
    clips: [
      {
        id: `clip-${i}`,
        trackId: `track-${i}`,
        mediaId: item.id,
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        volume: 1,
        effects: [],
        audioEffects: [],
        keyframes: [],
        transform: {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
      },
    ],
  }));
  return {
    ...base,
    mediaLibrary: { items: media },
    timeline: { ...base.timeline, tracks },
  } satisfies Project;
}
describe("indexed mixer channel selection", () => {
  it("matches canonical audio capability across media flags and universal track types", () => {
    const project = fixture();
    const actual = createMixerChannelSelector()(project);
    expect(actual.trackIds).toEqual(
      project.timeline.tracks
        .filter((track) => trackHasAudioItems(project, track.id))
        .map((track) => track.id),
    );
    expect(actual.trackIds).toEqual(["track-0", "track-1", "track-2"]);
    expect(actual.tracks[0].type).toBe("graphics");
  });
  it("observes audio capability replacement, missing media and removed clips", () => {
    const project = fixture(),
      select = createMixerChannelSelector();
    select(project);
    const changed = {
      ...project,
      mediaLibrary: {
        items: project.mediaLibrary.items
          .filter((item) => item.id !== "media-0")
          .map((item) => ({
            ...item,
            metadata: { ...item.metadata, hasAudio: item.id === "media-4" },
          })),
      },
    };
    expect(select(changed).trackIds).toEqual(["track-4"]);
    expect(
      select({
        ...changed,
        timeline: {
          ...changed.timeline,
          tracks: changed.timeline.tracks.map((track) => ({
            ...track,
            clips: [],
          })),
        },
      }).trackIds,
    ).toEqual([]);
  });
  it("includes nested audio under its root channel and observes definition replacement", () => {
    const project = fixture(), select = createMixerChannelSelector();
    const leaf = project.timeline.tracks[0].clips[0];
    const definition = { id: "nested", name: "Nested", color: "#888", createdAt: 0, modifiedAt: 0,
      content: { duration: 10, clips: [leaf], tracks: [{ ...project.timeline.tracks[0], clips: [leaf] }] } };
    const owned = { ...project, compoundClips: [definition], timeline: { ...project.timeline, tracks: [{ ...project.timeline.tracks[0], clips: [{ ...leaf, mediaId: "compound:nested" }] }] } };
    expect(select(owned).trackIds).toEqual(["track-0"]);
    expect(trackHasAudioItems(owned, "track-0")).toBe(true);
    const silent = { ...owned, compoundClips: [{ ...definition, content: { ...definition.content, tracks: [{ ...definition.content.tracks[0], clips: [{ ...leaf, mediaId: "media-4" }] }] } }] };
    expect(select(silent).trackIds).toEqual([]);
  });
  it("gives every audio track a strip, even before it holds clips", () => {
    const project = fixture();
    const empty = {
      ...project.timeline.tracks[5],
      id: "dialogue",
      type: "audio" as const,
      clips: [],
    };
    const withEmpty = {
      ...project,
      timeline: { ...project.timeline, tracks: [...project.timeline.tracks, empty] },
    };
    expect(createMixerChannelSelector()(withEmpty).trackIds).toEqual([
      "track-0",
      "track-1",
      "track-2",
      "dialogue",
    ]);
  });

});
