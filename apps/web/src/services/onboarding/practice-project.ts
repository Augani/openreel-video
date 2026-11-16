import { createEditorProject } from "../project-creation";
import { useProjectStore } from "../../stores/project-store";
import { useOnboardingStore } from "../../stores/onboarding-store";
import type { OpenReelSampleClipInfo } from "../../types/global";

/**
 * Practice project for the Learn path (spec 3.2). The clips are original footage generated for OpenReel and
 * shipped as desktop extraResources; they are only read over IPC when the Learn path starts, so cold start
 * is unaffected. When the pack is missing, `practiceClipsAvailable()` is false and the Learn sheet offers
 * "Use my own clip" only; the lessons work with any footage.
 */

export const PRACTICE_PROJECT_NAME = "Practice project";
/** 1080p30: what most people export, so lesson 6 is a realistic export. */
export const PRACTICE_SETTINGS = { width: 1920, height: 1080, frameRate: 30 } as const;

export class PracticeUnavailableError extends Error {
  constructor(message = "Practice clips are not available in this build.") {
    super(message);
    this.name = "PracticeUnavailableError";
  }
}

function samplesApi(): NonNullable<NonNullable<Window["openreel"]>["samples"]> | null {
  try {
    return window.openreel?.samples ?? null;
  } catch {
    return null;
  }
}

/** Lists the shipped practice clips (empty when the pack, or the desktop shell, is missing). */
export async function listPracticeClips(): Promise<OpenReelSampleClipInfo[]> {
  const api = samplesApi();
  if (!api) return [];
  try {
    return await api.list();
  } catch {
    return [];
  }
}

export async function practiceClipsAvailable(): Promise<boolean> {
  return (await listPracticeClips()).some((clip) => clip.kind === "video");
}

/** Loads every practice clip as a File (videos first, then the music bed). */
export async function loadPracticeFiles(): Promise<File[]> {
  const api = samplesApi();
  if (!api) throw new PracticeUnavailableError();
  const infos = await listPracticeClips();
  if (infos.length === 0) throw new PracticeUnavailableError();
  const ordered = [...infos].sort((a, b) => Number(a.kind === "audio") - Number(b.kind === "audio"));
  const files: File[] = [];
  for (const info of ordered) {
    const data = await api.get(info.id);
    if (!data) continue;
    const fileName = /\.[a-z0-9]+$/i.test(data.name) ? data.name : `${data.name}.${extensionFor(data.mimeType)}`;
    files.push(new File([data.bytes], fileName, { type: data.mimeType }));
  }
  if (files.length === 0) throw new PracticeUnavailableError();
  return files;
}

function extensionFor(mimeType: string): string {
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/mp4") return "m4a";
  if (mimeType === "audio/wav") return "wav";
  return "bin";
}

export interface PracticeProgress {
  /** Human-readable stage for the sheet ("Creating project", "Adding Aurora drift", ...). */
  readonly stage: string;
  readonly done: number;
  readonly total: number;
}

export interface PracticeResult {
  readonly projectId: string;
  readonly imported: number;
  readonly failed: readonly string[];
}

/**
 * Creates a project and imports `files` into its media library (not onto the timeline: placing a clip is
 * lesson 1). Marks the format as chosen so the duplicate format picker stays hidden, then opens the editor.
 */
export async function startLearnProject(
  files: readonly File[],
  options: { name?: string; onProgress?: (p: PracticeProgress) => void; navigate?: boolean } = {},
): Promise<PracticeResult> {
  if (files.length === 0) throw new Error("Pick a clip to practise with.");
  const report = options.onProgress ?? (() => undefined);
  report({ stage: "Creating your project", done: 0, total: files.length });
  const project = await createEditorProject({
    name: options.name ?? PRACTICE_PROJECT_NAME,
    settings: { ...PRACTICE_SETTINGS },
  });

  let imported = 0;
  const failed: string[] = [];
  for (const file of files) {
    report({ stage: `Adding ${file.name}`, done: imported + failed.length, total: files.length });
    const result = await useProjectStore.getState().importMedia(file);
    if (result.success) imported += 1;
    else failed.push(file.name);
  }
  if (imported === 0) {
    throw new Error("None of those files could be imported. Try a different clip.");
  }

  const onboarding = useOnboardingStore.getState();
  onboarding.markFormatChosen(project.id);
  onboarding.start("learn", "learn");
  report({ stage: "Ready", done: files.length, total: files.length });
  if (options.navigate !== false) window.location.hash = "#/editor";
  return { projectId: project.id, imported, failed };
}

/** "Use the practice clips (recommended)". */
export async function startPracticeProject(
  onProgress?: (p: PracticeProgress) => void,
): Promise<PracticeResult> {
  const files = await loadPracticeFiles();
  return startLearnProject(files, { onProgress });
}

/** "Use my own clip". */
export function startOwnClipProject(
  files: readonly File[],
  onProgress?: (p: PracticeProgress) => void,
): Promise<PracticeResult> {
  return startLearnProject(files, { name: "My first edit", onProgress });
}
