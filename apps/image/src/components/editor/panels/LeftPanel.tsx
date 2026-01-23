import { useState, useRef, useEffect, memo, useMemo } from 'react';
import {
  Layers,
  Image,
  LayoutTemplate,
  Type,
  Shapes,
  Upload,
  Search,
  Plus,
  Folder,
  FolderPlus,
  FolderOpen,
  Sparkles,
  Star,
  Heart,
  Zap,
  Cloud,
  Sun,
  Moon,
  Circle,
  Square,
  Triangle,
  Hexagon,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowUpToLine,
  ArrowDownToLine,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  AlertCircle,
  Info,
  HelpCircle,
  MapPin,
  Home,
  Settings,
  User,
  Users,
  Mail,
  Phone,
  Camera,
  Music,
  Video,
  Mic,
  Bookmark,
  Flag,
  Award,
  Gift,
  Coffee,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Copy,
} from 'lucide-react';
import { useUIStore, Panel } from '../../../stores/ui-store';
import { useProjectStore } from '../../../stores/project-store';
import type { Layer, GroupLayer, Project } from '../../../types/project';

interface LayerItemProps {
  layer: Layer;
  depth: number;
  project: Project | null;
  selectedLayerIds: string[];
  editingLayerId: string | null;
  editingName: string;
  isDragSelecting: boolean;
  onLayerClick: (layerId: string, e: React.MouseEvent) => void;
  onLayerMouseDown: (layerId: string, e: React.MouseEvent) => void;
  onLayerMouseEnter: (layerId: string) => void;
  onStartRename: (layer: { id: string; name: string }) => void;
  onFinishRename: () => void;
  onEditingNameChange: (name: string) => void;
  onCancelRename: () => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  getLayerIcon: (type: string) => React.ReactNode;
}

const LayerItem = memo(function LayerItem({
  layer,
  depth,
  project,
  selectedLayerIds,
  editingLayerId,
  editingName,
  isDragSelecting,
  onLayerClick,
  onLayerMouseDown,
  onLayerMouseEnter,
  onStartRename,
  onFinishRename,
  onEditingNameChange,
  onCancelRename,
  updateLayer,
  removeLayer,
  getLayerIcon,
}: LayerItemProps) {
  const isSelected = selectedLayerIds.includes(layer.id);
  const isEditing = editingLayerId === layer.id;
  const isGroup = layer.type === 'group';
  const group = isGroup ? (layer as GroupLayer) : null;
  const isExpanded = group?.expanded ?? false;

  const toggleExpanded = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (group) {
      updateLayer(layer.id, { expanded: !isExpanded } as Partial<Layer>);
    }
  };

  const toggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateLayer(layer.id, { visible: !layer.visible });
  };

  const toggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateLayer(layer.id, { locked: !layer.locked });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    removeLayer(layer.id);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStartRename(layer);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onFinishRename();
    } else if (e.key === 'Escape') {
      onCancelRename();
    }
  };

  return (
    <>
      <div
        onClick={(e) => onLayerClick(layer.id, e)}
        onMouseDown={(e) => onLayerMouseDown(layer.id, e)}
        onMouseEnter={() => isDragSelecting && onLayerMouseEnter(layer.id)}
        onDoubleClick={handleDoubleClick}
        className={`group flex items-center gap-1.5 px-2 py-1.5 mx-1 rounded-md cursor-pointer transition-colors select-none ${
          isSelected
            ? 'bg-primary/20 text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        } ${layer.locked ? 'opacity-60' : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {isGroup && (
          <button
            onClick={toggleExpanded}
            className="p-0.5 rounded hover:bg-accent/50 transition-colors"
          >
            {isExpanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
        )}

        <span className={`flex-shrink-0 ${isSelected ? 'text-primary' : ''}`}>
          {isGroup ? (
            isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />
          ) : (
            getLayerIcon(layer.type)
          )}
        </span>

        {isEditing ? (
          <input
            type="text"
            value={editingName}
            onChange={(e) => onEditingNameChange(e.target.value)}
            onBlur={onFinishRename}
            onKeyDown={handleKeyDown}
            autoFocus
            className="flex-1 min-w-0 px-1 py-0.5 text-xs bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-primary"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 min-w-0 text-xs truncate">
            {layer.name}
          </span>
        )}

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={toggleVisibility}
            className="p-1 rounded hover:bg-accent/50 transition-colors"
            title={layer.visible ? 'Hide' : 'Show'}
          >
            {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button
            onClick={toggleLock}
            className="p-1 rounded hover:bg-accent/50 transition-colors"
            title={layer.locked ? 'Unlock' : 'Lock'}
          >
            {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <button
            onClick={handleDelete}
            className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {isGroup && isExpanded && group && project && (
        <div>
          {group.childIds.map((childId) => {
            const childLayer = project.layers[childId];
            if (!childLayer) return null;
            return (
              <LayerItem
                key={childId}
                layer={childLayer}
                depth={depth + 1}
                project={project}
                selectedLayerIds={selectedLayerIds}
                editingLayerId={editingLayerId}
                editingName={editingName}
                isDragSelecting={isDragSelecting}
                onLayerClick={onLayerClick}
                onLayerMouseDown={onLayerMouseDown}
                onLayerMouseEnter={onLayerMouseEnter}
                onStartRename={onStartRename}
                onFinishRename={onFinishRename}
                onEditingNameChange={onEditingNameChange}
                onCancelRename={onCancelRename}
                updateLayer={updateLayer}
                removeLayer={removeLayer}
                getLayerIcon={getLayerIcon}
              />
            );
          })}
        </div>
      )}
    </>
  );
});

import {
  TEMPLATE_CATEGORIES,
  getTemplatesByCategory,
  getAllTemplates,
  searchTemplates,
  Template,
} from '../../../services/templates-service';

const panels: { id: Panel; icon: React.ElementType; label: string }[] = [
  { id: 'layers', icon: Layers, label: 'Layers' },
  { id: 'elements', icon: Sparkles, label: 'Elements' },
  { id: 'assets', icon: Image, label: 'Assets' },
  { id: 'templates', icon: LayoutTemplate, label: 'Templates' },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'shapes', icon: Shapes, label: 'Shapes' },
  { id: 'uploads', icon: Upload, label: 'Uploads' },
];

export const LeftPanel = memo(function LeftPanel() {
  const { activePanel, setActivePanel } = useUIStore();

  return (
    <div className="h-full flex">
      <div className="w-14 bg-background border-r border-border flex flex-col py-2">
        {panels.map((panel) => {
          const Icon = panel.icon;
          return (
            <button
              key={panel.id}
              onClick={() => setActivePanel(panel.id)}
              className={`flex flex-col items-center justify-center py-3 transition-colors ${
                activePanel === panel.id
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
              title={panel.label}
            >
              <Icon size={20} />
              <span className="text-[10px] mt-1 font-medium">{panel.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-hidden">
        {activePanel === 'layers' && <LayersPanel />}
        {activePanel === 'elements' && <ElementsPanel />}
        {activePanel === 'assets' && <AssetsPanel />}
        {activePanel === 'templates' && <TemplatesPanel />}
        {activePanel === 'text' && <TextPanel />}
        {activePanel === 'shapes' && <ShapesPanel />}
        {activePanel === 'uploads' && <UploadsPanel />}
      </div>
    </div>
  );
});

function LayersPanel() {
  const {
    project,
    selectedLayerIds,
    selectedArtboardId,
    selectLayer,
    selectLayers,
    updateLayer,
    removeLayer,
    duplicateLayer,
    moveLayerUp,
    moveLayerDown,
    moveLayerToTop,
    moveLayerToBottom,
    groupLayers,
    ungroupLayers,
  } = useProjectStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const dragSelectIds = useRef<Set<string>>(new Set());

  const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);

  const layers = useMemo(() => {
    if (!artboard || !project) return [];
    return artboard.layerIds.map((id) => project.layers[id]).filter(Boolean);
  }, [artboard, project]);

  const filteredLayers = useMemo(() => {
    if (!searchQuery) return layers;
    const query = searchQuery.toLowerCase();
    return layers.filter((layer) => layer && layer.name.toLowerCase().includes(query));
  }, [layers, searchQuery]);

  const handleStartRename = (layer: { id: string; name: string }) => {
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

  useEffect(() => {
    const handleMouseUp = () => {
      if (isDragSelecting) {
        setIsDragSelecting(false);
        if (dragSelectIds.current.size > 0) {
          selectLayers(Array.from(dragSelectIds.current));
        }
        dragSelectIds.current.clear();
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [isDragSelecting, selectLayers]);

  const handleLayerMouseDown = (layerId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;

    setIsDragSelecting(true);
    dragSelectIds.current.clear();
    dragSelectIds.current.add(layerId);
    selectLayers([layerId]);
  };

  const handleLayerMouseEnter = (layerId: string) => {
    if (isDragSelecting) {
      dragSelectIds.current.add(layerId);
      selectLayers(Array.from(dragSelectIds.current));
    }
  };

  const handleLayerClick = (layerId: string, e: React.MouseEvent) => {
    if (isDragSelecting) return;

    if (e.shiftKey && selectedLayerIds.length > 0) {
      const layerIds = layers.map(l => l?.id).filter(Boolean) as string[];
      const lastSelectedIndex = layerIds.indexOf(selectedLayerIds[selectedLayerIds.length - 1]);
      const clickedIndex = layerIds.indexOf(layerId);
      const start = Math.min(lastSelectedIndex, clickedIndex);
      const end = Math.max(lastSelectedIndex, clickedIndex);
      const rangeIds = layerIds.slice(start, end + 1);
      selectLayers([...new Set([...selectedLayerIds, ...rangeIds])]);
    } else if (e.metaKey || e.ctrlKey) {
      if (selectedLayerIds.includes(layerId)) {
        selectLayers(selectedLayerIds.filter(id => id !== layerId));
      } else {
        selectLayers([...selectedLayerIds, layerId]);
      }
    } else {
      selectLayer(layerId);
    }
  };

  const getLayerIcon = (type: string) => {
    switch (type) {
      case 'image': return <Image size={14} />;
      case 'text': return <Type size={14} />;
      case 'shape': return <Shapes size={14} />;
      case 'group': return <Folder size={14} />;
      default: return <Layers size={14} />;
    }
  };

  const selectedLayer = selectedLayerIds.length === 1 ? project?.layers[selectedLayerIds[0]] : null;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search layers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredLayers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Layers size={32} className="text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground">No layers yet</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Add text, shapes, or images
            </p>
          </div>
        ) : (
          <div className="py-1">
            {filteredLayers.map((layer) => {
              if (!layer) return null;
              return (
                <LayerItem
                  key={layer.id}
                  layer={layer}
                  depth={0}
                  project={project}
                  selectedLayerIds={selectedLayerIds}
                  editingLayerId={editingLayerId}
                  editingName={editingName}
                  isDragSelecting={isDragSelecting}
                  onLayerClick={handleLayerClick}
                  onLayerMouseDown={handleLayerMouseDown}
                  onLayerMouseEnter={handleLayerMouseEnter}
                  onStartRename={handleStartRename}
                  onFinishRename={handleFinishRename}
                  onEditingNameChange={setEditingName}
                  onCancelRename={() => { setEditingLayerId(null); setEditingName(''); }}
                  updateLayer={updateLayer}
                  removeLayer={removeLayer}
                  getLayerIcon={getLayerIcon}
                />
              );
            })}
          </div>
        )}
      </div>

      {selectedLayerIds.length > 0 && (
        <div className="p-2 border-t border-border space-y-2">
          {selectedLayerIds.length > 1 && (
            <button
              onClick={() => groupLayers(selectedLayerIds)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
            >
              <FolderPlus size={14} />
              Group {selectedLayerIds.length} Layers
            </button>
          )}

          {selectedLayerIds.length === 1 && selectedLayer?.type === 'group' && (
            <button
              onClick={() => ungroupLayers(selectedLayerIds[0])}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80"
            >
              <FolderOpen size={14} />
              Ungroup
            </button>
          )}

          {selectedLayerIds.length === 1 && (
            <>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-muted-foreground">Order</span>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => moveLayerToTop(selectedLayerIds[0])}
                    className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                    title="Bring to Front"
                  >
                    <ArrowUpToLine size={14} />
                  </button>
                  <button
                    onClick={() => moveLayerUp(selectedLayerIds[0])}
                    className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                    title="Bring Forward"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => moveLayerDown(selectedLayerIds[0])}
                    className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                    title="Send Backward"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    onClick={() => moveLayerToBottom(selectedLayerIds[0])}
                    className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                    title="Send to Back"
                  >
                    <ArrowDownToLine size={14} />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => duplicateLayer(selectedLayerIds[0])}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-secondary text-secondary-foreground text-[10px] font-medium hover:bg-secondary/80"
                >
                  <Copy size={12} />
                  Duplicate
                </button>
                <button
                  onClick={() => removeLayer(selectedLayerIds[0])}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-destructive/10 text-destructive text-[10px] font-medium hover:bg-destructive/20"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AssetsPanel() {
  const { project, addImageLayer } = useProjectStore();
  const [searchQuery, setSearchQuery] = useState('');
  const assets = project ? Object.values(project.assets) : [];

  const filteredAssets = searchQuery
    ? assets.filter((asset) =>
        asset.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : assets;

  const handleAddToCanvas = (asset: typeof assets[0]) => {
    addImageLayer(asset.id);
  };

  return (
    <div className="p-3 h-full overflow-y-auto">
      <div className="mb-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="text-center py-8">
          <Folder size={32} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground">No assets yet</p>
          <p className="text-xs text-muted-foreground mt-1">Upload images to use in your design</p>
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="text-center py-8">
          <Search size={32} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground">No matching assets</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filteredAssets.map((asset) => (
            <button
              key={asset.id}
              onClick={() => handleAddToCanvas(asset)}
              className="group relative aspect-square rounded-lg bg-muted overflow-hidden hover:ring-2 hover:ring-primary transition-all"
              title={`Add "${asset.name}" to canvas`}
            >
              <img
                src={asset.thumbnailUrl}
                alt={asset.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <Plus
                  size={24}
                  className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/60 to-transparent">
                <p className="text-[9px] text-white truncate">{asset.name}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplatesPanel() {
  const { createProject } = useProjectStore();
  const { setCurrentView } = useUIStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = TEMPLATE_CATEGORIES;
  const filteredTemplates = searchQuery
    ? searchTemplates(searchQuery)
    : selectedCategory
    ? getTemplatesByCategory(selectedCategory)
    : getAllTemplates();

  const handleApplyTemplate = (template: Template) => {
    createProject(template.name, template.size, template.background);
    setCurrentView('editor');
  };

  const getGradientBackground = (template: Template): string => {
    if (template.background.type === 'gradient' && template.background.gradient) {
      const { type, angle, stops } = template.background.gradient;
      const stopsStr = stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ');
      return type === 'linear'
        ? `linear-gradient(${angle}deg, ${stopsStr})`
        : `radial-gradient(circle, ${stopsStr})`;
    }
    if (template.background.type === 'color') {
      return template.background.color ?? '#ffffff';
    }
    return 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)';
  };

  return (
    <div className="p-3 h-full overflow-y-auto">
      <div className="mb-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) setSelectedCategory(null);
            }}
            className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-colors ${
            !selectedCategory
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
        >
          All
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => {
              setSelectedCategory(category.id);
              setSearchQuery('');
            }}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-colors ${
              selectedCategory === category.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent'
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>

      {filteredTemplates.length === 0 ? (
        <div className="text-center py-8">
          <LayoutTemplate size={32} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground">No templates found</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filteredTemplates.map((template) => {
            const aspectRatio = template.size.width / template.size.height;
            const thumbWidth = 100;
            const thumbHeight = thumbWidth / aspectRatio;

            return (
              <button
                key={template.id}
                onClick={() => handleApplyTemplate(template)}
                className="group text-left rounded-lg border border-border bg-background hover:border-primary hover:bg-primary/5 transition-all overflow-hidden"
              >
                <div className="p-2 flex items-center justify-center bg-muted/30">
                  <div
                    className="rounded shadow-sm"
                    style={{
                      width: Math.min(thumbWidth, 90),
                      height: Math.min(thumbHeight, 70),
                      maxHeight: 70,
                      background: getGradientBackground(template),
                      backgroundSize: template.background.type === 'transparent' ? '8px 8px' : undefined,
                    }}
                  />
                </div>
                <div className="p-2 border-t border-border/50">
                  <p className="text-[11px] font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {template.name}
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    {template.size.width} × {template.size.height}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TextPanel() {
  const { addTextLayer } = useProjectStore();

  const textStyles = [
    { label: 'Add a heading', fontSize: 48, fontWeight: 700 },
    { label: 'Add a subheading', fontSize: 32, fontWeight: 600 },
    { label: 'Add body text', fontSize: 18, fontWeight: 400 },
    { label: 'Add a caption', fontSize: 14, fontWeight: 400 },
  ];

  return (
    <div className="p-3">
      <h3 className="text-sm font-medium text-foreground mb-3">Add Text</h3>
      <div className="space-y-2">
        {textStyles.map((style) => (
          <button
            key={style.label}
            onClick={() => addTextLayer(style.label)}
            className="w-full p-3 text-left rounded-lg bg-background border border-border hover:border-primary hover:bg-primary/5 transition-all"
          >
            <span
              className="block text-foreground"
              style={{ fontSize: `${Math.min(style.fontSize / 3, 16)}px`, fontWeight: style.fontWeight }}
            >
              {style.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ShapesPanel() {
  const { addShapeLayer } = useProjectStore();

  const shapes: { type: 'rectangle' | 'ellipse' | 'triangle' | 'polygon' | 'star' | 'line'; label: string }[] = [
    { type: 'rectangle', label: 'Rectangle' },
    { type: 'ellipse', label: 'Circle' },
    { type: 'triangle', label: 'Triangle' },
    { type: 'polygon', label: 'Polygon' },
    { type: 'star', label: 'Star' },
    { type: 'line', label: 'Line' },
  ];

  return (
    <div className="p-3">
      <h3 className="text-sm font-medium text-foreground mb-3">Shapes</h3>
      <div className="grid grid-cols-3 gap-2">
        {shapes.map((shape) => (
          <button
            key={shape.type}
            onClick={() => addShapeLayer(shape.type)}
            className="aspect-square flex flex-col items-center justify-center rounded-lg bg-background border border-border hover:border-primary hover:bg-primary/5 transition-all"
          >
            <Shapes size={24} className="text-muted-foreground mb-1" />
            <span className="text-[10px] text-muted-foreground">{shape.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const ELEMENT_CATEGORIES = [
  {
    name: 'Basic Shapes',
    items: [
      { icon: Circle, label: 'Circle', shapeType: 'ellipse' as const },
      { icon: Square, label: 'Square', shapeType: 'rectangle' as const },
      { icon: Triangle, label: 'Triangle', shapeType: 'triangle' as const },
      { icon: Hexagon, label: 'Hexagon', shapeType: 'polygon' as const },
      { icon: Star, label: 'Star', shapeType: 'star' as const },
    ],
  },
  {
    name: 'Arrows',
    items: [
      { icon: ArrowRight, label: 'Right' },
      { icon: ArrowLeft, label: 'Left' },
      { icon: ArrowUp, label: 'Up' },
      { icon: ArrowDown, label: 'Down' },
    ],
  },
  {
    name: 'Status',
    items: [
      { icon: Check, label: 'Check' },
      { icon: X, label: 'Cross' },
      { icon: AlertCircle, label: 'Alert' },
      { icon: Info, label: 'Info' },
      { icon: HelpCircle, label: 'Help' },
    ],
  },
  {
    name: 'Icons',
    items: [
      { icon: Heart, label: 'Heart' },
      { icon: Sparkles, label: 'Sparkle' },
      { icon: Zap, label: 'Zap' },
      { icon: Sun, label: 'Sun' },
      { icon: Moon, label: 'Moon' },
      { icon: Cloud, label: 'Cloud' },
      { icon: MapPin, label: 'Pin' },
      { icon: Home, label: 'Home' },
      { icon: Settings, label: 'Settings' },
      { icon: User, label: 'User' },
      { icon: Users, label: 'Users' },
      { icon: Mail, label: 'Mail' },
      { icon: Phone, label: 'Phone' },
      { icon: Camera, label: 'Camera' },
      { icon: Music, label: 'Music' },
      { icon: Video, label: 'Video' },
      { icon: Mic, label: 'Mic' },
      { icon: Bookmark, label: 'Bookmark' },
      { icon: Flag, label: 'Flag' },
      { icon: Award, label: 'Award' },
      { icon: Gift, label: 'Gift' },
      { icon: Coffee, label: 'Coffee' },
    ],
  },
];

function ElementsPanel() {
  const { addShapeLayer } = useProjectStore();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCategories = ELEMENT_CATEGORIES.map((category) => ({
    ...category,
    items: category.items.filter((item) =>
      item.label.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter((category) => category.items.length > 0);

  const handleAddElement = (item: typeof ELEMENT_CATEGORIES[0]['items'][0]) => {
    if ('shapeType' in item && item.shapeType) {
      addShapeLayer(item.shapeType);
    }
  };

  return (
    <div className="p-3 h-full overflow-y-auto">
      <div className="mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search elements..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      </div>

      <div className="space-y-5">
        {filteredCategories.map((category) => (
          <div key={category.name}>
            <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {category.name}
            </h4>
            <div className="grid grid-cols-4 gap-1.5">
              {category.items.map((item) => {
                const Icon = item.icon;
                const isShape = 'shapeType' in item && item.shapeType;
                return (
                  <button
                    key={item.label}
                    onClick={() => handleAddElement(item)}
                    className={`aspect-square flex flex-col items-center justify-center rounded-lg border transition-all ${
                      isShape
                        ? 'bg-background border-border hover:border-primary hover:bg-primary/5 cursor-pointer'
                        : 'bg-muted/30 border-transparent cursor-not-allowed opacity-50'
                    }`}
                    disabled={!isShape}
                    title={isShape ? `Add ${item.label}` : `${item.label} (coming soon)`}
                  >
                    <Icon size={20} className="text-muted-foreground mb-0.5" />
                    <span className="text-[9px] text-muted-foreground truncate max-w-full px-1">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {filteredCategories.length === 0 && (
          <div className="text-center py-8">
            <Search size={32} className="mx-auto text-muted-foreground mb-2" />
            <p className="text-xs text-muted-foreground">No elements found</p>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadsPanel() {
  const { project, addAsset, addImageLayer } = useProjectStore();
  const [isDragging, setIsDragging] = useState(false);
  const assets = project ? Object.values(project.assets) : [];

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/')
    );

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new window.Image();
        img.onload = () => {
          addAsset({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: file.name,
            type: 'image',
            mimeType: file.type,
            size: file.size,
            width: img.width,
            height: img.height,
            thumbnailUrl: reader.result as string,
            dataUrl: reader.result as string,
          });
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new window.Image();
        img.onload = () => {
          addAsset({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: file.name,
            type: 'image',
            mimeType: file.type,
            size: file.size,
            width: img.width,
            height: img.height,
            thumbnailUrl: reader.result as string,
            dataUrl: reader.result as string,
          });
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAddToCanvas = (assetId: string) => {
    addImageLayer(assetId);
  };

  return (
    <div className="p-3 h-full overflow-y-auto">
      <h3 className="text-sm font-medium text-foreground mb-3">Upload Files</h3>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-4 text-center transition-all ${
          isDragging
            ? 'border-primary bg-primary/10'
            : 'border-border hover:border-muted-foreground'
        }`}
      >
        <Upload size={24} className="mx-auto text-muted-foreground mb-2" />
        <p className="text-xs text-foreground mb-1">
          Drag & drop or click to browse
        </p>
        <label className="inline-block px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium cursor-pointer hover:bg-primary/90 transition-colors">
          Browse Files
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileInput}
            className="hidden"
          />
        </label>
        <p className="text-[10px] text-muted-foreground mt-2">
          PNG, JPG, SVG, WebP
        </p>
      </div>

      {assets.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Your Uploads ({assets.length})
          </h4>
          <div className="grid grid-cols-3 gap-1.5">
            {assets.map((asset) => (
              <button
                key={asset.id}
                onClick={() => handleAddToCanvas(asset.id)}
                className="group relative aspect-square rounded-md bg-muted overflow-hidden hover:ring-2 hover:ring-primary transition-all"
                title={`Add "${asset.name}" to canvas`}
              >
                <img
                  src={asset.thumbnailUrl}
                  alt={asset.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <Plus
                    size={16}
                    className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
