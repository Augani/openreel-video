import { useState, useRef, useEffect } from 'react';
import {
  MousePointer2,
  Hand,
  Type,
  Square,
  PenTool,
  Pipette,
  ZoomIn,
  Undo2,
  Redo2,
  Download,
  Save,
  PanelLeftClose,
  PanelRightClose,
  Home,
  ChevronDown,
  SquareDashed,
  Circle,
  Lasso,
  Wand2,
  Crop,
  Eraser,
  Paintbrush,
  PaintBucket,
  Stamp,
  Bandage,
  Droplet,
  Droplets,
  Blend,
  Move,
  Maximize2,
  Grid3x3,
  Waves,
  Sun,
  Moon,
  Spline,
  SquareStack,
} from 'lucide-react';
import { useUIStore, Tool } from '../../../stores/ui-store';
import { useProjectStore } from '../../../stores/project-store';
import { useHistoryStore } from '../../../stores/history-store';
import { ZoomControl } from './ZoomControl';

interface ToolItem {
  id: Tool;
  icon: React.ElementType;
  label: string;
  shortcut?: string;
}

interface ToolGroup {
  id: string;
  label: string;
  tools: ToolItem[];
}

const toolGroups: ToolGroup[] = [
  {
    id: 'navigation',
    label: 'Navigation',
    tools: [
      { id: 'select', icon: MousePointer2, label: 'Move', shortcut: 'V' },
      { id: 'hand', icon: Hand, label: 'Hand', shortcut: 'H' },
      { id: 'zoom', icon: ZoomIn, label: 'Zoom', shortcut: 'Z' },
    ],
  },
  {
    id: 'selection',
    label: 'Selection',
    tools: [
      { id: 'marquee-rect', icon: SquareDashed, label: 'Rectangular Marquee', shortcut: 'M' },
      { id: 'marquee-ellipse', icon: Circle, label: 'Elliptical Marquee', shortcut: 'M' },
      { id: 'lasso', icon: Lasso, label: 'Lasso', shortcut: 'L' },
      { id: 'lasso-polygon', icon: Spline, label: 'Polygon Lasso', shortcut: 'L' },
      { id: 'magic-wand', icon: Wand2, label: 'Magic Wand', shortcut: 'W' },
    ],
  },
  {
    id: 'crop-transform',
    label: 'Crop & Transform',
    tools: [
      { id: 'crop', icon: Crop, label: 'Crop', shortcut: 'C' },
      { id: 'free-transform', icon: Move, label: 'Free Transform', shortcut: 'T' },
      { id: 'perspective', icon: Maximize2, label: 'Perspective', shortcut: '' },
      { id: 'warp', icon: Grid3x3, label: 'Warp', shortcut: '' },
      { id: 'liquify', icon: Waves, label: 'Liquify', shortcut: '' },
    ],
  },
  {
    id: 'paint',
    label: 'Paint',
    tools: [
      { id: 'brush', icon: Paintbrush, label: 'Brush', shortcut: 'B' },
      { id: 'eraser', icon: Eraser, label: 'Eraser', shortcut: 'E' },
      { id: 'paint-bucket', icon: PaintBucket, label: 'Paint Bucket', shortcut: 'G' },
      { id: 'gradient', icon: SquareStack, label: 'Gradient', shortcut: 'G' },
    ],
  },
  {
    id: 'retouch',
    label: 'Retouch',
    tools: [
      { id: 'clone-stamp', icon: Stamp, label: 'Clone Stamp', shortcut: 'S' },
      { id: 'healing-brush', icon: Bandage, label: 'Healing Brush', shortcut: 'J' },
      { id: 'spot-healing', icon: Bandage, label: 'Spot Healing', shortcut: 'J' },
    ],
  },
  {
    id: 'adjust',
    label: 'Adjust',
    tools: [
      { id: 'dodge', icon: Sun, label: 'Dodge', shortcut: 'O' },
      { id: 'burn', icon: Moon, label: 'Burn', shortcut: 'O' },
      { id: 'sponge', icon: Droplet, label: 'Sponge', shortcut: 'O' },
      { id: 'blur', icon: Droplets, label: 'Blur', shortcut: 'R' },
      { id: 'sharpen', icon: Droplets, label: 'Sharpen', shortcut: 'R' },
      { id: 'smudge', icon: Blend, label: 'Smudge', shortcut: 'R' },
    ],
  },
  {
    id: 'draw',
    label: 'Draw',
    tools: [
      { id: 'pen', icon: PenTool, label: 'Pen', shortcut: 'P' },
      { id: 'shape', icon: Square, label: 'Shape', shortcut: 'U' },
      { id: 'text', icon: Type, label: 'Text', shortcut: 'T' },
    ],
  },
  {
    id: 'sample',
    label: 'Sample',
    tools: [{ id: 'eyedropper', icon: Pipette, label: 'Eyedropper', shortcut: 'I' }],
  },
];

function ToolGroupButton({
  group,
  activeTool,
  onSelectTool,
}: {
  group: ToolGroup;
  activeTool: Tool;
  onSelectTool: (tool: Tool) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const isGroupActive = group.tools.some((t) => t.id === activeTool);
  const currentTool = group.tools.find((t) => t.id === activeTool) || group.tools[selectedIndex];
  const Icon = currentTool.icon;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleToolSelect = (tool: ToolItem, index: number) => {
    setSelectedIndex(index);
    onSelectTool(tool.id);
    setIsOpen(false);
  };

  if (group.tools.length === 1) {
    return (
      <button
        onClick={() => onSelectTool(group.tools[0].id)}
        className={`p-2 rounded-md transition-all ${
          isGroupActive
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
        title={`${currentTool.label}${currentTool.shortcut ? ` (${currentTool.shortcut})` : ''}`}
      >
        <Icon size={18} />
      </button>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => onSelectTool(currentTool.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setIsOpen(!isOpen);
        }}
        className={`relative p-2 rounded-md transition-all group ${
          isGroupActive
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
        title={`${currentTool.label}${currentTool.shortcut ? ` (${currentTool.shortcut})` : ''} - Right-click for more`}
      >
        <Icon size={18} />
        <span
          className={`absolute bottom-0.5 right-0.5 w-0 h-0 border-l-[4px] border-l-transparent border-b-[4px] ${
            isGroupActive ? 'border-b-primary-foreground/60' : 'border-b-muted-foreground/40'
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-full top-0 ml-1 z-50 py-1 bg-popover border border-border rounded-lg shadow-lg min-w-[180px]">
          {group.tools.map((tool, index) => {
            const ToolIcon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={() => handleToolSelect(tool, index)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                  activeTool === tool.id
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                <ToolIcon size={16} />
                <span className="flex-1 text-left">{tool.label}</span>
                {tool.shortcut && (
                  <span className="text-xs text-muted-foreground/60">{tool.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Toolbar() {
  const {
    activeTool,
    setActiveTool,
    togglePanelCollapsed,
    toggleInspectorCollapsed,
    setCurrentView,
    openExportDialog,
  } = useUIStore();

  const { project, setProjectName } = useProjectStore();
  const { canUndo, canRedo, undo, redo } = useHistoryStore();

  const handleUndo = () => {
    const state = undo();
    if (state) {
      useProjectStore.getState().loadProject(state);
    }
  };

  const handleRedo = () => {
    const state = redo();
    if (state) {
      useProjectStore.getState().loadProject(state);
    }
  };

  const handleSaveProject = () => {
    if (!project) return;
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^a-zA-Z0-9]/g, '_')}.orimg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-12 bg-card border-b border-border flex items-center px-3 gap-2">
      <button
        onClick={() => setCurrentView('welcome')}
        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Home"
      >
        <Home size={18} />
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      <button
        onClick={togglePanelCollapsed}
        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Toggle left panel"
      >
        <PanelLeftClose size={18} />
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      <div className="flex items-center">
        <input
          type="text"
          value={project?.name ?? 'Untitled'}
          onChange={(e) => setProjectName(e.target.value)}
          className="w-48 px-3 py-1.5 text-sm font-medium bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded-lg text-foreground"
        />
        <ChevronDown size={14} className="text-muted-foreground -ml-6" />
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5 bg-secondary/50 rounded-lg p-1">
        {toolGroups.map((group, idx) => (
          <div key={group.id} className="flex items-center">
            <ToolGroupButton group={group} activeTool={activeTool} onSelectTool={setActiveTool} />
            {idx < toolGroups.length - 1 && idx % 2 === 1 && (
              <div className="w-px h-5 bg-border/50 mx-0.5" />
            )}
          </div>
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <button
          onClick={handleUndo}
          disabled={!canUndo()}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={18} />
        </button>
        <button
          onClick={handleRedo}
          disabled={!canRedo()}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={18} />
        </button>
      </div>

      <div className="w-px h-6 bg-border mx-1" />

      <ZoomControl />

      <div className="w-px h-6 bg-border mx-1" />

      <button
        onClick={handleSaveProject}
        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Save Project (Ctrl+S)"
      >
        <Save size={18} />
      </button>

      <button
        onClick={openExportDialog}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all"
      >
        <Download size={16} />
        Export
      </button>

      <button
        onClick={toggleInspectorCollapsed}
        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Toggle right panel"
      >
        <PanelRightClose size={18} />
      </button>
    </div>
  );
}
