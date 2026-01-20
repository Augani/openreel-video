import { v4 as uuidv4 } from "uuid";
import type { Project, ProjectSettings, Timeline } from "@openreel/core";
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
    tracks: [
      {
        id: uuidv4(),
        type: "video",
        name: "Video 1",
        clips: [],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      },
      {
        id: uuidv4(),
        type: "audio",
        name: "Audio 1",
        clips: [],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      },
    ],
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
  };
}

export function calculateTimelineDuration(project: Project): number {
  let maxEnd = 0;
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd > maxEnd) {
        maxEnd = clipEnd;
      }
    }
  }
  return maxEnd;
}
