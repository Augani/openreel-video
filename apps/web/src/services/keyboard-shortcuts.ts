import { useAgentStore } from "../stores/agent-store";

export type ShortcutCategory =
  | "playback"
  | "editing"
  | "selection"
  | "timeline"
  | "view"
  | "file"
  | "tools";

export interface ShortcutDefinition {
  id: string;
  name: string;
  description: string;
  category: ShortcutCategory;
  defaultKey: string;
  currentKey: string;
  action: string;
  enabled: boolean;
}

export interface ShortcutPreset {
  id: string;
  name: string;
  description: string;
  shortcuts: Record<string, string>;
}

export type ShortcutHandler = (e: KeyboardEvent) => void;

const STORAGE_KEY = "openreel_shortcuts";
const PRESET_KEY = "openreel_shortcut_preset";

function parseKeyCombo(key: string): {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
} {
  const parts = key.toLowerCase().split("+");
  return {
    key: parts[parts.length - 1],
    meta: parts.includes("cmd") || parts.includes("meta"),
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt") || parts.includes("option"),
  };
}

function formatKeyCombo(combo: {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}): string {
  const parts: string[] = [];
  if (combo.meta || combo.ctrl) parts.push("⌘");
  if (combo.shift) parts.push("⇧");
  if (combo.alt) parts.push("⌥");

  const keyMap: Record<string, string> = {
    space: "Space",
    arrowleft: "←",
    arrowright: "→",
    arrowup: "↑",
    arrowdown: "↓",
    delete: "⌫",
    backspace: "⌫",
    escape: "Esc",
    enter: "↵",
    tab: "⇥",
    home: "Home",
    end: "End",
  };

  parts.push(keyMap[combo.key] || combo.key.toUpperCase());
  return parts.join("");
}

const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  {
    id: "playback.playPause",
    name: "Play/Pause",
    description: "Toggle playback",
    category: "playback",
    defaultKey: "space",
    currentKey: "space",
    action: "playback.playPause",
    enabled: true,
  },
  {
    id: "playback.frameBack",
    name: "Frame Back",
    description: "Move back one frame",
    category: "playback",
    defaultKey: "arrowleft",
    currentKey: "arrowleft",
    action: "playback.frameBack",
    enabled: true,
  },
  {
    id: "playback.frameForward",
    name: "Frame Forward",
    description: "Move forward one frame",
    category: "playback",
    defaultKey: "arrowright",
    currentKey: "arrowright",
    action: "playback.frameForward",
    enabled: true,
  },
  {
    id: "playback.secondBack",
    name: "Second Back",
    description: "Move back one second",
    category: "playback",
    defaultKey: "shift+arrowleft",
    currentKey: "shift+arrowleft",
    action: "playback.secondBack",
    enabled: true,
  },
  {
    id: "playback.secondForward",
    name: "Second Forward",
    description: "Move forward one second",
    category: "playback",
    defaultKey: "shift+arrowright",
    currentKey: "shift+arrowright",
    action: "playback.secondForward",
    enabled: true,
  },
  {
    id: "playback.jump5Back",
    name: "Jump 5s Back",
    description: "Move back 5 seconds",
    category: "playback",
    defaultKey: "arrowup",
    currentKey: "arrowup",
    action: "playback.jump5Back",
    enabled: true,
  },
  {
    id: "playback.jump5Forward",
    name: "Jump 5s Forward",
    description: "Move forward 5 seconds",
    category: "playback",
    defaultKey: "arrowdown",
    currentKey: "arrowdown",
    action: "playback.jump5Forward",
    enabled: true,
  },
  {
    id: "playback.goToStart",
    name: "Go to Start",
    description: "Jump to timeline start",
    category: "playback",
    defaultKey: "home",
    currentKey: "home",
    action: "playback.goToStart",
    enabled: true,
  },
  {
    id: "playback.goToEnd",
    name: "Go to End",
    description: "Jump to timeline end",
    category: "playback",
    defaultKey: "end",
    currentKey: "end",
    action: "playback.goToEnd",
    enabled: true,
  },
  {
    id: "playback.prevClip",
    name: "Previous Clip",
    description: "Jump to previous clip edge",
    category: "playback",
    defaultKey: "[",
    currentKey: "[",
    action: "playback.prevClip",
    enabled: true,
  },
  {
    id: "playback.nextClip",
    name: "Next Clip",
    description: "Jump to next clip edge",
    category: "playback",
    defaultKey: "]",
    currentKey: "]",
    action: "playback.nextClip",
    enabled: true,
  },
  {
    id: "editing.undo",
    name: "Undo",
    description: "Undo last action",
    category: "editing",
    defaultKey: "cmd+z",
    currentKey: "cmd+z",
    action: "editing.undo",
    enabled: true,
  },
  {
    id: "editing.redo",
    name: "Redo",
    description: "Redo last undone action",
    category: "editing",
    defaultKey: "cmd+shift+z",
    currentKey: "cmd+shift+z",
    action: "editing.redo",
    enabled: true,
  },
  {
    id: "editing.cut",
    name: "Cut",
    description: "Cut selected clips",
    category: "editing",
    defaultKey: "cmd+x",
    currentKey: "cmd+x",
    action: "editing.cut",
    enabled: true,
  },
  {
    id: "editing.copy",
    name: "Copy",
    description: "Copy selected clips",
    category: "editing",
    defaultKey: "cmd+c",
    currentKey: "cmd+c",
    action: "editing.copy",
    enabled: true,
  },
  {
    id: "editing.paste",
    name: "Paste",
    description: "Paste clips at playhead",
    category: "editing",
    defaultKey: "cmd+v",
    currentKey: "cmd+v",
    action: "editing.paste",
    enabled: true,
  },
  {
    id: "editing.duplicate",
    name: "Duplicate",
    description: "Duplicate selected clip",
    category: "editing",
    defaultKey: "cmd+d",
    currentKey: "cmd+d",
    action: "editing.duplicate",
    enabled: true,
  },
  {
    id: "editing.delete",
    name: "Delete",
    description: "Delete selected clips",
    category: "editing",
    defaultKey: "delete",
    currentKey: "delete",
    action: "editing.delete",
    enabled: true,
  },
  {
    id: "editing.rippleDelete",
    name: "Ripple Delete",
    description: "Delete and close gap",
    category: "editing",
    defaultKey: "shift+delete",
    currentKey: "shift+delete",
    action: "editing.rippleDelete",
    enabled: true,
  },
  {
    id: "editing.split",
    name: "Split",
    description: "Split clip at playhead",
    category: "editing",
    defaultKey: "s",
    currentKey: "s",
    action: "editing.split",
    enabled: true,
  },
  {
    id: "editing.trimStart",
    name: "Trim Start",
    description: "Trim clip start to playhead",
    category: "editing",
    defaultKey: "q",
    currentKey: "q",
    action: "editing.trimStart",
    enabled: true,
  },
  {
    id: "editing.trimEnd",
    name: "Trim End",
    description: "Trim clip end to playhead",
    category: "editing",
    defaultKey: "w",
    currentKey: "w",
    action: "editing.trimEnd",
    enabled: true,
  },
  {
    id: "selection.selectAll",
    name: "Select All",
    description: "Select all clips",
    category: "selection",
    defaultKey: "cmd+a",
    currentKey: "cmd+a",
    action: "selection.selectAll",
    enabled: true,
  },
  {
    id: "selection.deselect",
    name: "Deselect",
    description: "Clear selection",
    category: "selection",
    defaultKey: "escape",
    currentKey: "escape",
    action: "selection.deselect",
    enabled: true,
  },
  {
    id: "timeline.toggleSnap",
    name: "Toggle Snap",
    description: "Toggle snapping",
    category: "timeline",
    defaultKey: "n",
    currentKey: "n",
    action: "timeline.toggleSnap",
    enabled: true,
  },
  {
    id: "timeline.zoomIn",
    name: "Zoom In",
    description: "Zoom in timeline",
    category: "timeline",
    defaultKey: "cmd+=",
    currentKey: "cmd+=",
    action: "timeline.zoomIn",
    enabled: true,
  },
  {
    id: "timeline.zoomOut",
    name: "Zoom Out",
    description: "Zoom out timeline",
    category: "timeline",
    defaultKey: "cmd+-",
    currentKey: "cmd+-",
    action: "timeline.zoomOut",
    enabled: true,
  },
  {
    id: "timeline.fitTimeline",
    name: "Fit Timeline",
    description: "Fit timeline to view",
    category: "timeline",
    defaultKey: "cmd+0",
    currentKey: "cmd+0",
    action: "timeline.fitTimeline",
    enabled: true,
  },
  {
    id: "view.showShortcuts",
    name: "Show Shortcuts",
    description: "Show keyboard shortcuts",
    category: "view",
    defaultKey: "?",
    currentKey: "?",
    action: "view.showShortcuts",
    enabled: true,
  },
  {
    id: "file.save",
    name: "Save",
    description: "Save project",
    category: "file",
    defaultKey: "cmd+s",
    currentKey: "cmd+s",
    action: "file.save",
    enabled: true,
  },
  {
    id: "file.export",
    name: "Export",
    description: "Export video",
    category: "file",
    defaultKey: "cmd+e",
    currentKey: "cmd+e",
    action: "file.export",
    enabled: true,
  },
  {
    id: "tools.addText",
    name: "Add Text",
    description: "Add text clip",
    category: "tools",
    defaultKey: "t",
    currentKey: "t",
    action: "tools.addText",
    enabled: true,
  },
  {
    id: "tools.addMarker",
    name: "Add Marker",
    description: "Add marker at playhead",
    category: "tools",
    defaultKey: "m",
    currentKey: "m",
    action: "tools.addMarker",
    enabled: true,
  },
];

const PRESETS: ShortcutPreset[] = [
  {
    id: "openreel",
    name: "OpenReel Default",
    description: "Default OpenReel shortcuts",
    shortcuts: {},
  },
  {
    id: "capcut",
    name: "CapCut",
    description: "CapCut-style shortcuts",
    shortcuts: {
      "editing.split": "ctrl+b",
      "playback.playPause": "space",
      "editing.delete": "delete",
    },
  },
  {
    id: "premiere",
    name: "Adobe Premiere",
    description: "Premiere Pro-style shortcuts",
    shortcuts: {
      "editing.split": "cmd+k",
      "playback.playPause": "space",
      "playback.frameBack": "arrowleft",
      "playback.frameForward": "arrowright",
      "editing.rippleDelete": "shift+delete",
    },
  },
  {
    id: "finalcut",
    name: "Final Cut Pro",
    description: "Final Cut Pro-style shortcuts",
    shortcuts: {
      "editing.split": "cmd+b",
      "playback.playPause": "space",
      "editing.trimStart": "[",
      "editing.trimEnd": "]",
    },
  },
  {
    id: "davinci",
    name: "DaVinci Resolve",
    description: "DaVinci Resolve-style shortcuts",
    shortcuts: {
      "editing.split": "cmd+\\",
      "playback.playPause": "space",
      "editing.rippleDelete": "shift+backspace",
    },
  },
];

class KeyboardShortcutsManager {
  private shortcuts: Map<string, ShortcutDefinition> = new Map();
  private handlers: Map<string, Set<ShortcutHandler>> = new Map();
  private activePreset: string = "openreel";
  private isListening: boolean = false;

  constructor() {
    this.loadShortcuts();
    this.loadPreset();
  }

  private loadShortcuts(): void {
    const saved = localStorage.getItem(STORAGE_KEY);
    const customizations: Record<string, string> = saved
      ? JSON.parse(saved)
      : {};

    DEFAULT_SHORTCUTS.forEach((shortcut) => {
      const customKey = customizations[shortcut.id];
      this.shortcuts.set(shortcut.id, {
        ...shortcut,
        currentKey: customKey || shortcut.defaultKey,
      });
    });
  }

  private loadPreset(): void {
    const saved = localStorage.getItem(PRESET_KEY);
    if (saved) {
      this.activePreset = saved;
    }
  }

  private saveShortcuts(): void {
    const customizations: Record<string, string> = {};
    this.shortcuts.forEach((shortcut, id) => {
      if (shortcut.currentKey !== shortcut.defaultKey) {
        customizations[id] = shortcut.currentKey;
      }
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customizations));
  }

  private savePreset(): void {
    localStorage.setItem(PRESET_KEY, this.activePreset);
  }

  startListening(): void {
    if (this.isListening) return;
    this.isListening = true;
    window.addEventListener("keydown", this.handleKeyDown);
  }

  stopListening(): void {
    if (!this.isListening) return;
    this.isListening = false;
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    // Agent freeze: swallow shortcuts while the agent has the editor.
    // Esc is reserved as a global "stop agent" affordance.
    const agent = useAgentStore.getState();
    if (agent.frozen) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        agent.setFrozen(false);
      }
      return;
    }

    const matchedShortcut = this.findMatchingShortcut(e);
    if (matchedShortcut) {
      e.preventDefault();
      e.stopPropagation();
      this.executeAction(matchedShortcut.action, e);
    }
  };

  private findMatchingShortcut(e: KeyboardEvent): ShortcutDefinition | null {
    const isMeta = e.metaKey || e.ctrlKey;

    for (const shortcut of this.shortcuts.values()) {
      if (!shortcut.enabled) continue;

      const combo = parseKeyCombo(shortcut.currentKey);
      const keyMatches =
        e.key.toLowerCase() === combo.key || e.code.toLowerCase() === combo.key;
      const metaMatches = (combo.meta || combo.ctrl) === isMeta;
      const shiftMatches = combo.shift === e.shiftKey;
      const altMatches = combo.alt === e.altKey;

      if (keyMatches && metaMatches && shiftMatches && altMatches) {
        return shortcut;
      }
    }

    return null;
  }

  private executeAction(action: string, e: KeyboardEvent): void {
    const handlers = this.handlers.get(action);
    if (handlers) {
      handlers.forEach((handler) => handler(e));
    }
  }

  registerHandler(action: string, handler: ShortcutHandler): () => void {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, new Set());
    }
    this.handlers.get(action)!.add(handler);

    return () => {
      this.handlers.get(action)?.delete(handler);
    };
  }

  getShortcut(id: string): ShortcutDefinition | undefined {
    return this.shortcuts.get(id);
  }

  getAllShortcuts(): ShortcutDefinition[] {
    return Array.from(this.shortcuts.values());
  }

  getShortcutsByCategory(category: ShortcutCategory): ShortcutDefinition[] {
    return this.getAllShortcuts().filter((s) => s.category === category);
  }

  setShortcut(id: string, key: string): boolean {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut) return false;

    const conflict = this.findConflict(key, id);
    if (conflict) return false;

    this.shortcuts.set(id, { ...shortcut, currentKey: key });
    this.saveShortcuts();
    return true;
  }

  resetShortcut(id: string): void {
    const shortcut = this.shortcuts.get(id);
    if (shortcut) {
      this.shortcuts.set(id, { ...shortcut, currentKey: shortcut.defaultKey });
      this.saveShortcuts();
    }
  }

  resetAllShortcuts(): void {
    this.shortcuts.forEach((shortcut, id) => {
      this.shortcuts.set(id, { ...shortcut, currentKey: shortcut.defaultKey });
    });
    this.saveShortcuts();
  }

  findConflict(key: string, excludeId?: string): ShortcutDefinition | null {
    for (const [id, shortcut] of this.shortcuts) {
      if (id === excludeId) continue;
      if (shortcut.currentKey.toLowerCase() === key.toLowerCase()) {
        return shortcut;
      }
    }
    return null;
  }

  getPresets(): ShortcutPreset[] {
    return PRESETS;
  }

  getActivePreset(): string {
    return this.activePreset;
  }

  applyPreset(presetId: string): void {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    this.resetAllShortcuts();

    Object.entries(preset.shortcuts).forEach(([id, key]) => {
      const shortcut = this.shortcuts.get(id);
      if (shortcut) {
        this.shortcuts.set(id, { ...shortcut, currentKey: key });
      }
    });

    this.activePreset = presetId;
    this.saveShortcuts();
    this.savePreset();
  }

  formatShortcut(id: string): string {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut) return "";
    const combo = parseKeyCombo(shortcut.currentKey);
    return formatKeyCombo(combo);
  }

  getCategories(): ShortcutCategory[] {
    return [
      "playback",
      "editing",
      "selection",
      "timeline",
      "view",
      "file",
      "tools",
    ];
  }

  getCategoryName(category: ShortcutCategory): string {
    const names: Record<ShortcutCategory, string> = {
      playback: "Playback",
      editing: "Editing",
      selection: "Selection",
      timeline: "Timeline",
      view: "View",
      file: "File",
      tools: "Tools",
    };
    return names[category];
  }
}

export const keyboardShortcuts = new KeyboardShortcutsManager();

export function formatKeyComboDisplay(key: string): string {
  const combo = parseKeyCombo(key);
  return formatKeyCombo(combo);
}
