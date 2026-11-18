import type { Action } from "@openreel/core/types/actions";
import type { Clip } from "@openreel/core/types/timeline";
import type { ClipColorGrading, ClipLutJson } from "@openreel/core/video/color-grading-engine";
import {
  createLook,
  createLutEntry,
  gradingFromLook,
  LookError,
  type LutLibraryEntry,
  type SavedLook,
} from "@openreel/core/color/looks";
import { lutFromJson, serializeCubeLut } from "@openreel/core/color/lut-json";
import type { ColorLibraryBridge, EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Colour library tools: saved looks (a clip's whole Lumetri grade under a
 * name), the per-user LUT library, the Input LUT slot and .cube export. Edits
 * go through `clip/setColorGrading`, one undo step per call.
 */

const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const obj = (
  properties: Record<string, JSONSchema>,
  required: string[] = [],
): JSONSchema => ({ type: "object", properties, required, additionalProperties: true });
const strArray: JSONSchema = { type: "array", items: { type: "string" } };

const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "ERROR"): ToolResult => ({
  ok: false,
  summary: message,
  error: { code, message },
});

const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Headless hosts have no persistent library: keep entries for the session. */
const sessionLibraries = new WeakMap<object, ColorLibraryBridge>();

function memoryLibrary(): ColorLibraryBridge {
  const looks = new Map<string, SavedLook>();
  const luts = new Map<string, LutLibraryEntry>();
  return {
    listLooks: async () => [...looks.values()],
    saveLook: async (look) => void looks.set(look.id, look),
    deleteLook: async (id) => looks.delete(id),
    listLuts: async () => [...luts.values()],
    saveLut: async (entry) => void luts.set(entry.id, entry),
    deleteLut: async (id) => luts.delete(id),
  };
}

function library(host: EditingHost): ColorLibraryBridge {
  if (host.colorLibrary) return host.colorLibrary;
  let lib = sessionLibraries.get(host);
  if (!lib) {
    lib = memoryLibrary();
    sessionLibraries.set(host, lib);
  }
  return lib;
}

type Slot = "creative" | "input";

function slotOf(value: unknown): Slot {
  if (value === undefined || value === "creative") return "creative";
  if (value === "input") return "input";
  throw new Error('slot must be "creative" or "input".');
}

const slotKey = (slot: Slot): "lut" | "inputLut" => (slot === "input" ? "inputLut" : "lut");

function findClip(host: EditingHost, clipId: string): Clip | undefined {
  return host
    .getProject()
    .timeline.tracks.flatMap((t) => t.clips)
    .find((c) => c.id === clipId);
}

function clipIdList(args: Record<string, unknown>): string[] {
  const ids = Array.isArray(args.clipIds)
    ? args.clipIds
    : typeof args.clipId === "string"
      ? [args.clipId]
      : [];
  const list = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  if (list.length === 0) throw new Error("clipIds (or clipId) is required.");
  for (const id of list) {
    if (!/./.test(id)) throw new Error("Invalid clip id.");
  }
  return [...new Set(list)];
}

/** Replace the grade of several clips as one undo step. */
async function setGradings(
  host: EditingHost,
  clipIds: readonly string[],
  build: (current: ClipColorGrading | undefined) => ClipColorGrading | undefined,
  label: string,
): Promise<string[]> {
  for (const id of clipIds) {
    if (!findClip(host, id)) throw new Error(`Clip not found: ${id}`);
  }
  // Grades only apply to picture clips; skip audio, text and graphics clips.
  const visual = new Set(
    host
      .getProject()
      .timeline.tracks.filter((t) => t.type === "video" || t.type === "image")
      .flatMap((t) => t.clips.map((c) => c.id)),
  );
  const targets = clipIds.filter((id) => visual.has(id));
  if (targets.length === 0) throw new Error("Only video and image clips can be colour graded.");
  const txn = host.beginTransaction(label);
  try {
    for (const clipId of targets) {
      const current = findClip(host, clipId)?.colorGrading;
      const next = build(current);
      const action: Action = {
        type: "clip/setColorGrading",
        id: genId(),
        timestamp: Date.now(),
        params: { clipId, colorGrading: next ? structuredClone(next) : undefined },
      };
      const result = await host.applyAction(action);
      if (!result.success) throw new Error(result.error?.message ?? "The grade could not be set.");
    }
    await host.commitTransaction(txn, label);
  } catch (error) {
    await host.rollbackTransaction(txn);
    throw error;
  }
  return [...targets];
}

function pickByIdOrName<T extends { id: string; name: string }>(
  items: readonly T[],
  ref: unknown,
  what: string,
): T {
  if (typeof ref !== "string" || !ref) throw new Error(`${what} id or name is required.`);
  const found =
    items.find((i) => i.id === ref) ??
    items.find((i) => i.name.toLowerCase() === ref.toLowerCase());
  if (!found) throw new Error(`Unknown ${what}: ${ref}. Run list_color_library.`);
  return found;
}

const guarded =
  (run: (args: Record<string, unknown>, host: EditingHost) => Promise<ToolResult>): RegisteredTool["handler"] =>
  async (args, host) => {
    try {
      return await run(args, host);
    } catch (error) {
      const code = error instanceof LookError ? "INVALID_PARAMS" : "ERROR";
      return fail(error instanceof Error ? error.message : "Colour library request failed.", code);
    }
  };

function lutOf(grading: ClipColorGrading | undefined, slot: Slot): ClipLutJson | undefined {
  return grading?.[slotKey(slot)];
}

export const COLOR_LIBRARY_TOOLS: RegisteredTool[] = [
  {
    name: "list_color_library",
    domain: "color",
    title: "List colour library",
    description:
      "List the user's saved looks (named full Lumetri grades) and imported LUTs. These live outside the project, so they are reusable across projects. Read-only.",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded(async (_args, host) => {
      const lib = library(host);
      const [looks, luts] = await Promise.all([lib.listLooks(), lib.listLuts()]);
      return ok(`${looks.length} look(s), ${luts.length} LUT(s).`, {
        looks: looks.map((l) => ({ id: l.id, name: l.name, createdAt: l.createdAt })),
        luts: luts.map((l) => ({ id: l.id, name: l.name, kind: l.kind, size: l.size, createdAt: l.createdAt })),
      });
    }),
  },
  {
    name: "save_look",
    domain: "color",
    title: "Save look",
    description:
      "Save a clip's complete Lumetri grade (wheels, curves, hue curves, HSL, tone, white balance, vignette, creative LUT and Input LUT) as a named look in the user's library. Fails when the clip has no grade. Does not change the project.",
    inputSchema: obj({ clipId: str, name: str }, ["clipId", "name"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const clipId = String(args.clipId ?? "");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const look = createLook(String(args.name ?? ""), clip.colorGrading);
      await library(host).saveLook(look);
      return ok(`Saved look "${look.name}".`, { lookId: look.id, name: look.name });
    }),
  },
  {
    name: "apply_look",
    domain: "color",
    title: "Apply look",
    description:
      "Apply a saved look (by id or name) to one or more clips (clipIds), replacing their whole grade with the look's. One undo step for all clips.",
    inputSchema: obj({ lookId: str, clipIds: strArray, clipId: str }, ["lookId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const look = pickByIdOrName(await library(host).listLooks(), args.lookId, "look");
      const applied = await setGradings(host, clipIdList(args), () => gradingFromLook(look), `Apply look "${look.name}"`);
      return ok(`Applied look "${look.name}" to ${applied.length} clip(s) (one undo step).`, { lookId: look.id, clipIds: applied });
    }),
  },
  {
    name: "delete_look",
    domain: "color",
    title: "Delete look",
    description: "Delete a saved look from the user's library (by id or name). Clips already graded with it keep their grade.",
    inputSchema: obj({ lookId: str }, ["lookId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: guarded(async (args, host) => {
      const lib = library(host);
      const look = pickByIdOrName(await lib.listLooks(), args.lookId, "look");
      await lib.deleteLook(look.id);
      return ok(`Deleted look "${look.name}".`, { lookId: look.id });
    }),
  },
  {
    name: "save_clip_lut_to_library",
    domain: "color",
    title: "Save clip LUT to library",
    description:
      "Store the LUT currently applied to a clip (slot creative, the default, or input) in the user's LUT library under `name`, so it can be reused on other clips and projects. Does not change the project.",
    inputSchema: obj({ clipId: str, name: str, slot: { type: "string", enum: ["creative", "input"] } }, ["clipId", "name"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const slot = slotOf(args.slot);
      const clipId = String(args.clipId ?? "");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const lut = lutOf(clip.colorGrading, slot);
      if (!lut) return fail(`The clip has no ${slot} LUT.`, "NO_LUT");
      const entry = createLutEntry(String(args.name ?? ""), lut);
      await library(host).saveLut(entry);
      return ok(`Saved LUT "${entry.name}" to the library.`, { lutId: entry.id, kind: entry.kind, size: entry.size });
    }),
  },
  {
    name: "apply_library_lut",
    domain: "color",
    title: "Apply library LUT",
    description:
      "Apply a LUT from the library (by id or name) to one or more clips. slot \"creative\" (default) is the look LUT after the grade; slot \"input\" is the Input LUT applied to the source before the whole grade (e.g. camera log to Rec.709). Optional intensity 0..1. One undo step.",
    inputSchema: obj(
      { lutId: str, clipIds: strArray, clipId: str, slot: { type: "string", enum: ["creative", "input"] }, intensity: num },
      ["lutId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const slot = slotOf(args.slot);
      const entry = pickByIdOrName(await library(host).listLuts(), args.lutId, "LUT");
      let intensity = entry.lut.intensity;
      if (args.intensity !== undefined) {
        intensity = Number(args.intensity);
        if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1)
          return fail("intensity must be between 0 and 1.", "INVALID_PARAMS");
      }
      const key = slotKey(slot);
      const applied = await setGradings(
        host,
        clipIdList(args),
        (current) => ({
          ...(current ?? { pipelineVersion: 2 as const }),
          [key]: { ...structuredClone(entry.lut), intensity },
        }),
        `Apply ${slot} LUT "${entry.name}"`,
      );
      return ok(`Applied ${slot} LUT "${entry.name}" to ${applied.length} clip(s) (one undo step).`, {
        lutId: entry.id,
        slot,
        clipIds: applied,
      });
    }),
  },
  {
    name: "remove_clip_lut",
    domain: "color",
    title: "Remove clip LUT",
    description: "Remove the creative or Input LUT (slot) from one or more clips. One undo step.",
    inputSchema: obj({ clipIds: strArray, clipId: str, slot: { type: "string", enum: ["creative", "input"] } }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const slot = slotOf(args.slot);
      const key = slotKey(slot);
      const applied = await setGradings(
        host,
        clipIdList(args),
        (current) => {
          if (!current) return current;
          const { [key]: _removed, ...rest } = current;
          return rest;
        },
        `Remove ${slot} LUT`,
      );
      return ok(`Removed the ${slot} LUT from ${applied.length} clip(s).`, { slot, clipIds: applied });
    }),
  },
  {
    name: "export_lut_cube",
    domain: "color",
    title: "Export LUT as .cube",
    description:
      "Export the LUT applied to a clip (slot creative, the default, or input) as an Adobe/Resolve .cube file. The intensity is baked in unless bakeIntensity is false. Live editor only (it downloads the file).",
    inputSchema: obj(
      { clipId: str, slot: { type: "string", enum: ["creative", "input"] }, filename: str, bakeIntensity: { type: "boolean" } },
      ["clipId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const lib = library(host);
      if (!lib.exportCube) return fail("Exporting a .cube file needs the live editor.", "UNSUPPORTED_HOST");
      const slot = slotOf(args.slot);
      const clipId = String(args.clipId ?? "");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const lut = lutOf(clip.colorGrading, slot);
      if (!lut) return fail(`The clip has no ${slot} LUT to export.`, "NO_LUT");
      const base = typeof args.filename === "string" && args.filename.trim() ? args.filename.trim() : `${slot}-lut`;
      const filename = /\.cube$/i.test(base) ? base : `${base}.cube`;
      const text = serializeCubeLut(lutFromJson(lut), {
        title: filename.replace(/\.cube$/i, ""),
        bakeIntensity: args.bakeIntensity === false ? false : true,
      });
      await lib.exportCube(filename, text);
      return ok(`Exported ${filename}.`, { filename, bytes: text.length });
    }),
  },
];
