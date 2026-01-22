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
} from 'lucide-react';
import { useUIStore, Tool } from '../../../stores/ui-store';
import { useProjectStore } from '../../../stores/project-store';
import { useHistoryStore } from '../../../stores/history-store';
import { ZoomControl } from './ZoomControl';

const tools: { id: Tool; icon: React.ElementType; label: string; shortcut: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select', shortcut: 'V' },
  { id: 'hand', icon: Hand, label: 'Hand', shortcut: 'H' },
  { id: 'text', icon: Type, label: 'Text', shortcut: 'T' },
  { id: 'shape', icon: Square, label: 'Shape', shortcut: 'S' },
  { id: 'pen', icon: PenTool, label: 'Pen', shortcut: 'P' },
  { id: 'eyedropper', icon: Pipette, label: 'Eyedropper', shortcut: 'I' },
  { id: 'zoom', icon: ZoomIn, label: 'Zoom', shortcut: 'Z' },
];

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

      <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-1">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={`p-2 rounded-md transition-all ${
                activeTool === tool.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
              title={`${tool.label} (${tool.shortcut})`}
            >
              <Icon size={18} />
            </button>
          );
        })}
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
