/**
 * Template compiler (STUDIO_PLAN §11.1, §12.2, Appendix B). Flattens a template
 * definition into an EDL (edit decision list) — the pure-JSON output templates
 * compile to. Trivial runtime cost; runs locally on every platform (§24).
 */

export type SlotKind = "video" | "text" | "audio" | "image";

export interface TemplateSlot {
  id: string;
  kind: SlotKind;
  min_duration_ms?: number;
  max_duration_ms?: number;
  max_chars?: number;
  required?: boolean;
}

export interface TemplateFxRef {
  fx_id: string;
  params?: Record<string, number | string | boolean>;
}

export interface TemplateItem {
  slot: string;
  in: number;
  out: number;
  fx?: TemplateFxRef[];
  transform?: { x: number; y: number; scale?: number; rotate?: number };
}

export interface TemplateTrack {
  id: string;
  kind: SlotKind;
  items: TemplateItem[];
}

export interface TemplateSource {
  metadata: { title: string; duration_ms: number; aspect_ratio: string; fps?: number };
  slots: TemplateSlot[];
  tracks: TemplateTrack[];
  soundtrack?: { slot: string; in: number };
}

export interface Edl {
  schema_version: string;
  metadata: { title: string; duration_ms: number; aspect_ratio: string; fps: number };
  slots: TemplateSlot[];
  tracks: TemplateTrack[];
  soundtrack?: { slot: string; in: number };
}

export type TemplateCompileResult =
  | { ok: true; edl: Edl }
  | { ok: false; errors: Array<{ code: string; message: string }> };

export function compileTemplate(src: TemplateSource): TemplateCompileResult {
  const errors: Array<{ code: string; message: string }> = [];
  const slotIds = new Set(src.slots.map((s) => s.id));
  const duration = src.metadata.duration_ms;

  for (const track of src.tracks) {
    for (const item of track.items) {
      if (!slotIds.has(item.slot)) {
        errors.push({ code: "unknown_slot", message: `Track ${track.id} references unknown slot "${item.slot}"` });
      }
      if (item.out > duration) {
        errors.push({ code: "overflow", message: `Item "${item.slot}" out=${item.out}ms overflows template duration ${duration}ms` });
      }
      if (item.in < 0 || item.out <= item.in) {
        errors.push({ code: "bad_range", message: `Item "${item.slot}" has invalid range [${item.in}, ${item.out}]` });
      }
      for (const fx of item.fx ?? []) {
        if (typeof fx.fx_id !== "string" || !/^[\w.-]+\/[\w.-]+@[\w.-]+$/.test(fx.fx_id)) {
          errors.push({ code: "bad_fx_ref", message: `Invalid fx reference "${fx.fx_id}" (expected handle/slug@version)` });
        }
      }
    }
  }

  if (src.soundtrack && !slotIds.has(src.soundtrack.slot)) {
    errors.push({ code: "unknown_slot", message: `Soundtrack references unknown slot "${src.soundtrack.slot}"` });
  }

  if (errors.length) return { ok: false, errors };

  const edl: Edl = {
    schema_version: "1.0.0",
    metadata: {
      title: src.metadata.title,
      duration_ms: src.metadata.duration_ms,
      aspect_ratio: src.metadata.aspect_ratio,
      fps: src.metadata.fps ?? 30,
    },
    slots: src.slots,
    tracks: src.tracks,
    ...(src.soundtrack ? { soundtrack: src.soundtrack } : {}),
  };
  return { ok: true, edl };
}

/** Collect every fx reference in a template (for resolving against Approved versions, §38.2). */
export function templateFxRefs(src: TemplateSource): string[] {
  const refs = new Set<string>();
  for (const track of src.tracks) {
    for (const item of track.items) {
      for (const fx of item.fx ?? []) refs.add(fx.fx_id);
    }
  }
  return [...refs];
}
