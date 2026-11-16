import { createEditorProject } from "../../../services/project-creation";
import { useProjectStore } from "../../../stores/project-store";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { formatSettings, type FormatChoice } from "./clips";

export interface StartProjectResult {
  projectId: string;
  imported: string[];
  failed: { name: string; message: string }[];
}

export interface StartProjectDeps {
  createProject: typeof createEditorProject;
  importMedia: (
    file: File,
    onProgress?: (stage: string) => void,
  ) => Promise<{ success: boolean; error?: { message?: string } }>;
  markFormatChosen: (projectId: string) => void;
  /** Applies a new format to the project that is already open (a retry after the user changed it). */
  updateSettings: (settings: { width: number; height: number; frameRate: number }) => Promise<{ success: boolean; error?: { message?: string } }>;
}

const defaultDeps: StartProjectDeps = {
  createProject: createEditorProject,
  importMedia: (file, onProgress) => useProjectStore.getState().importMedia(file, onProgress),
  markFormatChosen: (id) => useOnboardingStore.getState().markFormatChosen(id),
  updateSettings: (settings) => useProjectStore.getState().updateSettings(settings),
};

/**
 * Creates the project in the chosen format and imports the clips with the same service the Assets
 * panel uses. The chat AI cannot create projects or import files, so the wizard does it (spec 2.4).
 * One bad file does not stop the rest; the caller decides what to do when nothing was imported.
 */
export async function startProjectWithClips(
  options: {
    files: readonly File[];
    format: FormatChoice;
    name?: string;
    /** A project this wizard already created: retry only the imports instead of making another project. */
    existingProjectId?: string;
    /** The format that project was created with; a different `format` on retry is applied to it. */
    existingFormatId?: FormatChoice["id"];
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
  },
  deps: Partial<StartProjectDeps> = {},
): Promise<StartProjectResult> {
  const d = { ...defaultDeps, ...deps };
  let projectId = options.existingProjectId;
  if (!projectId) {
    options.onProgress?.("Creating your project…");
    const project = await d.createProject({
      name: options.name ?? `New ${options.format.label} Video`,
      settings: formatSettings(options.format),
      signal: options.signal,
    });
    projectId = project.id;
    // The format was chosen here, so the editor's own format picker must stay hidden.
    d.markFormatChosen(projectId);
  } else if (options.existingFormatId && options.existingFormatId !== options.format.id) {
    // The user went back and picked another format after a failed import: honour it.
    options.onProgress?.("Updating the project format…");
    const updated = await d.updateSettings(formatSettings(options.format));
    if (!updated.success) {
      throw new Error(updated.error?.message ?? "Could not change the project format. Try again.");
    }
  }

  const imported: string[] = [];
  const failed: StartProjectResult["failed"] = [];
  for (let i = 0; i < options.files.length; i++) {
    if (options.signal?.aborted) break;
    const file = options.files[i];
    const label = `${i + 1} of ${options.files.length}`;
    options.onProgress?.(`Importing ${file.name} (${label})…`);
    try {
      const result = await d.importMedia(file, (stage) =>
        options.onProgress?.(`${stage} · ${file.name} (${label})`),
      );
      if (result.success) imported.push(file.name);
      else failed.push({ name: file.name, message: result.error?.message ?? "Could not import this file." });
    } catch (error) {
      failed.push({
        name: file.name,
        message: error instanceof Error ? error.message : "Could not import this file.",
      });
    }
  }
  return { projectId, imported, failed };
}

/** Turns practice clips from the main process into File objects. Empty when none are available. */
export async function loadPracticeFiles(): Promise<File[]> {
  const samples = typeof window !== "undefined" ? window.openreel?.samples : undefined;
  if (!samples) return [];
  try {
    const list = await samples.list();
    const files: File[] = [];
    for (const info of list) {
      const data = await samples.get(info.id);
      if (data) files.push(new File([data.bytes], data.name, { type: data.mimeType }));
    }
    return files;
  } catch {
    return [];
  }
}

/** Whether the practice clips exist (cheap list call). */
export async function practiceClipsAvailable(): Promise<boolean> {
  const samples = typeof window !== "undefined" ? window.openreel?.samples : undefined;
  if (!samples) return false;
  try {
    return (await samples.list()).length > 0;
  } catch {
    return false;
  }
}
