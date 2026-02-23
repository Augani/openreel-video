import type { Project, MediaItem } from "../types";
import type { IStorageEngine, MediaRecord } from "./types";
import type { ValidationResult, ProjectFileWithMetadata } from "./schema-types";

export interface ProjectFile {
  readonly version: string;
  readonly project: Project;
}

export const SCHEMA_VERSION = "1.0.0";

export class ProjectSerializer {
  private storage: IStorageEngine;

  constructor(storage: IStorageEngine) {
    this.storage = storage;
  }

  async saveProject(project: Project): Promise<void> {
    await this.saveMediaBlobs(project);

    const projectToSave: Project = {
      ...project,
      modifiedAt: Date.now(),
    };

    await this.storage.saveProject(projectToSave);
  }

  async loadProject(id: string): Promise<Project | null> {
    const project = await this.storage.loadProject(id);
    if (!project) {
      return null;
    }

    const restoredProject = await this.restoreMediaBlobs(project);
    return restoredProject;
  }

  exportToJson(project: Project): string {
    const projectFile: ProjectFile = {
      version: SCHEMA_VERSION,
      project: this.stripMediaBlobs(project),
    };
    return JSON.stringify(projectFile, null, 2);
  }

  importFromJson(json: string): Project {
    const projectFile = JSON.parse(json) as ProjectFile;

    if (projectFile.version !== SCHEMA_VERSION) {
      return this.migrateProject(projectFile);
    }

    const project = projectFile.project;

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
        items: processedItems,
      },
    };
  }

  exportToJsonWithMetadata(project: Project, description?: string): string {
    const projectFile: ProjectFileWithMetadata = {
      version: SCHEMA_VERSION,
      project: this.stripMediaBlobs(project),
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
                  clip.mediaId.startsWith("sticker-"));
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
        items: strippedItems,
      },
    };
  }

  private migrateProject(projectFile: ProjectFile): Project {
    return projectFile.project;
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
