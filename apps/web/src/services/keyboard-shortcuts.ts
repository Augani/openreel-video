import { hasEditorFieldDraft } from "./editor-field-drafts";
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

interface ShortcutPreset {
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
  // The plus key is itself a separator, so preserve it at the end of a combo.
  const parts = key.toLowerCase().split("+");
  return {
    key: normalizeKey(key.endsWith("+") ? "+" : parts[parts.length - 1]),
    meta: parts.includes("cmd") || parts.includes("meta"),
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt") || parts.includes("option"),
  };
}

function normalizeKey(key: string): string {
  if (key === " " || key === "spacebar") return "space";
  if (key === "esc") return "escape";
  return key.toLowerCase();
}

function comboIdentity(key: string): string {
  const combo = parseKeyCombo(key);
  // Cmd and Ctrl are portable aliases throughout the editor.
  return `${combo.meta || combo.ctrl}:${combo.shift && !isShiftedSymbol(combo.key)}:${combo.alt}:${combo.key === "backspace" ? "delete" : combo.key}`;
}

const PHYSICAL_PUNCTUATION: Record<string, string> = {
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Equal: "=",
  Minus: "-", Semicolon: ";", Quote: "'", Comma: ",", Period: ".",
  Slash: "/", Backquote: "`",
};

export function captureKeyCombo(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  code?: string;
}): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("cmd");
  // Printable symbols already include Shift (for example ? and +).
  const key = event.altKey && event.code && PHYSICAL_PUNCTUATION[event.code]
    ? PHYSICAL_PUNCTUATION[event.code]
    : event.key;
  if (event.shiftKey && !isShiftedSymbol(key)) parts.push("shift");
  if (event.altKey) parts.push("alt");
  parts.push(normalizeKey(key));
  return parts.join("+");
}

function isShiftedSymbol(key: string): boolean {
  return key.length === 1 && /[~!@#$%^&*()_+{}|:"<>?]/.test(key);
}

export function hasShortcutFocus(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const target = event.composedPath()[0] ?? event.target;
  if (!(target instanceof Element)) return true;
  if (
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="menu"], [data-editor-shortcuts="off"]',
    )
  ) return false;
  if (target.closest('[role="dialog"], [role="alertdialog"]')) return false;
  // Let focused controls keep their native keyboard activation/navigation.
  const control = target.closest('button, a[href], [role="button"], [role="tab"]');
  if (control) {
    const timelineItem = control.matches('[role="button"]:not(button)') && control.closest('[data-tour="timeline"]');
    if ([" ", "Enter"].includes(event.key)) return false;
    if (!timelineItem && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return false;
  }
  return true;
}

function formatKeyCombo(combo: {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}): string {
  const parts: string[] = [];
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  if (combo.meta || combo.ctrl) parts.push(isMac ? "⌘" : "Ctrl");
  if (combo.shift) parts.push(isMac ? "⇧" : "Shift");
  if (combo.alt) parts.push(isMac ? "⌥" : "Alt");

  const keyMap: Record<string, string> = {
    space: "Space",
    arrowleft: "←",
    arrowright: "→",
    arrowup: "↑",
    arrowdown: "↓",
    delete: isMac ? "⌫" : "Delete",
    backspace: isMac ? "⌫" : "Backspace",
    escape: "Esc",
    enter: "↵",
    tab: "⇥",
    home: "Home",
    end: "End",
  };

  parts.push(keyMap[combo.key] || combo.key.toUpperCase());
  return parts.join(isMac ? "" : "+");
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
    id: "playback.shuttleBack",
    name: "Shuttle Back",
    description: "Slow forward shuttle, or pause and step back one second. With an edit point selected: trim backward (Dynamic Trimming)",
    category: "playback",
    defaultKey: "j",
    currentKey: "j",
    action: "playback.shuttleBack",
    enabled: true,
  },
  {
    id: "playback.shuttleStop",
    name: "Shuttle Stop",
    description: "Pause playback and reset speed. With an edit point selected: commit the dynamic trim; hold with J or L to trim one frame",
    category: "playback",
    defaultKey: "k",
    currentKey: "k",
    action: "playback.shuttleStop",
    enabled: true,
  },
  {
    id: "playback.shuttleForward",
    name: "Shuttle Forward",
    description: "Play forward; press again to double speed (up to 4x). With an edit point selected: trim forward (Dynamic Trimming)",
    category: "playback",
    defaultKey: "l",
    currentKey: "l",
    action: "playback.shuttleForward",
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
    id: "playback.markLoopStart",
    name: "Mark Loop Start",
    description: "Set the preview loop start, or import media into an empty sequence",
    category: "playback",
    defaultKey: "i",
    currentKey: "i",
    action: "playback.markLoopStart",
    enabled: true,
  },
  {
    id: "playback.markLoopEnd",
    name: "Mark Loop End",
    description: "Set the preview loop end at the playhead",
    category: "playback",
    defaultKey: "o",
    currentKey: "o",
    action: "playback.markLoopEnd",
    enabled: true,
  },
  {
    id: "playback.markClip",
    name: "Mark Clip",
    description: "Set In and Out to the clip under the playhead on the targeted tracks",
    category: "playback",
    defaultKey: "x",
    currentKey: "x",
    action: "playback.markClip",
    enabled: true,
  },
  {
    id: "playback.goToIn",
    name: "Go to In",
    description: "Move the playhead to the sequence In point",
    category: "playback",
    defaultKey: "shift+i",
    currentKey: "shift+i",
    action: "playback.goToIn",
    enabled: true,
  },
  {
    id: "playback.goToOut",
    name: "Go to Out",
    description: "Move the playhead to the sequence Out point",
    category: "playback",
    defaultKey: "shift+o",
    currentKey: "shift+o",
    action: "playback.goToOut",
    enabled: true,
  },
  {
    id: "playback.clearInOut",
    name: "Clear In and Out",
    description: "Remove the sequence In and Out points",
    category: "playback",
    defaultKey: "alt+x",
    currentKey: "alt+x",
    action: "playback.clearInOut",
    enabled: true,
  },
  {
    id: "playback.toggleLoop",
    name: "Toggle Preview Loop",
    description: "Repeat the marked range or the full timeline",
    category: "playback",
    defaultKey: "shift+l",
    currentKey: "shift+l",
    action: "playback.toggleLoop",
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
    id: "editing.insert",
    name: "Insert",
    description: "Insert selected library media at playhead",
    category: "editing",
    defaultKey: ",",
    currentKey: ",",
    action: "editing.insert",
    enabled: true,
  },
  {
    id: "editing.overwrite",
    name: "Overwrite",
    description: "Overwrite with selected library media at playhead",
    category: "editing",
    defaultKey: ".",
    currentKey: ".",
    action: "editing.overwrite",
    enabled: true,
  },
  {
    id: "editing.replaceEdit",
    name: "Replace Edit",
    description: "Replace the selected clip with the Source monitor clip, keeping its length",
    category: "editing",
    defaultKey: "shift+g",
    currentKey: "shift+g",
    action: "editing.replaceEdit",
    enabled: true,
  },
  {
    id: "editing.fitToFill",
    name: "Fit to Fill",
    description: "Fit the Source In/Out range into the timeline In/Out range, changing speed",
    category: "editing",
    defaultKey: "alt+shift+f",
    currentKey: "alt+shift+f",
    action: "editing.fitToFill",
    enabled: true,
  },
  {
    id: "editing.lift",
    name: "Lift",
    description: "Remove the In/Out range, leaving a gap",
    category: "editing",
    defaultKey: ";",
    currentKey: ";",
    action: "editing.lift",
    enabled: true,
  },
  {
    id: "editing.extract",
    name: "Extract",
    description: "Remove the In/Out range and close the gap",
    category: "editing",
    defaultKey: "'",
    currentKey: "'",
    action: "editing.extract",
    enabled: true,
  },
  {
    id: "editing.trimEditLeftLarge",
    name: "Trim Selected Edit Left (5 frames)",
    description: "With an edit point selected, trim it five frames earlier (Ripple or Roll)",
    category: "editing",
    defaultKey: "<",
    currentKey: "<",
    action: "editing.trimEditLeftLarge",
    enabled: true,
  },
  {
    id: "editing.trimEditRightLarge",
    name: "Trim Selected Edit Right (5 frames)",
    description: "With an edit point selected, trim it five frames later (Ripple or Roll)",
    category: "editing",
    defaultKey: ">",
    currentKey: ">",
    action: "editing.trimEditRightLarge",
    enabled: true,
  },
  {
    id: "editing.nudgeLeft",
    name: "Nudge Edit Left",
    description: "Nudge the active tool's edit one frame left",
    category: "editing",
    defaultKey: "alt+arrowleft",
    currentKey: "alt+arrowleft",
    action: "editing.nudgeLeft",
    enabled: true,
  },
  {
    id: "editing.nudgeRight",
    name: "Nudge Edit Right",
    description: "Nudge the active tool's edit one frame right",
    category: "editing",
    defaultKey: "alt+arrowright",
    currentKey: "alt+arrowright",
    action: "editing.nudgeRight",
    enabled: true,
  },
  {
    id: "editing.nudgeLeftLarge",
    name: "Nudge Edit Left (5 frames)",
    description: "Nudge the active tool's edit five frames left",
    category: "editing",
    defaultKey: "alt+shift+arrowleft",
    currentKey: "alt+shift+arrowleft",
    action: "editing.nudgeLeftLarge",
    enabled: true,
  },
  {
    id: "editing.nudgeRightLarge",
    name: "Nudge Edit Right (5 frames)",
    description: "Nudge the active tool's edit five frames right",
    category: "editing",
    defaultKey: "alt+shift+arrowright",
    currentKey: "alt+shift+arrowright",
    action: "editing.nudgeRightLarge",
    enabled: true,
  },
  {
    id: "editing.nudgeSideLeft",
    name: "Nudge Edit This Side Left",
    description: "Nudge the selected clip's edit one frame left, ignoring its linked clips",
    category: "editing",
    defaultKey: "alt+,",
    currentKey: "alt+,",
    action: "editing.nudgeSideLeft",
    enabled: true,
  },
  {
    id: "editing.nudgeSideRight",
    name: "Nudge Edit This Side Right",
    description: "Nudge the selected clip's edit one frame right, ignoring its linked clips",
    category: "editing",
    defaultKey: "alt+.",
    currentKey: "alt+.",
    action: "editing.nudgeSideRight",
    enabled: true,
  },
  {
    id: "editing.nudgeSideLeftLarge",
    name: "Nudge Edit This Side Left (5 frames)",
    description: "Nudge the selected clip's edit five frames left, ignoring its linked clips",
    category: "editing",
    defaultKey: "alt+shift+,",
    currentKey: "alt+shift+,",
    action: "editing.nudgeSideLeftLarge",
    enabled: true,
  },
  {
    id: "editing.nudgeSideRightLarge",
    name: "Nudge Edit This Side Right (5 frames)",
    description: "Nudge the selected clip's edit five frames right, ignoring its linked clips",
    category: "editing",
    defaultKey: "alt+shift+.",
    currentKey: "alt+shift+.",
    action: "editing.nudgeSideRightLarge",
    enabled: true,
  },
  {
    id: "editing.extendEdit",
    name: "Extend Edit",
    description: "Extend the selected edit point to the playhead",
    category: "editing",
    defaultKey: "e",
    currentKey: "e",
    action: "editing.extendEdit",
    enabled: true,
  },
  {
    id: "editing.extendEditVideo",
    name: "Extend Video Edit",
    description: "Extend only the video side of the selected edit to the playhead",
    category: "editing",
    defaultKey: "shift+e",
    currentKey: "shift+e",
    action: "editing.extendEditVideo",
    enabled: true,
  },
  {
    id: "editing.extendEditAudio",
    name: "Extend Audio Edit",
    description: "Extend only the audio side of the selected edit to the playhead",
    category: "editing",
    defaultKey: "alt+e",
    currentKey: "alt+e",
    action: "editing.extendEditAudio",
    enabled: true,
  },
  {
    id: "editing.jCut",
    name: "J-Cut",
    description: "Make the audio lead the picture at the selected cut by the split-edit length",
    category: "editing",
    defaultKey: "alt+j",
    currentKey: "alt+j",
    action: "editing.jCut",
    enabled: true,
  },
  {
    id: "editing.lCut",
    name: "L-Cut",
    description: "Make the audio trail the picture at the selected cut by the split-edit length",
    category: "editing",
    defaultKey: "alt+l",
    currentKey: "alt+l",
    action: "editing.lCut",
    enabled: true,
  },
  {
    id: "editing.addEditAllTracks",
    name: "Add Edit to All Tracks",
    description: "Split every unlocked track at the playhead",
    category: "editing",
    defaultKey: "cmd+shift+k",
    currentKey: "cmd+shift+k",
    action: "editing.addEditAllTracks",
    enabled: true,
  },
  {
    id: "editing.group",
    name: "Group",
    description: "Group the selected clips so they select, move and delete together",
    category: "editing",
    defaultKey: "cmd+g",
    currentKey: "cmd+g",
    action: "editing.group",
    enabled: true,
  },
  {
    id: "editing.ungroup",
    name: "Ungroup",
    description: "Dissolve the groups of the selected clips",
    category: "editing",
    defaultKey: "cmd+shift+g",
    currentKey: "cmd+shift+g",
    action: "editing.ungroup",
    enabled: true,
  },
  {
    id: "editing.applyDefaultTransition",
    name: "Apply Default Transition",
    description: "Add the default transition to the selected cut",
    category: "editing",
    defaultKey: "cmd+shift+d",
    currentKey: "cmd+shift+d",
    action: "editing.applyDefaultTransition",
    enabled: true,
  },
  {
    id: "editing.addEdit",
    name: "Add Edit",
    description: "Split the targeted tracks (all unlocked tracks when none is targeted) at the playhead",
    category: "editing",
    defaultKey: "shift+k",
    currentKey: "shift+k",
    action: "editing.addEdit",
    enabled: true,
  },
  {
    id: "editing.addGainKeyframe",
    name: "Add Gain Keyframe",
    description: "Add a volume keyframe at the playhead on the selected audio clip",
    category: "editing",
    defaultKey: "alt+g",
    currentKey: "alt+g",
    action: "editing.addGainKeyframe",
    enabled: true,
  },
  {
    id: "editing.pasteInsert",
    name: "Paste Insert",
    description: "Paste copied clips at the playhead and ripple later content",
    category: "editing",
    defaultKey: "cmd+shift+v",
    currentKey: "cmd+shift+v",
    action: "editing.pasteInsert",
    enabled: true,
  },
  {
    id: "tracks.toggleTarget",
    name: "Toggle Track Target",
    description: "Target or untarget the selected track (V1/A1 style)",
    category: "editing",
    defaultKey: "shift+t",
    currentKey: "shift+t",
    action: "tracks.toggleTarget",
    enabled: true,
  },
  {
    id: "tracks.toggleSyncLock",
    name: "Toggle Sync Lock",
    description: "Turn Sync Lock on or off for the selected track",
    category: "editing",
    defaultKey: "shift+y",
    currentKey: "shift+y",
    action: "tracks.toggleSyncLock",
    enabled: true,
  },
  {
    id: "editing.speedDuration",
    name: "Speed/Duration",
    description: "Change speed, duration, direction and pitch of the selected clips, optionally rippling trailing clips",
    category: "editing",
    defaultKey: "cmd+alt+r",
    currentKey: "cmd+alt+r",
    action: "editing.speedDuration",
    enabled: true,
  },
  {
    id: "editing.matchFrame",
    name: "Match Frame",
    description: "Select the source of the clip under the playhead",
    category: "editing",
    defaultKey: "f",
    currentKey: "f",
    action: "editing.matchFrame",
    enabled: true,
  },
  {
    id: "editing.reverseMatchFrame",
    name: "Reverse Match Frame",
    description: "Find the Source monitor frame in the sequence and move the playhead there",
    category: "editing",
    defaultKey: "shift+f",
    currentKey: "shift+f",
    action: "editing.reverseMatchFrame",
    enabled: true,
  },
  {
    id: "linked.replace",
    name: "Replace with Linked Composition",
    description: "Move the selected text, shape and SVG clips into a live linked composition",
    category: "editing",
    defaultKey: "cmd+alt+l",
    currentKey: "cmd+alt+l",
    action: "linked.replace",
    enabled: true,
  },
  {
    id: "linked.open",
    name: "Open Linked Composition",
    description: "Edit the selected linked composition in its own window",
    category: "editing",
    defaultKey: "cmd+alt+o",
    currentKey: "cmd+alt+o",
    action: "linked.open",
    enabled: true,
  },
  {
    id: "linked.render",
    name: "Render and Replace",
    description: "Render the selected linked composition to a media clip",
    category: "editing",
    defaultKey: "cmd+alt+shift+r",
    currentKey: "cmd+alt+shift+r",
    action: "linked.render",
    enabled: true,
  },
  {
    id: "linked.restore",
    name: "Restore Unrendered",
    description: "Bring back the live layers of a rendered linked composition",
    category: "editing",
    defaultKey: "cmd+alt+shift+u",
    currentKey: "cmd+alt+shift+u",
    action: "linked.restore",
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
  {id:"timeline.selectionTool",name:"Selection Tool",description:"Select and move timeline clips",category:"timeline",defaultKey:"v",currentKey:"v",action:"timeline.selectionTool",enabled:true},
  {id:"timeline.bladeTool",name:"Blade Tool",description:"Split a clip where you click",category:"timeline",defaultKey:"b",currentKey:"b",action:"timeline.bladeTool",enabled:true},
  {id:"timeline.rippleTool",name:"Ripple Trim Tool",description:"Ripple trim clip edges and shift following items",category:"timeline",defaultKey:"r",currentKey:"r",action:"timeline.rippleTool",enabled:true},
  {id:"timeline.slipTool",name:"Slip Tool",description:"Change the source window without moving the clip",category:"timeline",defaultKey:"y",currentKey:"y",action:"timeline.slipTool",enabled:true},
  {id:"timeline.rollTool",name:"Rolling Edit Tool",description:"Drag the cut between two clips; one extends, the other trims",category:"timeline",defaultKey:"shift+n",currentKey:"shift+n",action:"timeline.rollTool",enabled:true},
  {id:"timeline.slideTool",name:"Slide Tool",description:"Move a clip between its neighbours without changing total length",category:"timeline",defaultKey:"u",currentKey:"u",action:"timeline.slideTool",enabled:true},
  {id:"timeline.stretchTool",name:"Rate Stretch Tool",description:"Drag a clip edge to change its speed and duration",category:"timeline",defaultKey:"shift+r",currentKey:"shift+r",action:"timeline.stretchTool",enabled:true},
  {id:"timeline.trackSelectForwardTool",name:"Track Select Forward Tool",description:"Click a clip to select it and everything after it on every track (Shift: that track only)",category:"timeline",defaultKey:"a",currentKey:"a",action:"timeline.trackSelectForwardTool",enabled:true},
  {id:"timeline.trackSelectBackwardTool",name:"Track Select Backward Tool",description:"Click a clip to select it and everything before it on every track (Shift: that track only)",category:"timeline",defaultKey:"shift+a",currentKey:"shift+a",action:"timeline.trackSelectBackwardTool",enabled:true},
  {id:"timeline.handTool",name:"Hand Tool",description:"Drag to pan the timeline",category:"timeline",defaultKey:"h",currentKey:"h",action:"timeline.handTool",enabled:true},
  {id:"timeline.zoomTool",name:"Zoom Tool",description:"Click to zoom in, Alt-click to zoom out, drag a range to zoom to fit it",category:"timeline",defaultKey:"z",currentKey:"z",action:"timeline.zoomTool",enabled:true},
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
    id: "sequence.renderInToOut",
    name: "Render In to Out",
    description: "Render the In/Out range (or the whole sequence) so effects play back in real time",
    category: "timeline",
    defaultKey: "enter",
    currentKey: "enter",
    action: "sequence.renderInToOut",
    enabled: true,
  },
  {
    id: "sequence.renderEffectsInToOut",
    name: "Render Effects In to Out",
    description: "Render only the stretches with effects, transitions or layers in the In/Out range (the yellow and red render bar)",
    category: "timeline",
    defaultKey: "cmd+enter",
    currentKey: "cmd+enter",
    action: "sequence.renderEffectsInToOut",
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
    id: "view.toggleScopes",
    name: "Toggle Video Scopes",
    description: "Show or hide the waveform, parade, vectorscope and histogram",
    category: "view",
    defaultKey: "shift+s",
    currentKey: "shift+s",
    action: "view.toggleScopes",
    enabled: true,
  },
  {
    id: "view.toggleProxies",
    name: "Toggle Proxies",
    description: "Switch preview, scrub and playback between proxies and full-resolution media",
    category: "view",
    defaultKey: "shift+p",
    currentKey: "shift+p",
    action: "view.toggleProxies",
    enabled: true,
  },
  {
    id: "view.toggleComparison",
    name: "Toggle Comparison View",
    description: "Compare the Program frame with an ungraded frame, a still or a pinned playhead position",
    category: "view",
    defaultKey: "shift+c",
    currentKey: "shift+c",
    action: "view.toggleComparison",
    enabled: true,
  },
  {
    id: "file.import",
    name: "Import Media",
    description: "Import video, audio or images",
    category: "file",
    defaultKey: "cmd+i",
    currentKey: "cmd+i",
    action: "file.import",
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
    id: "file.saveAs",
    name: "Save As",
    description: "Save the project to a new file",
    category: "file",
    defaultKey: "cmd+shift+s",
    currentKey: "cmd+shift+s",
    action: "file.saveAs",
    enabled: true,
  },
  {
    id: "collab.open",
    name: "Collaborate",
    description: "Start or join a live editing session",
    category: "file",
    defaultKey: "cmd+shift+j",
    currentKey: "cmd+shift+j",
    action: "collab.open",
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
    name: "Add Text / Trim Monitor",
    description: "Add a text clip; with an edit point selected, open or close the Trim Monitor",
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
  {
    id: "tools.addClipMarker",
    name: "Add Clip Marker",
    description: "Add a marker to the selected clip at the playhead (master-clip marker in the Source monitor)",
    category: "tools",
    defaultKey: "alt+shift+m",
    currentKey: "alt+shift+m",
    action: "tools.addClipMarker",
    enabled: true,
  },
  {
    id: "tools.editMarker",
    name: "Edit Marker",
    description: "Edit the marker at the playhead (also M twice)",
    category: "tools",
    defaultKey: "alt+m",
    currentKey: "alt+m",
    action: "tools.editMarker",
    enabled: true,
  },
  {
    id: "tools.nextMarker",
    name: "Go to Next Marker",
    description: "Move the playhead to the next marker",
    category: "tools",
    defaultKey: "shift+arrowdown",
    currentKey: "shift+arrowdown",
    action: "tools.nextMarker",
    enabled: true,
  },
  {
    id: "tools.prevMarker",
    name: "Go to Previous Marker",
    description: "Move the playhead to the previous marker",
    category: "tools",
    defaultKey: "shift+arrowup",
    currentKey: "shift+arrowup",
    action: "tools.prevMarker",
    enabled: true,
  },
  {
    id: "tools.clearMarker",
    name: "Clear Marker at Playhead",
    description: "Delete the marker at the playhead",
    category: "tools",
    defaultKey: "cmd+alt+m",
    currentKey: "cmd+alt+m",
    action: "tools.clearMarker",
    enabled: true,
  },
  {
    id: "tools.clearAllMarkers",
    name: "Clear All Markers",
    description: "Delete every marker",
    category: "tools",
    defaultKey: "cmd+alt+shift+m",
    currentKey: "cmd+alt+shift+m",
    action: "tools.clearAllMarkers",
    enabled: true,
  },
];

/*
 * Preset audit (onboarding WP-D). Every binding below targets an action that already has a
 * DEFAULT_SHORTCUTS entry and a registered handler in useKeyboardShortcuts. J/K/L shuttle, I/O marks,
 * M markers, Q/W trims, ,/. insert-overwrite and ;/' lift-extract already match Premiere by default,
 * so they are not repeated. Entries apply in order: a key is freed before another command takes it, and
 * a command displaced by a preset is moved to Alt+<its default> (see computePresetBindings).
 */
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
      // Premiere's Apply Video Transition default; Duplicate (which holds Cmd+D here) moves to Alt+Cmd+D.
      "editing.applyDefaultTransition": "cmd+d",
      "playback.playPause": "space",
      "playback.frameBack": "arrowleft",
      "playback.frameForward": "arrowright",
      "editing.rippleDelete": "shift+delete",
      "timeline.bladeTool": "c",
      "timeline.rippleTool": "b",
      "timeline.toggleSnap": "s",
      "timeline.rollTool": "n",
      "timeline.stretchTool": "r",
      "timeline.zoomIn": "=",
      "timeline.zoomOut": "-",
      "timeline.fitTimeline": "\\",
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
      "editing.insert": "w",
      "editing.overwrite": "d",
      "editing.addEditAllTracks": "cmd+shift+b",
      "timeline.selectionTool": "a",
      "timeline.fitTimeline": "shift+z",
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
      "timeline.selectionTool": "a",
      "timeline.trackSelectForwardTool": "y",
      "timeline.fitTimeline": "shift+z",
    },
  },
];

function eventMatchesCombo(e: KeyboardEvent, key: string): boolean {
  const isMeta = e.metaKey || e.ctrlKey;
  const combo = parseKeyCombo(key);
  const eventKey = normalizeKey(e.key);
  const keyMatches =
    eventKey === combo.key || e.code.toLowerCase() === combo.key ||
    (e.altKey && PHYSICAL_PUNCTUATION[e.code] === combo.key) ||
    // Option+letter types a dead/accented character on macOS; match the key.
    (e.altKey && /^[a-z]$/.test(combo.key) && e.code === `Key${combo.key.toUpperCase()}`) ||
    (eventKey === "backspace" && combo.key === "delete");
  const metaMatches = (combo.meta || combo.ctrl) === isMeta;
  const shiftMatches = combo.shift === e.shiftKey ||
    (!combo.shift && e.shiftKey && isShiftedSymbol(combo.key) && eventKey === combo.key);
  return keyMatches && metaMatches && shiftMatches && combo.alt === e.altKey;
}

/** Palette bindings in preference order; the first one no editor command claims wins. */
const SEARCH_PALETTE_KEYS = ["cmd+k", "cmd+shift+p", "cmd+/"] as const;

export interface PresetDiffEntry {
  id: string;
  name: string;
  category: ShortcutCategory;
  /** Binding before the preset. */
  from: string;
  /** Binding after the preset ("" when the command ended up unassigned). */
  to: string;
  fromLabel: string;
  toLabel: string;
  /** True when the command was displaced by another command taking its key, not named by the preset. */
  displaced: boolean;
}

export interface PresetDiff {
  presetId: string;
  presetName: string;
  /** Number of commands whose binding differs from the OpenReel default. */
  count: number;
  changes: PresetDiffEntry[];
  /** Binding the search palette uses under this preset. */
  searchPaletteKey: string;
  searchPaletteLabel: string;
  /** True when the preset takes the search palette's default key (Premiere's Add Edit takes Cmd+K). */
  searchPaletteMoved: boolean;
}

function resolveSearchPaletteKey(keys: Map<string, string>): string {
  const claimed = (key: string) => {
    for (const current of keys.values()) {
      if (current && comboIdentity(current) === comboIdentity(key)) return true;
    }
    return false;
  };
  return SEARCH_PALETTE_KEYS.find((key) => !claimed(key)) ?? SEARCH_PALETTE_KEYS[SEARCH_PALETTE_KEYS.length - 1];
}

/**
 * Pure simulation of applying `preset` on top of the default bindings (applyPreset resets first).
 * Shared by applyPreset and presetDiff so the caption can never disagree with what is applied.
 */
function computePresetBindings(preset: ShortcutPreset): { keys: Map<string, string>; displaced: Set<string> } {
  const keys = new Map<string, string>(DEFAULT_SHORTCUTS.map((s) => [s.id, s.defaultKey]));
  const displaced = new Set<string>();
  const conflictOf = (key: string, excludeId: string): string | null => {
    for (const [id, current] of keys) {
      if (id !== excludeId && comboIdentity(current) === comboIdentity(key)) return id;
    }
    return null;
  };
  for (const [id, key] of Object.entries(preset.shortcuts)) {
    if (!keys.has(id)) continue;
    const conflictId = conflictOf(key, id);
    if (conflictId) {
      const defaultKey = DEFAULT_SHORTCUTS.find((s) => s.id === conflictId)!.defaultKey;
      const alternative = `alt+${defaultKey}`;
      keys.set(conflictId, conflictOf(alternative, conflictId) ? "" : alternative);
      displaced.add(conflictId);
    }
    keys.set(id, key);
    displaced.delete(id);
  }
  return { keys, displaced };
}

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
    let customizations: Record<string, unknown> = {};
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = saved ? JSON.parse(saved) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        customizations = parsed as Record<string, unknown>;
      }
    } catch {
      // Storage may be unavailable or a previous customization may be corrupt.
    }

    DEFAULT_SHORTCUTS.forEach((shortcut) => {
      const customKey = customizations[shortcut.id];
      this.shortcuts.set(shortcut.id, {
        ...shortcut,
        currentKey: typeof customKey === "string" && customKey
          ? customKey
          : shortcut.defaultKey,
      });
    });
  }

  private loadPreset(): void {
    try {
      const saved = localStorage.getItem(PRESET_KEY);
      if (PRESETS.some((preset) => preset.id === saved)) this.activePreset = saved!;
    } catch { /* In-memory shortcuts still work when storage is unavailable. */ }
  }

  private saveShortcuts(): void {
    const customizations: Record<string, string> = {};
    this.shortcuts.forEach((shortcut, id) => {
      if (shortcut.currentKey !== shortcut.defaultKey) {
        customizations[id] = shortcut.currentKey;
      }
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customizations));
    } catch { /* Keep the customization active for this session. */ }
  }

  private savePreset(): void {
    try {
      localStorage.setItem(PRESET_KEY, this.activePreset);
    } catch { /* Keep the preset active for this session. */ }
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
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    const ownsFocus = hasShortcutFocus(e);
    const target = e.composedPath()[0] ?? e.target;
    // A closed shadcn Select retains button focus after applying its value.
    // Save still belongs to the editor; typing/navigation remains with Select.
    const closedSelect = target instanceof Element
      && target.closest('button[role="combobox"][aria-expanded="false"]')
      && !target.closest('[role="dialog"], [role="alertdialog"], [data-editor-shortcuts="off"]');
    const numericField = hasEditorFieldDraft(target) && target instanceof Element
      && !target.closest('[role="dialog"], [role="alertdialog"], [role="combobox"], [role="menu"], [data-editor-shortcuts="off"]');
    if (!ownsFocus && !closedSelect && !numericField) return;
    if (document.querySelector('[aria-modal="true"]:not([data-state="closed"])')) return;

    const matchedShortcut = this.findMatchingShortcut(e);
    if (!ownsFocus && matchedShortcut?.action !== "file.save" && matchedShortcut?.action !== "file.saveAs") return;
    if (numericField && !ownsFocus && !(e.metaKey || e.ctrlKey)) return;
    if (matchedShortcut && this.handlers.get(matchedShortcut.action)?.size) {
      e.preventDefault();
      e.stopPropagation();
      // Holding a key may scrub/zoom continuously, but must not repeat edits,
      // toggle playback, add markers, or open dialogs repeatedly.
      if (e.repeat && !/^(playback\.(frame|second|jump5|prevClip|nextClip)|timeline\.zoom|editing\.nudge)/.test(matchedShortcut.action)) return;
      this.executeAction(matchedShortcut.action, e);
    }
  };

  private findMatchingShortcut(e: KeyboardEvent): ShortcutDefinition | null {
    for (const shortcut of this.shortcuts.values()) {
      if (!shortcut.enabled) continue;

      if (eventMatchesCombo(e, shortcut.currentKey)) return shortcut;
    }

    return null;
  }

  /**
   * Binding for the global search palette. The active preset wins inside the
   * editor: Cmd+K stays the palette unless a preset (Premiere's Add Edit)
   * claims it, in which case the palette moves to the next free binding.
   */
  getSearchPaletteKey(): string {
    return SEARCH_PALETTE_KEYS.find((key) => {
      const claimant = this.findConflict(key);
      return !claimant || !claimant.enabled || !claimant.currentKey;
    }) ?? SEARCH_PALETTE_KEYS[SEARCH_PALETTE_KEYS.length - 1];
  }

  isSearchPaletteEvent(e: KeyboardEvent): boolean {
    return eventMatchesCombo(e, this.getSearchPaletteKey());
  }

  formatSearchPaletteHint(): string {
    return formatKeyComboDisplay(this.getSearchPaletteKey());
  }

  /** Invoke the same editing command from a menu or a keyboard shortcut. */
  runCommand(action: string): void {
    this.executeAction(action, new KeyboardEvent("keydown"));
  }

  private interceptor: ((action: string, e: KeyboardEvent) => boolean) | null = null;

  /**
   * Route shortcuts to a focused sub-editor (the Source monitor). The
   * interceptor sees the resolved action id, so presets and custom bindings
   * keep working; returning true consumes the action.
   */
  setActionInterceptor(
    interceptor: ((action: string, e: KeyboardEvent) => boolean) | null,
  ): () => void {
    this.interceptor = interceptor;
    return () => {
      if (this.interceptor === interceptor) this.interceptor = null;
    };
  }

  private executeAction(action: string, e: KeyboardEvent): void {
    if (this.interceptor?.(action, e)) return;
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

  resetShortcut(id: string): boolean {
    const shortcut = this.shortcuts.get(id);
    if (shortcut) {
      if (this.findConflict(shortcut.defaultKey, id)) return false;
      this.shortcuts.set(id, { ...shortcut, currentKey: shortcut.defaultKey });
      this.saveShortcuts();
      return true;
    }
    return false;
  }

  resetAllShortcuts(): void {
    this.shortcuts.forEach((shortcut, id) => {
      this.shortcuts.set(id, { ...shortcut, currentKey: shortcut.defaultKey });
    });
    this.saveShortcuts();
    this.activePreset = "openreel";
    this.savePreset();
  }

  findConflict(key: string, excludeId?: string): ShortcutDefinition | null {
    for (const [id, shortcut] of this.shortcuts) {
      if (id === excludeId) continue;
      if (comboIdentity(shortcut.currentKey) === comboIdentity(key)) {
        return shortcut;
      }
    }
    return null;
  }

  getPresets(): ShortcutPreset[] {
    return PRESETS;
  }

  /** What applying `presetId` would change versus the OpenReel defaults. Does not touch the live bindings. */
  presetDiff(presetId: string): PresetDiff | null {
    return buildPresetDiff(presetId);
  }

  getActivePreset(): string {
    return this.activePreset;
  }

  applyPreset(presetId: string): void {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    this.resetAllShortcuts();

    // A preset override takes precedence over the default binding it replaces. The displaced command is
    // relocated so both stay reachable (Final Cut uses [ / ] for trimming, OpenReel uses them for clip navigation).
    const { keys } = computePresetBindings(preset);
    keys.forEach((key, id) => {
      const shortcut = this.shortcuts.get(id);
      if (shortcut && shortcut.currentKey !== key) this.shortcuts.set(id, { ...shortcut, currentKey: key });
    });

    this.activePreset = presetId;
    this.saveShortcuts();
    this.savePreset();
  }

  formatShortcut(id: string): string {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut?.currentKey) return "";
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

function buildPresetDiff(presetId: string): PresetDiff | null {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  const { keys, displaced } = computePresetBindings(preset);
  const changes: PresetDiffEntry[] = [];
  for (const def of DEFAULT_SHORTCUTS) {
    const to = keys.get(def.id) ?? def.defaultKey;
    if (to === def.defaultKey) continue;
    changes.push({
      id: def.id,
      name: def.name,
      category: def.category,
      from: def.defaultKey,
      to,
      fromLabel: formatKeyComboDisplay(def.defaultKey),
      toLabel: to ? formatKeyComboDisplay(to) : "Unassigned",
      displaced: displaced.has(def.id),
    });
  }
  const searchPaletteKey = resolveSearchPaletteKey(keys);
  return {
    presetId: preset.id,
    presetName: preset.name,
    count: changes.length,
    changes,
    searchPaletteKey,
    searchPaletteLabel: formatKeyComboDisplay(searchPaletteKey),
    searchPaletteMoved: searchPaletteKey !== SEARCH_PALETTE_KEYS[0],
  };
}

export function formatKeyComboDisplay(key: string): string {
  const combo = parseKeyCombo(key);
  return formatKeyCombo(combo);
}
