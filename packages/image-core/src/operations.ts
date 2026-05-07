import type {
  Artboard,
  CanvasBackground,
  CanvasSize,
  Layer,
  Project,
  Transform,
} from './project';
import { parseProject } from './schema';
import { migrateProject } from './migration';

export interface CreateProjectDocumentOptions {
  id: string;
  artboardId: string;
  name: string;
  size: CanvasSize;
  background?: CanvasBackground;
  timestamp?: number;
}

export interface DuplicateLayerResult {
  project: Project;
  duplicatedLayerId: string;
}

export interface DeserializeProjectResult {
  success: true;
  data: Project;
}

export interface DeserializeProjectError {
  success: false;
  error: string;
}

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

function touchProject(project: Project, timestamp = Date.now()): Project {
  project.updatedAt = timestamp;
  return project;
}

function findArtboard(project: Project, artboardId: string): Artboard | undefined {
  return project.artboards.find((artboard) => artboard.id === artboardId);
}

function removeLayerReferences(project: Project, layerId: string) {
  project.artboards.forEach((artboard) => {
    artboard.layerIds = artboard.layerIds.filter((id) => id !== layerId);
  });

  Object.values(project.layers).forEach((layer) => {
    if (layer.type === 'group') {
      layer.childIds = layer.childIds.filter((childId) => childId !== layerId);
    }
  });
}

function removeLayerTree(project: Project, layerId: string) {
  const layer = project.layers[layerId];
  if (!layer) {
    return;
  }

  if (layer.type === 'group') {
    layer.childIds.forEach((childId) => {
      removeLayerTree(project, childId);
    });
  }

  removeLayerReferences(project, layerId);
  delete project.layers[layerId];
}

function isLayerIdKnown(project: Project, layerId: string): boolean {
  return Object.prototype.hasOwnProperty.call(project.layers, layerId);
}

function safeAssign<T extends object>(target: T, source: Partial<T>) {
  for (const [key, value] of Object.entries(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }

    Reflect.set(target, key, value);
  }
}

export function createProjectDocument({
  id,
  artboardId,
  name,
  size,
  background,
  timestamp = Date.now(),
}: CreateProjectDocumentOptions): Project {
  return {
    id,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    artboards: [
      {
        id: artboardId,
        name: 'Artboard 1',
        size,
        background: background ?? { type: 'color', color: '#ffffff' },
        layerIds: [],
        position: { x: 0, y: 0 },
      },
    ],
    layers: {},
    assets: {},
    activeArtboardId: artboardId,
  };
}

export function addLayerToProject(
  project: Project,
  artboardId: string,
  layer: Layer,
  index = 0,
  timestamp = Date.now(),
): Project {
  const nextProject = cloneProject(project);
  const artboard = findArtboard(nextProject, artboardId);
  if (!artboard) {
    return nextProject;
  }

  nextProject.layers[layer.id] = structuredClone(layer);
  const insertionIndex = Math.max(0, Math.min(index, artboard.layerIds.length));
  artboard.layerIds.splice(insertionIndex, 0, layer.id);
  return touchProject(nextProject, timestamp);
}

export function removeLayerFromProject(
  project: Project,
  layerId: string,
  timestamp = Date.now(),
): Project {
  if (!isLayerIdKnown(project, layerId)) {
    return project;
  }

  const nextProject = cloneProject(project);
  removeLayerTree(nextProject, layerId);
  return touchProject(nextProject, timestamp);
}

export function duplicateLayerInProject(
  project: Project,
  artboardId: string,
  layerId: string,
  duplicatedLayerId: string,
  offset: Pick<Transform, 'x' | 'y'> = { x: 20, y: 20 },
  timestamp = Date.now(),
): DuplicateLayerResult | null {
  const artboard = findArtboard(project, artboardId);
  const layer = project.layers[layerId];
  if (!artboard || !layer) {
    return null;
  }

  const nextProject = cloneProject(project);
  const nextArtboard = findArtboard(nextProject, artboardId);
  if (!nextArtboard) {
    return null;
  }

  const duplicatedLayer = structuredClone(layer);
  duplicatedLayer.id = duplicatedLayerId;
  duplicatedLayer.name = `${layer.name} copy`;
  duplicatedLayer.transform.x += offset.x;
  duplicatedLayer.transform.y += offset.y;
  nextProject.layers[duplicatedLayerId] = duplicatedLayer;

  const originalIndex = nextArtboard.layerIds.indexOf(layerId);
  nextArtboard.layerIds.splice(Math.max(originalIndex, 0), 0, duplicatedLayerId);

  return {
    project: touchProject(nextProject, timestamp),
    duplicatedLayerId,
  };
}

export function reorderArtboardLayers(
  project: Project,
  artboardId: string,
  layerIds: string[],
  timestamp = Date.now(),
): Project {
  const nextProject = cloneProject(project);
  const artboard = findArtboard(nextProject, artboardId);
  if (!artboard) {
    return nextProject;
  }

  artboard.layerIds = [...layerIds];
  return touchProject(nextProject, timestamp);
}

export function renameLayer(
  project: Project,
  layerId: string,
  name: string,
  timestamp = Date.now(),
): Project {
  const nextProject = cloneProject(project);
  const layer = nextProject.layers[layerId];
  if (!layer) {
    return nextProject;
  }

  layer.name = name;
  return touchProject(nextProject, timestamp);
}

export function setLayerLocked(
  project: Project,
  layerId: string,
  locked: boolean,
  timestamp = Date.now(),
): Project {
  const nextProject = cloneProject(project);
  const layer = nextProject.layers[layerId];
  if (!layer) {
    return nextProject;
  }

  layer.locked = locked;
  return touchProject(nextProject, timestamp);
}

export function setLayerVisible(
  project: Project,
  layerId: string,
  visible: boolean,
  timestamp = Date.now(),
): Project {
  const nextProject = cloneProject(project);
  const layer = nextProject.layers[layerId];
  if (!layer) {
    return nextProject;
  }

  layer.visible = visible;
  return touchProject(nextProject, timestamp);
}

export function updateLayerTransformInProject(
  project: Project,
  layerId: string,
  transform: Partial<Transform>,
  timestamp = Date.now(),
): Project {
  const nextProject = cloneProject(project);
  const layer = nextProject.layers[layerId];
  if (!layer) {
    return nextProject;
  }

  safeAssign(layer.transform, transform);
  return touchProject(nextProject, timestamp);
}

export function updateLayerInProject<T extends Layer>(
  project: Project,
  layerId: string,
  updates: Partial<T>,
  timestamp = Date.now(),
): Project {
  const nextProject = cloneProject(project);
  const layer = nextProject.layers[layerId];
  if (!layer) {
    return nextProject;
  }

  safeAssign(layer, updates);
  return touchProject(nextProject, timestamp);
}

export function validateLayerTree(project: Project): string[] {
  const issues: string[] = [];
  const artboardIds = new Set(project.artboards.map((artboard) => artboard.id));

  if (project.activeArtboardId !== null && !artboardIds.has(project.activeArtboardId)) {
    issues.push(`Active artboard "${project.activeArtboardId}" does not exist.`);
  }

  const artboardMembership = new Map<string, string>();

  const visitLayer = (layerId: string, artboardId: string, stack: string[]) => {
    if (stack.includes(layerId)) {
      issues.push(`Layer cycle detected: ${[...stack, layerId].join(' -> ')}.`);
      return;
    }

    const layer = project.layers[layerId];
    if (!layer) {
      issues.push(`Layer "${layerId}" is referenced by artboard "${artboardId}" but missing.`);
      return;
    }

    const existingOwner = artboardMembership.get(layerId);
    if (existingOwner && existingOwner !== artboardId) {
      issues.push(`Layer "${layerId}" belongs to multiple artboards: "${existingOwner}" and "${artboardId}".`);
    } else {
      artboardMembership.set(layerId, artboardId);
    }

    if (layer.parentId !== null) {
      const parent = project.layers[layer.parentId];
      if (!parent) {
        issues.push(`Layer "${layerId}" points to missing parent "${layer.parentId}".`);
      } else if (parent.type !== 'group') {
        issues.push(`Layer "${layerId}" parent "${layer.parentId}" is not a group.`);
      } else if (!parent.childIds.includes(layerId)) {
        issues.push(`Group "${parent.id}" is missing child reference for layer "${layerId}".`);
      }
    }

    if (layer.type === 'group') {
      layer.childIds.forEach((childId) => {
        const child = project.layers[childId];
        if (!child) {
          issues.push(`Group "${layer.id}" references missing child "${childId}".`);
          return;
        }

        if (child.parentId !== layer.id) {
          issues.push(`Child "${childId}" does not point back to parent group "${layer.id}".`);
        }

        visitLayer(childId, artboardId, [...stack, layerId]);
      });
    }
  };

  project.artboards.forEach((artboard) => {
    artboard.layerIds.forEach((layerId) => {
      visitLayer(layerId, artboard.id, []);
    });
  });

  Object.values(project.layers).forEach((layer) => {
    if (!artboardMembership.has(layer.id) && layer.parentId === null) {
      issues.push(`Root layer "${layer.id}" is not attached to any artboard.`);
    }
  });

  return issues;
}

export function serializeProject(project: Project): string {
  const issues = validateLayerTree(project);
  if (issues.length > 0) {
    throw new Error(`Invalid project document: ${issues.join(' ')}`);
  }

  return JSON.stringify(project);
}

export function deserializeProject(raw: string | Record<string, unknown>): DeserializeProjectResult | DeserializeProjectError {
  let parsedValue: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsedValue = JSON.parse(raw);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to parse project JSON.',
      };
    }
  }

  const migrated = migrateProject(parsedValue as Record<string, unknown>);
  const parsed = parseProject(migrated);
  if (!parsed.success) {
    return parsed;
  }

  const issues = validateLayerTree(parsed.data);
  if (issues.length > 0) {
    return {
      success: false,
      error: issues.join(' '),
    };
  }

  return {
    success: true,
    data: parsed.data,
  };
}
