import React, { useState, useEffect, useCallback } from "react";
import { Keyboard, Search, RotateCcw, ChevronDown } from "@/icons/lucide-compat";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftEmptyState as EmptyState } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftKbd as Kbd } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import {
  keyboardShortcuts,
  formatKeyComboDisplay,
  type ShortcutCategory,
  type ShortcutDefinition,
} from "../../services/keyboard-shortcuts";

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
  const [showPresets, setShowPresets] = useState(false);
  const [activePreset, setActivePreset] = useState(
    keyboardShortcuts.getActivePreset(),
  );

  useEffect(() => {
    setShortcuts(keyboardShortcuts.getAllShortcuts());
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (editingId) {
          setEditingId(null);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, editingId]);

  const filteredShortcuts = shortcuts.filter((shortcut) => {
    const matchesCategory =
      activeCategory === "all" || shortcut.category === activeCategory;
    const matchesSearch =
      searchQuery === "" ||
      shortcut.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      shortcut.description.toLowerCase().includes(searchQuery.toLowerCase());
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
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setEditingId(null);
        return;
      }

      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
        return;
      }

      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("cmd");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");
      parts.push(e.key.toLowerCase());

      const newKey = parts.join("+");
      const conflict = keyboardShortcuts.findConflict(newKey, shortcutId);

      if (conflict) {
        alert(
          `This shortcut conflicts with "${conflict.name}". Choose a different key.`,
        );
        return;
      }

      keyboardShortcuts.setShortcut(shortcutId, newKey);
      setShortcuts(keyboardShortcuts.getAllShortcuts());
      setEditingId(null);
    },
    [],
  );

  const handleResetShortcut = (id: string) => {
    keyboardShortcuts.resetShortcut(id);
    setShortcuts(keyboardShortcuts.getAllShortcuts());
  };

  const handleResetAll = () => {
    if (confirm("Reset all shortcuts to defaults?")) {
      keyboardShortcuts.resetAllShortcuts();
      setShortcuts(keyboardShortcuts.getAllShortcuts());
    }
  };

  const handleApplyPreset = (presetId: string) => {
    keyboardShortcuts.applyPreset(presetId);
    setShortcuts(keyboardShortcuts.getAllShortcuts());
    setActivePreset(presetId);
    setShowPresets(false);
  };

  const categories = keyboardShortcuts.getCategories();
  const categoryOptions: Array<{ label: string; value: ShortcutCategory | "all" }> = [
    { value: "all", label: "All" },
    ...categories.map((category) => ({
      value: category,
      label: keyboardShortcuts.getCategoryName(category),
    })),
  ];
  const presets = keyboardShortcuts.getPresets();

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      width={768}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title="Keyboard Shortcuts"
            onOpenChange={(open) => !open && onClose()}
            startContent={<Keyboard size={20} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="max-h-[65vh] overflow-y-auto">
        <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <ToolcraftTextInputControl
              label="Search shortcuts"
              isLabelHidden
              type="text"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search shortcuts..."
              startIcon={<Search size={16} aria-hidden />}
              width="100%"
            />
          </div>

          <div className="relative">
            <Button
              label={presets.find((p) => p.id === activePreset)?.name || "Preset"}
              onClick={() => setShowPresets(!showPresets)}
              variant="secondary"
              icon={<ChevronDown size={14} aria-hidden />}
            />
            {showPresets && (
              <Card
                variant="default"
                padding={1}
                className="absolute top-full right-0 z-10 mt-1 w-56 border border-border shadow-lg"
              >
                {presets.map((preset) => (
                  <ClickableCard
                    key={preset.id}
                    label={`Apply ${preset.name} preset`}
                    onClick={() => handleApplyPreset(preset.id)}
                    padding={2}
                    variant={activePreset === preset.id ? "green" : "transparent"}
                  >
                    <Text type="label" weight="bold" color={activePreset === preset.id ? "active" : "primary"} display="block">
                      {preset.name}
                    </Text>
                    <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                      {preset.description}
                    </Text>
                  </ClickableCard>
                ))}
              </Card>
            )}
          </div>

          <Button
            label="Reset All"
            onClick={handleResetAll}
            variant="ghost"
            icon={<RotateCcw size={14} aria-hidden />}
          />
        </div>

        <div className="overflow-x-auto">
          <ToolcraftSegmentedControl<ShortcutCategory | "all">
            ariaLabel="Shortcut category"
            className="min-w-[640px]"
            value={activeCategory}
            onChange={setActiveCategory}
            options={categoryOptions}
          />
        </div>

        <div className="space-y-6">
          {Object.entries(groupedShortcuts).map(
            ([category, categoryShortcuts]) => (
              <div key={category}>
                <Text
                  as="h3"
                  type="supporting"
                  weight="bold"
                  color="secondary"
                  display="block"
                  className="mb-3 text-xs uppercase"
                >
                  {keyboardShortcuts.getCategoryName(
                    category as ShortcutCategory,
                  )}
                </Text>
                <div className="space-y-1">
                  {categoryShortcuts.map((shortcut) => (
                    <Card
                      key={shortcut.id}
                      variant="transparent"
                      padding={2}
                      className="group flex items-center justify-between hover:bg-background-tertiary"
                    >
                      <div className="flex-1">
                        <Text type="body" display="block">
                          {shortcut.name}
                        </Text>
                        <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                          {shortcut.description}
                        </Text>
                      </div>
                      <div className="flex items-center gap-2">
                        {editingId === shortcut.id ? (
                          <ToolcraftTextInputControl
                            label={`Set shortcut for ${shortcut.name}`}
                            isLabelHidden
                            value=""
                            onKeyDown={(e) =>
                              handleShortcutCapture(e, shortcut.id)
                            }
                            placeholder="Press keys..."
                            hasAutoFocus
                            width={128}
                            size="sm"
                          />
                        ) : (
                          <Button
                            label={formatKeyComboDisplay(shortcut.currentKey)}
                            onClick={() => setEditingId(shortcut.id)}
                            variant="secondary"
                            size="sm"
                            className="min-w-[80px] font-mono"
                          />
                        )}
                        {shortcut.currentKey !== shortcut.defaultKey && (
                          <IconButton
                            label="Reset to default"
                            onClick={() => handleResetShortcut(shortcut.id)}
                            variant="ghost"
                            size="sm"
                            icon={<RotateCcw size={12} aria-hidden />}
                            className="opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ),
          )}

          {filteredShortcuts.length === 0 && (
            <EmptyState
              title="No shortcuts found"
              icon={<Keyboard size={32} className="text-text-muted opacity-30" aria-hidden />}
              isCompact
            />
          )}
        </div>
        </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
          <Text type="supporting" color="secondary" display="block" justify="center" className="text-[10px]">
            Click a shortcut key to customize • Press{" "}
            <Kbd keys="?" />{" "}
            to toggle this overlay
          </Text>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};

export default KeyboardShortcutsOverlay;
