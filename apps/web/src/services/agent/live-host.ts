import type {
  EditingHost,
  JobKind,
  JobResult,
  JobRunner,
  TxnHandle,
  ProjectRef,
  ImportedMediaRef,
  RiggingBackendProbe,
  CreateProjectOptions,
  ModelInspectionReport,
  ModelInspectionRequest,
  HumanoidRigRequest,
  HumanoidRigResult,
  TextOverlayOptions,
  ShapeOverlayOptions,
  OverlayRef,
  OverlayKind,
  UpdateTextOverlayOptions,
  UpdateShapeOverlayOptions,
  StickerOverlayOptions,
  UpdateStickerOverlayOptions,
  SvgOverlayOptions,
  ExportMotionSceneOptions,
  ExportMotionSceneResult,
  ExportMotionSceneFormat,
  MotionRenderQueueBridge,
  MotionRenderQueueAddInput,
  MotionRenderQueueAddResult,
  MotionRenderQueueAddError,
  MotionRenderQueueRunResult,
} from "@openreel/agent";
import type { TextStyle, TextAnimationPreset } from "@openreel/core/text/types";
import type { ShapeStyle, ShapeType } from "@openreel/core/graphics/types";
import type { Transform } from "@openreel/core/types/timeline";
import { CAPABILITY_MANIFEST } from "@openreel/core/capabilities/manifest";
import type { Action } from "@openreel/core/types/actions";
import type { Project } from "@openreel/core/types/project";
import type { CapabilityManifest } from "@openreel/core/capabilities/manifest";
import { useProjectStore } from "../../stores/project-store";
import { checkForRecovery } from "../auto-save";
import { inspectGltfModel } from "../../motion/model-inspection";
import {
  exportMotionCompositionScene,
  MOTION_EXPORT_FORMATS,
  type MotionExportFormat,
  type MotionExportRange,
  type MotionExportResolutionScale,
} from "../../motion/export-motion-frame";
import {
  useMotionStore,
  type MotionRenderQueueFormat,
} from "../../motion/stores/motion-store";
import { runMotionRenderQueue } from "../../motion/render-queue-runner";

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const dot = pathname.lastIndexOf(".");
    return dot >= 0 ? pathname.slice(dot + 1).toLowerCase() : "";
  } catch {
    return "";
  }
}

function inferName(url: string, mime: string): string {
  try {
    const base = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (base && base.includes(".")) return decodeURIComponent(base);
  } catch {
    /* fall through */
  }
  const ext = (mime.split("/")[1] ?? "bin").replace("jpeg", "jpg");
  return `media-${Date.now()}.${ext}`;
}

function projectRef(project: Project): ProjectRef {
  return {
    id: project.id,
    name: project.name,
    width: project.settings.width,
    height: project.settings.height,
    frameRate: project.settings.frameRate,
    modifiedAt: project.modifiedAt,
  };
}

export interface LiveEditorHostOptions {
  readonly jobRunner?: JobRunner;
}

const RENDER_QUEUE_FORMATS: readonly MotionRenderQueueFormat[] = [
  "mp4",
  "webm-alpha",
  "mov-prores4444",
  "png-sequence",
];

const RENDER_QUEUE_RESOLUTION_SCALES: readonly MotionExportResolutionScale[] = [
  1, 0.5, 0.25,
];

function normalizeRenderQueueFormat(
  format: string | undefined,
): MotionRenderQueueFormat | undefined {
  if (format === undefined) return "mp4";
  return (RENDER_QUEUE_FORMATS as readonly string[]).includes(format)
    ? (format as MotionRenderQueueFormat)
    : undefined;
}

function normalizeRenderQueueScale(
  scale: number | undefined,
): MotionExportResolutionScale | undefined | null {
  if (scale === undefined) return undefined;
  return (RENDER_QUEUE_RESOLUTION_SCALES as readonly number[]).includes(scale)
    ? (scale as MotionExportResolutionScale)
    : null;
}

/**
 * EditingHost backed by the live web editor's Zustand store. Used by the
 * built-in chat (in-renderer) and by the desktop MCP server (forwarded over
 * IPC). Edits go through the same undoable action path the UI uses, so the chat
 * and the timeline stay in sync and the whole turn undoes as one history group.
 */
export class LiveEditorHost implements EditingHost {
  private jobRunner?: JobRunner;
  private appliedInTxn = 0;

  constructor(options: LiveEditorHostOptions = {}) {
    this.jobRunner = options.jobRunner;
  }

  setJobRunner(runner: JobRunner): void {
    this.jobRunner = runner;
  }

  getProject(): Project {
    this.requireOpenProject();
    return useProjectStore.getState().project;
  }

  async applyAction(action: Action) {
    this.requireOpenProject();
    const result = await useProjectStore.getState().executeAction(action);
    if (result.success) this.appliedInTxn++;
    return result;
  }

  beginTransaction(label?: string): TxnHandle {
    this.appliedInTxn = 0;
    useProjectStore.getState().beginHistoryGroup(label);
    return { id: label ?? "turn" };
  }

  commitTransaction(_handle: TxnHandle, _label: string): void {
    useProjectStore.getState().endHistoryGroup();
  }

  async rollbackTransaction(_handle: TxnHandle): Promise<void> {
    useProjectStore.getState().endHistoryGroup();
    // The turn's actions form one history group; a single undo reverts them all.
    if (this.appliedInTxn > 0) {
      await useProjectStore.getState().undo();
    }
    this.appliedInTxn = 0;
  }

  async runJob(
    kind: JobKind,
    params: Record<string, unknown>,
  ): Promise<JobResult> {
    if (!this.jobRunner) {
      return { ok: false, error: `Job '${kind}' is not wired in the live host yet` };
    }
    return this.jobRunner(kind, params);
  }

  capabilities(): CapabilityManifest {
    return CAPABILITY_MANIFEST;
  }

  requireOpenProject(): void {
    if (!useProjectStore.getState().hasOpenProject) {
      throw new Error("No project is open");
    }
  }

  async createProject(options: CreateProjectOptions): Promise<ProjectRef> {
    const settings: Partial<Project["settings"]> = {
      ...(options.width !== undefined ? { width: options.width } : {}),
      ...(options.height !== undefined ? { height: options.height } : {}),
      ...(options.frameRate !== undefined ? { frameRate: options.frameRate } : {}),
    };
    useProjectStore.getState().createNewProject(options.name, settings);
    return projectRef(useProjectStore.getState().project);
  }

  async listProjects(): Promise<readonly ProjectRef[]> {
    const saves = await checkForRecovery();
    const latest = new Map<string, ProjectRef>();
    for (const s of saves) {
      const existing = latest.get(s.projectId);
      if (!existing || (existing.modifiedAt ?? 0) < s.timestamp) {
        latest.set(s.projectId, { id: s.id, name: s.projectName, modifiedAt: s.timestamp });
      }
    }
    return [...latest.values()].sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
  }

  async openProject(id: string): Promise<ProjectRef> {
    const ok = await useProjectStore.getState().recoverFromAutoSave(id);
    if (!ok) throw new Error(`Could not open project (save id "${id}")`);
    return projectRef(useProjectStore.getState().project);
  }

  async saveProject(): Promise<ProjectRef> {
    this.requireOpenProject();
    const store = useProjectStore.getState();
    await store.forceSave();
    return projectRef(store.getFullProject());
  }

  async importMediaFromUrl(
    url: string,
    options?: { name?: string },
  ): Promise<ImportedMediaRef> {
    this.requireOpenProject();
    const bridge = window.openreel?.media?.fetchUrl;
    if (typeof bridge !== "function") {
      throw new Error("Media download is only available in the desktop app");
    }
    const res = await bridge({ url });
    if (!res.ok) {
      throw new Error(res.error ?? `Download failed: HTTP ${res.status}`);
    }
    const mime = (res.contentType.split(";")[0] ?? "").trim() || MIME_BY_EXT[extFromUrl(url)] || "application/octet-stream";
    const name = options?.name ?? inferName(url, mime);
    const file = new File([res.body], name, { type: mime });
    const result = await useProjectStore.getState().importMedia(file);
    if (!result.success || !result.actionId) {
      throw new Error(result.error?.message ?? "Media import failed");
    }
    const mediaId = result.actionId;
    const item = useProjectStore
      .getState()
      .project.mediaLibrary.items.find((m) => m.id === mediaId);
    return {
      mediaId,
      name,
      type: item?.type ?? "unknown",
      durationSec: item?.metadata?.duration ?? 0,
      width: item?.metadata?.width,
      height: item?.metadata?.height,
    };
  }

  async exportMotionScene(
    options: ExportMotionSceneOptions,
  ): Promise<ExportMotionSceneResult> {
    this.requireOpenProject();
    const project = useProjectStore.getState().project;
    const compositions = project.motionCompositions ?? [];
    const composition = compositions.find(
      (candidate) => candidate.id === options.compositionId,
    );
    if (!composition) {
      throw new Error(`Motion composition not found: ${options.compositionId}`);
    }
    const requestedFormat: ExportMotionSceneFormat = options.format ?? "mp4";
    const descriptor = MOTION_EXPORT_FORMATS.find(
      (entry) => entry.id === requestedFormat,
    );
    const requiresNative =
      descriptor !== undefined &&
      (descriptor.transparent || descriptor.extension === "mov");
    const nativeAvailable =
      typeof window !== "undefined" &&
      window.openreel?.platform === "desktop";
    const willNormalize = requiresNative && !nativeAvailable;
    if (willNormalize && options.acknowledgeH264Fallback !== true) {
      throw new Error(
        "Web export can't produce ProRes or alpha — this will encode H.264 without transparency. Pass acknowledgeH264Fallback:true to consent, or use the desktop app for ProRes/alpha.",
      );
    }
    const encodedFormat: ExportMotionSceneFormat = willNormalize
      ? "mp4"
      : requestedFormat;
    const result = await exportMotionCompositionScene({
      project,
      composition,
      compositionLibrary: compositions.length > 0 ? compositions : [composition],
      format: encodedFormat as MotionExportFormat,
      ...(options.filename ? { filename: options.filename } : {}),
    });
    return {
      filename: result.filename,
      width: result.width,
      height: result.height,
      duration: result.duration,
      framesRendered: result.framesRendered,
      requestedFormat,
      encodedFormat,
      normalizedToH264: willNormalize,
      ...(willNormalize
        ? { note: "Encoded H.264 (ProRes/alpha unavailable on web)" }
        : {}),
    };
  }

  motionRenderQueue: MotionRenderQueueBridge = {
    add: (
      input: MotionRenderQueueAddInput,
    ): MotionRenderQueueAddResult | MotionRenderQueueAddError => {
      if (!useProjectStore.getState().hasOpenProject) {
        return { error: "No project is open" };
      }
      const format = normalizeRenderQueueFormat(input.format);
      if (format === undefined) {
        return { error: `Unsupported render queue format: ${input.format}` };
      }
      const scale = normalizeRenderQueueScale(input.resolutionScale);
      if (scale === null) {
        return {
          error: `resolutionScale must be one of ${RENDER_QUEUE_RESOLUTION_SCALES.join(", ")}`,
        };
      }
      const project = useProjectStore.getState().project;
      const compositions = project.motionCompositions ?? [];
      const scene = compositions.find(
        (candidate) => candidate.id === input.compositionId,
      );
      if (!scene) {
        return {
          error: `Motion composition not found: ${input.compositionId}`,
        };
      }
      let range: MotionExportRange | undefined;
      if (input.range !== undefined) {
        const { startTime, endTime } = input.range;
        if (
          !Number.isFinite(startTime) ||
          !Number.isFinite(endTime) ||
          !(startTime < endTime) ||
          startTime < 0 ||
          endTime > scene.duration
        ) {
          return {
            error: "range must satisfy 0 <= startTime < endTime <= duration",
          };
        }
        range = { startTime, endTime };
      }
      const itemId = useMotionStore.getState().addRenderQueueItem({
        compositionId: scene.id,
        name: scene.name,
        width: scene.width,
        height: scene.height,
        frameRate: scene.frameRate,
        duration: scene.duration,
        format,
        ...(range !== undefined ? { range } : {}),
        ...(scale !== undefined ? { resolutionScale: scale } : {}),
      });
      return { itemId };
    },
    run: async (): Promise<MotionRenderQueueRunResult> => {
      if (!useProjectStore.getState().hasOpenProject) {
        return { outcomes: [], alreadyRunning: false };
      }
      const project = useProjectStore.getState().project;
      const compositions = project.motionCompositions ?? [];
      const result = await runMotionRenderQueue({ project, compositions });
      if (result.alreadyRunning) {
        return { outcomes: [], alreadyRunning: true };
      }
      return {
        alreadyRunning: false,
        outcomes: result.outcomes.map((outcome) => ({
          itemId: outcome.itemId,
          status: outcome.status,
          ...(outcome.encodedFormat !== undefined
            ? { encodedFormat: outcome.encodedFormat }
            : {}),
          ...(outcome.filename !== undefined
            ? { filename: outcome.filename }
            : {}),
          ...(outcome.error !== undefined ? { error: outcome.error } : {}),
        })),
      };
    },
    list: (): ReadonlyArray<Record<string, unknown>> =>
      useMotionStore.getState().renderQueue.map((item) => ({
        itemId: item.id,
        compositionId: item.compositionId,
        name: item.name,
        format: item.format,
        status: item.status,
        progress: item.progress,
        ...(item.range !== undefined ? { range: item.range } : {}),
        ...(item.resolutionScale !== undefined
          ? { resolutionScale: item.resolutionScale }
          : {}),
        ...(item.outputFilename !== undefined
          ? { filename: item.outputFilename }
          : {}),
        ...(item.error !== undefined ? { error: item.error } : {}),
      })),
    cancel: (itemId: string): boolean => {
      const exists = useMotionStore
        .getState()
        .renderQueue.some((item) => item.id === itemId);
      if (!exists) return false;
      useMotionStore.getState().cancelRenderQueueItem(itemId);
      return true;
    },
  };

  async probeRiggingBackend(): Promise<RiggingBackendProbe> {
    const probeBackend = window.openreel?.rigging?.probeBackend;
    if (typeof probeBackend !== "function") {
      return {
        available: false,
        provider: "blender",
        error: "Rigging backend is only available in the desktop app",
      };
    }
    return probeBackend();
  }

  async inspectModel(options: ModelInspectionRequest): Promise<ModelInspectionReport> {
    return inspectGltfModel(options.modelUrl, {
      ...(options.name ? { name: options.name } : {}),
      ...(options.source ? { source: options.source } : {}),
    });
  }

  async rigHumanoidModel(options: HumanoidRigRequest): Promise<HumanoidRigResult> {
    const rigHumanoidModel = window.openreel?.rigging?.rigHumanoidModel;
    if (typeof rigHumanoidModel !== "function") {
      return {
        ok: false,
        provider: "blender",
        inputUrl: options.modelUrl,
        createdArmature: false,
        preservedExistingArmature: false,
        skinnedMeshCount: 0,
        meshCount: 0,
        boneCount: 0,
        warnings: [
          {
            code: "HOST_UNAVAILABLE",
            severity: "error",
            message: "Humanoid rigging is only available in the desktop app.",
          },
        ],
        error: "Humanoid rigging is only available in the desktop app",
      };
    }
    return rigHumanoidModel({
      modelUrl: options.modelUrl,
      ...(options.outputPath ? { outputPath: options.outputPath } : {}),
      ...(options.name ? { name: options.name } : {}),
      ...(options.heightMeters ? { heightMeters: options.heightMeters } : {}),
      ...(options.overwriteExisting !== undefined
        ? { overwriteExisting: options.overwriteExisting }
        : {}),
    });
  }

  async createTextOverlay(options: TextOverlayOptions): Promise<OverlayRef> {
    this.requireOpenProject();
    const store = useProjectStore.getState();
    const tracks = store.project.timeline.tracks;

    let trackId = options.trackId;
    if (!trackId || !tracks.some((t) => t.id === trackId)) {
      const existing = tracks.find((t) => t.type === "text");
      if (existing) {
        trackId = existing.id;
      } else {
        await store.executeAction({
          type: "track/add",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: { trackType: "text" },
        } as Action);
        const created = useProjectStore
          .getState()
          .project.timeline.tracks.find((t) => t.type === "text");
        if (!created) throw new Error("Failed to create a text track");
        trackId = created.id;
      }
    }

    const clip = useProjectStore
      .getState()
      .createTextClip(
        trackId,
        options.startSec,
        options.text,
        options.durationSec,
        options.style as Partial<TextStyle> | undefined,
      );
    if (!clip) throw new Error("Failed to create text overlay");

    if (options.animation && options.animation !== "none") {
      useProjectStore
        .getState()
        .applyTextAnimationPreset(
          clip.id,
          options.animation as TextAnimationPreset,
          options.animationInSec ?? 0.3,
          options.animationOutSec ?? 0.25,
        );
    }
    return { id: clip.id, trackId };
  }

  async createShapeOverlay(options: ShapeOverlayOptions): Promise<OverlayRef> {
    this.requireOpenProject();
    const store = useProjectStore.getState();
    const tracks = store.project.timeline.tracks;

    let trackId = options.trackId;
    if (!trackId || !tracks.some((t) => t.id === trackId)) {
      const existing = tracks.find((t) => t.type === "graphics");
      if (existing) {
        trackId = existing.id;
      } else {
        await store.executeAction({
          type: "track/add",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: { trackType: "graphics" },
        } as Action);
        const created = useProjectStore
          .getState()
          .project.timeline.tracks.find((t) => t.type === "graphics");
        if (!created) throw new Error("Failed to create a graphics track");
        trackId = created.id;
      }
    }

    const style: Partial<ShapeStyle> = {
      fill: { type: "solid", color: options.color ?? "#000000", opacity: options.opacity ?? 0.45 },
      stroke: { color: "#000000", width: 0, opacity: 0 },
    };
    const clip = useProjectStore
      .getState()
      .createShapeClip(
        trackId,
        options.startSec,
        (options.shapeType ?? "rectangle") as ShapeType,
        options.durationSec,
        style,
      );
    if (!clip) throw new Error("Failed to create shape overlay");

    if (options.fullFrame) {
      const { width, height } = useProjectStore.getState().project.settings;
      useProjectStore.getState().updateShapeTransform(clip.id, {
        position: { x: 0.5, y: 0.5 },
        scale: { x: width / 200, y: height / 200 },
        anchor: { x: 0.5, y: 0.5 },
        rotation: 0,
        opacity: 1,
      });
    }
    return { id: clip.id, trackId };
  }

  private async ensureOverlayTrack(
    type: "text" | "graphics",
    trackId?: string,
  ): Promise<string> {
    const tracks = useProjectStore.getState().project.timeline.tracks;
    if (trackId && tracks.some((t) => t.id === trackId)) return trackId;
    const existing = tracks.find((t) => t.type === type);
    if (existing) return existing.id;
    await useProjectStore.getState().addTrack(type, 0);
    const created = useProjectStore
      .getState()
      .project.timeline.tracks.find((t) => t.type === type);
    if (!created) throw new Error(`Failed to create a ${type} track`);
    return created.id;
  }

  async updateTextOverlay(
    id: string,
    options: UpdateTextOverlayOptions,
  ): Promise<OverlayRef> {
    this.requireOpenProject();
    const store = useProjectStore.getState();
    if (!store.getTextClip(id)) {
      throw new Error(`Text overlay "${id}" not found`);
    }
    if (options.text !== undefined && !store.updateTextContent(id, options.text)) {
      throw new Error(`Failed to update text overlay "${id}" content`);
    }
    if (options.style !== undefined) {
      if (!store.updateTextStyle(id, options.style as Partial<TextStyle>)) {
        throw new Error(`Failed to update text overlay "${id}" style`);
      }
    }
    if (options.transform !== undefined) {
      if (!store.updateTextTransform(id, options.transform as Partial<Transform>)) {
        throw new Error(`Failed to update text overlay "${id}" transform`);
      }
    }
    if (options.animation && options.animation !== "none") {
      const updated = store.applyTextAnimationPreset(
        id,
        options.animation as TextAnimationPreset,
        options.animationInSec ?? 0.3,
        options.animationOutSec ?? 0.25,
      );
      if (!updated) throw new Error(`Failed to update text overlay "${id}" animation`);
    }
    const clip = useProjectStore.getState().getTextClip(id);
    if (!clip) throw new Error(`Text overlay "${id}" not found`);
    return { id, trackId: clip.trackId };
  }

  async updateShapeOverlay(
    id: string,
    options: UpdateShapeOverlayOptions,
  ): Promise<OverlayRef> {
    this.requireOpenProject();
    const store = useProjectStore.getState();
    if (!store.getShapeClip(id)) {
      throw new Error(`Shape overlay "${id}" not found`);
    }
    if (
      options.style !== undefined ||
      options.color !== undefined ||
      options.opacity !== undefined
    ) {
      const style: Partial<ShapeStyle> =
        (options.style as Partial<ShapeStyle> | undefined) ?? {
          fill: {
            type: "solid",
            color: options.color ?? "#000000",
            opacity: options.opacity ?? 1,
          },
        };
      if (!store.updateShapeStyle(id, style)) {
        throw new Error(`Failed to update shape overlay "${id}" style`);
      }
    }
    if (options.transform !== undefined) {
      if (!store.updateShapeTransform(id, options.transform as Partial<Transform>)) {
        throw new Error(`Failed to update shape overlay "${id}" transform`);
      }
    }
    if (options.fullFrame) {
      const { width, height } = useProjectStore.getState().project.settings;
      const updated = store.updateShapeTransform(id, {
        position: { x: 0.5, y: 0.5 },
        scale: { x: width / 200, y: height / 200 },
        anchor: { x: 0.5, y: 0.5 },
        rotation: 0,
        opacity: 1,
      });
      if (!updated) throw new Error(`Failed to resize shape overlay "${id}"`);
    }
    const clip = useProjectStore.getState().getShapeClip(id);
    if (!clip) throw new Error(`Shape overlay "${id}" not found`);
    return { id, trackId: clip.trackId };
  }

  async createStickerOverlay(
    options: StickerOverlayOptions,
  ): Promise<OverlayRef> {
    this.requireOpenProject();
    const trackId = await this.ensureOverlayTrack("graphics", options.trackId);
    const { stickerLibrary } = await import("@openreel/core");
    const clip = options.imageUrl
      ? stickerLibrary.createStickerClip(
          {
            id: crypto.randomUUID(),
            name: options.name ?? "sticker",
            category: "custom",
            imageUrl: options.imageUrl,
          },
          trackId,
          options.startSec,
          options.durationSec,
        )
      : stickerLibrary.createEmojiClip(
          {
            id: crypto.randomUUID(),
            emoji: options.emoji ?? "⭐",
            name: options.name ?? options.emoji ?? "emoji",
            category: "emojis",
          },
          trackId,
          options.startSec,
          options.durationSec,
        );
    const created = useProjectStore.getState().createStickerClip(clip);
    if (!created) throw new Error("Failed to create sticker overlay");
    return { id: created.id, trackId };
  }

  async updateStickerOverlay(
    id: string,
    options: UpdateStickerOverlayOptions,
  ): Promise<OverlayRef> {
    this.requireOpenProject();
    const store = useProjectStore.getState();
    if (!store.getStickerClip(id)) {
      throw new Error(`Sticker overlay "${id}" not found`);
    }
    if (options.transform !== undefined) {
      if (!store.updateShapeTransform(id, options.transform as Partial<Transform>)) {
        throw new Error(`Failed to update sticker overlay "${id}" transform`);
      }
    }
    const clip = useProjectStore.getState().getStickerClip(id);
    if (!clip) throw new Error(`Sticker overlay "${id}" not found`);
    return { id, trackId: clip.trackId };
  }

  async createSvgOverlay(options: SvgOverlayOptions): Promise<OverlayRef> {
    this.requireOpenProject();
    const trackId = await this.ensureOverlayTrack("graphics", options.trackId);
    const clip = useProjectStore
      .getState()
      .importSVG(options.svg, trackId, options.startSec, options.durationSec);
    if (!clip) throw new Error("Failed to create SVG overlay");
    return { id: clip.id, trackId };
  }

  async updateSvgOverlay(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<OverlayRef> {
    this.requireOpenProject();
    const clip = useProjectStore.getState().updateSVGClip(id, updates);
    if (!clip) throw new Error(`SVG overlay "${id}" not found`);
    return { id, trackId: clip.trackId };
  }

  async removeOverlay(kind: OverlayKind, id: string): Promise<boolean> {
    this.requireOpenProject();
    const store = useProjectStore.getState();
    switch (kind) {
      case "text":
        return store.deleteTextClip(id);
      case "shape":
        return store.deleteShapeClip(id);
      case "sticker":
        return store.deleteStickerClip(id);
      case "svg":
        return store.deleteSVGClip(id);
      default:
        return false;
    }
  }
}
