import type { Artboard, GroupLayer, Layer, Project, TextStyle, Transform } from './project';
import type { LayerMask } from './mask';
import {
  addLayerToProject,
  removeLayerFromProject,
  reorderArtboardLayers,
  updateLayerInProject,
  updateLayerTransformInProject,
} from './operations';

// ---------------------------------------------------------------------------
// Command interface
// ---------------------------------------------------------------------------

/**
 * A reversible editing operation.  Each command captures enough data to both
 * apply itself and to construct an exact inverse command so that undo/redo is
 * always correct.  The optional `merge` method allows consecutive commands of
 * the same type on the same target (e.g. dragging) to be coalesced into a
 * single undo step.
 */
export interface Command {
  readonly type: string;
  readonly description: string;
  apply(project: Project): Project;
  invert(): Command;
  merge?(next: Command): Command | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

function findArtboardIndex(project: Project, artboardId: string): number {
  return project.artboards.findIndex((a) => a.id === artboardId);
}

function findLayerIndexInArtboard(project: Project, artboardId: string, layerId: string): number {
  const artboard = project.artboards.find((a) => a.id === artboardId);
  return artboard ? artboard.layerIds.indexOf(layerId) : -1;
}

// ---------------------------------------------------------------------------
// Project-level commands
// ---------------------------------------------------------------------------

export class SetProjectNameCommand implements Command {
  readonly type = 'SetProjectName';

  constructor(
    private readonly newName: string,
    private readonly prevName: string,
  ) {}

  get description(): string {
    return `Rename project to "${this.newName}"`;
  }

  apply(project: Project): Project {
    const next = cloneProject(project);
    next.name = this.newName;
    next.updatedAt = Date.now();
    return next;
  }

  invert(): Command {
    return new SetProjectNameCommand(this.prevName, this.newName);
  }
}

// ---------------------------------------------------------------------------
// Artboard commands
// ---------------------------------------------------------------------------

export class AddArtboardCommand implements Command {
  readonly type = 'AddArtboard';

  constructor(
    private readonly artboard: Artboard,
    private readonly insertIndex?: number,
  ) {}

  get description(): string {
    return `Add artboard "${this.artboard.name}"`;
  }

  apply(project: Project): Project {
    const next = cloneProject(project);
    const idx = this.insertIndex ?? next.artboards.length;
    next.artboards.splice(idx, 0, structuredClone(this.artboard));
    next.updatedAt = Date.now();
    return next;
  }

  invert(): Command {
    return new RemoveArtboardCommand(
      this.artboard.id,
      this.artboard,
      {},
      this.insertIndex ?? -1,
    );
  }
}

export class RemoveArtboardCommand implements Command {
  readonly type = 'RemoveArtboard';

  constructor(
    private readonly artboardId: string,
    private readonly artboard: Artboard,
    private readonly removedLayers: Record<string, Layer>,
    private readonly originalIndex: number,
  ) {}

  get description(): string {
    return `Remove artboard "${this.artboard.name}"`;
  }

  apply(project: Project): Project {
    const next = cloneProject(project);
    const artboard = next.artboards.find((a) => a.id === this.artboardId);
    if (artboard) {
      artboard.layerIds.forEach((id) => {
        delete next.layers[id];
      });
      next.artboards = next.artboards.filter((a) => a.id !== this.artboardId);
      if (next.activeArtboardId === this.artboardId) {
        next.activeArtboardId = next.artboards[0]?.id ?? null;
      }
      next.updatedAt = Date.now();
    }
    return next;
  }

  invert(): Command {
    const restoredArtboard = structuredClone(this.artboard);
    const restoredLayers = structuredClone(this.removedLayers);
    return new RestoreArtboardCommand(restoredArtboard, restoredLayers, this.originalIndex);
  }
}

/** Internal command used only as the inverse of RemoveArtboardCommand. */
class RestoreArtboardCommand implements Command {
  readonly type = 'RestoreArtboard';

  constructor(
    private readonly artboard: Artboard,
    private readonly layers: Record<string, Layer>,
    private readonly insertIndex: number,
  ) {}

  get description(): string {
    return `Restore artboard "${this.artboard.name}"`;
  }

  apply(project: Project): Project {
    const next = cloneProject(project);
    const idx = this.insertIndex >= 0 ? this.insertIndex : next.artboards.length;
    next.artboards.splice(idx, 0, structuredClone(this.artboard));
    Object.entries(this.layers).forEach(([id, layer]) => {
      next.layers[id] = structuredClone(layer);
    });
    next.updatedAt = Date.now();
    return next;
  }

  invert(): Command {
    return new RemoveArtboardCommand(
      this.artboard.id,
      this.artboard,
      this.layers,
      this.insertIndex,
    );
  }
}

export class UpdateArtboardCommand implements Command {
  readonly type = 'UpdateArtboard';

  constructor(
    private readonly artboardId: string,
    private readonly updates: Partial<Artboard>,
    private readonly prevValues: Partial<Artboard>,
    private readonly descriptionText?: string,
  ) {}

  get description(): string {
    return this.descriptionText ?? 'Update artboard';
  }

  apply(project: Project): Project {
    const next = cloneProject(project);
    const artboard = next.artboards.find((a) => a.id === this.artboardId);
    if (artboard) {
      Object.assign(artboard, this.updates);
      next.updatedAt = Date.now();
    }
    return next;
  }

  invert(): Command {
    return new UpdateArtboardCommand(
      this.artboardId,
      this.prevValues,
      this.updates,
      `Undo ${this.description.toLowerCase()}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Layer commands
// ---------------------------------------------------------------------------

export class AddLayerCommand implements Command {
  readonly type = 'AddLayer';

  constructor(
    private readonly artboardId: string,
    private readonly layer: Layer,
    private readonly index: number,
    private readonly descriptionText?: string,
  ) {}

  get description(): string {
    return this.descriptionText ?? `Add ${this.layer.type} layer "${this.layer.name}"`;
  }

  apply(project: Project): Project {
    return addLayerToProject(project, this.artboardId, structuredClone(this.layer), this.index);
  }

  invert(): Command {
    return new RemoveLayerCommand(
      this.layer.id,
      this.artboardId,
      structuredClone(this.layer),
      this.index,
      `Remove ${this.layer.type} layer "${this.layer.name}"`,
    );
  }
}

export class RemoveLayerCommand implements Command {
  readonly type = 'RemoveLayer';

  constructor(
    private readonly layerId: string,
    private readonly artboardId: string,
    private readonly layer: Layer,
    private readonly originalIndex: number,
    private readonly descriptionText?: string,
  ) {}

  get description(): string {
    return this.descriptionText ?? `Remove layer "${this.layer.name}"`;
  }

  apply(project: Project): Project {
    return removeLayerFromProject(project, this.layerId);
  }

  invert(): Command {
    return new AddLayerCommand(
      this.artboardId,
      structuredClone(this.layer),
      this.originalIndex,
      `Restore layer "${this.layer.name}"`,
    );
  }
}

export class DuplicateLayerCommand implements Command {
  readonly type = 'DuplicateLayer';

  constructor(
    private readonly artboardId: string,
    private readonly duplicatedLayer: Layer,
    private readonly insertIndex: number,
  ) {}

  get description(): string {
    return `Duplicate layer "${this.duplicatedLayer.name}"`;
  }

  apply(project: Project): Project {
    return addLayerToProject(
      project,
      this.artboardId,
      structuredClone(this.duplicatedLayer),
      this.insertIndex,
    );
  }

  invert(): Command {
    return new RemoveLayerCommand(
      this.duplicatedLayer.id,
      this.artboardId,
      structuredClone(this.duplicatedLayer),
      this.insertIndex,
      `Remove duplicate "${this.duplicatedLayer.name}"`,
    );
  }
}

export class ReorderLayerCommand implements Command {
  readonly type = 'ReorderLayer';

  constructor(
    private readonly artboardId: string,
    private readonly newLayerIds: string[],
    private readonly prevLayerIds: string[],
    private readonly descriptionText?: string,
  ) {}

  get description(): string {
    return this.descriptionText ?? 'Reorder layers';
  }

  apply(project: Project): Project {
    return reorderArtboardLayers(project, this.artboardId, this.newLayerIds);
  }

  invert(): Command {
    return new ReorderLayerCommand(this.artboardId, this.prevLayerIds, this.newLayerIds, 'Undo reorder');
  }
}

export class UpdateLayerTransformCommand implements Command {
  readonly type = 'UpdateLayerTransform';

  constructor(
    private readonly layerId: string,
    private readonly newTransform: Partial<Transform>,
    private readonly prevTransform: Partial<Transform>,
    private readonly descriptionText?: string,
  ) {}

  get description(): string {
    return this.descriptionText ?? 'Move/resize layer';
  }

  apply(project: Project): Project {
    return updateLayerTransformInProject(project, this.layerId, this.newTransform);
  }

  invert(): Command {
    return new UpdateLayerTransformCommand(
      this.layerId,
      this.prevTransform,
      this.newTransform,
      `Undo ${this.description.toLowerCase()}`,
    );
  }

  merge(next: Command): Command | null {
    if (!(next instanceof UpdateLayerTransformCommand)) return null;
    if (next.layerId !== this.layerId) return null;
    return new UpdateLayerTransformCommand(
      this.layerId,
      next.newTransform,
      this.prevTransform,
      next.descriptionText ?? this.descriptionText,
    );
  }
}

export class UpdateLayerStyleCommand implements Command {
  readonly type = 'UpdateLayerStyle';

  constructor(
    private readonly layerId: string,
    private readonly updates: Partial<Layer>,
    private readonly prevValues: Partial<Layer>,
    private readonly descriptionText?: string,
  ) {}

  get description(): string {
    return this.descriptionText ?? 'Update layer style';
  }

  apply(project: Project): Project {
    return updateLayerInProject(project, this.layerId, this.updates);
  }

  invert(): Command {
    return new UpdateLayerStyleCommand(
      this.layerId,
      this.prevValues,
      this.updates,
      `Undo ${this.description.toLowerCase()}`,
    );
  }

  merge(next: Command): Command | null {
    if (!(next instanceof UpdateLayerStyleCommand)) return null;
    if (next.layerId !== this.layerId) return null;
    const mergedUpdates = { ...this.updates, ...next.updates };
    const mergedPrev = { ...next.prevValues, ...this.prevValues };
    return new UpdateLayerStyleCommand(
      this.layerId,
      mergedUpdates,
      mergedPrev,
      next.descriptionText ?? this.descriptionText,
    );
  }
}

export class UpdateTextCommand implements Command {
  readonly type = 'UpdateText';

  constructor(
    private readonly layerId: string,
    private readonly newContent: string,
    private readonly prevContent: string,
    private readonly newStyle: TextStyle | null,
    private readonly prevStyle: TextStyle | null,
  ) {}

  get description(): string {
    return 'Edit text';
  }

  apply(project: Project): Project {
    const updates: Record<string, unknown> = { content: this.newContent };
    if (this.newStyle !== null) updates.style = this.newStyle;
    return updateLayerInProject(project, this.layerId, updates as Partial<Layer>);
  }

  invert(): Command {
    return new UpdateTextCommand(
      this.layerId,
      this.prevContent,
      this.newContent,
      this.prevStyle,
      this.newStyle,
    );
  }

  merge(next: Command): Command | null {
    if (!(next instanceof UpdateTextCommand)) return null;
    if (next.layerId !== this.layerId) return null;
    return new UpdateTextCommand(
      this.layerId,
      next.newContent,
      this.prevContent,
      next.newStyle,
      this.prevStyle,
    );
  }
}

export class ApplyAdjustmentCommand implements Command {
  readonly type = 'ApplyAdjustment';

  constructor(
    private readonly layerId: string,
    private readonly adjustmentKey: string,
    private readonly newValue: unknown,
    private readonly prevValue: unknown,
  ) {}

  get description(): string {
    return `Adjust ${this.adjustmentKey}`;
  }

  apply(project: Project): Project {
    return updateLayerInProject(project, this.layerId, {
      [this.adjustmentKey]: this.newValue,
    } as Partial<Layer>);
  }

  invert(): Command {
    return new ApplyAdjustmentCommand(
      this.layerId,
      this.adjustmentKey,
      this.prevValue,
      this.newValue,
    );
  }

  merge(next: Command): Command | null {
    if (!(next instanceof ApplyAdjustmentCommand)) return null;
    if (next.layerId !== this.layerId) return null;
    if (next.adjustmentKey !== this.adjustmentKey) return null;
    return new ApplyAdjustmentCommand(
      this.layerId,
      this.adjustmentKey,
      next.newValue,
      this.prevValue,
    );
  }
}

export class ApplyMaskCommand implements Command {
  readonly type = 'ApplyMask';

  constructor(
    private readonly layerId: string,
    private readonly newMask: LayerMask | null,
    private readonly prevMask: LayerMask | null,
  ) {}

  get description(): string {
    return this.newMask ? 'Apply mask' : 'Remove mask';
  }

  apply(project: Project): Project {
    return updateLayerInProject(project, this.layerId, { mask: this.newMask } as Partial<Layer>);
  }

  invert(): Command {
    return new ApplyMaskCommand(this.layerId, this.prevMask, this.newMask);
  }
}

/**
 * RasterEdit captures a full serialized snapshot of the affected layer for
 * large pixel-level edits where computing an inverse analytically is not
 * practical.  The inverse simply restores the layer to its pre-edit state.
 */
export class RasterEditCommand implements Command {
  readonly type = 'RasterEdit';

  constructor(
    private readonly layerId: string,
    private readonly artboardId: string,
    private readonly afterLayerJson: string,
    private readonly beforeLayerJson: string,
    private readonly descriptionText = 'Raster edit',
  ) {}

  get description(): string {
    return this.descriptionText;
  }

  apply(project: Project): Project {
    const next = cloneProject(project);
    next.layers[this.layerId] = JSON.parse(this.afterLayerJson) as Layer;
    next.updatedAt = Date.now();
    return next;
  }

  invert(): Command {
    return new RasterEditCommand(
      this.layerId,
      this.artboardId,
      this.beforeLayerJson,
      this.afterLayerJson,
      `Undo ${this.descriptionText.toLowerCase()}`,
    );
  }
}

/**
 * GroupLayersCommand groups several layers under a new group layer.
 * It stores enough state to restore the original flat arrangement on undo.
 */
export class GroupLayersCommand implements Command {
  readonly type = 'GroupLayers';

  constructor(
    private readonly artboardId: string,
    private readonly groupLayer: GroupLayer,
    private readonly groupInsertIndex: number,
    private readonly prevArtboardLayerIds: string[],
    private readonly childLayersBefore: Record<string, Layer>,
  ) {}

  get description(): string {
    return `Group ${Object.keys(this.childLayersBefore).length} layers`;
  }

  apply(project: Project): Project {
    const next = cloneProject(project);
    const artboard = next.artboards.find((a) => a.id === this.artboardId);
    if (!artboard) return next;
    const { childIds } = this.groupLayer;
    childIds.forEach((childId) => {
      if (next.layers[childId]) {
        const childBefore = this.childLayersBefore[childId];
        next.layers[childId] = {
          ...next.layers[childId],
          ...(childBefore ? structuredClone(childBefore) : {}),
          parentId: this.groupLayer.id,
        };
      }
    });
    artboard.layerIds = artboard.layerIds.filter((id) => !childIds.includes(id));
    next.layers[this.groupLayer.id] = structuredClone(this.groupLayer);
    artboard.layerIds.splice(this.groupInsertIndex, 0, this.groupLayer.id);
    next.updatedAt = Date.now();
    return next;
  }

  invert(): Command {
    return new UngroupLayersCommand(
      this.artboardId,
      this.groupLayer.id,
      this.groupLayer,
      this.prevArtboardLayerIds,
      this.childLayersBefore,
    );
  }
}

export class UngroupLayersCommand implements Command {
  readonly type = 'UngroupLayers';

  constructor(
    private readonly artboardId: string,
    private readonly groupId: string,
    private readonly groupLayer: GroupLayer,
    private readonly prevArtboardLayerIds: string[],
    private readonly childLayersBefore: Record<string, Layer>,
  ) {}

  get description(): string {
    return 'Ungroup layers';
  }

  apply(project: Project): Project {
    const next = cloneProject(project);
    const artboard = next.artboards.find((a) => a.id === this.artboardId);
    if (!artboard) return next;
    const group = next.layers[this.groupId] as GroupLayer;
    if (!group || group.type !== 'group') return next;
    const groupIndex = artboard.layerIds.indexOf(this.groupId);
    const { x: groupX, y: groupY } = group.transform;
    group.childIds.forEach((childId) => {
      const child = next.layers[childId];
      if (child) {
        child.transform.x += groupX;
        child.transform.y += groupY;
        child.parentId = null;
      }
    });
    artboard.layerIds.splice(groupIndex, 1, ...group.childIds);
    delete next.layers[this.groupId];
    next.updatedAt = Date.now();
    return next;
  }

  invert(): Command {
    const { childIds } = this.groupLayer;
    return new GroupLayersCommand(
      this.artboardId,
      structuredClone(this.groupLayer),
      this.prevArtboardLayerIds.indexOf(this.groupId),
      this.prevArtboardLayerIds,
      Object.fromEntries(
        childIds.map((id) => [id, structuredClone(this.childLayersBefore[id])]),
      ),
    );
  }
}

export class PasteLayersCommand implements Command {
  readonly type = 'PasteLayers';

  constructor(
    private readonly artboardId: string,
    private readonly pastedLayers: Layer[],
    private readonly prevArtboardLayerIds: string[],
  ) {}

  get description(): string {
    return `Paste ${this.pastedLayers.length} layer${this.pastedLayers.length !== 1 ? 's' : ''}`;
  }

  apply(project: Project): Project {
    let next = cloneProject(project);
    const artboard = next.artboards.find((a) => a.id === this.artboardId);
    if (!artboard) return next;
    this.pastedLayers.forEach((layer) => {
      next.layers[layer.id] = structuredClone(layer);
      artboard.layerIds.unshift(layer.id);
    });
    next.updatedAt = Date.now();
    return next;
  }

  invert(): Command {
    const layerIds = this.pastedLayers.map((l) => l.id);
    return new RemovePastedLayersCommand(
      this.artboardId,
      layerIds,
      this.pastedLayers,
      this.prevArtboardLayerIds,
    );
  }
}

class RemovePastedLayersCommand implements Command {
  readonly type = 'RemovePastedLayers';

  constructor(
    private readonly artboardId: string,
    private readonly layerIds: string[],
    private readonly layers: Layer[],
    private readonly prevArtboardLayerIds: string[],
  ) {}

  get description(): string {
    return `Undo paste ${this.layers.length} layer${this.layers.length !== 1 ? 's' : ''}`;
  }

  apply(project: Project): Project {
    let next = cloneProject(project);
    this.layerIds.forEach((id) => {
      next = removeLayerFromProject(next, id);
    });
    return next;
  }

  invert(): Command {
    return new PasteLayersCommand(this.artboardId, this.layers, this.prevArtboardLayerIds);
  }
}

// ---------------------------------------------------------------------------
// Lookup table for history panel icons / display grouping
// ---------------------------------------------------------------------------

export const COMMAND_DISPLAY_INFO: Record<string, { icon: string; category: string }> = {
  SetProjectName: { icon: 'pencil', category: 'Project' },
  AddArtboard: { icon: 'layout', category: 'Artboard' },
  RemoveArtboard: { icon: 'layout', category: 'Artboard' },
  RestoreArtboard: { icon: 'layout', category: 'Artboard' },
  UpdateArtboard: { icon: 'layout', category: 'Artboard' },
  AddLayer: { icon: 'plus', category: 'Layer' },
  RemoveLayer: { icon: 'trash', category: 'Layer' },
  DuplicateLayer: { icon: 'copy', category: 'Layer' },
  ReorderLayer: { icon: 'move', category: 'Layer' },
  UpdateLayerTransform: { icon: 'move', category: 'Transform' },
  UpdateLayerStyle: { icon: 'sliders', category: 'Style' },
  UpdateText: { icon: 'type', category: 'Text' },
  ApplyAdjustment: { icon: 'sliders', category: 'Adjustment' },
  ApplyMask: { icon: 'scissors', category: 'Mask' },
  RasterEdit: { icon: 'image', category: 'Paint' },
  GroupLayers: { icon: 'folder', category: 'Layer' },
  UngroupLayers: { icon: 'folder-open', category: 'Layer' },
  PasteLayers: { icon: 'clipboard', category: 'Layer' },
  RemovePastedLayers: { icon: 'clipboard', category: 'Layer' },
};

// Re-export helpers used by callers that capture "before" data
export { findArtboardIndex, findLayerIndexInArtboard };
