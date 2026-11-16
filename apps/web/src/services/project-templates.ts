import type { Project, Template, TemplateCategory } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useProcessingStore } from "./processing-manager";
import {
  flushEditorFieldDrafts,
  type EditorDraftOwner,
} from "./editor-field-drafts";
import { loadMediaBlob, saveMediaBlob, deleteMediaBlob } from "./media-storage";
import { templateCloudService } from "./template-cloud-service";
import { saveCurrentProjectForReplacement } from "./project-replacement";
import { autoSaveManager } from "./auto-save";
import { loadEngineModules } from "./lazy-engines";
import { copyPackagedProject } from "./project-package";
import { restoreMediaItem } from "../utils/media-recovery";

export function templateEditorOwner(): EditorDraftOwner {
  const current = useProjectStore.getState();
  return { projectId: current.project.id, history: current.actionHistory };
}

function assertOwner(owner: EditorDraftOwner, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const current = useProjectStore.getState();
  if (
    current.project.id !== owner.projectId ||
    current.actionHistory !== owner.history
  ) {
    throw new Error(
      "The open project changed. Try again from the current project.",
    );
  }
}

/** The library picker stores media IDs; resolve actual owned originals before application. */
export async function resolveTemplateMedia<
  T extends Record<string, { type: string; value: unknown; mediaBlob?: Blob }>,
>(values: T, owner: EditorDraftOwner, signal?: AbortSignal): Promise<T> {
  const resolved = { ...values };
  for (const [id, value] of Object.entries(values)) {
    if ((value.type !== "media" && value.type !== "audio") || value.mediaBlob)
      continue;
    assertOwner(owner, signal);
    const item = useProjectStore
      .getState()
      .project.mediaLibrary.items.find(
        (candidate) => candidate.id === value.value,
      );
    if (!item) continue;
    if (item.isPending || item.kieaiError)
      throw new Error(
        `Wait for “${item.name}” to finish generating, or choose another media item.`,
      );
    const blob =
      item.blob instanceof Blob
        ? item.blob
        : item.fileHandle && typeof item.fileHandle.getFile === "function"
          ? await item.fileHandle.getFile()
          : await loadMediaBlob(item.id);
    assertOwner(owner, signal);
    const latest = useProjectStore
      .getState()
      .project.mediaLibrary.items.find((candidate) => candidate.id === item.id);
    if (
      !latest ||
      latest.blob !== item.blob ||
      latest.fileHandle !== item.fileHandle
    )
      throw new Error("The selected media changed. Choose it again.");
    if (!(blob instanceof Blob) || blob.size === 0)
      throw new Error(`Relink “${item.name}” before using it in a template.`);
    Object.assign(resolved, {
      [id]: {
        ...value,
        mediaBlob: blob,
        media: {
          name: latest.name,
          type: latest.type,
          metadata: { ...latest.metadata },
        },
      },
    });
  }
  return resolved;
}

interface SaveProjectTemplateOptions {
  owner: EditorDraftOwner;
  signal: AbortSignal;
  name: string;
  description: string;
  category: TemplateCategory;
  tags: string;
  author: string;
  location: "local" | "cloud";
  onWriting?: () => void;
}

/** Capture one owned project after pending property edits, never mixed engine state. */
export async function saveProjectTemplate(
  options: SaveProjectTemplateOptions,
): Promise<Template> {
  const { owner, signal } = options;
  if (!options.name.trim()) throw new Error("Template name is required");
  if (!options.description.trim()) throw new Error("Description is required");
  assertOwner(owner, signal);
  await flushEditorFieldDrafts(owner);
  assertOwner(owner, signal);
  const engine = await useEngineStore.getState().getTemplateEngine();
  await engine.initialize();
  assertOwner(owner, signal);
  const project = useProjectStore.getState().getFullProject();
  let template: Template = {
    ...engine.createFromProject(project, {
      name: options.name.trim(),
      description: options.description.trim(),
      category: options.category,
      tags: options.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      placeholders: [],
    }),
    author: options.author.trim() || "Anonymous",
  };

  if (options.location === "local" && template.projectContent) {
    const originals = new Map(
      project.mediaLibrary.items.map((item) => [item.id, item]),
    );
    const items = [];
    for (const item of template.projectContent.mediaLibrary.items) {
      assertOwner(owner, signal);
      const source = originals.get(item.id)!;
      const blob =
        source.blob instanceof Blob
          ? source.blob
          : source.fileHandle && typeof source.fileHandle.getFile === "function"
            ? await source.fileHandle.getFile()
            : await loadMediaBlob(source.id);
      assertOwner(owner, signal);
      if (!(blob instanceof Blob) || blob.size === 0)
        throw new Error(
          `Relink “${item.name}” before saving this template locally.`,
        );
      items.push({ ...item, blob, isPlaceholder: false });
    }
    template = {
      ...template,
      projectContent: { ...template.projectContent, mediaLibrary: { items } },
    };
  }
  assertOwner(owner, signal);
  options.onWriting?.();
  if (options.location === "cloud") {
    const result = await templateCloudService.uploadTemplate(template, {
      signal,
    });
    if (!result.success)
      throw new Error(result.error || "Failed to upload to cloud");
  } else await engine.saveTemplate(template, { signal });
  assertOwner(owner, signal);
  return template;
}

let applying = false;
function assertReplacement(owner: EditorDraftOwner, signal?: AbortSignal) {
  assertOwner(owner, signal);
  if (
    useUIStore.getState().exportState.isExporting ||
    useTimelineStore.getState().playbackLockedReason ||
    useProcessingStore.getState().hasActiveProcessing()
  ) {
    throw new Error(
      "Wait for the current operation to finish before applying a template.",
    );
  }
}

/** A template opens an independent persisted project and keeps the previous work in Recents. */
export async function openTemplateProject(
  project: Project,
  owner: EditorDraftOwner,
  signal?: AbortSignal,
): Promise<Project> {
  assertReplacement(owner, signal);
  if (applying) throw new Error("Another template is already being applied.");
  const copy = copyPackagedProject(project);
  applying = true;
  const written: string[] = [];
  let published = false;
  try {
    await flushEditorFieldDrafts(owner);
    assertReplacement(owner, signal);
    await saveCurrentProjectForReplacement(owner.projectId);
    assertReplacement(owner, signal);
    for (const item of copy.mediaLibrary.items) {
      assertReplacement(owner, signal);
      if (item.blob instanceof Blob) {
        written.push(item.id);
        await saveMediaBlob(copy.id, item.id, item.blob, item.metadata);
      }
    }
    assertReplacement(owner, signal);
    await autoSaveManager.forceSave(copy);
    assertReplacement(owner, signal);
    await saveCurrentProjectForReplacement(owner.projectId);
    // loadProject defers itself until the engine modules resolve; the owner/stillOpen checks below need it applied now.
    await loadEngineModules();
    assertReplacement(owner, signal);
    const timeline = useTimelineStore.getState();
    timeline.stop();
    timeline.seekToStart();
    timeline.clearLoopRange();
    timeline.setScrollX(0);
    timeline.setScrollY(0);
    useUIStore.getState().clearSelection();
    useProjectStore.getState().loadProject(copy);
    timeline.zoomToFit(copy.timeline.duration || 5);
    published = true;
    const opened = templateEditorOwner();
    const stillOpen = () => {
      const current = useProjectStore.getState();
      return (
        current.project.id === opened.projectId &&
        current.actionHistory === opened.history
      );
    };
    // Optional thumbnails never delay the new project's first usable frame.
    void (async () => {
      for (const item of copy.mediaLibrary.items) {
        if (!stillOpen()) break;
        if (!(item.blob instanceof Blob)) continue;
        const restored = await restoreMediaItem(item, item.blob);
        const latest = useProjectStore
          .getState()
          .project.mediaLibrary.items.find((current) => current.id === item.id);
        if (
          !stillOpen() ||
          !latest ||
          latest.blob !== item.blob ||
          latest.fileHandle !== item.fileHandle
        ) {
          if (restored.thumbnailUrl?.startsWith("blob:"))
            URL.revokeObjectURL(restored.thumbnailUrl);
          break;
        }
        useProjectStore.setState((state) => ({
          project: {
            ...state.project,
            mediaLibrary: {
              ...state.project.mediaLibrary,
              items: state.project.mediaLibrary.items.map((current) =>
                current.id === item.id
                  ? { ...current, thumbnailUrl: restored.thumbnailUrl }
                  : current,
              ),
            },
          },
        }));
      }
    })().catch(() => {});
    return copy;
  } finally {
    if (!published) {
      await Promise.allSettled(written.map((id) => deleteMediaBlob(id)));
      await autoSaveManager.clearProjectSaves(copy.id).catch(() => {});
    }
    applying = false;
  }
}
