import { nanoid } from "nanoid";
import type { Behavior } from "../effect/scene";
import type { FilterDoc } from "./types";

export function emptyFilterDoc(): FilterDoc {
  return { name: "Untitled filter", sampleClipId: "portrait-closeup-01", adjustments: [] };
}

export function addAdjustment(doc: FilterDoc, adjustment: Behavior): FilterDoc {
  return { ...doc, adjustments: [...doc.adjustments, adjustment] };
}

export function removeAdjustment(doc: FilterDoc, id: string): FilterDoc {
  return { ...doc, adjustments: doc.adjustments.filter((a) => a.id !== id) };
}

export function moveAdjustment(doc: FilterDoc, fromIndex: number, toIndex: number): FilterDoc {
  const arr = [...doc.adjustments];
  const [moved] = arr.splice(fromIndex, 1);
  if (!moved) return doc;
  arr.splice(toIndex, 0, moved);
  return { ...doc, adjustments: arr };
}

export function setAdjustmentParam(doc: FilterDoc, id: string, key: string, value: unknown): FilterDoc {
  return {
    ...doc,
    adjustments: doc.adjustments.map((a) => (a.id === id ? { ...a, params: { ...a.params, [key]: value } } : a)),
  };
}

export function newAdjustmentId(): string {
  return nanoid(8);
}
