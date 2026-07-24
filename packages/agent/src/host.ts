import type { Action, ActionResult } from "@openreel/core/types/actions";
import type { Project } from "@openreel/core/types/project";
import type { CapabilityManifest } from "@openreel/core/capabilities/manifest";

export type JobKind =
  | "transcribe"
  | "detectHighlights"
  | "removeBackground"
  | "upscale"
  | "generateMusic"
  | "inpaint"
  | "exportVideo"
  | "exportAudio"
  | "exportFrame";

export interface JobResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

export interface TxnHandle {
  readonly id: string;
}

export interface ProjectRef {
  readonly id: string;
  readonly name: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly modifiedAt?: number;
}

export interface ImportedMediaRef {
  readonly mediaId: string;
  readonly name: string;
  readonly type: string;
  readonly durationSec: number;
  readonly width?: number;
  readonly height?: number;
}

export type RiggingBackendMode = "configured" | "bundled" | "system";

export interface RiggingBackendProbe {
  readonly available: boolean;
  readonly provider: "blender";
  readonly mode?: RiggingBackendMode;
  readonly path?: string;
  readonly version?: string;
  readonly error?: string;
}

export interface ModelInspectionVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ModelInspectionBounds {
  readonly min: ModelInspectionVec3;
  readonly max: ModelInspectionVec3;
  readonly size: ModelInspectionVec3;
  readonly center: ModelInspectionVec3;
}

export interface ModelInspectionMesh {
  readonly name: string;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly skinned: boolean;
  readonly materialNames: readonly string[];
}

export interface ModelInspectionTexture {
  readonly name: string;
  readonly slot: string;
  readonly width?: number;
  readonly height?: number;
}

export interface ModelInspectionMaterial {
  readonly name: string;
  readonly type: string;
  readonly color?: string;
  readonly metalness?: number;
  readonly roughness?: number;
  readonly textureSlots: readonly string[];
}

export interface ModelInspectionAnimation {
  readonly name: string;
  readonly duration: number;
  readonly trackCount: number;
  readonly targetCount: number;
  readonly tracks: readonly string[];
}

export interface ModelInspectionArmature {
  readonly hasSkinnedMesh: boolean;
  readonly skinnedMeshCount: number;
  readonly boneCount: number;
  readonly rootBones: readonly string[];
  readonly sampleBones: readonly string[];
}

export interface ModelInspectionWarning {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
}

export interface ModelInspectionReport {
  readonly modelUrl: string;
  readonly name?: string;
  readonly source?: string;
  readonly meshCount: number;
  readonly materialCount: number;
  readonly textureCount: number;
  readonly animationCount: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly bounds?: ModelInspectionBounds;
  readonly meshes: readonly ModelInspectionMesh[];
  readonly materials: readonly ModelInspectionMaterial[];
  readonly textures: readonly ModelInspectionTexture[];
  readonly animations: readonly ModelInspectionAnimation[];
  readonly armature: ModelInspectionArmature;
  readonly warnings: readonly ModelInspectionWarning[];
  readonly suggestedNextTools: readonly string[];
}

export interface ModelInspectionRequest {
  readonly modelUrl: string;
  readonly name?: string;
  readonly source?: string;
}

export interface HumanoidRigRequest {
  readonly modelUrl: string;
  readonly outputPath?: string;
  readonly name?: string;
  readonly heightMeters?: number;
  readonly overwriteExisting?: boolean;
}

export interface HumanoidRigResult {
  readonly ok: boolean;
  readonly provider: "blender";
  readonly inputUrl: string;
  readonly outputUrl?: string;
  readonly outputPath?: string;
  readonly armatureName?: string;
  readonly createdArmature: boolean;
  readonly preservedExistingArmature: boolean;
  readonly skinnedMeshCount: number;
  readonly meshCount: number;
  readonly boneCount: number;
  readonly warnings: readonly ModelInspectionWarning[];
  readonly error?: string;
}

export interface CreateProjectOptions {
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
}

export type ExportMotionSceneFormat = "mp4" | "webm-alpha" | "mov-prores4444";

export interface ExportMotionSceneOptions {
  readonly compositionId: string;
  readonly format?: ExportMotionSceneFormat;
  readonly filename?: string;
  readonly acknowledgeH264Fallback?: boolean;
}

export interface ExportMotionSceneResult {
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly framesRendered: number;
  readonly requestedFormat: ExportMotionSceneFormat;
  readonly encodedFormat: ExportMotionSceneFormat;
  readonly normalizedToH264: boolean;
  readonly note?: string;
}

/**
 * The single seam the tool layer executes through. Implemented by the live
 * renderer (LiveEditorHost) and by a headless Node host (HeadlessHost), so the
 * same registry, executor, and loop drive any environment.
 */
export interface EditingHost {
  /** The authoritative, serializable project. */
  getProject(): Project;
  /** Dispatch an action through the action system; records undo. */
  applyAction(action: Action): Promise<ActionResult>;
  /** Open an undoable transaction so a whole agent turn reverts as one unit. */
  beginTransaction(label?: string): TxnHandle;
  commitTransaction(handle: TxnHandle, label: string): void;
  rollbackTransaction(handle: TxnHandle): Promise<void>;
  /** Long-running GPU/analysis/export jobs. */
  runJob(kind: JobKind, params: Record<string, unknown>): Promise<JobResult>;
  /** Machine-readable enums + parameter ranges for the agent. */
  capabilities(): CapabilityManifest;
  /** Throws when no project is open (guard for mutating tools). */
  requireOpenProject(): void;

  /**
   * Project lifecycle + media ingest. Optional because they require a real
   * editor environment (Zustand store, IndexedDB, a main-process URL fetcher)
   * that only the live/desktop host provides. Tools must feature-detect these
   * and fail clearly when undefined (e.g. on the headless cloud host).
   */
  createProject?(options: CreateProjectOptions): Promise<ProjectRef>;
  openProject?(id: string): Promise<ProjectRef>;
  listProjects?(): Promise<readonly ProjectRef[]>;
  saveProject?(): Promise<ProjectRef>;
  importMediaFromUrl?(url: string, options?: { name?: string }): Promise<ImportedMediaRef>;
  /**
   * Render a motion composition to a finished video file (mp4 / transparent
   * WebM / ProRes 4444 MOV). Optional because it needs the renderer-side motion
   * export pipeline that only the live/desktop web host provides — headless
   * hosts leave it undefined and the export tool fails clearly. On web the ProRes
   * and alpha formats normalize to H.264; the implementation enforces the
   * acknowledge-fallback guardrail and reports the format actually encoded.
   */
  exportMotionScene?(
    options: ExportMotionSceneOptions,
  ): Promise<ExportMotionSceneResult>;
  /**
   * Motion render queue bridge (add/run/list/cancel). Optional because it needs
   * the live editor's motion store + renderer-side export pipeline that only the
   * live/desktop web host provides — headless hosts leave it undefined and the
   * queue tools fail clearly.
   */
  motionRenderQueue?: MotionRenderQueueBridge;
  /** Desktop-only DCC backend discovery for character rigging/retarget jobs. */
  probeRiggingBackend?(): Promise<RiggingBackendProbe>;
  /** Inspect a GLB/glTF model so agents can choose animation, rigging, and cleanup tools. */
  inspectModel?(options: ModelInspectionRequest): Promise<ModelInspectionReport>;
  /** Run a desktop rigging backend job to create or repair a humanoid GLB rig. */
  rigHumanoidModel?(options: HumanoidRigRequest): Promise<HumanoidRigResult>;
  /**
   * Create a text overlay through the engine-aware store path so it actually
   * registers with the TitleEngine the preview + timeline read from. The raw
   * text/create action only appends to project.textClips and never reaches the
   * engine, so it renders nothing — this method is the live host's fix.
   */
  createTextOverlay?(options: TextOverlayOptions): Promise<OverlayRef>;
  /**
   * Create a graphic (shape) overlay through the engine-aware store path so it
   * registers with the GraphicsEngine the preview reads from — the raw
   * shape/create action only appends to project.shapeClips and renders nothing.
   */
  createShapeOverlay?(options: ShapeOverlayOptions): Promise<OverlayRef>;
  /**
   * Edit/remove overlays through the engine-aware store path. The raw
   * text/update, text/remove, shape/*, sticker/*, svg/* actions only mutate the
   * serialized project arrays and never reach the Title/Graphics engines the
   * preview + export read from, so they appear to succeed but render stale.
   * These methods are the live host's fix for that whole class of bug.
   */
  updateTextOverlay?(id: string, options: UpdateTextOverlayOptions): Promise<OverlayRef>;
  updateShapeOverlay?(id: string, options: UpdateShapeOverlayOptions): Promise<OverlayRef>;
  createStickerOverlay?(options: StickerOverlayOptions): Promise<OverlayRef>;
  updateStickerOverlay?(id: string, options: UpdateStickerOverlayOptions): Promise<OverlayRef>;
  createSvgOverlay?(options: SvgOverlayOptions): Promise<OverlayRef>;
  updateSvgOverlay?(id: string, updates: Record<string, unknown>): Promise<OverlayRef>;
  removeOverlay?(kind: OverlayKind, id: string): Promise<boolean>;
}

export type MotionRenderQueueAddFormat =
  | "mp4"
  | "webm-alpha"
  | "mov-prores4444"
  | "png-sequence";

export interface MotionRenderQueueAddInput {
  readonly compositionId: string;
  readonly format?: MotionRenderQueueAddFormat;
  readonly range?: { readonly startTime: number; readonly endTime: number };
  readonly resolutionScale?: number;
  readonly filename?: string;
}

export interface MotionRenderQueueAddResult {
  readonly itemId: string;
}

export interface MotionRenderQueueAddError {
  readonly error: string;
}

export interface MotionRenderQueueRunOutcome {
  readonly itemId: string;
  readonly status: string;
  readonly encodedFormat?: string;
  readonly filename?: string;
  readonly error?: string;
}

export interface MotionRenderQueueRunResult {
  readonly outcomes: ReadonlyArray<MotionRenderQueueRunOutcome>;
  readonly alreadyRunning: boolean;
}

export interface MotionRenderQueueBridge {
  add(
    input: MotionRenderQueueAddInput,
  ): MotionRenderQueueAddResult | MotionRenderQueueAddError;
  run(): Promise<MotionRenderQueueRunResult>;
  list(): ReadonlyArray<Record<string, unknown>>;
  cancel(itemId: string): boolean;
}

export type OverlayKind = "text" | "shape" | "sticker" | "svg";

export interface UpdateTextOverlayOptions {
  readonly text?: string;
  readonly style?: Record<string, unknown>;
  readonly transform?: Record<string, unknown>;
  readonly animation?: string;
  readonly animationInSec?: number;
  readonly animationOutSec?: number;
}

export interface UpdateShapeOverlayOptions {
  readonly color?: string;
  readonly opacity?: number;
  readonly style?: Record<string, unknown>;
  readonly transform?: Record<string, unknown>;
  readonly fullFrame?: boolean;
}

export interface StickerOverlayOptions {
  readonly emoji?: string;
  readonly imageUrl?: string;
  readonly name?: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly trackId?: string;
}

export interface UpdateStickerOverlayOptions {
  readonly transform?: Record<string, unknown>;
}

export interface SvgOverlayOptions {
  readonly svg: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly trackId?: string;
}

export interface TextOverlayOptions {
  readonly text: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly trackId?: string;
  readonly style?: Record<string, unknown>;
  /** Entrance/exit animation preset (e.g. "fade", "scale", "slide-up", "pop"). */
  readonly animation?: string;
  readonly animationInSec?: number;
  readonly animationOutSec?: number;
}

export interface ShapeOverlayOptions {
  readonly shapeType?: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly trackId?: string;
  readonly color?: string;
  readonly opacity?: number;
  /** Scale the shape to cover the whole canvas (e.g. a full-frame scrim). */
  readonly fullFrame?: boolean;
}

export interface OverlayRef {
  readonly id: string;
  readonly trackId: string;
}

export type JobRunner = (
  kind: JobKind,
  params: Record<string, unknown>,
) => Promise<JobResult>;
