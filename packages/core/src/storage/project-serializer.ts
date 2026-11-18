import { normalizeBins } from "../media/bins";
import { normalizeSmartBins } from "../media/smart-bins";
import type { Project, MediaItem } from "../types";
import type { IStorageEngine, MediaRecord } from "./types";
import type { ValidationResult, ProjectFileWithMetadata } from "./schema-types";
import type {
  MotionAudioClip,
  MotionComposition,
  MotionCompositionInstance,
  MotionLayer,
} from "../motion/types";
import type {
  MotionShaderCategory,
  MotionShaderDef,
  MotionShaderParamDef,
} from "../motion/shaders/types";
import { normalizeMotionCamera } from "../motion/motion-camera";
import { normalizeMotionLights } from "../motion/motion-lights";
import { normalizeMotionTracks } from "../motion/motion-tracking";
import { normalizeCreationState } from "../creation";
import { normalizeProjectIrisAnimations } from "../video/clip-iris";
import { normalizeProjectEffectKeyframes } from "../video/effect-instance-keyframes";
import { normalizeProjectAudioRacks } from "../audio/track-audio-rack";
import { normalizeProjectAudioRouting } from "../audio/audio-routing";
import { ensureSequences, syncActiveSequence } from "../timeline/sequences";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "../text/types";
import {
  UNIVERSAL_TRACKS_MIN_READER_VERSION,
  projectUsesUniversalTracks,
} from "../timeline/timeline-items";

const MOTION_SHADER_CATEGORIES: ReadonlySet<MotionShaderCategory> = new Set([
  "fill",
  "effect",
  "text",
]);

function isMotionShaderParamDef(value: unknown): value is MotionShaderParamDef {
  if (!value || typeof value !== "object") {
    return false;
  }
  const param = value as Record<string, unknown>;
  return (
    typeof param.name === "string" &&
    typeof param.label === "string" &&
    (param.type === "number" || param.type === "color") &&
    typeof param.default === "number" &&
    typeof param.min === "number" &&
    typeof param.max === "number" &&
    typeof param.step === "number"
  );
}

function isMotionShaderDef(value: unknown): value is MotionShaderDef {
  if (!value || typeof value !== "object") {
    return false;
  }
  const def = value as Record<string, unknown>;
  return (
    typeof def.id === "string" &&
    def.id.length > 0 &&
    typeof def.name === "string" &&
    typeof def.category === "string" &&
    MOTION_SHADER_CATEGORIES.has(def.category as MotionShaderCategory) &&
    typeof def.glsl === "string" &&
    def.glsl.length > 0 &&
    Array.isArray(def.params) &&
    def.params.every(isMotionShaderParamDef)
  );
}

export function normalizeGeneratedShaders(
  value: unknown,
): readonly MotionShaderDef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isMotionShaderDef).map((def) => ({
    id: def.id,
    name: def.name,
    category: def.category,
    glsl: def.glsl,
    params: def.params,
    origin: "generated" as const,
  }));
}

interface ProjectFile {
  readonly version: string;
  readonly minimumReaderVersion?: string;
  readonly capabilities?: readonly string[];
  readonly project: Project;
}

export const SCHEMA_VERSION = "1.2.0";
/** Wire layout stays compatible; this reader additionally understands clip clocks. */
export const PROJECT_READER_VERSION = "1.3.0";
export const CLIP_FRAGMENTS_CAPABILITY = "clip-fragments-v1";
/** Projects holding more than one sequence keep the others outside `timeline`: older readers would drop them. */
export const MULTI_SEQUENCE_CAPABILITY = "multi-sequence-v1";
export const MULTI_SEQUENCE_MIN_READER_VERSION = "1.4.0";
/** Newest project layout this build reads (clip clocks stay at PROJECT_READER_VERSION). */
const SUPPORTED_READER_VERSION = MULTI_SEQUENCE_MIN_READER_VERSION;

function projectUsesClipClocks(project: Project): boolean {
  const items = [
    ...project.timeline.tracks.flatMap(track => track.clips),
    ...(project.textClips ?? []), ...(project.shapeClips ?? []),
    ...(project.svgClips ?? []), ...(project.stickerClips ?? []),
    ...(project.compoundClips ?? []).flatMap(definition => [
      ...(definition.content.clips ?? []), ...(definition.content.tracks ?? []).flatMap(track => track.clips),
    ]),
  ];
  return items.some(item => ("fade" in item && item.fade?.origin) || ("speed" in item && (item.speed ?? 1) < 0) ||
    item.keyframes?.some(key => key.time < 0)) ||
    (project.particleEffects ?? []).some(effect => !!effect.seedId);
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .split(".")
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function getProjectFileCompatibility(project: Project): Pick<
  ProjectFile,
  "minimumReaderVersion" | "capabilities"
> {
  const clocks = projectUsesClipClocks(project);
  const multiSequence = (project.sequences?.length ?? 0) > 1;
  const capabilities = [...new Set([...(project.capabilities ?? []), ...(clocks ? [CLIP_FRAGMENTS_CAPABILITY] : []), ...(multiSequence ? [MULTI_SEQUENCE_CAPABILITY] : [])])];
  const versions = [project.minimumReaderVersion,
    multiSequence ? MULTI_SEQUENCE_MIN_READER_VERSION : undefined,
    projectUsesUniversalTracks(project) ? UNIVERSAL_TRACKS_MIN_READER_VERSION : undefined,
    clocks ? PROJECT_READER_VERSION : undefined].filter((version): version is string => !!version);
  const minimumReaderVersion = versions.sort(compareVersions).at(-1);
  return {
    minimumReaderVersion,
    capabilities: capabilities.length > 0 ? capabilities : undefined,
  };
}

function assertReaderCompatibility(projectFile: ProjectFile): void {
  const minimumReaderVersion = [projectFile.minimumReaderVersion, projectFile.project?.minimumReaderVersion]
    .filter((version): version is string => !!version).sort(compareVersions).at(-1);
  if (
    minimumReaderVersion &&
    compareVersions(minimumReaderVersion, SUPPORTED_READER_VERSION) > 0
  ) {
    throw new Error(
      `This project requires OpenReel project reader ${minimumReaderVersion} or newer. Current reader: ${SUPPORTED_READER_VERSION}.`,
    );
  }
}

function normalizeMotionAudioClips(
  composition: Pick<MotionComposition, "audioClips">,
): MotionAudioClip[] {
  if (!Array.isArray(composition.audioClips)) {
    return [];
  }
  return composition.audioClips.filter(
    (clip): clip is MotionAudioClip =>
      !!clip && typeof clip === "object" && typeof clip.id === "string",
  );
}

function normalizeMotionLayers(
  composition: Pick<MotionComposition, "layers">,
): MotionLayer[] {
  if (!Array.isArray(composition.layers)) {
    return [];
  }
  return composition.layers.filter(
    (layer): layer is MotionLayer =>
      !!layer && typeof layer === "object" && typeof layer.id === "string",
  );
}

export function normalizeMotionComposition(
  composition: MotionComposition,
): MotionComposition {
  return {
    ...composition,
    layers: normalizeMotionLayers(composition),
    assets: Array.isArray(composition.assets) ? composition.assets : [],
    variables: Array.isArray(composition.variables) ? composition.variables : [],
    markers: Array.isArray(composition.markers) ? composition.markers : [],
    audioClips: normalizeMotionAudioClips(composition),
    guides: Array.isArray(composition.guides) ? composition.guides : [],
    lights: normalizeMotionLights(composition),
    camera: composition.camera
      ? normalizeMotionCamera(composition)
      : undefined,
    tracks: normalizeMotionTracks(composition),
  };
}

export function normalizeProjectMotionFields(project: Project): Project {
  const motionInstances: MotionCompositionInstance[] = Array.isArray(
    project.motionInstances,
  )
    ? project.motionInstances
    : [];

  return {
    ...project,
    motionCompositions: Array.isArray(project.motionCompositions)
      ? project.motionCompositions.map(normalizeMotionComposition)
      : [],
    motionInstances,
  };
}

export function normalizeProjectCreationFields(project: Project): Project {
  return {
    ...project,
    creation: normalizeCreationState(project.creation),
  };
}

function normalizeProjectGeneratedShaderFields(
  project: Project,
): Project {
  return {
    ...project,
    generatedShaders: normalizeGeneratedShaders(project.generatedShaders),
  };
}

/**
 * Project-panel migration. Projects saved before bins existed have no `bins`
 * and no `binId`s: everything stays at the root and the project is returned
 * untouched. Stored bins are repaired and dangling `binId`s hoisted to root.
 */
export function normalizeProjectBins(project: Project): Project {
  const library = project.mediaLibrary?.items;
  if (!Array.isArray(library)) return project;
  const hasBinIds = library.some((item) => item.binId !== undefined);
  if (project.bins === undefined && !hasBinIds) return project;
  const bins = normalizeBins(project.bins) ?? [];
  const known = new Set(bins.map((bin) => bin.id));
  const items = library.map((item) => {
    if (item.binId === undefined || known.has(item.binId)) return item;
    const { binId: _dropped, ...rest } = item;
    void _dropped;
    return rest as MediaItem;
  });
  const { bins: _oldBins, ...withoutBins } = project;
  void _oldBins;
  return {
    ...withoutBins,
    ...(bins.length > 0 ? { bins } : {}),
    mediaLibrary: { ...project.mediaLibrary, items },
  };
}

/** Smart bins are optional; drop malformed stored entries, leave old projects untouched. */
export function normalizeProjectSmartBins(project: Project): Project {
  if (project.smartBins === undefined) return project;
  const smartBins = normalizeSmartBins(project.smartBins) ?? [];
  const { smartBins: _old, ...rest } = project;
  void _old;
  return smartBins.length > 0 ? { ...rest, smartBins } : rest;
}

/**
 * Text clips saved without a style object (legacy files, hand-written or agent-built projects) get the
 * default style, seeded from any legacy top-level fontFamily/fontSize/color fields. Every text reader
 * (renderer, inspector, font scan) assumes `clip.style` exists.
 */
export function normalizeProjectTextStyles(project: Project): Project {
  if (!Array.isArray(project.textClips)) return project;
  let changed = false;
  const textClips = project.textClips.map((clip) => {
    const style = (clip as { style?: Partial<TextStyle> }).style;
    if (style && typeof style === "object" && typeof style.fontFamily === "string" && style.fontSize !== undefined && style.fontWeight !== undefined) return clip;
    changed = true;
    const legacy = clip as unknown as Partial<Pick<TextStyle, "fontFamily" | "fontSize" | "color">>;
    const seeded: Partial<TextStyle> = {
      ...(typeof legacy.fontFamily === "string" ? { fontFamily: legacy.fontFamily } : {}),
      ...(typeof legacy.fontSize === "number" ? { fontSize: legacy.fontSize } : {}),
      ...(typeof legacy.color === "string" ? { color: legacy.color } : {}),
    };
    return { ...clip, style: { ...DEFAULT_TEXT_STYLE, ...seeded, ...(style && typeof style === "object" ? style : {}) } };
  });
  return changed ? { ...project, textClips } : project;
}

// Type-keyed effect keyframes (effect.brightness, effect.<proType>.<param>,
// effect.hsl-secondary.*) are rewritten onto effect instances (fx:<id>:<param>)
// on load; every writer now emits instance ids. Idempotent.
export function normalizeProjectStoredFields(project: Project): Project {
  return ensureSequences(normalizeProjectSmartBins(normalizeProjectBins(normalizeProjectAudioRouting(normalizeProjectAudioRacks(normalizeProjectEffectKeyframes(normalizeProjectIrisAnimations(normalizeProjectGeneratedShaderFields(
    normalizeProjectCreationFields(normalizeProjectMotionFields(normalizeProjectTextStyles(project))),
  ))))))));
}

export class ProjectSerializer {
  private storage: IStorageEngine;

  constructor(storage: IStorageEngine) {
    this.storage = storage;
  }

  async saveProject(source: Project): Promise<void> {
    const project = syncActiveSequence(source);
    const compatibility = getProjectFileCompatibility(project);
    await this.saveMediaBlobs(project);

    const projectToSave: Project = {
      ...project,
      ...(compatibility.minimumReaderVersion ? { minimumReaderVersion: compatibility.minimumReaderVersion } : {}),
      ...(compatibility.capabilities ? { capabilities: compatibility.capabilities } : {}),
      modifiedAt: Date.now(),
    };

    await this.storage.saveProject(projectToSave);
  }

  async loadProject(id: string): Promise<Project | null> {
    const project = await this.storage.loadProject(id);
    if (!project) {
      return null;
    }
    assertReaderCompatibility({ version: SCHEMA_VERSION, project, minimumReaderVersion: project.minimumReaderVersion });

    const restoredProject = await this.restoreMediaBlobs(project);
    return ensureSequences(normalizeProjectSmartBins(normalizeProjectBins(restoredProject)));
  }

  exportToJson(project: Project): string {
    const projectFile: ProjectFile = {
      version: SCHEMA_VERSION,
      ...getProjectFileCompatibility(project),
      project: this.stripMediaBlobs(syncActiveSequence(project)),
    };
    return JSON.stringify(projectFile, null, 2);
  }

  importFromJson(json: string): Project {
    const projectFile = JSON.parse(json) as ProjectFile;
    assertReaderCompatibility(projectFile);

    if (projectFile.version !== SCHEMA_VERSION) {
      return this.migrateProject(projectFile);
    }

    const project = this.normalizeStoredFields(projectFile.project);

    const processedItems: MediaItem[] = project.mediaLibrary.items.map(
      (item: MediaItem) => {
        if (!item.blob) {
          return {
            ...item,
            isPlaceholder: true,
            originalUrl: item.thumbnailUrl || undefined,
          };
        }
        return item;
      },
    );

    return {
      ...project,
      mediaLibrary: {
        ...project.mediaLibrary,
        items: processedItems,
      },
    };
  }

  exportToJsonWithMetadata(project: Project, description?: string): string {
    const projectFile: ProjectFileWithMetadata = {
      version: SCHEMA_VERSION,
      ...getProjectFileCompatibility(project),
      project: this.stripMediaBlobs(syncActiveSequence(project)),
      metadata: {
        exportedAt: Date.now(),
        description,
      },
    };
    return JSON.stringify(projectFile, null, 2);
  }

  validateProjectJson(json: string): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      missingAssets: [],
    };

    try {
      const projectFile = JSON.parse(json) as ProjectFile;

      if (!projectFile.version) {
        result.errors.push("Missing version field");
        result.valid = false;
      } else if (projectFile.version !== SCHEMA_VERSION) {
        result.warnings.push(
          `Version mismatch: expected ${SCHEMA_VERSION}, got ${projectFile.version}`,
        );
      }

      if (
        projectFile.minimumReaderVersion &&
        compareVersions(projectFile.minimumReaderVersion, SUPPORTED_READER_VERSION) > 0
      ) {
        result.errors.push(
          `Project requires reader ${projectFile.minimumReaderVersion} or newer`,
        );
        result.valid = false;
      }

      if (!projectFile.project) {
        result.errors.push("Missing project field");
        result.valid = false;
        return result;
      }

      const project = projectFile.project;

      if (!project.id) {
        result.errors.push("Missing project.id");
        result.valid = false;
      }
      if (!project.name) {
        result.errors.push("Missing project.name");
        result.valid = false;
      }
      if (!project.settings) {
        result.errors.push("Missing project.settings");
        result.valid = false;
      }
      if (!project.timeline) {
        result.errors.push("Missing project.timeline");
        result.valid = false;
      }
      if (!project.mediaLibrary) {
        result.errors.push("Missing project.mediaLibrary");
        result.valid = false;
      }

      if (!result.valid) {
        return result;
      }

      const mediaIds = new Set(
        project.mediaLibrary.items.map((item: MediaItem) => item.id),
      );

      for (const item of project.mediaLibrary.items) {
        if (!item.blob && !item.thumbnailUrl) {
          result.missingAssets!.push(item.id);
        }
      }

      if (project.timeline.tracks) {
        for (const track of project.timeline.tracks) {
          if (track.clips) {
            for (const clip of track.clips) {
              const isVirtualClip =
                clip.mediaId &&
                (clip.mediaId.startsWith("text-") ||
                  clip.mediaId.startsWith("shape-") ||
                  clip.mediaId.startsWith("svg-") ||
                  clip.mediaId.startsWith("sticker-") ||
                  clip.mediaId.startsWith("motion-") ||
                  // Compound clips and sequence nests point at a sequence, not a media item.
                  clip.mediaId.startsWith("compound:"));
              if (
                clip.mediaId &&
                !isVirtualClip &&
                !mediaIds.has(clip.mediaId)
              ) {
                result.errors.push(
                  `Clip ${clip.id} references non-existent mediaId: ${clip.mediaId}`,
                );
                result.valid = false;
              }
            }
          }
        }
      }

      if (result.missingAssets && result.missingAssets.length > 0) {
        result.warnings.push(
          `${result.missingAssets.length} asset(s) need replacement`,
        );
      }
    } catch (error) {
      result.errors.push(
        `Invalid JSON: ${error instanceof Error ? error.message : "Parse error"}`,
      );
      result.valid = false;
    }

    return result;
  }

  importFromJsonWithValidation(json: string): {
    project: Project | null;
    validation: ValidationResult;
  } {
    const validation = this.validateProjectJson(json);

    if (!validation.valid) {
      return { project: null, validation };
    }

    const project = this.importFromJson(json);
    return { project, validation };
  }

  private async saveMediaBlobs(project: Project): Promise<void> {
    for (const item of project.mediaLibrary.items) {
      if (item.blob) {
        const mediaRecord: MediaRecord = {
          id: item.id,
          projectId: project.id,
          blob: item.blob,
          metadata: item.metadata,
        };
        await this.storage.saveMedia(mediaRecord);
      }
    }
  }

  private async restoreMediaBlobs(project: Project): Promise<Project> {
    const restoredItems: MediaItem[] = [];

    for (const item of project.mediaLibrary.items) {
      const mediaRecord = await this.storage.loadMedia(item.id);

      if (mediaRecord) {
        restoredItems.push({
          ...item,
          blob: mediaRecord.blob,
          metadata: mediaRecord.metadata,
        });
      } else {
        restoredItems.push(item);
      }
    }

    return {
      ...project,
      mediaLibrary: {
        ...project.mediaLibrary,
        items: restoredItems,
      },
    };
  }

  private stripMediaBlobs(project: Project): Project {
    const strippedItems: MediaItem[] = project.mediaLibrary.items.map(
      (item) => ({
        ...item,
        blob: null,
        fileHandle: null,
        waveformData: null,
      }),
    );

    return {
      ...project,
      mediaLibrary: {
        ...project.mediaLibrary,
        items: strippedItems,
      },
    };
  }

  private migrateProject(projectFile: ProjectFile): Project {
    return this.normalizeStoredFields(projectFile.project);
  }

  private normalizeStoredFields(project: Project): Project {
    return normalizeProjectStoredFields(project);
  }

  async deleteProject(id: string): Promise<void> {
    await this.storage.deleteProject(id);
  }

  async listProjects() {
    return this.storage.listProjects();
  }
}

export function createProjectSerializer(
  storage: IStorageEngine,
): ProjectSerializer {
  return new ProjectSerializer(storage);
}
