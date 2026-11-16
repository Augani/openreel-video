import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import type {
  MotionAudioClip,
  MotionComposition,
  MotionVideoLayer,
} from "../motion/types";
import { DEFAULT_MOTION_TRANSFORM } from "../motion/types";
import type { MotionShaderDef } from "../motion/shaders/types";
import type {
  CacheRecord,
  IStorageEngine,
  MediaRecord,
  ProjectSummary,
  StorageUsage,
  WaveformRecord,
} from "./types";
import {
  ProjectSerializer,
  PROJECT_READER_VERSION,
  CLIP_FRAGMENTS_CAPABILITY,
  MULTI_SEQUENCE_MIN_READER_VERSION,
  SCHEMA_VERSION,
  normalizeMotionComposition,
  normalizeProjectCreationFields,
  normalizeProjectMotionFields,
  normalizeProjectTextStyles,
  normalizeProjectStoredFields,
} from "./project-serializer";
import { createCreationScene, createEmptyCreationState } from "../creation";
import { UNIVERSAL_TRACKS_CAPABILITY } from "../timeline/timeline-items";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_TRANSFORM } from "../text/types";

const makeVideoLayer = (
  overrides: Partial<MotionVideoLayer> = {},
): MotionVideoLayer => ({
  id: "layer-video-1",
  type: "video",
  name: "Clip",
  startTime: 0,
  duration: 3,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  assetId: "asset-1",
  width: 1920,
  height: 1080,
  fit: "contain",
  playbackRate: 1,
  timeOffset: 0,
  trimStart: 0,
  muted: false,
  ...overrides,
});

const makeComposition = (
  overrides: Partial<MotionComposition> = {},
): MotionComposition => ({
  id: "comp-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
  ...overrides,
});

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: "project-1",
  name: "Project",
  createdAt: 1,
  modifiedAt: 1,
  settings: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
  },
  mediaLibrary: { items: [] },
  timeline: {
    tracks: [],
    subtitles: [],
    duration: 0,
    markers: [],
  },
  ...overrides,
});

class MemoryStorageEngine implements IStorageEngine {
  private projects = new Map<string, Project>();
  private media = new Map<string, MediaRecord>();

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }
  async loadProject(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }
  async listProjects(): Promise<ProjectSummary[]> {
    return [...this.projects.values()].map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      modifiedAt: project.modifiedAt,
    }));
  }
  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
  }
  async saveMedia(media: MediaRecord): Promise<void> {
    this.media.set(media.id, media);
  }
  async loadMedia(id: string): Promise<MediaRecord | null> {
    return this.media.get(id) ?? null;
  }
  async deleteMedia(id: string): Promise<void> {
    this.media.delete(id);
  }
  async getMediaByProject(): Promise<MediaRecord[]> {
    return [];
  }
  async saveCache(): Promise<void> {}
  async loadCache(): Promise<CacheRecord | null> {
    return null;
  }
  async deleteCache(): Promise<void> {}
  async clearCache(): Promise<void> {}
  async saveWaveform(): Promise<void> {}
  async loadWaveform(): Promise<WaveformRecord | null> {
    return null;
  }
  async deleteWaveform(): Promise<void> {}
  async saveFileHandle(): Promise<void> {}
  async loadFileHandle(): Promise<FileSystemFileHandle | null> {
    return null;
  }
  async saveDirectoryHandle(): Promise<void> {}
  async loadDirectoryHandle(): Promise<{
    handle: FileSystemDirectoryHandle;
    folderName: string;
  } | null> {
    return null;
  }
  async getStorageUsage(): Promise<StorageUsage> {
    return { used: 0, quota: 0, projects: 0, mediaItems: 0 };
  }
  async clearAllData(): Promise<void> {}
  close(): void {}
}

describe("fragment project compatibility", () => {
  const clockedProject = () => makeProject({ textClips: [{
    id: "caption", trackId: "titles", startTime: 0, duration: 2, text: "Retained material",
    style: DEFAULT_TEXT_STYLE, transform: DEFAULT_TEXT_TRANSFORM,
    keyframes: [{ id: "before-cut", time: -1, property: "opacity", value: 0, easing: "linear" }],
  }] });
  it("declares retained clocks in ordinary JSON files and stored saves without mutating the live project", async () => {
    const storage = new MemoryStorageEngine(), serializer = new ProjectSerializer(storage), project = clockedProject();
    const file = JSON.parse(serializer.exportToJson(project));
    expect(file.version).toBe(SCHEMA_VERSION);
    expect(file.minimumReaderVersion).toBe(PROJECT_READER_VERSION);
    expect(file.capabilities).toContain(CLIP_FRAGMENTS_CAPABILITY);
    expect(serializer.importFromJson(JSON.stringify(file)).textClips).toEqual(project.textClips);
    await serializer.saveProject(project);
    const restored = await serializer.loadProject(project.id);
    expect(restored?.minimumReaderVersion).toBe(PROJECT_READER_VERSION);
    expect(restored?.textClips).toEqual(project.textClips);
    expect(project.minimumReaderVersion).toBeUndefined();
    expect(project.capabilities).toBeUndefined();
  });
  it("keeps ordinary projects unchanged and preserves a higher declared reader minimum", async () => {
    const storage = new MemoryStorageEngine(), serializer = new ProjectSerializer(storage);
    expect(JSON.parse(serializer.exportToJson(makeProject())).minimumReaderVersion).toBeUndefined();
    const future = makeProject({ ...clockedProject(), capabilities: [UNIVERSAL_TRACKS_CAPABILITY], minimumReaderVersion: "9.0.0" });
    expect(JSON.parse(serializer.exportToJson(future)).minimumReaderVersion).toBe("9.0.0");
    await serializer.saveProject(future);
    await expect(serializer.loadProject(future.id)).rejects.toThrow(/reader 9\.0\.0/);
    expect(() => serializer.importFromJson(JSON.stringify({ version: SCHEMA_VERSION, project: future }))).toThrow(/reader 9\.0\.0/);
  });
});

describe("normalizeMotionComposition", () => {
  it("defaults audioClips to [] when missing", () => {
    const composition = makeComposition();
    expect(composition.audioClips).toBeUndefined();

    const normalized = normalizeMotionComposition(composition);

    expect(normalized.audioClips).toEqual([]);
  });

  it("preserves existing audioClips", () => {
    const audioClips: MotionAudioClip[] = [
      { id: "audio-1", startTime: 0, duration: 4, gain: 0.8 },
    ];
    const normalized = normalizeMotionComposition(
      makeComposition({ audioClips }),
    );

    expect(normalized.audioClips).toEqual(audioClips);
  });

  it("drops malformed audioClips entries", () => {
    const audioClips = [
      { id: "audio-1", startTime: 0, duration: 4 },
      null,
      { startTime: 1, duration: 2 },
    ] as unknown as MotionAudioClip[];

    const normalized = normalizeMotionComposition(
      makeComposition({ audioClips }),
    );

    expect(normalized.audioClips).toHaveLength(1);
    expect(normalized.audioClips?.[0]?.id).toBe("audio-1");
  });

  it("preserves video layers and their fields", () => {
    const videoLayer = makeVideoLayer({
      assetId: "video-asset-42",
      playbackRate: 1.5,
      trimStart: 2,
      muted: true,
    });
    const normalized = normalizeMotionComposition(
      makeComposition({ layers: [videoLayer] }),
    );

    expect(normalized.layers).toHaveLength(1);
    const layer = normalized.layers[0] as MotionVideoLayer;
    expect(layer.type).toBe("video");
    expect(layer.assetId).toBe("video-asset-42");
    expect(layer.playbackRate).toBe(1.5);
    expect(layer.trimStart).toBe(2);
    expect(layer.muted).toBe(true);
  });

  it("backfills guides/lights/tracks and is idempotent", () => {
    const composition = makeComposition();
    const once = normalizeMotionComposition(composition);
    const twice = normalizeMotionComposition(once);

    expect(once.guides).toEqual([]);
    expect(once.lights).toEqual([]);
    expect(once.tracks).toEqual([]);
    expect(twice).toEqual(once);
  });
});

describe("normalizeProjectMotionFields", () => {
  it("defaults motionCompositions and motionInstances", () => {
    const normalized = normalizeProjectMotionFields(makeProject());

    expect(normalized.motionCompositions).toEqual([]);
    expect(normalized.motionInstances).toEqual([]);
  });

  it("does not clobber existing motion instances", () => {
    const project = makeProject({
      motionInstances: [
        {
          id: "instance-1",
          compositionId: "comp-1",
          startTime: 0,
          duration: 5,
          transform: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
            fitMode: "contain",
          },
          opacity: 1,
        },
      ],
    });

    const normalized = normalizeProjectMotionFields(project);

    expect(normalized.motionInstances).toHaveLength(1);
    expect(normalized.motionInstances?.[0]?.id).toBe("instance-1");
  });
});

describe("normalizeProjectCreationFields", () => {
  it("normalizes creation state while preserving scene records", () => {
    const creation = {
      ...createEmptyCreationState(),
      scenes: [createCreationScene({ id: "scene-creation", name: "Creation", now: 1 })],
    };
    const normalized = normalizeProjectCreationFields(makeProject({ creation }));

    expect(normalized.creation?.version).toBe(creation.version);
    expect(normalized.creation?.scenes).toHaveLength(1);
    expect(normalized.creation?.operationHistory).toEqual([]);
  });
});

describe("ProjectSerializer round-trip", () => {
  it("upgrades saved iris intent while preserving text material and manual animation", () => {
    const serializer = new ProjectSerializer(new MemoryStorageEngine());
    const manual = { id: "manual", property: "rotation", time: 1, value: 25, easing: "linear" as const };
    const style = { ...DEFAULT_TEXT_STYLE, color: "rgba(30, 40, 50, 0.4)",
      shader: { shaderId: "paper-mesh-gradient", params: { color1: "#ee44aa" } } };
    const transform = { ...DEFAULT_TEXT_TRANSFORM, scale: { x: -0.8, y: 1.2 }, opacity: 0.4,
      rotate3d: { x: 5, y: 10, z: 15 }, perspective: 600 };
    const legacy = ["scale.x", "scale.y", "opacity"].flatMap((property) => [
      { id: `kf-entry-iris-star-${property}-0`, property, time: 0, value: property === "opacity" ? 0.5 : 0, easing: "ease-out" as const },
      { id: `kf-entry-iris-star-${property}-1`, property, time: 0.5, value: property === "scale.x" ? -0.8 : property === "scale.y" ? 1.2 : 0.4, easing: "ease-out" as const },
    ]);
    const project = makeProject({ textClips: [{ id: "title", text: "Keep my material", trackId: "titles",
      startTime: 0, duration: 4, style, transform, keyframes: [manual, ...legacy] }] });
    const imported = serializer.importFromJson(JSON.stringify({ version: SCHEMA_VERSION, project }));
    const clip = imported.textClips![0];
    expect(clip.style).toEqual(style);
    expect(clip.transform).toEqual(transform);
    expect(clip.keyframes).toEqual([manual,
      expect.objectContaining({ property: "effect.iris-star", time: 0, value: 0, easing: "ease-out" }),
      expect.objectContaining({ property: "effect.iris-star", time: 0.5, value: 1, easing: "ease-out" }),
    ]);
    expect(serializer.importFromJson(serializer.exportToJson(imported)).textClips).toEqual(imported.textClips);
    expect(project.textClips![0].keyframes).toHaveLength(7);
  });

  it("writes the universal-track reader requirement and preserves it", () => {
    const serializer = new ProjectSerializer(new MemoryStorageEngine());
    const project = makeProject({
      capabilities: [UNIVERSAL_TRACKS_CAPABILITY],
      minimumReaderVersion: "1.2.0",
    });

    const json = serializer.exportToJson(project);
    const file = JSON.parse(json) as {
      version: string;
      minimumReaderVersion?: string;
      capabilities?: string[];
    };

    expect(file.version).toBe(SCHEMA_VERSION);
    expect(file.minimumReaderVersion).toBe("1.2.0");
    expect(file.capabilities).toContain(UNIVERSAL_TRACKS_CAPABILITY);
    expect(serializer.importFromJson(json).capabilities).toContain(
      UNIVERSAL_TRACKS_CAPABILITY,
    );
  });

  it("rejects a project that needs a newer reader", () => {
    const serializer = new ProjectSerializer(new MemoryStorageEngine());
    const json = JSON.stringify({
      version: "9.0.0",
      minimumReaderVersion: "9.0.0",
      project: makeProject(),
    });

    expect(() => serializer.importFromJson(json)).toThrow(
      /requires OpenReel project reader 9\.0\.0 or newer/,
    );
    expect(serializer.validateProjectJson(json)).toMatchObject({
      valid: false,
    });
  });

  // The validator compared the file's minimum reader against the SCHEMA version (1.2.0), so any
  // file declaring clip clocks (1.3.0) or multiple sequences (1.4.0) was rejected on package and
  // script import even though the reader itself accepts them.
  it("validates files that need the clip-clock or multi-sequence reader this build supports", () => {
    const serializer = new ProjectSerializer(new MemoryStorageEngine());
    for (const minimumReaderVersion of [PROJECT_READER_VERSION, MULTI_SEQUENCE_MIN_READER_VERSION]) {
      const json = JSON.stringify({ version: SCHEMA_VERSION, minimumReaderVersion, project: makeProject() });
      expect(serializer.validateProjectJson(json), minimumReaderVersion).toMatchObject({ valid: true });
      expect(serializer.importFromJsonWithValidation(json).project).not.toBeNull();
    }
    const newer = JSON.stringify({ version: SCHEMA_VERSION, minimumReaderVersion: "1.5.0", project: makeProject() });
    expect(serializer.validateProjectJson(newer)).toMatchObject({ valid: false });
  });

  it("does not flag a sequence nest or compound clip as pointing at a missing media item", () => {
    const serializer = new ProjectSerializer(new MemoryStorageEngine());
    const project = makeProject();
    const nest = { id: "nest-1", mediaId: "compound:seq-2", trackId: "t1", startTime: 0, duration: 2, inPoint: 0, outPoint: 2, effects: [], audioEffects: [], transform: DEFAULT_TEXT_TRANSFORM, volume: 1, keyframes: [] };
    const withNest = { ...project, timeline: { ...project.timeline, tracks: [{ id: "t1", type: "video", name: "V1", clips: [nest], transitions: [], locked: false, hidden: false, muted: false, solo: false }] } };
    const json = JSON.stringify({ version: SCHEMA_VERSION, project: withNest });
    expect(serializer.validateProjectJson(json)).toMatchObject({ valid: true, errors: [] });
  });

  it("preserves audioClips and video layers through export/import", () => {
    const serializer = new ProjectSerializer(new MemoryStorageEngine());
    const composition = makeComposition({
      layers: [makeVideoLayer()],
      audioClips: [{ id: "audio-1", startTime: 0, duration: 4 }],
    });
    const project = makeProject({ motionCompositions: [composition] });

    const json = serializer.exportToJson(project);
    const imported = serializer.importFromJson(json);

    expect(imported.motionCompositions).toHaveLength(1);
    const importedComposition = imported.motionCompositions![0];
    expect(importedComposition.audioClips).toEqual([
      { id: "audio-1", startTime: 0, duration: 4 },
    ]);
    expect(importedComposition.layers).toHaveLength(1);
    expect((importedComposition.layers[0] as MotionVideoLayer).type).toBe(
      "video",
    );
    expect((importedComposition.layers[0] as MotionVideoLayer).assetId).toBe(
      "asset-1",
    );
  });

  it("backfills audioClips when an older composition lacks it", () => {
    const serializer = new ProjectSerializer(new MemoryStorageEngine());
    const composition = makeComposition({ layers: [makeVideoLayer()] });
    const project = makeProject({ motionCompositions: [composition] });

    const imported = serializer.importFromJson(serializer.exportToJson(project));

    expect(imported.motionCompositions![0].audioClips).toEqual([]);
  });
});

const makeShaderDef = (
  overrides: Partial<MotionShaderDef> = {},
): MotionShaderDef => ({
  id: "ai-round-1",
  name: "AI Round",
  category: "fill",
  glsl: "void main(){}",
  params: [
    {
      name: "u_intensity",
      label: "Intensity",
      type: "number",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
  ],
  origin: "generated",
  ...overrides,
});

describe("ProjectSerializer generatedShaders", () => {
  it("round-trips a valid generated shader through export/import", () => {
    const serializer = new ProjectSerializer(new MemoryStorageEngine());
    const def = makeShaderDef();
    const project = makeProject({ generatedShaders: [def] });

    const imported = serializer.importFromJson(serializer.exportToJson(project));

    expect(imported.generatedShaders).toEqual([def]);
  });

  it("drops malformed generated shaders on import", () => {
    const serializer = new ProjectSerializer(new MemoryStorageEngine());
    const valid = makeShaderDef();
    const badCategory = makeShaderDef({ id: "ai-bad-cat", category: "wrong" as MotionShaderDef["category"] });
    const missingGlsl = { ...makeShaderDef({ id: "ai-no-glsl" }), glsl: undefined };
    const project = makeProject({
      generatedShaders: [valid, badCategory, missingGlsl] as MotionShaderDef[],
    });

    const imported = serializer.importFromJson(serializer.exportToJson(project));

    expect(imported.generatedShaders?.map((d) => d.id)).toEqual(["ai-round-1"]);
  });

  it("defaults generatedShaders to an empty array when absent", () => {
    const serializer = new ProjectSerializer(new MemoryStorageEngine());
    const project = makeProject();

    const imported = serializer.importFromJson(serializer.exportToJson(project));

    expect(imported.generatedShaders).toEqual([]);
  });
});

describe("normalizeProjectTextStyles", () => {
  it("gives a text clip saved without a style the default style, seeded from legacy top-level fields", () => {
    const project = {
      textClips: [
        { id: "a", trackId: "t", startTime: 0, duration: 1, text: "Legacy", fontFamily: "Roboto", fontSize: 64, color: "#ff0000" },
        { id: "b", trackId: "t", startTime: 0, duration: 1, text: "Partial", style: { color: "#00ff00" } },
      ],
    } as unknown as Project;
    const out = normalizeProjectTextStyles(project);
    expect(out.textClips?.[0].style).toEqual({ ...DEFAULT_TEXT_STYLE, fontFamily: "Roboto", fontSize: 64, color: "#ff0000" });
    expect(out.textClips?.[1].style).toEqual({ ...DEFAULT_TEXT_STYLE, color: "#00ff00" });
  });

  it("leaves complete styles untouched and runs as part of the stored-field normalization", () => {
    const styled = { id: "c", trackId: "t", startTime: 0, duration: 1, text: "Ok", style: { ...DEFAULT_TEXT_STYLE, fontFamily: "Lora" }, transform: DEFAULT_TEXT_TRANSFORM };
    const project = { textClips: [styled] } as unknown as Project;
    expect(normalizeProjectTextStyles(project)).toBe(project);
    const stored = normalizeProjectStoredFields(makeProject({ textClips: [{ id: "d", trackId: "t", startTime: 0, duration: 1, text: "x" }] } as unknown as Partial<Project>));
    expect(stored.textClips?.[0].style?.fontWeight).toBe(DEFAULT_TEXT_STYLE.fontWeight);
  });
});

