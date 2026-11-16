import { useUIStore } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";

/** Drag payloads between Project-panel items, bins and breadcrumb segments. */
export const MEDIA_IDS_MIME = "application/x-openreel-media-ids";
export const BIN_IDS_MIME = "application/x-openreel-bin-ids";
export const SEQUENCE_IDS_MIME = "application/x-openreel-sequence-ids";

export interface DragPayload {
  mediaIds: string[];
  binIds: string[];
  sequenceIds: string[];
}

export function hasPanelPayload(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types);
  return types.includes(MEDIA_IDS_MIME) || types.includes(BIN_IDS_MIME) || types.includes(SEQUENCE_IDS_MIME);
}

export function readPanelPayload(dt: DataTransfer): DragPayload {
  const parse = (mime: string): string[] => {
    try {
      const value = JSON.parse(dt.getData(mime) || "[]");
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  };
  return { mediaIds: parse(MEDIA_IDS_MIME), binIds: parse(BIN_IDS_MIME), sequenceIds: parse(SEQUENCE_IDS_MIME) };
}

/** Media ids to drag from one item: the whole selection when the item is in it. */
export function mediaIdsForDrag(itemId: string): string[] {
  const library = new Set(useProjectStore.getState().project.mediaLibrary.items.map((i) => i.id));
  const selected = useUIStore.getState().selectedItems.map((s) => s.id).filter((id) => library.has(id));
  return selected.includes(itemId) ? selected : [itemId];
}

export function writeMediaDrag(dt: DataTransfer, itemId: string): void {
  dt.setData(MEDIA_IDS_MIME, JSON.stringify(mediaIdsForDrag(itemId)));
}

export function writeBinDrag(dt: DataTransfer, binId: string, selectedBinIds: readonly string[]): void {
  const ids = selectedBinIds.includes(binId) ? [...selectedBinIds] : [binId];
  dt.setData(BIN_IDS_MIME, JSON.stringify(ids));
  dt.effectAllowed = "move";
}
