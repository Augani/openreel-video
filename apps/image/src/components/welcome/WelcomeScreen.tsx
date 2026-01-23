import { useState, useEffect } from 'react';
import { Plus, FolderOpen, Image, Layout, FileText, Presentation, Smartphone, Monitor, Star, Trash2, Clock, MoreVertical } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useUIStore } from '../../stores/ui-store';
import { CANVAS_PRESETS, Project } from '../../types/project';
import { loadSavedProject, getSavedProjectIds, deleteSavedProject } from '../../hooks/useAutoSave';

type Category = 'all' | 'Social Media' | 'Presentation' | 'Print' | 'Desktop' | 'Mobile' | 'Logo';

interface SavedProjectInfo {
  id: string;
  name: string;
  updatedAt: number;
  size: { width: number; height: number };
}

const categories: { id: Category; label: string; icon: React.ElementType }[] = [
  { id: 'all', label: 'All', icon: Layout },
  { id: 'Social Media', label: 'Social Media', icon: Star },
  { id: 'Presentation', label: 'Presentation', icon: Presentation },
  { id: 'Print', label: 'Print', icon: FileText },
  { id: 'Desktop', label: 'Desktop', icon: Monitor },
  { id: 'Mobile', label: 'Mobile', icon: Smartphone },
  { id: 'Logo', label: 'Logo', icon: Image },
];

export function WelcomeScreen() {
  const [selectedCategory, setSelectedCategory] = useState<Category>('all');
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const [showCustomSize, setShowCustomSize] = useState(false);
  const [recentProjects, setRecentProjects] = useState<SavedProjectInfo[]>([]);
  const [projectMenuOpen, setProjectMenuOpen] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { createProject, loadProject } = useProjectStore();
  const { setCurrentView } = useUIStore();

  useEffect(() => {
    loadRecentProjects();
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setProjectMenuOpen(null);
    if (projectMenuOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [projectMenuOpen]);

  const loadRecentProjects = () => {
    const projectIds = getSavedProjectIds();
    const projects: SavedProjectInfo[] = [];

    for (const id of projectIds) {
      const project = loadSavedProject(id);
      if (project) {
        projects.push({
          id: project.id,
          name: project.name,
          updatedAt: project.updatedAt,
          size: project.artboards?.[0]?.size ?? { width: 0, height: 0 },
        });
      }
    }

    projects.sort((a, b) => b.updatedAt - a.updatedAt);
    setRecentProjects(projects);
  };

  const handleOpenProject = (projectId: string) => {
    const project = loadSavedProject(projectId);
    if (project) {
      loadProject(project);
      setCurrentView('editor');
    }
  };

  const handleDeleteProject = (projectId: string) => {
    deleteSavedProject(projectId);
    setRecentProjects((prev) => prev.filter((p) => p.id !== projectId));
    setDeleteConfirmId(null);
    setProjectMenuOpen(null);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return minutes <= 1 ? 'Just now' : `${minutes} minutes ago`;
      }
      return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    }
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  const filteredPresets = selectedCategory === 'all'
    ? CANVAS_PRESETS
    : CANVAS_PRESETS.filter((p) => p.category === selectedCategory);

  const handleCreateProject = (width: number, height: number, name: string) => {
    createProject(name, { width, height });
    setCurrentView('editor');
  };

  const handleCreateCustom = () => {
    createProject('Untitled Design', { width: customWidth, height: customHeight });
    setCurrentView('editor');
  };

  return (
    <div className="h-full w-full bg-background flex flex-col">
      <header className="flex items-center justify-between px-8 py-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
            <Image size={20} className="text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">OpenReel Image</h1>
            <p className="text-sm text-muted-foreground">Professional Graphic Design Editor</p>
          </div>
        </div>
        <button
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.orimg,application/json';
            input.onchange = async (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) {
                try {
                  const text = await file.text();
                  const project = JSON.parse(text) as Project;
                  if (project && project.id && project.artboards) {
                    loadProject(project);
                    setCurrentView('editor');
                  }
                } catch (err) {
                  console.error('Failed to load project file:', err);
                }
              }
            };
            input.click();
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <FolderOpen size={18} />
          Open Project
        </button>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">
          <section className="mb-10">
            <h2 className="text-lg font-semibold text-foreground mb-4">Start a new project</h2>

            <div className="flex gap-2 mb-6 flex-wrap">
              {categories.map((cat) => {
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedCategory === cat.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-accent'
                    }`}
                  >
                    <Icon size={16} />
                    {cat.label}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              <button
                onClick={() => setShowCustomSize(!showCustomSize)}
                className="group flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-all aspect-square"
              >
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                  <Plus size={24} className="text-primary" />
                </div>
                <span className="text-sm font-medium text-foreground">Custom Size</span>
                <span className="text-xs text-muted-foreground mt-1">Set dimensions</span>
              </button>

              {filteredPresets.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handleCreateProject(preset.width, preset.height, preset.name)}
                  className="group flex flex-col items-center justify-center p-6 rounded-xl border border-border bg-card hover:border-primary hover:shadow-md transition-all aspect-square"
                >
                  <div
                    className="bg-muted rounded-lg mb-3 flex items-center justify-center"
                    style={{
                      width: Math.min(80, (preset.width / Math.max(preset.width, preset.height)) * 80),
                      height: Math.min(80, (preset.height / Math.max(preset.width, preset.height)) * 80),
                    }}
                  >
                    <Layout size={20} className="text-muted-foreground" />
                  </div>
                  <span className="text-sm font-medium text-foreground text-center">{preset.name}</span>
                  <span className="text-xs text-muted-foreground mt-1">
                    {preset.width} × {preset.height}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {showCustomSize && (
            <section className="mb-10 p-6 rounded-xl bg-card border border-border">
              <h3 className="text-base font-medium text-foreground mb-4">Custom Dimensions</h3>
              <div className="flex items-end gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Width (px)</label>
                  <input
                    type="number"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(Number(e.target.value))}
                    className="w-32 px-3 py-2.5 rounded-lg bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    min={1}
                    max={8000}
                  />
                </div>
                <span className="text-muted-foreground pb-2.5">×</span>
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Height (px)</label>
                  <input
                    type="number"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(Number(e.target.value))}
                    className="w-32 px-3 py-2.5 rounded-lg bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    min={1}
                    max={8000}
                  />
                </div>
                <button
                  onClick={handleCreateCustom}
                  className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all"
                >
                  Create Design
                </button>
              </div>
            </section>
          )}

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Recent Projects</h2>
            {recentProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <FolderOpen size={28} className="text-muted-foreground" />
                </div>
                <p className="text-muted-foreground mb-2">No recent projects</p>
                <p className="text-sm text-muted-foreground/70">
                  Create a new project to get started
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {recentProjects.map((project) => (
                  <div
                    key={project.id}
                    className="group relative flex flex-col p-4 rounded-xl border border-border bg-card hover:border-primary hover:shadow-md transition-all cursor-pointer"
                    onClick={() => handleOpenProject(project.id)}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div
                        className="bg-muted rounded-lg flex items-center justify-center"
                        style={{
                          width: Math.min(60, (project.size.width / Math.max(project.size.width, project.size.height)) * 60),
                          height: Math.min(60, (project.size.height / Math.max(project.size.width, project.size.height)) * 60),
                        }}
                      >
                        <Layout size={16} className="text-muted-foreground" />
                      </div>
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setProjectMenuOpen(projectMenuOpen === project.id ? null : project.id);
                          }}
                          className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent transition-all"
                        >
                          <MoreVertical size={16} className="text-muted-foreground" />
                        </button>
                        {projectMenuOpen === project.id && (
                          <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border border-border bg-popover shadow-lg py-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenProject(project.id);
                              }}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2"
                            >
                              <FolderOpen size={14} />
                              Open
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(project.id);
                              }}
                              className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-2"
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <h3 className="text-sm font-medium text-foreground truncate mb-1">{project.name}</h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock size={12} />
                      <span>{formatDate(project.updatedAt)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      {project.size.width} × {project.size.height}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {deleteConfirmId && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              onClick={() => setDeleteConfirmId(null)}
            >
              <div
                className="bg-card border border-border rounded-xl p-6 max-w-sm mx-4 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-base font-semibold text-foreground mb-2">Delete Project?</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  This action cannot be undone. The project will be permanently deleted from your browser storage.
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDeleteProject(deleteConfirmId)}
                    className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg text-sm font-medium hover:bg-destructive/90 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="px-8 py-4 border-t border-border flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          OpenReel Image — Professional graphic design in your browser
        </p>
        <p className="text-xs text-muted-foreground">
          100% offline • No account required
        </p>
      </footer>
    </div>
  );
}
