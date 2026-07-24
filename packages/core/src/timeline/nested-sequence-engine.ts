import type { Clip, Track, Transform } from "../types/timeline";

export interface CompoundClipContent {
  clips: Clip[];
  tracks: Track[];
  duration: number;
}

export interface CompoundClip {
  id: string;
  name: string;
  content: CompoundClipContent;
  createdAt: number;
  modifiedAt: number;
  color: string;
}

export interface CompoundClipInstance {
  id: string;
  compoundClipId: string;
  trackId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  transform: Transform;
  volume: number;
}

export interface CreateCompoundClipOptions {
  name?: string;
  color?: string;
}

export interface FlattenResult {
  clips: Clip[];
  trackId: string;
  startTime: number;
}

const COMPOUND_COLORS = [
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#eab308",
  "#ef4444",
];

function generateId(): string {
  return `compound_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export class NestedSequenceEngine {
  private compoundClips: Map<string, CompoundClip> = new Map();
  private instances: Map<string, CompoundClipInstance> = new Map();
  private instancesByCompound: Map<string, Set<string>> = new Map();
  private colorIndex = 0;

  createCompoundClip(
    clips: Clip[],
    tracks: Track[],
    options: CreateCompoundClipOptions = {},
  ): CompoundClip {
    if (clips.length === 0) {
      throw new Error("Cannot create compound clip from empty selection");
    }

    const minStartTime = Math.min(...clips.map((c) => c.startTime));
    const maxEndTime = Math.max(...clips.map((c) => c.startTime + c.duration));
    const duration = maxEndTime - minStartTime;

    const normalizedClips = clips.map((clip) => ({
      ...clip,
      startTime: clip.startTime - minStartTime,
    }));

    const relevantTrackIds = new Set(clips.map((c) => c.trackId));
    const normalizedById = new Map(normalizedClips.map((clip) => [clip.id, clip]));
    const relevantTracks = tracks
      .filter((track) => relevantTrackIds.has(track.id))
      .map((track) => ({
        ...track,
        clips: track.clips
          .filter((clip) => normalizedById.has(clip.id))
          .map((clip) => normalizedById.get(clip.id)!),
        transitions: track.transitions.filter(
          (transition) =>
            normalizedById.has(transition.clipAId) &&
            (!transition.clipBId || normalizedById.has(transition.clipBId)),
        ),
      }));

    const compound: CompoundClip = {
      id: generateId(),
      name: options.name || `Compound Clip ${this.compoundClips.size + 1}`,
      content: {
        clips: normalizedClips,
        tracks: relevantTracks,
        duration,
      },
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      color:
        options.color ||
        COMPOUND_COLORS[this.colorIndex++ % COMPOUND_COLORS.length],
    };

    this.compoundClips.set(compound.id, compound);
    this.instancesByCompound.set(compound.id, new Set());

    return compound;
  }

  getCompoundClip(id: string): CompoundClip | undefined {
    return this.compoundClips.get(id);
  }

  getAllCompoundClips(): CompoundClip[] {
    return Array.from(this.compoundClips.values());
  }

  updateCompoundClip(id: string, content: CompoundClipContent): boolean {
    const compound = this.compoundClips.get(id);
    if (!compound) return false;

    this.compoundClips.set(id, {
      ...compound,
      content,
      modifiedAt: Date.now(),
    });

    return true;
  }

  renameCompoundClip(id: string, name: string): boolean {
    const compound = this.compoundClips.get(id);
    if (!compound) return false;

    this.compoundClips.set(id, {
      ...compound,
      name,
      modifiedAt: Date.now(),
    });

    return true;
  }

  deleteCompoundClip(id: string): boolean {
    const instances = this.instancesByCompound.get(id);
    if (instances && instances.size > 0) {
      return false;
    }

    this.instancesByCompound.delete(id);
    return this.compoundClips.delete(id);
  }

  createInstance(
    compoundClipId: string,
    trackId: string,
    startTime: number,
  ): CompoundClipInstance | null {
    const compound = this.compoundClips.get(compoundClipId);
    if (!compound) return null;

    const instance: CompoundClipInstance = {
      id: `instance_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      compoundClipId,
      trackId,
      startTime,
      duration: compound.content.duration,
      inPoint: 0,
      outPoint: compound.content.duration,
      transform: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        anchor: { x: 0.5, y: 0.5 },
        opacity: 1,
      },
      volume: 1,
    };

    this.instances.set(instance.id, instance);
    this.instancesByCompound.get(compoundClipId)?.add(instance.id);

    return instance;
  }

  getInstance(id: string): CompoundClipInstance | undefined {
    return this.instances.get(id);
  }

  getInstancesForCompound(compoundClipId: string): CompoundClipInstance[] {
    const instanceIds = this.instancesByCompound.get(compoundClipId);
    if (!instanceIds) return [];

    return Array.from(instanceIds)
      .map((id) => this.instances.get(id))
      .filter(
        (instance): instance is CompoundClipInstance => instance !== undefined,
      );
  }

  getAllInstances(): CompoundClipInstance[] {
    return Array.from(this.instances.values());
  }

  loadState(
    compoundClips: CompoundClip[],
    instances: CompoundClipInstance[],
  ): void {
    this.compoundClips.clear();
    this.instances.clear();
    this.instancesByCompound.clear();
    for (const clip of compoundClips) {
      this.compoundClips.set(clip.id, clip);
    }
    for (const instance of instances) {
      this.instances.set(instance.id, instance);
      if (!this.instancesByCompound.has(instance.compoundClipId)) {
        this.instancesByCompound.set(instance.compoundClipId, new Set());
      }
      this.instancesByCompound.get(instance.compoundClipId)!.add(instance.id);
    }
  }

  updateInstance(id: string, updates: Partial<CompoundClipInstance>): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    this.instances.set(id, {
      ...instance,
      ...updates,
      id: instance.id,
      compoundClipId: instance.compoundClipId,
    });

    return true;
  }

  deleteInstance(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    this.instancesByCompound.get(instance.compoundClipId)?.delete(id);
    return this.instances.delete(id);
  }

  flattenInstance(instanceId: string): FlattenResult | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;

    const compound = this.compoundClips.get(instance.compoundClipId);
    if (!compound) return null;

    const flattenedClips = compound.content.clips.map((clip) => ({
      ...clip,
      id: `flat_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      startTime: instance.startTime + clip.startTime,
      trackId: instance.trackId,
    }));

    this.deleteInstance(instanceId);

    return {
      clips: flattenedClips,
      trackId: instance.trackId,
      startTime: instance.startTime,
    };
  }

  duplicateCompoundClip(id: string, newName?: string): CompoundClip | null {
    const original = this.compoundClips.get(id);
    if (!original) return null;

    const duplicate: CompoundClip = {
      ...original,
      id: generateId(),
      name: newName || `${original.name} (Copy)`,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };

    this.compoundClips.set(duplicate.id, duplicate);
    this.instancesByCompound.set(duplicate.id, new Set());

    return duplicate;
  }

  getCompoundClipForInstance(instanceId: string): CompoundClip | undefined {
    const instance = this.instances.get(instanceId);
    if (!instance) return undefined;
    return this.compoundClips.get(instance.compoundClipId);
  }

  getInstanceCount(compoundClipId: string): number {
    return this.instancesByCompound.get(compoundClipId)?.size || 0;
  }

  clearAll(): void {
    this.compoundClips.clear();
    this.instances.clear();
    this.instancesByCompound.clear();
    this.colorIndex = 0;
  }
}

let nestedSequenceEngineInstance: NestedSequenceEngine | null = null;

export function getNestedSequenceEngine(): NestedSequenceEngine {
  if (!nestedSequenceEngineInstance) {
    nestedSequenceEngineInstance = new NestedSequenceEngine();
  }
  return nestedSequenceEngineInstance;
}

export function resetNestedSequenceEngine(): void {
  nestedSequenceEngineInstance = null;
}
