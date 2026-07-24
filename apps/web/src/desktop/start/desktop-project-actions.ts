import { useProjectStore } from "../../stores/project-store";
import { checkForRecovery, type AutoSaveMetadata } from "../../services/auto-save";

export interface NewProjectFormat {
  id: string;
  label: string;
  width: number;
  height: number;
  frameRate: number;
}

export const DESKTOP_FORMATS: NewProjectFormat[] = [
  { id: "vertical", label: "Vertical", width: 1080, height: 1920, frameRate: 30 },
  { id: "horizontal", label: "Horizontal", width: 1920, height: 1080, frameRate: 30 },
  { id: "square", label: "Square", width: 1080, height: 1080, frameRate: 30 },
];

export function startNewProject(format: NewProjectFormat): void {
  useProjectStore.getState().createNewProject(format.label, {
    width: format.width,
    height: format.height,
    frameRate: format.frameRate,
  });
}

export function startNewMotionProject(format: NewProjectFormat): void {
  useProjectStore.getState().createNewProject(`${format.label} Motion Creator`, {
    width: format.width,
    height: format.height,
    frameRate: format.frameRate,
  });
}

export interface RecentEntry {
  id: string;
  name: string;
  savedAt: number;
}

export async function listRecentProjects(): Promise<RecentEntry[]> {
  const saves = await checkForRecovery();
  const latestByProject = new Map<string, AutoSaveMetadata>();

  for (const save of saves) {
    if (!latestByProject.has(save.projectId)) {
      latestByProject.set(save.projectId, save);
    }
  }

  return Array.from(latestByProject.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10)
    .map((save) => ({
      id: save.id,
      name: save.projectName,
      savedAt: save.timestamp,
    }));
}

export async function openRecentProject(saveId: string): Promise<boolean> {
  return useProjectStore.getState().recoverFromAutoSave(saveId);
}
