import { ActionExecutor } from "@openreel/core";
import { CAPABILITY_MANIFEST } from "@openreel/core/capabilities/manifest";
import { editSnapshot, type EditSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import { createPortableEdit } from "@openreel/core/editing/portable-project";
import { TitleEngine } from "@openreel/core/text/title-engine";
import type { Project, Action } from "@openreel/core";
import type { EditingHost, TxnHandle, TextOverlayOptions, UpdateTextOverlayOptions } from "@openreel/agent";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { getMediaBridge, initializeMediaBridge } from "../../bridges/media-bridge";

export function cloneEditSnapshot(snapshot: EditSnapshot): EditSnapshot {
  return { ...JSON.parse(JSON.stringify({ ...snapshot, mediaLibrary: undefined })), mediaLibrary: { items: snapshot.mediaLibrary.items.map((m) => ({ ...m })) } } as EditSnapshot;
}
const blobRevisions = new WeakMap<Blob, number>();
let nextBlobRevision = 0;
const blobRevision = (blob: Blob | null): number => { if (!blob) return 0; if (!blobRevisions.has(blob)) blobRevisions.set(blob, ++nextBlobRevision); return blobRevisions.get(blob)!; };
export function projectRevision(project: Project): string {
  return JSON.stringify({ ...editSnapshot(project), mediaLibrary: { items: project.mediaLibrary.items.map((m) => ({ id: m.id, name: m.name, metadata: m.metadata, sourceFile: m.sourceFile, blobRevision: blobRevision(m.blob) })) }, id: project.id, modifiedAt: project.modifiedAt });
}

/** Engine actions run on an isolated draft. Exactly one snapshot enters UI history. */
export class EditingSession implements EditingHost {
  private draft!: Project;
  private revision = "";
  private original!: Project;
  private executor = new ActionExecutor();
  private hasChanges = false;
  private exportRequested = false;
  private portable = false;
  committed = false;
  constructor(private signal?: AbortSignal) {}
  requireOpenProject(): void { if (!useProjectStore.getState().hasOpenProject) throw new Error("Open a project first"); }
  getProject(): Project { this.requireOpenProject(); return this.draft; }
  capabilities() { return CAPABILITY_MANIFEST; }
  beginTransaction(): TxnHandle {
    this.requireOpenProject();
    this.original = useProjectStore.getState().getFullProject();
    this.revision = projectRevision(this.original);
    this.draft = { ...this.original, ...cloneEditSnapshot(editSnapshot(this.original)) };
    try { createPortableEdit(this.draft); this.portable = true; } catch { this.portable = false; }
    return { id: crypto.randomUUID() };
  }
  async applyAction(action: Action) {
    if (this.signal?.aborted) throw new Error("Edit cancelled");
    const result = await this.executor.execute(action, this.draft);
    if (result.success) {
      if (this.portable) createPortableEdit(this.draft);
      this.hasChanges = true;
    }
    return result;
  }
  async commitTransaction(_handle: TxnHandle, label: string): Promise<void> {
    if (this.signal?.aborted) throw new Error("Edit cancelled");
    if (projectRevision(useProjectStore.getState().getFullProject()) !== this.revision) throw new Error("The project changed while the AI was working. No AI changes were applied; try again.");
    if (this.hasChanges) {
      const store = useProjectStore.getState();
      store.beginHistoryGroup(label);
      try {
        const result = await store.executeAction({ type: "project/applyEditSnapshot", id: crypto.randomUUID(), timestamp: Date.now(), params: { snapshot: cloneEditSnapshot(editSnapshot(this.draft)) } });
        if (!result.success) throw new Error(result.error?.message ?? "Could not apply edit");
        this.committed = true;
      } finally { store.endHistoryGroup(); }
    }
    if (this.exportRequested) useUIStore.getState().openModal("export");
  }
  async rollbackTransaction(): Promise<void> { this.hasChanges = false; this.exportRequested = false; }
  async runJob() { return { ok: false, error: "This job is unavailable in the local AI workspace" }; }
  requestExport(): void { this.exportRequested = true; }
  replaceDraft(project: Project): void { this.draft = project; this.hasChanges = true; }
  async relinkMedia(mediaId: string, file: File): Promise<void> {
    const old = this.draft.mediaLibrary.items.find((m) => m.id === mediaId);
    if (!old) throw new Error("Missing media reference");
    if (!getMediaBridge().isInitialized()) await initializeMediaBridge();
    const result = await getMediaBridge().importFile(file, true);
    if (!result.success || !result.media) throw new Error(result.error ?? "Could not decode media");
    const decoded = result.media;
    const type = decoded.metadata.hasVideo ? "video" : decoded.metadata.hasAudio ? "audio" : "image";
    if (type !== old.type) throw new Error("Choose the same decoded media type");
    const asset = { ...old, name: file.name, blob: file, fileHandle: null, isPlaceholder: false, sourceFile: { name: file.name, size: file.size, lastModified: file.lastModified }, metadata: { duration: decoded.metadata.duration ?? 0, width: decoded.metadata.width ?? 0, height: decoded.metadata.height ?? 0, frameRate: decoded.metadata.frameRate ?? 0, codec: decoded.metadata.codec ?? "", sampleRate: decoded.metadata.sampleRate ?? 0, channels: decoded.metadata.channels ?? 0, fileSize: file.size }, thumbnailUrl: decoded.thumbnails?.[0]?.dataUrl ?? null, waveformData: decoded.waveformData?.peaks ?? null };
    const project = { ...this.draft, mediaLibrary: { items: this.draft.mediaLibrary.items.map((m) => m.id === mediaId ? asset : m) } };
    createPortableEdit(project); // Check actual decoded source ranges before publishing.
    this.replaceDraft(project);
  }
  async createTextOverlay(options: TextOverlayOptions) {
    let trackId = options.trackId ?? this.draft.timeline.tracks.find((t) => t.type === "text")?.id;
    if (!trackId) {
      const result = await this.applyAction({ type: "track/add", id: crypto.randomUUID(), timestamp: Date.now(), params: { trackType: "text", position: 0 } });
      if (!result.success) throw new Error(result.error?.message);
      trackId = this.draft.timeline.tracks.find((t) => t.type === "text")!.id;
    }
    if (this.draft.timeline.tracks.find((t) => t.id === trackId)?.locked) throw new Error("Text track is locked");
    const clip = new TitleEngine().createTextClip({ trackId, text: options.text, startTime: options.startSec, duration: options.durationSec, style: options.style });
    const result = await this.applyAction({ type: "text/create", id: crypto.randomUUID(), timestamp: Date.now(), params: { clip } });
    if (!result.success) throw new Error(result.error?.message);
    return { id: clip.id, trackId };
  }
  async updateTextOverlay(id: string, options: UpdateTextOverlayOptions) {
    const clip = this.draft.textClips?.find((c) => c.id === id);
    if (!clip) throw new Error(`Text element not found: ${id}`);
    if (this.draft.timeline.tracks.find((t) => t.id === clip.trackId)?.locked) throw new Error("Text track is locked");
    const updates = { ...(options.text !== undefined ? { text: options.text } : {}), ...(options.style ? { style: { ...clip.style, ...options.style } } : {}), ...(options.transform ? { transform: { ...clip.transform, ...options.transform } } : {}) };
    const result = await this.applyAction({ type: "text/update", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: id, updates } });
    if (!result.success) throw new Error(result.error?.message);
    return { id, trackId: clip.trackId };
  }
}
