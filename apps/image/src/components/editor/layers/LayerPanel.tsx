import { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Lock, Unlock, Trash2, Copy, ChevronUp, ChevronDown, ArrowUp, ArrowDown, ArrowUpToLine, ArrowDownToLine, Clipboard, ClipboardCopy, Scissors, Paintbrush, Search, X, Image, Type, Hexagon, Folder, FolderPlus, FolderOpen } from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';
import type { Layer, LayerType } from '../../../types/project';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuCheckboxItem,
  Slider,
} from '@openreel/ui';

type FilterType = 'all' | LayerType;

const LAYER_TYPE_ICONS: Record<LayerType, React.ReactNode> = {
  image: <Image size={12} />,
  text: <Type size={12} />,
  shape: <Hexagon size={12} />,
  group: <Folder size={12} />,
};

export function LayerPanel() {
  const {
    project,
    selectedLayerIds,
    selectedArtboardId,
    copiedStyle,
    selectLayer,
    selectLayers,
    updateLayer,
    updateLayerTransform,
    removeLayer,
    duplicateLayer,
    moveLayerUp,
    moveLayerDown,
    moveLayerToTop,
    moveLayerToBottom,
    copyLayers,
    cutLayers,
    pasteLayers,
    copyLayerStyle,
    pasteLayerStyle,
    groupLayers,
    ungroupLayers,
  } = useProjectStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);
  const allLayers = artboard?.layerIds.map((id) => project?.layers[id]).filter(Boolean) as Layer[] ?? [];

  const layers = allLayers.filter((layer) => {
    const matchesSearch = searchQuery === '' || layer.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || layer.type === filterType;
    return matchesSearch && matchesType;
  });

  const handleSelectAllByType = (type: LayerType) => {
    const layerIds = allLayers.filter((l) => l.type === type).map((l) => l.id);
    if (layerIds.length > 0) {
      selectLayers(layerIds);
    }
  };

  const handleStartRename = (layer: Layer) => {
    setEditingLayerId(layer.id);
    setEditingName(layer.name);
  };

  const handleFinishRename = () => {
    if (editingLayerId && editingName.trim()) {
      updateLayer(editingLayerId, { name: editingName.trim() });
    }
    setEditingLayerId(null);
    setEditingName('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishRename();
    } else if (e.key === 'Escape') {
      setEditingLayerId(null);
      setEditingName('');
    }
  };

  useEffect(() => {
    if (editingLayerId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingLayerId]);

  const handleToggleVisibility = (layer: Layer, e: React.MouseEvent) => {
    e.stopPropagation();
    updateLayer(layer.id, { visible: !layer.visible });
  };

  const handleToggleLock = (layer: Layer, e: React.MouseEvent) => {
    e.stopPropagation();
    updateLayer(layer.id, { locked: !layer.locked });
  };

  const handleDelete = (layerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeLayer(layerId);
  };

  const handleDuplicate = (layerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    duplicateLayer(layerId);
  };

  const getLayerIcon = (type: Layer['type']) => {
    switch (type) {
      case 'image':
        return '🖼️';
      case 'text':
        return 'T';
      case 'shape':
        return '◆';
      case 'group':
        return '📁';
      default:
        return '•';
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="text-xs font-medium text-foreground">Layers</h3>
        <span className="text-[10px] text-muted-foreground">
          {layers.length}/{allLayers.length}
        </span>
      </div>

      <div className="px-2 py-2 border-b border-border space-y-2">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search layers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-7 py-1.5 text-[11px] bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex gap-1">
          <button
            onClick={() => setFilterType('all')}
            className={`flex-1 px-1.5 py-1 text-[10px] rounded transition-colors ${
              filterType === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent'
            }`}
          >
            All
          </button>
          {(['image', 'text', 'shape', 'group'] as LayerType[]).map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(filterType === type ? 'all' : type)}
              onDoubleClick={() => handleSelectAllByType(type)}
              className={`p-1.5 rounded transition-colors ${
                filterType === type ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent'
              }`}
              title={`Filter ${type}s (double-click to select all)`}
            >
              {LAYER_TYPE_ICONS[type]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {layers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <p className="text-xs text-muted-foreground">No layers yet</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Add text, shapes, or images
            </p>
          </div>
        ) : (
          <div className="py-1">
            {layers.map((layer) => {
              const isSelected = selectedLayerIds.includes(layer.id);

              return (
                <ContextMenu key={layer.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      onClick={() => selectLayer(layer.id)}
                      className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-primary/20 border-l-2 border-primary'
                          : 'hover:bg-accent border-l-2 border-transparent'
                      }`}
                    >
                      <span
                        className={`w-5 h-5 flex items-center justify-center text-xs rounded ${
                          layer.type === 'text' ? 'font-bold' : ''
                        }`}
                      >
                        {getLayerIcon(layer.type)}
                      </span>

                      {editingLayerId === layer.id ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={handleFinishRename}
                          onKeyDown={handleRenameKeyDown}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 text-xs bg-background border border-primary rounded px-1 py-0.5 focus:outline-none"
                        />
                      ) : (
                        <span
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            handleStartRename(layer);
                          }}
                          className={`flex-1 text-xs truncate ${
                            layer.visible ? 'text-foreground' : 'text-muted-foreground'
                          } ${layer.locked ? 'italic' : ''}`}
                          title="Double-click to rename"
                        >
                          {layer.name}
                        </span>
                      )}

                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleToggleVisibility(layer, e)}
                          className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground"
                          title={layer.visible ? 'Hide' : 'Show'}
                        >
                          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>

                        <button
                          onClick={(e) => handleToggleLock(layer, e)}
                          className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground"
                          title={layer.locked ? 'Unlock' : 'Lock'}
                        >
                          {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
                        </button>

                        <button
                          onClick={(e) => handleDuplicate(layer.id, e)}
                          className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground"
                          title="Duplicate"
                        >
                          <Copy size={12} />
                        </button>

                        <button
                          onClick={(e) => handleDelete(layer.id, e)}
                          className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48">
                    <ContextMenuItem onClick={() => { selectLayer(layer.id); copyLayers(); }}>
                      <ClipboardCopy size={14} className="mr-2" />
                      Copy
                      <ContextMenuShortcut>⌘C</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => { selectLayer(layer.id); cutLayers(); }}>
                      <Scissors size={14} className="mr-2" />
                      Cut
                      <ContextMenuShortcut>⌘X</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={pasteLayers}>
                      <Clipboard size={14} className="mr-2" />
                      Paste
                      <ContextMenuShortcut>⌘V</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => duplicateLayer(layer.id)}>
                      <Copy size={14} className="mr-2" />
                      Duplicate
                      <ContextMenuShortcut>⌘D</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    {selectedLayerIds.length > 1 && (
                      <ContextMenuItem onClick={() => groupLayers(selectedLayerIds)}>
                        <FolderPlus size={14} className="mr-2" />
                        Group Selection
                        <ContextMenuShortcut>⌘G</ContextMenuShortcut>
                      </ContextMenuItem>
                    )}
                    {layer.type === 'group' && (
                      <ContextMenuItem onClick={() => ungroupLayers(layer.id)}>
                        <FolderOpen size={14} className="mr-2" />
                        Ungroup
                        <ContextMenuShortcut>⌘⇧G</ContextMenuShortcut>
                      </ContextMenuItem>
                    )}
                    {(selectedLayerIds.length > 1 || layer.type === 'group') && <ContextMenuSeparator />}
                    <ContextMenuItem onClick={() => { selectLayer(layer.id); copyLayerStyle(); }}>
                      <Paintbrush size={14} className="mr-2" />
                      Copy Style
                    </ContextMenuItem>
                    <ContextMenuItem onClick={pasteLayerStyle} disabled={!copiedStyle}>
                      <Paintbrush size={14} className="mr-2" />
                      Paste Style
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => moveLayerToTop(layer.id)}>
                      <ArrowUpToLine size={14} className="mr-2" />
                      Bring to Front
                      <ContextMenuShortcut>⌘⇧]</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => moveLayerUp(layer.id)}>
                      <ArrowUp size={14} className="mr-2" />
                      Bring Forward
                      <ContextMenuShortcut>⌘]</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => moveLayerDown(layer.id)}>
                      <ArrowDown size={14} className="mr-2" />
                      Send Backward
                      <ContextMenuShortcut>⌘[</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => moveLayerToBottom(layer.id)}>
                      <ArrowDownToLine size={14} className="mr-2" />
                      Send to Back
                      <ContextMenuShortcut>⌘⇧[</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuCheckboxItem
                      checked={layer.visible}
                      onCheckedChange={() => updateLayer(layer.id, { visible: !layer.visible })}
                    >
                      {layer.visible ? <Eye size={14} className="mr-2" /> : <EyeOff size={14} className="mr-2" />}
                      Visible
                    </ContextMenuCheckboxItem>
                    <ContextMenuCheckboxItem
                      checked={layer.locked}
                      onCheckedChange={() => updateLayer(layer.id, { locked: !layer.locked })}
                    >
                      {layer.locked ? <Lock size={14} className="mr-2" /> : <Unlock size={14} className="mr-2" />}
                      Locked
                    </ContextMenuCheckboxItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => removeLayer(layer.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 size={14} className="mr-2" />
                      Delete
                      <ContextMenuShortcut>⌫</ContextMenuShortcut>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        )}
      </div>

      {selectedLayerIds.length > 1 && (
        <div className="p-2 border-t border-border">
          <button
            onClick={() => groupLayers(selectedLayerIds)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <FolderPlus size={14} />
            Group {selectedLayerIds.length} Layers
          </button>
        </div>
      )}

      {selectedLayerIds.length === 1 && (
        <div className="p-2 border-t border-border space-y-2">
          {project?.layers[selectedLayerIds[0]]?.type === 'group' && (
            <button
              onClick={() => ungroupLayers(selectedLayerIds[0])}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors mb-2"
            >
              <FolderOpen size={14} />
              Ungroup
            </button>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-12">Opacity</span>
            <Slider
              value={[project?.layers[selectedLayerIds[0]]?.transform.opacity ?? 1]}
              onValueChange={([opacity]) => updateLayerTransform(selectedLayerIds[0], { opacity })}
              min={0}
              max={1}
              step={0.01}
              className="flex-1"
            />
            <span className="text-[10px] text-muted-foreground w-8 text-right">
              {Math.round((project?.layers[selectedLayerIds[0]]?.transform.opacity ?? 1) * 100)}%
            </span>
          </div>
          <div className="flex items-center justify-center gap-1">
            <button
              onClick={() => moveLayerUp(selectedLayerIds[0])}
              className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              title="Move up (Cmd+])"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={() => moveLayerDown(selectedLayerIds[0])}
              className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              title="Move down (Cmd+[)"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
