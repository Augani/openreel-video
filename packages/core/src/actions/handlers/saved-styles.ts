import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import type { Subtitle } from "../../types/timeline";
import type { MutableTimeline } from "../../utils/immutable-updates";
import type { TextClip, TextStyle } from "../../text/types";
import {
  EMPTY_STYLE_LIBRARY,
  findSavedStyle,
  normalizeStyleName,
  type SavedCaptionStyle,
  type SavedStyleKind,
  type SavedStyleLibrary,
  type SavedTextStyle,
} from "../../text/saved-styles";
import { registerActionHandler, type ActionHandler } from "../registry";

/**
 * Saved text / caption styles.
 *  - style/save   {kind, id, name, style, scroll?|cueSettings?}  upsert by name
 *  - style/delete {kind, styleId}
 *  - style/setLibrary {library}                                  whole-library restore (inverse of the two above)
 *  - style/applyText    {clipIds, styleId}                        one undo step for any number of clips
 *  - style/restoreText  {styles: {clipId: {style, scroll?}}}      inverse of applyText
 *  - style/applyCaption {subtitleIds, styleId}                    inverse is subtitle/setAll
 */

const ok = (): ValidationResult => ({ valid: true, errors: [] });
const err = (message: string): ValidationResult => ({
  valid: false,
  errors: [{ code: "INVALID_PARAMS", message }],
});

const library = (project: Project): SavedStyleLibrary => project.savedStyles ?? EMPTY_STYLE_LIBRARY;
const setLibrary = (project: Project, lib: SavedStyleLibrary): void => {
  (project as { savedStyles?: SavedStyleLibrary }).savedStyles = lib;
};
const inverse = (action: Action, type: string, params: Record<string, unknown>): Action => ({
  type,
  id: `inverse-${action.id}`,
  timestamp: Date.now(),
  params,
});
const isKind = (kind: unknown): kind is SavedStyleKind => kind === "text" || kind === "caption";

const save: ActionHandler = {
  type: "style/save",
  validate(action) {
    const p = action.params as { kind?: unknown; id?: unknown; name?: unknown; style?: unknown };
    if (!isKind(p.kind)) return err("kind must be \"text\" or \"caption\"");
    if (typeof p.id !== "string" || !p.id) return err("id is required");
    if (typeof p.name !== "string" || !normalizeStyleName(p.name)) return err("name is required");
    if (!p.style || typeof p.style !== "object") return err("style is required");
    return ok();
  },
  apply(action, project) {
    const p = action.params as {
      kind: SavedStyleKind;
      id: string;
      name: string;
      style: Record<string, unknown>;
      scroll?: unknown;
      cueSettings?: unknown;
    };
    const name = normalizeStyleName(p.name);
    const lib = library(project);
    const list = (p.kind === "text" ? lib.text : lib.caption) as ReadonlyArray<{ id: string; name: string }>;
    // Saving under an existing name overwrites it (keeps its id).
    const existing = findSavedStyle(list, name);
    const id = existing?.id ?? p.id;
    const entry =
      p.kind === "text"
        ? { id, name, style: structuredClone(p.style), ...(p.scroll ? { scroll: structuredClone(p.scroll) } : {}) }
        : { id, name, style: structuredClone(p.style), ...(p.cueSettings ? { cueSettings: structuredClone(p.cueSettings) } : {}) };
    const next = existing ? list.map((e) => (e.id === existing.id ? entry : e)) : [...list, entry];
    setLibrary(project, { ...lib, [p.kind]: next } as unknown as SavedStyleLibrary);
  },
  invert(action, projectBefore) {
    return inverse(action, "style/setLibrary", { library: structuredClone(library(projectBefore)) });
  },
};

const del: ActionHandler = {
  type: "style/delete",
  validate(action, project) {
    const p = action.params as { kind?: unknown; styleId?: unknown };
    if (!isKind(p.kind) || typeof p.styleId !== "string") return err("kind and styleId are required");
    const list: ReadonlyArray<{ id: string; name: string }> =
      p.kind === "text" ? library(project).text : library(project).caption;
    return findSavedStyle(list, p.styleId) ? ok() : err(`Saved ${p.kind} style not found: ${p.styleId}`);
  },
  apply(action, project) {
    const p = action.params as { kind: SavedStyleKind; styleId: string };
    const lib = library(project);
    const list = (p.kind === "text" ? lib.text : lib.caption) as ReadonlyArray<{ id: string; name: string }>;
    const target = findSavedStyle(list, p.styleId);
    setLibrary(project, { ...lib, [p.kind]: list.filter((e) => e !== target) } as unknown as SavedStyleLibrary);
  },
  invert(action, projectBefore) {
    return inverse(action, "style/setLibrary", { library: structuredClone(library(projectBefore)) });
  },
};

const setLib: ActionHandler = {
  type: "style/setLibrary",
  validate(action) {
    const lib = (action.params as { library?: SavedStyleLibrary }).library;
    return lib && Array.isArray(lib.text) && Array.isArray(lib.caption) ? ok() : err("library with text and caption lists is required");
  },
  apply(action, project) {
    setLibrary(project, structuredClone((action.params as { library: SavedStyleLibrary }).library));
  },
  invert(action, projectBefore) {
    return inverse(action, "style/setLibrary", { library: structuredClone(library(projectBefore)) });
  },
};

type TextSnapshot = { style: TextStyle; scroll?: TextClip["scroll"] };

function textClips(project: Project): TextClip[] {
  return (project.textClips ?? []) as TextClip[];
}

const applyText: ActionHandler = {
  type: "style/applyText",
  validate(action, project) {
    const p = action.params as { clipIds?: unknown; styleId?: unknown };
    if (!Array.isArray(p.clipIds) || p.clipIds.length === 0) return err("clipIds is required");
    if (typeof p.styleId !== "string" || !findSavedStyle(library(project).text, p.styleId)) {
      return err(`Saved text style not found: ${String(p.styleId)}`);
    }
    const known = new Set(textClips(project).map((c) => c.id));
    const missing = (p.clipIds as unknown[]).find((id) => typeof id !== "string" || !known.has(id));
    return missing === undefined ? ok() : err(`Text clip not found: ${String(missing)}`);
  },
  apply(action, project) {
    const p = action.params as { clipIds: string[]; styleId: string };
    const saved = findSavedStyle(library(project).text, p.styleId) as SavedTextStyle;
    const ids = new Set(p.clipIds);
    (project as { textClips?: TextClip[] }).textClips = textClips(project).map((clip) => {
      if (!ids.has(clip.id)) return clip;
      const next = { ...clip, style: structuredClone(saved.style) } as { -readonly [K in keyof TextClip]: TextClip[K] };
      if (saved.scroll) next.scroll = structuredClone(saved.scroll);
      else delete next.scroll;
      return next;
    });
  },
  invert(action, projectBefore) {
    const p = action.params as { clipIds: string[] };
    const styles: Record<string, TextSnapshot> = {};
    for (const clip of textClips(projectBefore)) {
      if (p.clipIds.includes(clip.id)) {
        styles[clip.id] = { style: structuredClone(clip.style), ...(clip.scroll ? { scroll: structuredClone(clip.scroll) } : {}) };
      }
    }
    return inverse(action, "style/restoreText", { styles });
  },
};

const restoreText: ActionHandler = {
  type: "style/restoreText",
  validate(action) {
    const styles = (action.params as { styles?: unknown }).styles;
    return styles && typeof styles === "object" ? ok() : err("styles is required");
  },
  apply(action, project) {
    const styles = (action.params as { styles: Record<string, TextSnapshot> }).styles;
    (project as { textClips?: TextClip[] }).textClips = textClips(project).map((clip) => {
      const snap = styles[clip.id];
      if (!snap) return clip;
      const next = { ...clip, style: structuredClone(snap.style) } as { -readonly [K in keyof TextClip]: TextClip[K] };
      if (snap.scroll) next.scroll = structuredClone(snap.scroll);
      else delete next.scroll;
      return next;
    });
  },
  invert(action, projectBefore) {
    const styles: Record<string, TextSnapshot> = {};
    for (const id of Object.keys((action.params as { styles: Record<string, unknown> }).styles)) {
      const clip = textClips(projectBefore).find((c) => c.id === id);
      if (clip) styles[id] = { style: structuredClone(clip.style), ...(clip.scroll ? { scroll: structuredClone(clip.scroll) } : {}) };
    }
    return inverse(action, "style/restoreText", { styles });
  },
};

const applyCaption: ActionHandler = {
  type: "style/applyCaption",
  validate(action, project) {
    const p = action.params as { subtitleIds?: unknown; styleId?: unknown };
    if (!Array.isArray(p.subtitleIds) || p.subtitleIds.length === 0) return err("subtitleIds is required");
    if (typeof p.styleId !== "string" || !findSavedStyle(library(project).caption, p.styleId)) {
      return err(`Saved caption style not found: ${String(p.styleId)}`);
    }
    const known = new Set(project.timeline.subtitles.map((s) => s.id));
    const missing = (p.subtitleIds as unknown[]).find((id) => typeof id !== "string" || !known.has(id));
    return missing === undefined ? ok() : err(`Subtitle not found: ${String(missing)}`);
  },
  apply(action, project) {
    const p = action.params as { subtitleIds: string[]; styleId: string };
    const saved = findSavedStyle(library(project).caption, p.styleId) as SavedCaptionStyle;
    const ids = new Set(p.subtitleIds);
    (project.timeline as MutableTimeline).subtitles = project.timeline.subtitles.map((cue: Subtitle) => {
      if (!ids.has(cue.id)) return cue;
      const { cueSettings: _drop, ...rest } = cue;
      void _drop;
      return {
        ...rest,
        style: structuredClone(saved.style),
        ...(saved.cueSettings ? { cueSettings: structuredClone(saved.cueSettings) } : {}),
      };
    });
  },
  invert(action, projectBefore) {
    return inverse(action, "subtitle/setAll", {
      subtitles: projectBefore.timeline.subtitles.map((s) => structuredClone(s)),
    });
  },
};

for (const handler of [save, del, setLib, applyText, restoreText, applyCaption]) registerActionHandler(handler);
