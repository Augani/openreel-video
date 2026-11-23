import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import type { MediaItem } from "../types/project";
import type { IStorageEngine, MediaRecord } from "./types";
import { ProjectSerializer } from "./project-serializer";
import { resolveSourceChannelGroups, buildSourceGroups, sourceAudioShape, type SourceChannelGroup } from "../audio/source-channels";

/**
 * A media item's channel layout (Modify > Audio Channels), the per-stream widths of a mixed-width file and the clips'
 * channel maps / patch slots survive a save and reload, through both the stored project and the JSON project file.
 */
class MemoryStorage implements Partial<IStorageEngine> {
  private projects = new Map<string, Project>();
  private media = new Map<string, MediaRecord>();
  async saveProject(project: Project) { this.projects.set(project.id, JSON.parse(JSON.stringify(project))); }
  async loadProject(id: string) { return this.projects.get(id) ?? null; }
  async saveMedia(media: MediaRecord) { this.media.set(media.id, media); }
  async loadMedia(id: string) { return this.media.get(id) ?? null; }
  async deleteMedia(id: string) { this.media.delete(id); }
  async getMediaByProject() { return []; }
  async saveWaveform() {}
  async loadWaveform() { return null; }
}

const layout: SourceChannelGroup[] = [
  { stream: 0, map: { format: "stereo", sources: [0, 0] } },
  { stream: 1, map: { format: "mono", sources: [-1] } },
  { stream: 2, map: { format: "stereo", sources: [0, 1] } },
];

function project(): Project {
  const media = {
    id: "m1", name: "mixed.mov", type: "video", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
    channelLayout: layout,
    metadata: { duration: 10, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1, hasAudio: true, audioTrackCount: 3, audioStreamChannels: [1, 1, 2] },
  } as unknown as MediaItem;
  const clip = {
    id: "c1", mediaId: "m1", trackId: "a1", startTime: 0, duration: 4, inPoint: 0, outPoint: 4, effects: [], audioEffects: [], keyframes: [], volume: 1,
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
    audioTrackIndex: 2, channelMap: { format: "mono", sources: [1] }, metadata: { sourceChannelGroup: 2 },
  };
  return {
    id: "p-layout", name: "Layout", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media] },
    timeline: { tracks: [{ id: "a1", name: "A1", type: "audio", clips: [clip], transitions: [], locked: false, hidden: false, solo: false, muted: false }], subtitles: [], duration: 4, markers: [] },
  } as unknown as Project;
}

const expectKept = (restored: Project | null | undefined) => {
  const item = restored?.mediaLibrary.items[0];
  expect(item?.channelLayout).toEqual(layout);
  expect(item?.metadata.audioStreamChannels).toEqual([1, 1, 2]);
  const clip = restored?.timeline.tracks[0].clips[0];
  expect(clip?.channelMap).toEqual({ format: "mono", sources: [1] });
  expect(clip?.audioTrackIndex).toBe(2);
  expect(clip?.metadata?.sourceChannelGroup).toBe(2);
  // What the layout expands to is what was saved: three clips, the stereo stream beside two mono streams.
  expect(resolveSourceChannelGroups(item).map((group) => group.map.format)).toEqual(["stereo", "mono", "stereo"]);
};

describe("channel layout save and reload", () => {
  it("round-trips through the stored project", async () => {
    const serializer = new ProjectSerializer(new MemoryStorage() as unknown as IStorageEngine);
    await serializer.saveProject(project());
    expectKept(await serializer.loadProject("p-layout"));
  });

  it("round-trips through the JSON project file", () => {
    const serializer = new ProjectSerializer(new MemoryStorage() as unknown as IStorageEngine);
    expectKept(serializer.importFromJson(serializer.exportToJson(project())));
  });

  it("a project saved before per-stream widths were read still groups every stream by the file's one channel count", () => {
    const old = project();
    const item = old.mediaLibrary.items[0] as unknown as { metadata: Record<string, unknown>; channelLayout?: unknown };
    delete item.metadata.audioStreamChannels;
    delete item.channelLayout;
    const serializer = new ProjectSerializer(new MemoryStorage() as unknown as IStorageEngine);
    const restored = serializer.importFromJson(serializer.exportToJson(old));
    expect(resolveSourceChannelGroups(restored.mediaLibrary.items[0]).map((group) => [group.stream, group.map.format])).toEqual([[0, "stereo"], [1, "stereo"], [2, "stereo"]]);
    expect(buildSourceGroups("file", sourceAudioShape(restored.mediaLibrary.items[0]))).toHaveLength(3);
  });
});
