import type { Project } from "@openreel/core/types/project";
import type { Clip } from "@openreel/core/types/timeline";
import {
  DEFAULT_VR_PROPERTIES,
  NO_VR,
  VR_LAYOUTS,
  VR_PROJECTIONS,
  describeVrProperties,
  effectiveVrProperties,
  isVrProperties,
  normalizeVrProperties,
  validateVrProperties,
  type VrProperties,
} from "@openreel/core/vr/vr-properties";
import { PRO_EFFECT_DEFAULTS } from "@openreel/core/video/pro-effects";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Immersive video (VR / 360): sequence and clip VR Properties, and the Reframe 360 to flat helper. The VR effects
 * themselves (vr-rotate-sphere, vr-projection, vr-blur, vr-plane-to-sphere) go through the generic effect tools
 * (add_video_effect, update_video_effect, keyframes); definitions only, this group loads lazily with the others.
 */
const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const bool: JSONSchema = { type: "boolean" };
const strings: JSONSchema = { type: "array", items: str };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({ ok: false, summary: message, error: { code, message } });
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const VR_FIELDS: Record<string, JSONSchema> = {
  projection: { type: "string", enum: [...VR_PROJECTIONS] },
  layout: { type: "string", enum: [...VR_LAYOUTS] },
  horizontalFov: num,
  verticalFov: num,
};
const INITIAL_VIEW: JSONSchema = obj({ yaw: num, pitch: num, roll: num });

function readVrArgs(args: Record<string, unknown>, base: VrProperties, withInitialView = false): { vr: VrProperties | null } | { error: string } {
  const patch: Partial<VrProperties> = {};
  for (const key of (withInitialView ? ["projection", "layout", "horizontalFov", "verticalFov", "initialView"] : ["projection", "layout", "horizontalFov", "verticalFov"]) as readonly (keyof VrProperties)[]) {
    if (args[key] !== undefined) (patch as Record<string, unknown>)[key] = args[key];
  }
  const bad = validateVrProperties(patch);
  if (bad) return { error: bad };
  // Setting anything on a flat sequence / clip means "this is a sphere", unless projection says none.
  const merged = normalizeVrProperties({
    ...(base.projection === "none" ? DEFAULT_VR_PROPERTIES : base),
    ...patch,
  });
  if (merged.projection === "none") return { vr: null };
  const { source: _source, ...plain } = merged;
  void _source;
  return { vr: plain };
}

function clipsById(project: Project): Map<string, Clip> {
  return new Map(project.timeline.tracks.flatMap((t) => t.clips).map((c) => [c.id, c] as const));
}

function targetMedia(project: Project, args: Record<string, unknown>): { mediaIds: string[] } | { error: ToolResult } {
  const mediaIds = new Set<string>();
  const clipIds = Array.isArray(args.clipIds) ? args.clipIds : typeof args.clipId === "string" ? [args.clipId] : [];
  const clips = clipsById(project);
  for (const id of clipIds) {
    const clip = typeof id === "string" ? clips.get(id) : undefined;
    if (!clip) return { error: fail(`Clip not found: ${String(id)}`, "CLIP_NOT_FOUND") };
    mediaIds.add(clip.mediaId);
  }
  if (Array.isArray(args.mediaIds)) for (const id of args.mediaIds) if (typeof id === "string") mediaIds.add(id);
  if (!mediaIds.size) return { error: fail("Give clipId, clipIds or mediaIds.") };
  for (const id of mediaIds) {
    const item = project.mediaLibrary.items.find((m) => m.id === id);
    if (!item) return { error: fail(`Media not found: ${id}`, "MEDIA_NOT_FOUND") };
    if (item.type !== "video" && item.type !== "image") return { error: fail(`"${item.name}" is not video or image media.`) };
  }
  return { mediaIds: [...mediaIds] };
}

const describeItem = (item: Project["mediaLibrary"]["items"][number]) => {
  const effective = effectiveVrProperties(item);
  return {
    mediaId: item.id,
    name: item.name,
    effective,
    description: describeVrProperties(effective),
    override: item.vrProperties ?? null,
    detected: item.metadata.vr ?? null,
  };
};

export const VR_TOOLS: RegisteredTool[] = [
  {
    name: "set_sequence_vr_properties",
    domain: "project",
    title: "Set sequence VR properties",
    description:
      'Immersive video: set the active sequence\'s VR Properties (Premiere: Sequence Settings > VR Properties). projection "equirectangular" makes it a 360 sequence (VR effects, the Program monitor VR view and spherical metadata in MP4 / MOV exports); "none" or clear:true makes it flat. layout: "mono", "over-under" (left eye on top) or "side-by-side" (left eye on the left). horizontalFov (default 360) and verticalFov (default 180) are the captured view in degrees. initialView {yaw, pitch, roll} (degrees; yaw to the right, pitch up; all 0 = straight ahead) is the direction a player opens at, written into exports as the sv3d pose and the V1 InitialView fields. Fields not given keep their value. One undo step. Set the sequence size to 2:1 (for example 3840x1920) for a mono sphere.',
    inputSchema: obj({ ...VR_FIELDS, initialView: INITIAL_VIEW, clear: bool }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host): Promise<ToolResult> => {
      host.requireOpenProject();
      const project = host.getProject();
      let vr: VrProperties | null;
      if (args.clear === true) vr = null;
      else {
        if (args.projection === undefined && args.layout === undefined && args.horizontalFov === undefined && args.verticalFov === undefined && args.initialView === undefined) {
          return fail("Give projection, layout, horizontalFov, verticalFov, initialView or clear:true.");
        }
        const read = readVrArgs(args, project.settings.vr ?? NO_VR, true);
        if ("error" in read) return fail(read.error);
        vr = read.vr;
      }
      const result = await host.applyAction({ type: "project/updateSettings", id: genId(), timestamp: Date.now(), params: { vr: vr ?? undefined } });
      if (!result.success) return fail(result.error?.message ?? "The sequence could not be updated.", result.error?.code ?? "ACTION_FAILED");
      const now = host.getProject().settings.vr;
      return ok(vr ? `sequence is VR: ${describeVrProperties(vr)}` : "sequence is flat", { vr: now ?? null, size: { width: host.getProject().settings.width, height: host.getProject().settings.height } });
    },
  },
  {
    name: "set_clip_vr_properties",
    domain: "media",
    title: "Set clip VR properties",
    description:
      'Immersive video: tell OpenReel how a clip\'s source is projected (Premiere: Interpret Footage > VR Properties), for clipId / clipIds / mediaIds. projection "equirectangular" | "none"; layout "mono" | "over-under" | "side-by-side"; horizontalFov / verticalFov are the captured view in degrees. clear:true goes back to what the file\'s spherical metadata says. Footage with spherical metadata is detected on import (see list_media / get_vr_properties); a 2:1 picture without metadata is only a hint until you set it. One undo step.',
    inputSchema: obj({ clipId: str, clipIds: strings, mediaIds: strings, ...VR_FIELDS, clear: bool }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host): Promise<ToolResult> => {
      host.requireOpenProject();
      const project = host.getProject();
      const target = targetMedia(project, args);
      if ("error" in target) return target.error;
      const itemPatches: Record<string, { vrProperties: VrProperties | null }> = {};
      for (const id of target.mediaIds) {
        const item = project.mediaLibrary.items.find((m) => m.id === id)!;
        if (args.clear === true) {
          itemPatches[id] = { vrProperties: null };
          continue;
        }
        const read = readVrArgs(args, effectiveVrProperties(item));
        if ("error" in read) return fail(read.error);
        // "none" is stored (it overrides the file's metadata); only clear removes the override.
        itemPatches[id] = { vrProperties: read.vr ?? NO_VR };
      }
      if (args.clear !== true && args.projection === undefined && args.layout === undefined && args.horizontalFov === undefined && args.verticalFov === undefined) {
        return fail("Give projection, layout, horizontalFov, verticalFov or clear:true.");
      }
      const result = await host.applyAction({ type: "media/organize", id: genId(), timestamp: Date.now(), params: { label: "VR properties", itemPatches } });
      if (!result.success) return fail(result.error?.message ?? "The clip could not be updated.", result.error?.code ?? "ACTION_FAILED");
      const items = host.getProject().mediaLibrary.items.filter((m) => target.mediaIds.includes(m.id));
      return ok(`VR properties set on ${items.length} media item${items.length === 1 ? "" : "s"}`, { items: items.map(describeItem) });
    },
  },
  {
    name: "get_vr_properties",
    domain: "read",
    title: "Get VR properties",
    description:
      "Read immersive video properties: the active sequence's VR properties, and for clipId / mediaId the effective, overridden and detected (spherical metadata or 2:1 hint) properties of the source.",
    inputSchema: obj({ clipId: str, mediaId: str }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host): Promise<ToolResult> => {
      host.requireOpenProject();
      const project = host.getProject();
      const sequence = project.settings.vr ?? null;
      const out: Record<string, unknown> = {
        sequence,
        sequenceIsVr: isVrProperties(sequence ?? undefined),
        sequenceSize: { width: project.settings.width, height: project.settings.height },
      };
      let mediaId = typeof args.mediaId === "string" ? args.mediaId : undefined;
      if (typeof args.clipId === "string") {
        const clip = clipsById(project).get(args.clipId);
        if (!clip) return fail(`Clip not found: ${args.clipId}`, "CLIP_NOT_FOUND");
        mediaId = clip.mediaId;
      }
      if (mediaId) {
        const item = project.mediaLibrary.items.find((m) => m.id === mediaId);
        if (!item) return fail(`Media not found: ${mediaId}`, "MEDIA_NOT_FOUND");
        out.media = describeItem(item);
      }
      return ok(sequence && sequence.projection !== "none" ? `sequence: ${describeVrProperties(sequence)}` : "sequence is flat", out);
    },
  },
  {
    name: "reframe_360_to_flat",
    domain: "effect",
    title: "Reframe 360 to flat",
    description:
      "Make a flat edit from 360 footage: adds a VR Projection effect (mode rectilinear) to the clip with a view aimed at pan (yaw, degrees to the right), tilt (degrees up), roll and fov (horizontal field of view, 10-170, default 90), and sets the clip to Cover so the view fills the sequence. The view aspect defaults to the sequence's, so use a flat sequence (for example 1920x1080); the clip's source layout (mono / over-under / side-by-side) is read from its VR Properties. Returns effectId: keyframe pan / tilt / roll / fov with the effect keyframe tools (angles interpolate along the shorter arc). One undo step.",
    inputSchema: obj({ clipId: str, pan: num, tilt: num, roll: num, fov: num, aspect: num, fill: bool }, ["clipId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host: EditingHost): Promise<ToolResult> => {
      host.requireOpenProject();
      const project = host.getProject();
      const clip = clipsById(project).get(String(args.clipId));
      if (!clip) return fail(`Clip not found: ${String(args.clipId)}`, "CLIP_NOT_FOUND");
      const item = project.mediaLibrary.items.find((m) => m.id === clip.mediaId);
      if (!item || (item.type !== "video" && item.type !== "image")) return fail("Reframe applies to video and image clips.");
      const source = effectiveVrProperties(item);
      const layout = source.projection !== "none" ? source.layout : (project.settings.vr?.layout ?? "mono");
      const sequenceAspect = project.settings.width / project.settings.height;
      const num01 = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
      const params = {
        ...PRO_EFFECT_DEFAULTS["vr-projection"],
        mode: "rectilinear",
        layout,
        fov: num01(args.fov, 90),
        pan: num01(args.pan, 0),
        tilt: num01(args.tilt, 0),
        roll: num01(args.roll, 0),
        aspect: Math.round(num01(args.aspect, sequenceAspect) * 1000) / 1000,
      };
      if (params.fov < 10 || params.fov > 170) return fail("fov must be between 10 and 170 degrees for a flat view.");
      if (params.aspect < 0.25 || params.aspect > 4) return fail("aspect must be between 0.25 and 4.");
      const effectId = genId();
      const txn = host.beginTransaction("Reframe 360 to flat");
      try {
        const added = await host.applyAction({ type: "effect/add", id: genId(), timestamp: Date.now(), params: { clipId: clip.id, effectType: "vr-projection", params, effectId } });
        if (!added.success) throw new Error(added.error?.message ?? "The effect could not be added.");
        if (args.fill !== false) {
          const filled = await host.applyAction({ type: "transform/update", id: genId(), timestamp: Date.now(), params: { clipId: clip.id, transform: { fitMode: "cover" } } });
          if (!filled.success) throw new Error(filled.error?.message ?? "The clip could not be set to Cover.");
        }
        await host.commitTransaction(txn, "Reframe 360 to flat");
      } catch (error) {
        await host.rollbackTransaction(txn);
        return fail(error instanceof Error ? error.message : "reframe_360_to_flat failed", "ACTION_FAILED");
      }
      return ok("reframed to a flat view", { clipId: clip.id, effectId, params, fill: args.fill !== false });
    },
  },
];
