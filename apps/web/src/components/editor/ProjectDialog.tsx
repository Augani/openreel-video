import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  FolderOpen,
  Clock,
  Trash2,
  Film,
  Music,
  Smartphone,
  Monitor,
  ChevronRight,
  FileVideo,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Label,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@openreel/ui";
import {
  projectManager,
  type RecentProject,
  type ProjectTemplate,
} from "../../services/project-manager";
import { useProjectStore } from "../../stores/project-store";

interface ProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: "new" | "open" | "recent";
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  General: <Film size={14} />,
  "Social Media": <Smartphone size={14} />,
  Professional: <Monitor size={14} />,
  Audio: <Music size={14} />,
  Educational: <Monitor size={14} />,
};

export const ProjectDialog: React.FC<ProjectDialogProps> = ({
  isOpen,
  onClose,
  mode = "new",
}) => {
  const { loadProject } = useProjectStore();
  const [activeTab, setActiveTab] = useState<"new" | "recent">(
    mode === "recent" ? "recent" : "new",
  );
  const [selectedTemplate, setSelectedTemplate] = useState<string>("blank");
  const [projectName, setProjectName] = useState("Untitled Project");
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [templates, setTemplates] = useState<Map<string, ProjectTemplate[]>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    const recent = await projectManager.getRecentProjects();
    setRecentProjects(recent);
    setTemplates(projectManager.getTemplatesByCategory());
  };

  const handleCreateProject = useCallback(async () => {
    setIsLoading(true);
    try {
      const project = await projectManager.createProject({
        name: projectName,
        templateId: selectedTemplate,
      });
      loadProject(project);
      onClose();
    } catch (error) {
      console.error("Failed to create project:", error);
    } finally {
      setIsLoading(false);
    }
  }, [projectName, selectedTemplate, loadProject, onClose]);

  const handleOpenProject = useCallback(async () => {
    setIsLoading(true);
    try {
      const project = await projectManager.openProject();
      if (project) {
        loadProject(project);
        onClose();
      }
    } catch (error) {
      console.error("Failed to open project:", error);
    } finally {
      setIsLoading(false);
    }
  }, [loadProject, onClose]);

  const handleOpenRecent = useCallback(
    async (recent: RecentProject) => {
      setIsLoading(true);
      try {
        const project = await projectManager.openRecentProject(recent);
        if (project) {
          loadProject(project);
          onClose();
        }
      } catch (error) {
        console.error("Failed to open recent project:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [loadProject, onClose],
  );

  const handleRemoveRecent = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      await projectManager.removeFromRecent(id);
      setRecentProjects((prev) => prev.filter((p) => p.id !== id));
    },
    [],
  );

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] p-0 gap-0 bg-background-secondary border-border overflow-hidden flex flex-col">
        <DialogHeader className="p-4 border-b border-border bg-background-tertiary space-y-0">
          <div className="flex items-center gap-3">
            <FileVideo size={20} className="text-primary" />
            <DialogTitle className="text-lg font-bold text-text-primary">
              {mode === "open" ? "Open Project" : "Project"}
            </DialogTitle>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "new" | "recent")}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="flex border-b border-border bg-transparent rounded-none">
            <TabsTrigger
              value="new"
              className="flex-1 flex items-center justify-center gap-2 p-3 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary text-text-secondary hover:text-text-primary"
            >
              <Plus size={16} />
              New Project
            </TabsTrigger>
            <TabsTrigger
              value="recent"
              className="flex-1 flex items-center justify-center gap-2 p-3 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary text-text-secondary hover:text-text-primary"
            >
              <Clock size={16} />
              Recent ({recentProjects.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="flex-1 overflow-y-auto p-4 mt-0">
            <div className="space-y-6">
              <div>
                <Label className="block text-xs font-medium text-text-secondary mb-2">
                  Project Name
                </Label>
                <Input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="bg-background-tertiary border-border text-text-primary"
                  placeholder="Enter project name"
                />
              </div>

              <div>
                <Label className="block text-xs font-medium text-text-secondary mb-3">
                  Choose a Template
                </Label>
                <div className="space-y-4">
                  {Array.from(templates.entries()).map(
                    ([category, categoryTemplates]) => (
                      <div key={category}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-text-muted">
                            {CATEGORY_ICONS[category] || <Film size={14} />}
                          </span>
                          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                            {category}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {categoryTemplates.map((template) => (
                            <button
                              key={template.id}
                              onClick={() => setSelectedTemplate(template.id)}
                              className={`p-3 rounded-lg border text-left transition-colors ${
                                selectedTemplate === template.id
                                  ? "border-primary bg-primary/10"
                                  : "border-border hover:border-primary/50 hover:bg-background-tertiary"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-text-primary">
                                  {template.name}
                                </span>
                                {selectedTemplate === template.id && (
                                  <div className="w-2 h-2 rounded-full bg-primary" />
                                )}
                              </div>
                              <p className="text-[10px] text-text-muted">
                                {template.description}
                              </p>
                              {template.settings && (
                                <p className="text-[10px] text-primary mt-1">
                                  {template.settings.width}x
                                  {template.settings.height} @{" "}
                                  {template.settings.frameRate}fps
                                </p>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="recent" className="flex-1 overflow-y-auto p-4 mt-0">
            {recentProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                <Clock size={32} className="mb-3 opacity-30" />
                <p className="text-sm">No recent projects</p>
                <p className="text-xs mt-1">
                  Projects you open will appear here
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => handleOpenRecent(project)}
                    disabled={isLoading}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-background-tertiary transition-colors group disabled:opacity-50"
                  >
                    <div className="w-12 h-12 bg-background-tertiary rounded-lg flex items-center justify-center">
                      <FileVideo size={20} className="text-text-muted" />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {project.name}
                      </p>
                      <p className="text-[10px] text-text-muted">
                        {formatDate(project.lastOpened)}
                        {project.trackCount !== undefined && (
                          <> · {project.trackCount} tracks</>
                        )}
                      </p>
                    </div>
                    <ChevronRight
                      size={16}
                      className="text-text-muted group-hover:text-primary transition-colors"
                    />
                    <button
                      onClick={(e) => handleRemoveRecent(project.id, e)}
                      className="p-1 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      title="Remove from recent"
                    >
                      <Trash2 size={14} />
                    </button>
                  </button>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between p-4 border-t border-border bg-background-tertiary">
          <Button
            variant="ghost"
            onClick={handleOpenProject}
            disabled={isLoading}
          >
            <FolderOpen size={16} />
            Open from File...
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {activeTab === "new" && (
              <Button
                onClick={handleCreateProject}
                disabled={isLoading || !projectName.trim()}
              >
                <Plus size={16} />
                Create Project
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectDialog;
