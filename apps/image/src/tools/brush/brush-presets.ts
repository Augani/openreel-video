import { BrushSettings, DEFAULT_BRUSH_SETTINGS } from './brush-engine';

export interface BrushPreset {
  id: string;
  name: string;
  category: BrushCategory;
  settings: BrushSettings;
  thumbnail?: string;
}

export type BrushCategory =
  | 'general'
  | 'soft'
  | 'hard'
  | 'texture'
  | 'special'
  | 'artistic'
  | 'custom';

export const BRUSH_PRESETS: BrushPreset[] = [
  {
    id: 'soft-round',
    name: 'Soft Round',
    category: 'soft',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 30,
      hardness: 0,
      opacity: 1,
      flow: 1,
      spacing: 25,
      tip: 'round',
    },
  },
  {
    id: 'hard-round',
    name: 'Hard Round',
    category: 'hard',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 20,
      hardness: 100,
      opacity: 1,
      flow: 1,
      spacing: 25,
      tip: 'round',
    },
  },
  {
    id: 'soft-round-pressure',
    name: 'Soft Round Pressure',
    category: 'soft',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 30,
      hardness: 0,
      opacity: 1,
      flow: 1,
      spacing: 25,
      tip: 'round',
      sizeDynamics: {
        control: 'pen-pressure',
        minValue: 0.1,
        jitter: 0,
      },
      opacityDynamics: {
        control: 'pen-pressure',
        minValue: 0.2,
        jitter: 0,
      },
    },
  },
  {
    id: 'hard-round-pressure',
    name: 'Hard Round Pressure',
    category: 'hard',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 20,
      hardness: 100,
      opacity: 1,
      flow: 1,
      spacing: 25,
      tip: 'round',
      sizeDynamics: {
        control: 'pen-pressure',
        minValue: 0.1,
        jitter: 0,
      },
    },
  },
  {
    id: 'airbrush-soft',
    name: 'Airbrush Soft',
    category: 'soft',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 100,
      hardness: 0,
      opacity: 0.3,
      flow: 0.5,
      spacing: 10,
      tip: 'round',
      buildUp: true,
    },
  },
  {
    id: 'chalk',
    name: 'Chalk',
    category: 'texture',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 40,
      hardness: 80,
      opacity: 0.8,
      flow: 0.6,
      spacing: 20,
      tip: 'round',
      sizeDynamics: {
        control: 'pen-pressure',
        minValue: 0.5,
        jitter: 0.1,
      },
      opacityDynamics: {
        control: 'pen-pressure',
        minValue: 0.3,
        jitter: 0.15,
      },
    },
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    category: 'artistic',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 30,
      hardness: 50,
      opacity: 0.7,
      flow: 0.8,
      spacing: 15,
      tip: 'round',
      roundness: 60,
      angle: 45,
      sizeDynamics: {
        control: 'pen-pressure',
        minValue: 0.3,
        jitter: 0.05,
      },
      opacityDynamics: {
        control: 'pen-pressure',
        minValue: 0.2,
        jitter: 0.1,
      },
    },
  },
  {
    id: 'pencil-hard',
    name: 'Pencil Hard',
    category: 'hard',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 4,
      hardness: 100,
      opacity: 1,
      flow: 1,
      spacing: 10,
      tip: 'round',
      sizeDynamics: {
        control: 'pen-pressure',
        minValue: 0.5,
        jitter: 0,
      },
    },
  },
  {
    id: 'pencil-soft',
    name: 'Pencil Soft',
    category: 'soft',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 6,
      hardness: 70,
      opacity: 0.8,
      flow: 1,
      spacing: 10,
      tip: 'round',
      sizeDynamics: {
        control: 'pen-pressure',
        minValue: 0.3,
        jitter: 0,
      },
      opacityDynamics: {
        control: 'pen-pressure',
        minValue: 0.4,
        jitter: 0,
      },
    },
  },
  {
    id: 'marker',
    name: 'Marker',
    category: 'hard',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 15,
      hardness: 100,
      opacity: 0.8,
      flow: 1,
      spacing: 15,
      tip: 'round',
      roundness: 70,
      angle: -30,
    },
  },
  {
    id: 'watercolor-wet',
    name: 'Watercolor Wet',
    category: 'artistic',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 60,
      hardness: 0,
      opacity: 0.4,
      flow: 0.3,
      spacing: 15,
      tip: 'round',
      buildUp: true,
      sizeDynamics: {
        control: 'pen-pressure',
        minValue: 0.5,
        jitter: 0.1,
      },
      opacityDynamics: {
        control: 'pen-pressure',
        minValue: 0.1,
        jitter: 0.2,
      },
    },
  },
  {
    id: 'ink-pen',
    name: 'Ink Pen',
    category: 'hard',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 3,
      hardness: 100,
      opacity: 1,
      flow: 1,
      spacing: 5,
      tip: 'round',
      smoothing: 70,
      sizeDynamics: {
        control: 'pen-pressure',
        minValue: 0.2,
        jitter: 0,
      },
    },
  },
  {
    id: 'flat-brush',
    name: 'Flat Brush',
    category: 'artistic',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 40,
      hardness: 90,
      opacity: 1,
      flow: 1,
      spacing: 20,
      tip: 'square',
      roundness: 30,
      angle: 0,
      sizeDynamics: {
        control: 'pen-pressure',
        minValue: 0.5,
        jitter: 0,
      },
    },
  },
  {
    id: 'scatter-brush',
    name: 'Scatter Brush',
    category: 'special',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 25,
      hardness: 100,
      opacity: 1,
      flow: 1,
      spacing: 80,
      tip: 'round',
      sizeDynamics: {
        control: 'off',
        minValue: 0.3,
        jitter: 0.5,
      },
      opacityDynamics: {
        control: 'off',
        minValue: 0.5,
        jitter: 0.3,
      },
    },
  },
  {
    id: 'eraser-soft',
    name: 'Soft Eraser',
    category: 'general',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 50,
      hardness: 0,
      opacity: 1,
      flow: 1,
      spacing: 25,
      tip: 'round',
    },
  },
  {
    id: 'eraser-hard',
    name: 'Hard Eraser',
    category: 'general',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 30,
      hardness: 100,
      opacity: 1,
      flow: 1,
      spacing: 25,
      tip: 'round',
    },
  },
  {
    id: 'smudge-soft',
    name: 'Smudge Soft',
    category: 'special',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 40,
      hardness: 0,
      opacity: 0.5,
      flow: 1,
      spacing: 10,
      tip: 'round',
      sizeDynamics: {
        control: 'pen-pressure',
        minValue: 0.5,
        jitter: 0,
      },
    },
  },
  {
    id: 'blur-brush',
    name: 'Blur Brush',
    category: 'special',
    settings: {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 50,
      hardness: 0,
      opacity: 0.5,
      flow: 1,
      spacing: 15,
      tip: 'round',
    },
  },
];

export class BrushPresetManager {
  private presets: Map<string, BrushPreset> = new Map();
  private customPresets: Map<string, BrushPreset> = new Map();

  constructor() {
    BRUSH_PRESETS.forEach((preset) => {
      this.presets.set(preset.id, preset);
    });
  }

  getPreset(id: string): BrushPreset | undefined {
    return this.presets.get(id) || this.customPresets.get(id);
  }

  getAllPresets(): BrushPreset[] {
    return [...this.presets.values(), ...this.customPresets.values()];
  }

  getPresetsByCategory(category: BrushCategory): BrushPreset[] {
    return this.getAllPresets().filter((preset) => preset.category === category);
  }

  addCustomPreset(name: string, settings: BrushSettings): BrushPreset {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const preset: BrushPreset = {
      id,
      name,
      category: 'custom',
      settings: { ...settings },
    };
    this.customPresets.set(id, preset);
    return preset;
  }

  updateCustomPreset(id: string, updates: Partial<Omit<BrushPreset, 'id'>>): boolean {
    const preset = this.customPresets.get(id);
    if (!preset) return false;

    this.customPresets.set(id, {
      ...preset,
      ...updates,
      settings: updates.settings ? { ...updates.settings } : preset.settings,
    });
    return true;
  }

  deleteCustomPreset(id: string): boolean {
    return this.customPresets.delete(id);
  }

  getCustomPresets(): BrushPreset[] {
    return [...this.customPresets.values()];
  }

  exportCustomPresets(): string {
    return JSON.stringify([...this.customPresets.values()]);
  }

  importCustomPresets(json: string): number {
    try {
      const presets: BrushPreset[] = JSON.parse(json);
      let imported = 0;
      presets.forEach((preset) => {
        if (preset.id && preset.name && preset.settings) {
          this.customPresets.set(preset.id, preset);
          imported++;
        }
      });
      return imported;
    } catch {
      return 0;
    }
  }

  searchPresets(query: string): BrushPreset[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllPresets().filter(
      (preset) =>
        preset.name.toLowerCase().includes(lowerQuery) ||
        preset.category.toLowerCase().includes(lowerQuery)
    );
  }
}

export const brushPresetManager = new BrushPresetManager();
