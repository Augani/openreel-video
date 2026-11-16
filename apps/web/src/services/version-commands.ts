import { v4 as uuidv4 } from "uuid";
import {
  DEFAULT_VERSION_POLICY,
  autoSnapshotDue,
  versionLabel,
  type MediaItem,
  type Project,
  type ProjectVersionMeta,
  type VersionPolicy,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { toast } from "../stores/notification-store";
import { serializeProjectForAutoSave } from "./auto-save";
import { projectManager } from "./project-manager";
import { saveCurrentProjectForReplacement } from "./project-replacement";
import { commitSequenceEdit } from "./sequence-commands";
import { createVersion, getVersion, removeVersion } from "./project-versions";

/**
 * Version commands: name a snapshot, restore one (as an undoable replace or as
 * a copy), delete one, and the background timer that takes automatic ones.
 */

/**
 * The snapshot's media items carry no blobs (JSON cannot hold them). Keep the
 * live item wherever the project still has it so a restore never detaches
 * media, keep live items the snapshot never knew (restoring must not lose
 * footage imported later), and leave the remaining ones as relinkable placeholders.
 */
export function mergeRestoredMedia(snapshot: Project, current: Project): Project {
  const live = new Map<string, MediaItem>(current.mediaLibrary.items.map((item) => [item.id, item]));
  const restored = snapshot.mediaLibrary.items.map((item) => live.get(item.id) ?? item);
  const known = new Set(restored.map((item) => item.id));
  const extra = current.mediaLibrary.items.filter((item) => !known.has(item.id));
  return { ...snapshot, mediaLibrary: { ...snapshot.mediaLibrary, items: [...restored, ...extra] } };
}

function blockedReason(): string | null {
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) return "Open a project first.";
  if (useUIStore.getState().exportState.isExporting) return "Wait for the export to finish.";
  return null;
}

export async function saveNamedVersion(name: string): Promise<ProjectVersionMeta | null> {
  const blocked = blockedReason();
  if (blocked) {
    toast.warning("Save version", blocked);
    return null;
  }
  try {
    const project = useProjectStore.getState().getFullProject();
    const data = serializeProjectForAutoSave(project);
    const meta = await createVersion(project, { kind: "manual", name: name.trim() || defaultVersionName(), data });
    noteVersionBaseline(project.id, data);
    toast.success("Version saved", versionLabel(meta));
    return meta;
  } catch (error) {
    toast.error("Could not save the version", error instanceof Error ? error.message : "Please try again.");
    return null;
  }
}

export const defaultVersionName = (now = new Date()): string =>
  `Version ${now.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;

async function loadSnapshot(versionId: string): Promise<{ version: Project; label: string } | null> {
  const projectId = useProjectStore.getState().project.id;
  const record = await getVersion(projectId, versionId);
  if (!record) {
    toast.warning("Version not found", "It may have been deleted.");
    return null;
  }
  const parsed = await projectManager.parseProjectContent(record.data);
  return { version: parsed, label: versionLabel(record) };
}

/**
 * Restore a version into the open project as ONE undoable step (Undo brings
 * the current edit back). A safety copy of the current state is stored first so
 * the replaced edit also survives a reload.
 */
export async function restoreVersion(versionId: string): Promise<boolean> {
  const blocked = blockedReason();
  if (blocked) {
    toast.warning("Restore version", blocked);
    return false;
  }
  try {
    const loaded = await loadSnapshot(versionId);
    if (!loaded) return false;
    const current = useProjectStore.getState().getFullProject();
    await createVersion(current, { kind: "manual", name: `Before restoring "${loaded.label}"` });
    const result = await commitSequenceEdit("Restore version", (project) => {
      const merged = mergeRestoredMedia(loaded.version, project);
      // The restored edit keeps this project's identity; only its content changes.
      return { ok: true, project: { ...merged, id: project.id, createdAt: project.createdAt } };
    });
    if (!result.ok) {
      toast.warning("Could not restore the version", result.message);
      return false;
    }
    toast.success("Version restored", `${loaded.label}. Use Undo to go back.`);
    return true;
  } catch (error) {
    toast.error("Could not restore the version", error instanceof Error ? error.message : "Please try again.");
    return false;
  }
}

/** Open a version as its own new project, leaving the current project untouched. */
export async function restoreVersionAsCopy(versionId: string): Promise<boolean> {
  const blocked = blockedReason();
  if (blocked) {
    toast.warning("Restore as copy", blocked);
    return false;
  }
  try {
    const loaded = await loadSnapshot(versionId);
    if (!loaded) return false;
    const current = useProjectStore.getState().getFullProject();
    await saveCurrentProjectForReplacement(current.id);
    const now = Date.now();
    const copy: Project = {
      ...mergeRestoredMedia(loaded.version, current),
      id: uuidv4(),
      name: `${loaded.version.name} (${loaded.label})`,
      createdAt: now,
      modifiedAt: now,
    };
    useProjectStore.getState().loadProject(copy);
    projectManager.activatePickedProject({ project: copy, fileHandle: null });
    const timeline = useTimelineStore.getState();
    timeline.stop();
    timeline.seekToStart();
    timeline.clearLoopRange();
    useUIStore.getState().clearSelection();
    toast.success("Opened as a copy", copy.name);
    return true;
  } catch (error) {
    toast.error("Could not open the copy", error instanceof Error ? error.message : "Please try again.");
    return false;
  }
}

export async function deleteVersion(versionId: string): Promise<void> {
  try {
    await removeVersion(versionId);
  } catch (error) {
    toast.error("Could not delete the version", error instanceof Error ? error.message : "Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Automatic versions

let timer: ReturnType<typeof setInterval> | null = null;
let state: { projectId: string; lastAutoAt: number | null; lastData: string | null } | null = null;
let running = false;

/** One tick: take an automatic version when the interval has passed and the project changed. Exposed for tests. */
export async function runAutoVersionCheck(
  now: number = Date.now(),
  policy: VersionPolicy = DEFAULT_VERSION_POLICY,
): Promise<ProjectVersionMeta | null> {
  if (running) return null;
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) return null;
  running = true;
  try {
    const project = store.getFullProject();
    const data = serializeProjectForAutoSave(project);
    if (!state || state.projectId !== project.id) {
      // First sight of this project: the baseline is what is open now, no version yet.
      state = { projectId: project.id, lastAutoAt: now, lastData: data };
      return null;
    }
    if (!autoSnapshotDue(state, data, now, policy)) return null;
    const meta = await createVersion(project, { kind: "auto", data, policy });
    state = { projectId: project.id, lastAutoAt: now, lastData: data };
    return meta;
  } catch (error) {
    console.warn("[Versions] Automatic version failed", error);
    return null;
  } finally {
    running = false;
  }
}

/** A manual version counts as the baseline too: no automatic one is needed until the project changes again. */
export function noteVersionBaseline(projectId: string, data: string, now = Date.now()): void {
  state = { projectId, lastAutoAt: state?.projectId === projectId ? state.lastAutoAt : now, lastData: data };
}

/** Start the background timer (idempotent). The check is cheap when nothing changed. */
export function startAutoVersioning(checkEveryMs = 60_000): void {
  if (timer || typeof window === "undefined") return;
  timer = setInterval(() => {
    void runAutoVersionCheck();
  }, checkEveryMs);
}

export function stopAutoVersioning(): void {
  if (timer) clearInterval(timer);
  timer = null;
  state = null;
}
