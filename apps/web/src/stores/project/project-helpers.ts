import { v4 as uuidv4 } from "uuid";
import {
  calculateProjectDuration,
  type Project,
  type ProjectSettings,
  type Timeline,
} from "@openreel/core";
import { generateProjectName } from "../../utils/project-names";

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  sampleRate: 48000,
  channels: 2,
};

function createDefaultTimeline(withEditingTracks = false): Timeline {
  return {
    tracks: withEditingTracks ? ([
      ["text", "Titles", "general"], ["video", "B-roll", "general"], ["video", "Main", "general"],
      ["audio", "Dialogue", "dialogue"], ["audio", "Music", "music"],
    ] as const).map(([type, name, role]) => ({
      id: uuidv4(), name, type, role, mode: "standard" as const, clips: [], transitions: [],
      locked: false, hidden: false, muted: false, solo: false,
    })) : [],
    subtitles: [],
    duration: 0,
    markers: [],
  };
}

export function createEmptyProject(
  name?: string,
  settings?: Partial<ProjectSettings>,
  withEditingTracks = false,
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
    timeline: createDefaultTimeline(withEditingTracks),
    motionCompositions: [],
    motionInstances: [],
  };
}

export function calculateTimelineDuration(project: Project): number {
  return calculateProjectDuration(project);
}
