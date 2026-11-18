import { validateGraphicTemplate, type GraphicTemplate } from "@openreel/core";

/**
 * Messages between the editor and a linked-composition window.
 *
 * The main window owns the project: it is the only place a composition is edited
 * for real (through `editLinkedComposition`, one undo step per message). A
 * composition window is a view with its own editing UI; it sends full-template
 * edits and receives the authoritative state back.
 */

export type LinkedCompEditorMessage =
  /** Window -> main: send me the composition (sent when the window opens, and as a retry). */
  | { readonly type: "hello"; readonly compositionId: string }
  /** Window -> main: replace the master template. `baseRevision` is the revision the edit was made on. */
  | {
      readonly type: "edit";
      readonly compositionId: string;
      readonly baseRevision: number;
      readonly label: string;
      readonly template: unknown;
    }
  /** Window -> main: the window was closed. */
  | { readonly type: "closed"; readonly compositionId: string };

export type LinkedCompHostMessage =
  /** Main -> windows: the authoritative composition (reply to hello, after every change, or a rejected edit). */
  | {
      readonly type: "state";
      readonly compositionId: string;
      readonly name: string;
      readonly revision: number;
      readonly template: GraphicTemplate;
      /** Set when this state answers an edit that could not be applied as sent. */
      readonly rejected?: string;
    }
  /** Main -> windows: the composition no longer exists (deleted, project closed or changed). */
  | { readonly type: "gone"; readonly compositionId: string };

export type LinkedCompMessage = LinkedCompEditorMessage | LinkedCompHostMessage;

export const LINKED_COMP_CHANNEL = "openreel-linked-composition";
/** Largest edit message the host accepts (a template embeds its images as data: URLs). */
export const LINKED_COMP_MAX_BYTES = 16_000_000;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Narrow an untrusted message (BroadcastChannel / IPC payload). Never throws. */
export function parseLinkedCompMessage(raw: unknown): LinkedCompMessage | null {
  if (!isObject(raw) || typeof raw.type !== "string" || typeof raw.compositionId !== "string" || raw.compositionId.length === 0) return null;
  switch (raw.type) {
    case "hello":
    case "closed":
    case "gone":
      return { type: raw.type, compositionId: raw.compositionId };
    case "edit":
      if (typeof raw.baseRevision !== "number" || !Number.isFinite(raw.baseRevision) || typeof raw.label !== "string" || !isObject(raw.template)) return null;
      return {
        type: "edit",
        compositionId: raw.compositionId,
        baseRevision: raw.baseRevision,
        label: raw.label.slice(0, 120),
        template: raw.template,
      };
    case "state": {
      if (typeof raw.revision !== "number" || typeof raw.name !== "string") return null;
      const checked = validateGraphicTemplate(raw.template as GraphicTemplate);
      if (!checked.ok) return null;
      return {
        type: "state",
        compositionId: raw.compositionId,
        name: raw.name,
        revision: raw.revision,
        template: checked.template,
        ...(typeof raw.rejected === "string" ? { rejected: raw.rejected } : {}),
      };
    }
    default:
      return null;
  }
}

/** The hash that makes the app render only the composition window. */
export const compositionWindowHash = (compositionId: string): string => `#/composition/${encodeURIComponent(compositionId)}`;

/** Composition id when `hash` addresses a composition window. */
export function compositionIdFromHash(hash: string): string | null {
  const match = /^#\/composition\/([^/?#]+)/.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
