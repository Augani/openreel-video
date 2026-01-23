import { useState } from 'react';
import { Ruler, Plus, Trash2, X, ArrowRight, ArrowDown } from 'lucide-react';
import { useCanvasStore, type Guide } from '../../../stores/canvas-store';
import { useProjectStore } from '../../../stores/project-store';

export function GuidePanel() {
  const { guides, addGuide, removeGuide, updateGuide, clearGuides } = useCanvasStore();
  const { project, selectedArtboardId } = useProjectStore();
  const [editingGuideId, setEditingGuideId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newGuideType, setNewGuideType] = useState<'horizontal' | 'vertical'>('horizontal');
  const [newGuidePosition, setNewGuidePosition] = useState('');

  const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);

  const horizontalGuides = guides.filter((g) => g.type === 'horizontal');
  const verticalGuides = guides.filter((g) => g.type === 'vertical');

  const handleAddGuide = () => {
    const position = parseFloat(newGuidePosition);
    if (!isNaN(position)) {
      addGuide(newGuideType, position);
      setNewGuidePosition('');
      setShowAddForm(false);
    }
  };

  const handleStartEdit = (guide: Guide) => {
    setEditingGuideId(guide.id);
    setEditingValue(guide.position.toString());
  };

  const handleFinishEdit = () => {
    if (editingGuideId) {
      const position = parseFloat(editingValue);
      if (!isNaN(position)) {
        updateGuide(editingGuideId, position);
      }
    }
    setEditingGuideId(null);
    setEditingValue('');
  };

  const handleAddCenterGuides = () => {
    if (artboard) {
      addGuide('horizontal', artboard.size.height / 2);
      addGuide('vertical', artboard.size.width / 2);
    }
  };

  const handleAddThirdsGuides = () => {
    if (artboard) {
      addGuide('horizontal', artboard.size.height / 3);
      addGuide('horizontal', (artboard.size.height * 2) / 3);
      addGuide('vertical', artboard.size.width / 3);
      addGuide('vertical', (artboard.size.width * 2) / 3);
    }
  };

  const handleAddEdgeGuides = () => {
    if (artboard) {
      const margin = Math.min(artboard.size.width, artboard.size.height) * 0.1;
      addGuide('horizontal', margin);
      addGuide('horizontal', artboard.size.height - margin);
      addGuide('vertical', margin);
      addGuide('vertical', artboard.size.width - margin);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Ruler size={14} className="text-muted-foreground" />
          <h3 className="text-xs font-medium text-foreground">Guides</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">{guides.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-2 space-y-3">
          <div className="flex gap-1">
            <button
              onClick={() => setShowAddForm(true)}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={12} />
              Add Guide
            </button>
            {guides.length > 0 && (
              <button
                onClick={clearGuides}
                className="p-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                title="Clear all guides"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>

          {showAddForm && (
            <div className="p-2 bg-secondary/50 rounded-lg space-y-2">
              <div className="flex gap-1">
                <button
                  onClick={() => setNewGuideType('horizontal')}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] transition-colors ${
                    newGuideType === 'horizontal'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ArrowRight size={10} />
                  Horizontal
                </button>
                <button
                  onClick={() => setNewGuideType('vertical')}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] transition-colors ${
                    newGuideType === 'vertical'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ArrowDown size={10} />
                  Vertical
                </button>
              </div>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={newGuidePosition}
                  onChange={(e) => setNewGuidePosition(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddGuide();
                    if (e.key === 'Escape') setShowAddForm(false);
                  }}
                  placeholder={newGuideType === 'horizontal' ? 'Y position...' : 'X position...'}
                  className="flex-1 px-2 py-1 text-[10px] bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  onClick={handleAddGuide}
                  className="px-2 py-1 rounded bg-primary text-primary-foreground text-[10px] hover:bg-primary/90 transition-colors"
                >
                  Add
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="p-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground font-medium">Quick Presets</span>
            <div className="grid grid-cols-3 gap-1">
              <button
                onClick={handleAddCenterGuides}
                className="px-2 py-1.5 rounded bg-secondary/50 text-[9px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                Center
              </button>
              <button
                onClick={handleAddThirdsGuides}
                className="px-2 py-1.5 rounded bg-secondary/50 text-[9px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                Thirds
              </button>
              <button
                onClick={handleAddEdgeGuides}
                className="px-2 py-1.5 rounded bg-secondary/50 text-[9px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                Margins
              </button>
            </div>
          </div>

          {horizontalGuides.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <ArrowRight size={10} className="text-blue-400" />
                <span className="text-[10px] text-muted-foreground">
                  Horizontal ({horizontalGuides.length})
                </span>
              </div>
              <div className="space-y-0.5">
                {horizontalGuides.map((guide) => (
                  <div
                    key={guide.id}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500/10 group"
                  >
                    <span className="text-[10px] text-blue-400 w-4">Y</span>
                    {editingGuideId === guide.id ? (
                      <input
                        type="number"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onBlur={handleFinishEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleFinishEdit();
                          if (e.key === 'Escape') setEditingGuideId(null);
                        }}
                        className="flex-1 px-1 py-0.5 text-[10px] bg-background border border-primary rounded focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => handleStartEdit(guide)}
                        className="flex-1 text-left text-[10px] text-foreground hover:text-primary transition-colors"
                      >
                        {Math.round(guide.position)}px
                      </button>
                    )}
                    <button
                      onClick={() => removeGuide(guide.id)}
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {verticalGuides.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <ArrowDown size={10} className="text-green-400" />
                <span className="text-[10px] text-muted-foreground">
                  Vertical ({verticalGuides.length})
                </span>
              </div>
              <div className="space-y-0.5">
                {verticalGuides.map((guide) => (
                  <div
                    key={guide.id}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/10 group"
                  >
                    <span className="text-[10px] text-green-400 w-4">X</span>
                    {editingGuideId === guide.id ? (
                      <input
                        type="number"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onBlur={handleFinishEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleFinishEdit();
                          if (e.key === 'Escape') setEditingGuideId(null);
                        }}
                        className="flex-1 px-1 py-0.5 text-[10px] bg-background border border-primary rounded focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => handleStartEdit(guide)}
                        className="flex-1 text-left text-[10px] text-foreground hover:text-primary transition-colors"
                      >
                        {Math.round(guide.position)}px
                      </button>
                    )}
                    <button
                      onClick={() => removeGuide(guide.id)}
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {guides.length === 0 && !showAddForm && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Ruler size={24} className="text-muted-foreground/40 mb-2" />
              <p className="text-[10px] text-muted-foreground">No guides yet</p>
              <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                Click "Add Guide" or use presets
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
