import { create } from "zustand";
import {
  BUILT_IN_GRAPHIC_TEMPLATES,
  validateGraphicTemplate,
  type GraphicTemplate,
} from "@openreel/core";

const STORAGE_KEY = "openreel-graphic-templates-v1";
/** Stay well under the ~5 MB localStorage quota shared with the rest of the app. */
const MAX_STORED_CHARS = 3_000_000;

function readStored(): GraphicTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const checked = validateGraphicTemplate(entry);
      return checked.ok ? [checked.template] : [];
    });
  } catch {
    return [];
  }
}

function writeStored(templates: readonly GraphicTemplate[]): boolean {
  try {
    const text = JSON.stringify(templates);
    if (text.length > MAX_STORED_CHARS) return false;
    localStorage.setItem(STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

interface GraphicTemplatesState {
  /** Templates the user saved or imported ("My templates"). */
  userTemplates: GraphicTemplate[];
  /** True when the last save did not reach localStorage (quota / private mode). */
  persistenceFailed: boolean;
  list: () => GraphicTemplate[];
  get: (id: string) => GraphicTemplate | undefined;
  save: (template: GraphicTemplate) => void;
  remove: (id: string) => void;
}

export const useGraphicTemplatesStore = create<GraphicTemplatesState>((set, get) => ({
  userTemplates: readStored(),
  persistenceFailed: false,
  list: () => [...BUILT_IN_GRAPHIC_TEMPLATES, ...get().userTemplates],
  get: (id) => get().list().find((template) => template.id === id),
  save: (template) => {
    const next = [...get().userTemplates.filter((item) => item.id !== template.id), template];
    set({ userTemplates: next, persistenceFailed: !writeStored(next) });
  },
  remove: (id) => {
    const next = get().userTemplates.filter((item) => item.id !== id);
    set({ userTemplates: next, persistenceFailed: !writeStored(next) });
  },
}));
