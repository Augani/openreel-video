import React, { useState, useEffect, useCallback } from "react";
import { Clock, Trash2, Film } from "lucide-react";
import {
  checkForRecovery,
  type AutoSaveMetadata,
} from "../../services/auto-save";
import { useProjectStore } from "../../stores/project-store";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";

interface RecentProject {
  id: string;
  saveId: string;
  name: string;
  lastModified: number;
}

interface RecentProjectsProps {
  onProjectSelected?: () => void;
}

export const RecentProjects: React.FC<RecentProjectsProps> = ({
  onProjectSelected,
}) => {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const recoverFromAutoSave = useProjectStore(
    (state) => state.recoverFromAutoSave,
  );
  const { track } = useAnalytics();

  useEffect(() => {
    async function loadProjects() {
      try {
        const saves = await checkForRecovery();
        const projectMap = new Map<string, AutoSaveMetadata>();

        for (const save of saves) {
          if (!projectMap.has(save.projectId)) {
            projectMap.set(save.projectId, save);
          }
        }

        const projects: RecentProject[] = Array.from(projectMap.values())
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 10)
          .map((save) => ({
            id: save.projectId,
            saveId: save.id,
            name: save.projectName,
            lastModified: save.timestamp,
          }));

        setRecentProjects(projects);
      } catch (error) {
        console.error("Failed to load recent projects:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadProjects();
  }, []);

  const handleSelectProject = useCallback(
    async (project: RecentProject) => {
      setLoadingProjectId(project.id);
      try {
        const success = await recoverFromAutoSave(project.saveId);
        if (success) {
          track(AnalyticsEvents.PROJECT_OPENED, {
            source: "recent_projects",
          });
          onProjectSelected?.();
        }
      } catch (error) {
        console.error("Failed to load project:", error);
      } finally {
        setLoadingProjectId(null);
      }
    },
    [recoverFromAutoSave, onProjectSelected, track],
  );

  const handleRemoveProject = useCallback(
    (projectId: string, event: React.MouseEvent) => {
      event.stopPropagation();
      setRecentProjects((prev) => prev.filter((p) => p.id !== projectId));
    },
    [],
  );

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;

    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
        <p className="text-sm text-text-secondary">
          Loading recent projects...
        </p>
      </div>
    );
  }

  if (recentProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-14 h-14 rounded-2xl bg-background-tertiary flex items-center justify-center mb-4">
          <Clock size={24} className="text-text-muted" />
        </div>
        <h3 className="text-base font-medium text-text-primary mb-2">
          No Recent Projects
        </h3>
        <p className="text-sm text-text-muted text-center max-w-md">
          Your recently opened projects will appear here. Start a new project or
          use a template to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">
          Recent Projects ({recentProjects.length})
        </h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {recentProjects.map((project) => {
          const isLoadingThis = loadingProjectId === project.id;
          return (
            <div
              key={project.id}
              className="group relative flex flex-col bg-background-tertiary rounded-xl border border-border hover:border-primary/40 hover:bg-background-elevated transition-all overflow-hidden"
            >
              <button
                onClick={() => handleSelectProject(project)}
                disabled={isLoadingThis}
                className="flex flex-col flex-1 text-left disabled:opacity-70"
              >
                <div className="aspect-video w-full bg-background flex items-center justify-center border-b border-border">
                  {isLoadingThis ? (
                    <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  ) : (
                    <Film size={32} className="text-text-muted/50 group-hover:text-primary/50 transition-colors" />
                  )}
                </div>

                <div className="p-3 flex-1">
                  <h4 className="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">
                    {project.name}
                  </h4>
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-text-muted">
                    <Clock size={11} />
                    <span>{formatDate(project.lastModified)}</span>
                  </div>
                </div>
              </button>

              <button
                onClick={(e) => handleRemoveProject(project.id, e)}
                className="absolute top-2 right-2 p-1.5 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded-lg bg-background/80 hover:bg-red-500/10 backdrop-blur-sm"
                title="Remove from recent"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-text-muted text-center">
        Recent projects are stored locally in your browser
      </p>
    </div>
  );
};

export default RecentProjects;
