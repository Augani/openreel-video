import { v4 as uuidv4 } from "uuid";
import {
  calculateProjectDuration,
  type Project,
  type ProjectSettings,
  type Timeline,
} from "@openreel/core";
import { generateProjectName } from "../../utils/project-names";

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  sampleRate: 48000,
  channels: 2,
};

export function createDefaultTimeline(): Timeline {
  return {
    tracks: [],
    subtitles: [],
    duration: 0,
    markers: [],
  };
}

export function createEmptyProject(
  name?: string,
  settings?: Partial<ProjectSettings>,
): Project {
  const now = Date.now();
  const projectName = name || generateProjectName();
  return {
    id: uuidv4(),
    name: projectName,
    createdAt: now,
    modifiedAt: now,
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...settings },
    mediaLibrary: { items: [] },
    timeline: createDefaultTimeline(),
    motionCompositions: [],
    motionInstances: [],
  };
}

export function calculateTimelineDuration(project: Project): number {
  return calculateProjectDuration(project);
}
