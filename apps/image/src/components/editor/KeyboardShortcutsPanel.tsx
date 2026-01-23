import { X, Keyboard } from 'lucide-react';

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Tools',
    shortcuts: [
      { keys: ['V'], description: 'Select tool' },
      { keys: ['H'], description: 'Hand/Pan tool' },
      { keys: ['T'], description: 'Text tool' },
      { keys: ['S'], description: 'Shape tool' },
      { keys: ['P'], description: 'Pen tool' },
      { keys: ['I'], description: 'Eyedropper' },
      { keys: ['Z'], description: 'Zoom tool' },
    ],
  },
  {
    title: 'Edit',
    shortcuts: [
      { keys: ['⌘', 'Z'], description: 'Undo' },
      { keys: ['⌘', '⇧', 'Z'], description: 'Redo' },
      { keys: ['⌘', 'C'], description: 'Copy' },
      { keys: ['⌘', 'X'], description: 'Cut' },
      { keys: ['⌘', 'V'], description: 'Paste' },
      { keys: ['⌘', 'D'], description: 'Duplicate' },
      { keys: ['Delete'], description: 'Delete selected' },
    ],
  },
  {
    title: 'Selection',
    shortcuts: [
      { keys: ['⌘', 'A'], description: 'Select all' },
      { keys: ['Esc'], description: 'Deselect all' },
      { keys: ['⌘', 'G'], description: 'Group layers' },
      { keys: ['⌘', '⇧', 'G'], description: 'Ungroup layers' },
    ],
  },
  {
    title: 'Layer Order',
    shortcuts: [
      { keys: ['⌘', ']'], description: 'Bring forward' },
      { keys: ['⌘', '['], description: 'Send backward' },
      { keys: ['⌘', '⇧', ']'], description: 'Bring to front' },
      { keys: ['⌘', '⇧', '['], description: 'Send to back' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { keys: ['⌘', '+'], description: 'Zoom in' },
      { keys: ['⌘', '-'], description: 'Zoom out' },
      { keys: ['⌘', '0'], description: 'Zoom to fit' },
      { keys: ["⌘", "'"], description: 'Toggle grid' },
      { keys: ['⌘', ';'], description: 'Toggle guides' },
    ],
  },
  {
    title: 'Other',
    shortcuts: [
      { keys: ['?'], description: 'Show shortcuts' },
      { keys: ['⌘', ','], description: 'Settings' },
    ],
  },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsPanel({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Keyboard size={20} className="text-primary" />
            <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
          <div className="grid grid-cols-2 gap-6">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title} className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">{group.title}</h3>
                <div className="space-y-1.5">
                  {group.shortcuts.map((shortcut, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <span className="text-sm text-muted-foreground">
                        {shortcut.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <kbd
                            key={keyIndex}
                            className="min-w-[24px] h-6 px-1.5 flex items-center justify-center text-[11px] font-medium bg-secondary border border-border rounded shadow-sm"
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground text-center">
              Press <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-[10px]">?</kbd> to toggle this panel
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
