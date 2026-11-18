import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Keyboard, Search, RotateCcw, ChevronDown, X } from "@/icons/lucide-compat";
import {
  Button, Card, Input, Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose, DropdownMenu, DropdownMenuTrigger,
  DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  ToggleGroup, ToggleGroupItem,
} from "@openreel/ui";
import {
  keyboardShortcuts,
  formatKeyComboDisplay,
  captureKeyCombo,
  type ShortcutCategory,
  type ShortcutDefinition,
} from "../../services/keyboard-shortcuts";
import { describePresetDiff } from "../onboarding/pro/preset-caption";

const categoryOptions: Array<{ label: string; value: ShortcutCategory | "all"; }> = [
  { value: "all", label: "All" },
  ...keyboardShortcuts.getCategories().map(category => ({
    value: category, label: keyboardShortcuts.getCategoryName(category),
  })),
];
const presets = keyboardShortcuts.getPresets();

interface KeyboardShortcutsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsOverlay: React.FC<
  KeyboardShortcutsOverlayProps
> = ({ isOpen, onClose }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<
    ShortcutCategory | "all"
  >("all");
  const [shortcuts, setShortcuts] = useState<ShortcutDefinition[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const shortcutButtons = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<string | null>(null);
  const finishCapture = useCallback((id: string) => {
    returnFocus.current = id;
    setEditingId(null);
  }, []);
  const [activePreset, setActivePreset] = useState(
    keyboardShortcuts.getActivePreset(),
  );

  const presetDiff = useMemo(() => keyboardShortcuts.presetDiff(activePreset), [activePreset]);

  useEffect(() => {
    if (isOpen) {
      setShortcuts(keyboardShortcuts.getAllShortcuts());
      setActivePreset(keyboardShortcuts.getActivePreset());
      setShortcutError(null);
    } else {
      returnFocus.current = null;
      setEditingId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && editingId === null && returnFocus.current) {
      shortcutButtons.current.get(returnFocus.current)?.focus();
      returnFocus.current = null;
    }
  }, [isOpen, editingId]);

  const normalizedQuery = searchQuery.toLowerCase();
  const filteredShortcuts = shortcuts.filter((shortcut) => {
    const matchesCategory =
      activeCategory === "all" || shortcut.category === activeCategory;
    const matchesSearch =
      searchQuery === "" ||
      shortcut.name.toLowerCase().includes(normalizedQuery) ||
      shortcut.description.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesSearch;
  });

  const groupedShortcuts = filteredShortcuts.reduce(
    (acc, shortcut) => {
      if (!acc[shortcut.category]) {
        acc[shortcut.category] = [];
      }
      acc[shortcut.category].push(shortcut);
      return acc;
    },
    {} as Record<ShortcutCategory, ShortcutDefinition[]>,
  );

  const handleShortcutCapture = useCallback(
    (e: React.KeyboardEvent, shortcutId: string) => {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        finishCapture(shortcutId);
        return;
      }

      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
        return;
      }

      const newKey = captureKeyCombo(e);
      const conflict = keyboardShortcuts.findConflict(newKey, shortcutId);

      if (conflict) {
        setShortcutError(`This shortcut is used by ${conflict.name}. Choose a different key.`);
        return;
      }

      keyboardShortcuts.setShortcut(shortcutId, newKey);
      setShortcuts(keyboardShortcuts.getAllShortcuts());
      finishCapture(shortcutId);
      setShortcutError(null);
    },
    [finishCapture],
  );

  const handleResetShortcut = (id: string) => {
    const shortcut = keyboardShortcuts.getShortcut(id);
    const conflict = shortcut && keyboardShortcuts.findConflict(shortcut.defaultKey, id);
    if (conflict) {
      setShortcutError(`The default key is used by ${conflict.name}. Change that shortcut first or reset all shortcuts.`);
      return;
    }
    keyboardShortcuts.resetShortcut(id);
    setShortcuts(keyboardShortcuts.getAllShortcuts());
    setShortcutError(null);
  };

  const handleResetAll = () => {
    keyboardShortcuts.resetAllShortcuts();
    setShortcuts(keyboardShortcuts.getAllShortcuts());
    setActivePreset(keyboardShortcuts.getActivePreset());
    setShortcutError(null);
  };

  const handleApplyPreset = (presetId: string) => {
    keyboardShortcuts.applyPreset(presetId);
    setShortcuts(keyboardShortcuts.getAllShortcuts());
    setActivePreset(presetId);
    setShortcutError(null);
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        hideCloseButton
        className="flex max-h-[90vh] w-[calc(100vw-32px)] max-w-[768px] flex-col gap-0 overflow-hidden border-border bg-bg-1 p-0 text-fg shadow-xl"
        onEscapeKeyDown={(event) => {
          if (editingId) {
            event.preventDefault();
            finishCapture(editingId);
          }
        }}
      >
        <DialogHeader className="flex-row items-start gap-3 space-y-0 border-b border-border px-5 py-4 text-left">
          <Keyboard size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[15px] font-semibold leading-5 text-fg">Keyboard Shortcuts</DialogTitle>
            <DialogDescription className="mt-1 text-[12px] leading-4 text-fg-muted">Find shortcuts, choose a preset, or customize your keys.</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close dialog" className="h-7 w-7 shrink-0 rounded-[7px] text-fg-muted hover:bg-bg-2 hover:text-fg">
              <X size={15} aria-hidden />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 max-h-[65vh]">
          <div className="space-y-4">
            {shortcutError && <p role="status" className="text-sm text-red-400">{shortcutError}</p>}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="relative">
                  <Search size={16} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
                  <Input
                    aria-label="Search shortcuts"
                    type="search"
                    value={searchQuery}
                    onChange={(event) => {
                      returnFocus.current = null;
                      setEditingId(null);
                      setSearchQuery(event.target.value);
                    }}
                    placeholder="Search shortcuts..."
                    className="h-8 w-full rounded-[7px] border-border bg-bg-0 pl-8 text-[12px]"
                  />
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" aria-label="Keyboard shortcut preset" className="h-8 min-w-0 gap-1.5 rounded-[7px] border-border bg-bg-2 px-3 text-[12px] text-fg-2 hover:bg-bg-3 hover:text-fg">
                    <ChevronDown size={14} aria-hidden />
                    <span className="truncate">{presets.find(preset => preset.id === activePreset)?.name || "Preset"}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" aria-labelledby={undefined} aria-label="Keyboard shortcut presets" className="w-56 rounded-[7px] border-border bg-bg-1 text-fg">
                  <DropdownMenuRadioGroup value={activePreset} onValueChange={handleApplyPreset}>
                    {presets.map(preset => (
                      <DropdownMenuRadioItem key={preset.id} value={preset.id} className="items-start rounded-[7px] py-2 text-left data-[state=checked]:text-accent">
                        <span className="min-w-0">
                          <span className="block text-[12px] font-bold leading-4">{preset.name}</span>
                          <span className="block text-[10px] font-normal text-fg-2">{preset.description}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button onClick={handleResetAll} type="button" aria-label="Reset All" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<RotateCcw size={14} aria-hidden />}</span>
                <span className="truncate">{"Reset All"}</span>
              </Button>
            </div>

            {presetDiff && presetDiff.count > 0 && (
              <p className="text-[11px] leading-4 text-fg-3" data-testid="shortcut-preset-diff">
                {describePresetDiff(presetDiff)}
              </p>
            )}

            <div className="overflow-x-auto">
              <ToggleGroup
                type="single"
                aria-label="Shortcut category"
                className="grid min-h-8 min-w-[640px] grid-cols-8 gap-0 rounded-[7px] border border-border bg-bg-1 p-0.5"
                value={activeCategory}
                onValueChange={(value) => {
                  if (!categoryOptions.some(option => option.value === value)) return;
                  returnFocus.current = null;
                  setEditingId(null);
                  setActiveCategory(value as ShortcutCategory | "all");
                }}
              >
                {categoryOptions.map(option => (
                  <ToggleGroupItem key={option.value} value={option.value} aria-label={option.label} className="h-7 min-w-0 rounded-[5px] px-2 text-[12px] font-semibold text-fg-muted hover:bg-bg-2 hover:text-fg-2 data-[state=on]:bg-bg-3 data-[state=on]:text-fg data-[state=on]:shadow-sm">
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="space-y-6">
              {Object.entries(groupedShortcuts).map(
                ([category, categoryShortcuts]) => (
                  <div key={category}>
                    <h3 className="text-fg-2 font-bold block mb-3 text-xs uppercase"
                    >
                      {keyboardShortcuts.getCategoryName(
                        category as ShortcutCategory,
                      )}
                    </h3>
                    <div className="space-y-1">
                      {categoryShortcuts.map((shortcut) => (
                        <Card key={shortcut.id} className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-transparent text-fg p-2 group flex items-center justify-between hover:bg-background-tertiary"
                        >
                          <div className="flex-1">
                            <span className="text-[13px] leading-5 text-fg-2 font-normal block">
                              {shortcut.name}
                            </span>
                            <span className="text-fg-2 font-normal block text-[10px]">
                              {shortcut.description}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {editingId === shortcut.id ? (
                              <Input
                                aria-label={`Set shortcut for ${shortcut.name}`}
                                value=""
                                readOnly
                                onKeyDown={(event) => handleShortcutCapture(event, shortcut.id)}
                                placeholder="Press keys..."
                                autoFocus
                                className="h-7 w-32 rounded-[7px] border-border bg-bg-0 text-[12px]"
                              />
                            ) : (
                              <Button
                                ref={(node) => {
                                  if (node) shortcutButtons.current.set(shortcut.id, node);
                                  else shortcutButtons.current.delete(shortcut.id);
                                }}
                                onClick={() => { setEditingId(shortcut.id); setShortcutError(null); }}
                                type="button"
                                aria-label={`Customize ${shortcut.name} shortcut`}
                                className="inline-flex h-7 min-w-[80px] items-center justify-center gap-1.5 rounded-[7px] border border-border bg-bg-2 px-2.5 font-mono text-[12px] font-semibold text-fg-2 hover:bg-bg-3 hover:text-fg"
                              >
                                {(formatKeyComboDisplay(shortcut.currentKey)) ? <span className="truncate">{formatKeyComboDisplay(shortcut.currentKey)}</span> : null}
                              </Button>
                            )}
                            {shortcut.currentKey !== shortcut.defaultKey && (
                              <Button variant="ghost" size="icon-sm" onClick={() => handleResetShortcut(shortcut.id)} type="button" aria-label={`Reset ${shortcut.name} shortcut to default`} title="Reset to default" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
                                {<RotateCcw size={12} aria-hidden />}
                              </Button>
                            )}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                ),
              )}

              {filteredShortcuts.length === 0 && (
                <div role="status" className="flex flex-col items-center gap-2 py-6 text-center text-fg-muted">
                  <Keyboard size={32} className="opacity-30" aria-hidden />
                  <p className="text-[12px]">No shortcuts found</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="shrink-0 items-center justify-end border-t border-border bg-bg-1 px-5 py-4">
          <span className="text-fg-2 font-normal block text-center text-[10px]">
            Click a shortcut key to customize • Press{" "}
            <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-bg-2 px-1.5 font-mono text-[10px] font-semibold uppercase leading-none text-fg-2 shadow-sm">{"Esc"}</kbd>{" "}
            to close
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
