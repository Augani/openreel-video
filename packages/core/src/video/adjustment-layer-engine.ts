import type { Effect, Transform } from "../types/timeline";
import type { BlendMode } from "./types";

export type { BlendMode };

export interface AdjustmentLayer {
  id: string;
  trackId: string;
  name: string;
  startTime: number;
  duration: number;
  effects: Effect[];
  opacity: number;
  blendMode: BlendMode;
  enabled: boolean;
  affectedTracks: string[] | "all";
  transform: Transform;
}

export interface CreateAdjustmentLayerOptions {
  name?: string;
  duration?: number;
  opacity?: number;
  blendMode?: BlendMode;
  effects?: Effect[];
}

export interface AdjustmentLayerEffect {
  layerId: string;
  effect: Effect;
  opacity: number;
  blendMode: BlendMode;
}

const BLEND_MODE_INFO: Record<
  BlendMode,
  { name: string; description: string }
> = {
  normal: { name: "Normal", description: "Standard blending" },
  multiply: { name: "Multiply", description: "Darkens by multiplying colors" },
  screen: { name: "Screen", description: "Lightens by screening colors" },
  overlay: { name: "Overlay", description: "Combines multiply and screen" },
  darken: { name: "Darken", description: "Keeps darker pixels" },
  lighten: { name: "Lighten", description: "Keeps lighter pixels" },
  "color-dodge": { name: "Color Dodge", description: "Brightens base color" },
  "color-burn": { name: "Color Burn", description: "Darkens base color" },
  "hard-light": { name: "Hard Light", description: "Strong overlay effect" },
  "soft-light": { name: "Soft Light", description: "Gentle overlay effect" },
  difference: { name: "Difference", description: "Subtracts colors" },
  exclusion: {
    name: "Exclusion",
    description: "Similar to difference, lower contrast",
  },
  hue: { name: "Hue", description: "Applies hue only" },
  saturation: { name: "Saturation", description: "Applies saturation only" },
  color: { name: "Color", description: "Applies hue and saturation" },
  luminosity: { name: "Luminosity", description: "Applies luminosity only" },
  add: { name: "Add", description: "Additive lighten (clamped sum)" },
  "linear-dodge": {
    name: "Linear Dodge",
    description: "Additive lighten (clamped sum)",
  },
};

function generateId(): string {
  return `adj_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export class AdjustmentLayerEngine {
  private layers: Map<string, AdjustmentLayer> = new Map();
  private layersByTrack: Map<string, Set<string>> = new Map();

  createAdjustmentLayer(
    trackId: string,
    startTime: number,
    options: CreateAdjustmentLayerOptions = {},
  ): AdjustmentLayer {
    const layer: AdjustmentLayer = {
      id: generateId(),
      trackId,
      name: options.name || `Adjustment Layer ${this.layers.size + 1}`,
      startTime,
      duration: options.duration || 5,
      effects: options.effects || [],
      opacity: options.opacity ?? 1,
      blendMode: options.blendMode || "normal",
      enabled: true,
      affectedTracks: "all",
      transform: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        anchor: { x: 0.5, y: 0.5 },
        opacity: 1,
      },
    };

    this.layers.set(layer.id, layer);

    if (!this.layersByTrack.has(trackId)) {
      this.layersByTrack.set(trackId, new Set());
    }
    this.layersByTrack.get(trackId)!.add(layer.id);

    return layer;
  }

  getLayer(id: string): AdjustmentLayer | undefined {
    return this.layers.get(id);
  }

  getAllLayers(): AdjustmentLayer[] {
    return Array.from(this.layers.values());
  }

  loadLayers(layers: AdjustmentLayer[]): void {
    this.clearAll();
    for (const layer of layers) {
      this.layers.set(layer.id, layer);
      if (!this.layersByTrack.has(layer.trackId)) {
        this.layersByTrack.set(layer.trackId, new Set());
      }
      this.layersByTrack.get(layer.trackId)!.add(layer.id);
    }
  }

  getLayersForTrack(trackId: string): AdjustmentLayer[] {
    const layerIds = this.layersByTrack.get(trackId);
    if (!layerIds) return [];

    return Array.from(layerIds)
      .map((id) => this.layers.get(id))
      .filter((layer): layer is AdjustmentLayer => layer !== undefined);
  }

  getActiveLayersAtTime(time: number, trackIndex?: number): AdjustmentLayer[] {
    const activeLayers: AdjustmentLayer[] = [];

    for (const layer of this.layers.values()) {
      if (!layer.enabled) continue;
      if (time >= layer.startTime && time < layer.startTime + layer.duration) {
        activeLayers.push(layer);
      }
    }

    return activeLayers.sort((a, b) => {
      if (trackIndex !== undefined) {
        return 0;
      }
      return a.startTime - b.startTime;
    });
  }

  updateLayer(
    id: string,
    updates: Partial<Omit<AdjustmentLayer, "id">>,
  ): boolean {
    const layer = this.layers.get(id);
    if (!layer) return false;

    if (updates.trackId && updates.trackId !== layer.trackId) {
      this.layersByTrack.get(layer.trackId)?.delete(id);
      if (!this.layersByTrack.has(updates.trackId)) {
        this.layersByTrack.set(updates.trackId, new Set());
      }
      this.layersByTrack.get(updates.trackId)!.add(id);
    }

    this.layers.set(id, {
      ...layer,
      ...updates,
      id: layer.id,
    });

    return true;
  }

  deleteLayer(id: string): boolean {
    const layer = this.layers.get(id);
    if (!layer) return false;

    this.layersByTrack.get(layer.trackId)?.delete(id);
    return this.layers.delete(id);
  }

  addEffect(layerId: string, effect: Effect): boolean {
    const layer = this.layers.get(layerId);
    if (!layer) return false;

    const newEffect = {
      ...effect,
      id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    };

    this.layers.set(layerId, {
      ...layer,
      effects: [...layer.effects, newEffect],
    });

    return true;
  }

  removeEffect(layerId: string, effectId: string): boolean {
    const layer = this.layers.get(layerId);
    if (!layer) return false;

    this.layers.set(layerId, {
      ...layer,
      effects: layer.effects.filter((e) => e.id !== effectId),
    });

    return true;
  }

  updateEffect(
    layerId: string,
    effectId: string,
    updates: Partial<Effect>,
  ): boolean {
    const layer = this.layers.get(layerId);
    if (!layer) return false;

    const effectIndex = layer.effects.findIndex((e) => e.id === effectId);
    if (effectIndex === -1) return false;

    const newEffects = [...layer.effects];
    newEffects[effectIndex] = {
      ...newEffects[effectIndex],
      ...updates,
      id: effectId,
    };

    this.layers.set(layerId, {
      ...layer,
      effects: newEffects,
    });

    return true;
  }

  setOpacity(layerId: string, opacity: number): boolean {
    return this.updateLayer(layerId, {
      opacity: Math.max(0, Math.min(1, opacity)),
    });
  }

  setBlendMode(layerId: string, blendMode: BlendMode): boolean {
    return this.updateLayer(layerId, { blendMode });
  }

  setEnabled(layerId: string, enabled: boolean): boolean {
    return this.updateLayer(layerId, { enabled });
  }

  setAffectedTracks(layerId: string, trackIds: string[] | "all"): boolean {
    return this.updateLayer(layerId, { affectedTracks: trackIds });
  }

  getEffectsForClip(
    clipTrackIndex: number,
    time: number,
    trackIndices: Map<string, number>,
  ): AdjustmentLayerEffect[] {
    const effects: AdjustmentLayerEffect[] = [];

    for (const layer of this.layers.values()) {
      if (!layer.enabled) continue;
      if (time < layer.startTime || time >= layer.startTime + layer.duration)
        continue;

      const layerTrackIndex = trackIndices.get(layer.trackId);
      if (layerTrackIndex === undefined) continue;

      if (layerTrackIndex < clipTrackIndex) {
        continue;
      }

      if (layer.affectedTracks !== "all") {
        const affectedIndices = layer.affectedTracks
          .map((tid) => trackIndices.get(tid))
          .filter((idx): idx is number => idx !== undefined);

        if (!affectedIndices.some((idx) => idx === clipTrackIndex)) {
          continue;
        }
      }

      for (const effect of layer.effects) {
        if (effect.enabled !== false) {
          effects.push({
            layerId: layer.id,
            effect,
            opacity: layer.opacity,
            blendMode: layer.blendMode,
          });
        }
      }
    }

    return effects;
  }

  duplicateLayer(id: string, newTrackId?: string): AdjustmentLayer | null {
    const original = this.layers.get(id);
    if (!original) return null;

    const duplicate: AdjustmentLayer = {
      ...original,
      id: generateId(),
      trackId: newTrackId || original.trackId,
      name: `${original.name} (Copy)`,
      effects: original.effects.map((e) => ({
        ...e,
        id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      })),
    };

    this.layers.set(duplicate.id, duplicate);

    if (!this.layersByTrack.has(duplicate.trackId)) {
      this.layersByTrack.set(duplicate.trackId, new Set());
    }
    this.layersByTrack.get(duplicate.trackId)!.add(duplicate.id);

    return duplicate;
  }

  getBlendModes(): Array<{ id: BlendMode; name: string; description: string }> {
    return Object.entries(BLEND_MODE_INFO).map(([id, info]) => ({
      id: id as BlendMode,
      ...info,
    }));
  }

  clearAll(): void {
    this.layers.clear();
    this.layersByTrack.clear();
  }
}

let adjustmentLayerEngineInstance: AdjustmentLayerEngine | null = null;

export function getAdjustmentLayerEngine(): AdjustmentLayerEngine {
  if (!adjustmentLayerEngineInstance) {
    adjustmentLayerEngineInstance = new AdjustmentLayerEngine();
  }
  return adjustmentLayerEngineInstance;
}

export function resetAdjustmentLayerEngine(): void {
  adjustmentLayerEngineInstance = null;
}
