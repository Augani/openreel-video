import { useState } from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@openreel/ui';
import { ChevronDown, Plus, Trash2, X, Bookmark, History, FolderPlus, Pencil, Check } from 'lucide-react';
import { useColorStore, type CustomPalette } from '../../stores/color-store';

interface SavedColorsSectionProps {
  onColorSelect: (color: string) => void;
  selectedColor?: string;
  currentColor?: string;
}

export function SavedColorsSection({ onColorSelect, selectedColor, currentColor }: SavedColorsSectionProps) {
  const {
    recentColors,
    savedColors,
    customPalettes,
    saveColor,
    removeSavedColor,
    clearSavedColors,
    createPalette,
    updatePalette,
    addColorToPalette,
    removeColorFromPalette,
    deletePalette,
  } = useColorStore();

  const [isOpen, setIsOpen] = useState(true);
  const [editingPaletteId, setEditingPaletteId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [showNewPaletteInput, setShowNewPaletteInput] = useState(false);
  const [newPaletteName, setNewPaletteName] = useState('');

  const handleSaveCurrentColor = () => {
    if (currentColor) {
      saveColor(currentColor);
    }
  };

  const handleCreatePalette = () => {
    if (newPaletteName.trim()) {
      createPalette(newPaletteName.trim());
      setNewPaletteName('');
      setShowNewPaletteInput(false);
    }
  };

  const handleStartEditPalette = (palette: CustomPalette) => {
    setEditingPaletteId(palette.id);
    setEditingName(palette.name);
  };

  const handleFinishEditPalette = () => {
    if (editingPaletteId && editingName.trim()) {
      updatePalette(editingPaletteId, { name: editingName.trim() });
    }
    setEditingPaletteId(null);
    setEditingName('');
  };

  const handleAddCurrentToPalette = (paletteId: string) => {
    if (currentColor) {
      addColorToPalette(paletteId, currentColor);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
          <div className="flex items-center gap-2">
            <Bookmark size={14} className="text-muted-foreground" />
            <span className="text-xs font-medium">Saved Colors</span>
          </div>
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-2 space-y-3 bg-background/50 rounded-b-lg border border-t-0 border-border">
          {recentColors.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <History size={12} className="text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Recent</span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {recentColors.map((color, i) => (
                  <button
                    key={`${color}-${i}`}
                    onClick={() => onColorSelect(color)}
                    className={`w-full aspect-square rounded border transition-all hover:scale-110 ${
                      selectedColor?.toLowerCase() === color.toLowerCase()
                        ? 'border-primary ring-2 ring-primary/30'
                        : 'border-border/50 hover:border-border'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Bookmark size={12} className="text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Saved</span>
                <span className="text-[9px] text-muted-foreground/60">({savedColors.length})</span>
              </div>
              <div className="flex items-center gap-1">
                {currentColor && (
                  <button
                    onClick={handleSaveCurrentColor}
                    className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Save current color"
                  >
                    <Plus size={12} />
                  </button>
                )}
                {savedColors.length > 0 && (
                  <button
                    onClick={clearSavedColors}
                    className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    title="Clear all saved colors"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
            {savedColors.length > 0 ? (
              <div className="grid grid-cols-6 gap-1">
                {savedColors.map((color, i) => (
                  <div key={`${color}-${i}`} className="relative group">
                    <button
                      onClick={() => onColorSelect(color)}
                      className={`w-full aspect-square rounded border transition-all hover:scale-110 ${
                        selectedColor?.toLowerCase() === color.toLowerCase()
                          ? 'border-primary ring-2 ring-primary/30'
                          : 'border-border/50 hover:border-border'
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                    <button
                      onClick={() => removeSavedColor(color)}
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      title="Remove color"
                    >
                      <X size={8} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground/60 text-center py-2">
                No saved colors yet
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Custom Palettes</span>
              <button
                onClick={() => setShowNewPaletteInput(true)}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="Create new palette"
              >
                <FolderPlus size={12} />
              </button>
            </div>

            {showNewPaletteInput && (
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newPaletteName}
                  onChange={(e) => setNewPaletteName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreatePalette();
                    if (e.key === 'Escape') setShowNewPaletteInput(false);
                  }}
                  placeholder="Palette name..."
                  className="flex-1 px-2 py-1 text-[10px] bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  onClick={handleCreatePalette}
                  className="p-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Check size={12} />
                </button>
                <button
                  onClick={() => setShowNewPaletteInput(false)}
                  className="p-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {customPalettes.map((palette) => (
              <div key={palette.id} className="space-y-1 p-2 bg-secondary/30 rounded-lg">
                <div className="flex items-center justify-between">
                  {editingPaletteId === palette.id ? (
                    <div className="flex-1 flex gap-1 mr-1">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleFinishEditPalette();
                          if (e.key === 'Escape') setEditingPaletteId(null);
                        }}
                        className="flex-1 px-1.5 py-0.5 text-[10px] bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-primary"
                        autoFocus
                      />
                      <button
                        onClick={handleFinishEditPalette}
                        className="p-0.5 rounded bg-primary text-primary-foreground"
                      >
                        <Check size={10} />
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] font-medium text-foreground">{palette.name}</span>
                  )}
                  <div className="flex items-center gap-0.5">
                    {currentColor && (
                      <button
                        onClick={() => handleAddCurrentToPalette(palette.id)}
                        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        title="Add current color"
                      >
                        <Plus size={10} />
                      </button>
                    )}
                    <button
                      onClick={() => handleStartEditPalette(palette)}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title="Rename palette"
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      onClick={() => deletePalette(palette.id)}
                      className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete palette"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
                {palette.colors.length > 0 ? (
                  <div className="grid grid-cols-6 gap-1">
                    {palette.colors.map((color, i) => (
                      <div key={`${color}-${i}`} className="relative group">
                        <button
                          onClick={() => onColorSelect(color)}
                          className={`w-full aspect-square rounded border transition-all hover:scale-110 ${
                            selectedColor?.toLowerCase() === color.toLowerCase()
                              ? 'border-primary ring-2 ring-primary/30'
                              : 'border-border/50 hover:border-border'
                          }`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                        <button
                          onClick={() => removeColorFromPalette(palette.id, color)}
                          className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        >
                          <X size={7} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] text-muted-foreground/60 text-center py-1">
                    Empty palette
                  </p>
                )}
              </div>
            ))}

            {customPalettes.length === 0 && !showNewPaletteInput && (
              <p className="text-[10px] text-muted-foreground/60 text-center py-2">
                No custom palettes yet
              </p>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
