import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ProjectSerializer } from "@openreel/core/storage/project-serializer";
import type { IStorageEngine } from "@openreel/core/storage/types";
import type { Project, ProjectSettings } from "@openreel/core/types/project";

const DEFAULT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  sampleRate: 48000,
  channels: 2,
};

const unavailable = (): never => {
  throw new Error("Storage engine is not available in the headless runner");
};

/**
 * The headless runner only uses the serializer's pure JSON methods
 * (exportToJson / importFromJson / validateProjectJson); any persistence call
 * is a bug, so every member throws. A Proxy guarantees full coverage of
 * IStorageEngine (no member can silently be a no-op).
 */
const noopStorage = new Proxy(
  {},
  { get: () => unavailable },
) as IStorageEngine;

function serializer(): ProjectSerializer {
  return new ProjectSerializer(noopStorage);
}

export function createEmptyProject(
  name?: string,
  settings?: Partial<ProjectSettings>,
): Project {
  const now = Date.now();
  return {
    id: randomUUID(),
    name: name && name.length > 0 ? name : "Untitled",
    createdAt: now,
    modifiedAt: now,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    mediaLibrary: { items: [] },
    timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
  } as unknown as Project;
}

export async function loadProjectFile(path: string): Promise<Project> {
  const json = await readFile(path, "utf8");
  const validation = serializer().validateProjectJson(json);
  if (!validation.valid) {
    const detail =
      validation.errors?.join("; ") ?? "unknown validation error";
    throw new Error(`Invalid project file ${path}: ${detail}`);
  }
  return serializer().importFromJson(json);
}

export async function saveProjectFile(
  path: string,
  project: Project,
): Promise<void> {
  const stamped: Project = { ...project, modifiedAt: Date.now() };
  await writeFile(path, serializer().exportToJson(stamped), "utf8");
}
