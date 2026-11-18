import {
  Popover as ShadcnPopover,
  PopoverTrigger as ShadcnPopoverTrigger,
  PopoverContent as ShadcnPopoverContent,
  Input as ShadcnInput,
  cn as uiCn,
  Button,
  Card,
} from "@openreel/ui";

import React, {
  lazy,
  Suspense,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Plus,
  FolderOpen,
  Clock,
  Check,
  Pencil,
  FileVideo,
} from "@/icons/lucide-compat";







import { useProjectStore } from "../../stores/project-store";
import {
  autoSaveManager,
  type AutoSaveMetadata,
} from "../../services/auto-save";
import { ErrorBoundary } from "../ErrorBoundary";
import { toast } from "../../stores/notification-store";
import { saveCurrentProjectForReplacement } from "../../services/project-replacement";
const ProjectPackageDialog = lazy(() => import("./ProjectPackageDialog").then((module) => ({ default: module.ProjectPackageDialog })));

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins}m ago`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours}h ago`;
  }
  const days = Math.floor(seconds / 86400);
  return `${days}d ago`;
}

export const ProjectSwitcher: React.FC<{ trigger?: React.ReactNode; menuContent?: React.ReactNode }> = ({ trigger, menuContent }) => {
  const { project, createNewProject, recoverFromAutoSave, renameProject } = useProjectStore();
  const [isOpen, setIsOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState<AutoSaveMetadata[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [isLoading, setIsLoading] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replacing = useRef(false);

  useEffect(() => {
    const loadSavedProjects = async () => {
      try {
        await autoSaveManager.initialize();
        const saves = await autoSaveManager.checkForRecovery();
        const uniqueProjects = saves.reduce((acc, save) => {
          const existing = acc.find((s) => s.projectId === save.projectId);
          if (!existing || save.timestamp > existing.timestamp) {
            return [...acc.filter((s) => s.projectId !== save.projectId), save];
          }
          return acc;
        }, [] as AutoSaveMetadata[]);
        setSavedProjects(uniqueProjects.sort((a, b) => b.timestamp - a.timestamp));
      } catch (err) {
        console.warn("[ProjectSwitcher] Failed to load saved projects:", err);
      }
    };

    if (isOpen) {
      loadSavedProjects();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditName(project.name);
  }, [project.name]);

  const handleSaveName = useCallback(async () => {
    const trimmedName = editName.trim();
    if (trimmedName && trimmedName !== project.name) {
      await renameProject(trimmedName);
    }
    setIsEditing(false);
  }, [editName, project.name, renameProject]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSaveName();
      } else if (e.key === "Escape") {
        setEditName(project.name);
        setIsEditing(false);
      }
    },
    [handleSaveName, project.name]
  );

  const handleNewProject = useCallback(async () => {
    if (replacing.current) return;
    replacing.current = true; setIsLoading(true);
    try {
      const current = useProjectStore.getState();
      await saveCurrentProjectForReplacement(current.project.id);
      createNewProject();
      setIsOpen(false);
    } catch { toast.error("Project could not be saved", "Your current project is still open. Try saving it again."); }
    finally { replacing.current = false; setIsLoading(false); }
  }, [createNewProject]);

  const handleSwitchProject = useCallback(
    async (saveId: string) => {
      if (replacing.current) return;
      replacing.current = true;
      setIsLoading(true);
      try {
        const current = useProjectStore.getState();
        await saveCurrentProjectForReplacement(current.project.id);
        if (await recoverFromAutoSave(saveId)) setIsOpen(false);
        else toast.error("Could not open this project", "Your current project is still available.");
      } catch (err) {
        console.error("[ProjectSwitcher] Failed to switch project:", err);
        toast.error("Could not switch projects", "Your current project is still open. Try saving it again.");
      } finally {
        replacing.current = false;
        setIsLoading(false);
      }
    },
    [recoverFromAutoSave]
  );

  const otherProjects = savedProjects.filter((s) => s.projectId !== project.id);

  return (
    <div className="relative min-w-0 max-w-full">
      <ShadcnPopover
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) setIsEditing(false);
        }}
      >
        <ShadcnPopoverTrigger asChild>
          {trigger ?? (
            <Button
              type="button"
              aria-label={project.name.trim() || undefined}
              className="inline-flex items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-transparent text-fg-2 hover:text-fg min-w-0 max-w-full sm:max-w-[200px] justify-start truncate hover:bg-background-secondary"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {
                  <FileVideo
                    className="h-4 w-4 shrink-0 text-primary"
                    aria-hidden
                  />
                }
              </span>
              {project.name ? (
                <span className="truncate">{project.name}</span>
              ) : null}
              <span className="flex shrink-0 items-center justify-center">
                {
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                }
              </span>
            </Button>
          )}
        </ShadcnPopoverTrigger>
        <ShadcnPopoverContent
          align={"start"}
          aria-label={"Project menu"}
          side="bottom"
          className={uiCn(
            "!w-auto !p-0 overflow-hidden",
            "!w-[min(320px,calc(100vw-24px))] border-border bg-bg-1 shadow-xl",
          )}
        >
          {
            <Card className="min-w-0 shadow-none border-border text-fg p-0 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-none border-0 bg-bg-1">
              <div className="p-3 border-b border-border">
                <span className="text-fg-2 mb-2 text-xs font-medium uppercase tracking-wider">
                  Current Project
                </span>
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <ShadcnInput
                      ref={inputRef}
                      value={editName}
                      onBlur={handleSaveName}
                      onKeyDown={handleKeyDown}
                      aria-label={"Project name"}
                      onChange={(event) => setEditName(event.currentTarget.value)}
                      style={{ width: "100%" }}
                      className={uiCn(
                        "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]",
                        "h-7 text-[12px] md:text-[12px]",
                        "flex-1 bg-background-secondary border-primary text-text-primary",
                      )}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleSaveName}
                      type="button"
                      aria-label="Save project name"
                      title="Save project name"
                      className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 border border-border hover:text-fg bg-primary text-white hover:bg-primary-hover"
                    >
                      {<Check className="h-4 w-4" aria-hidden />}
                    </Button>
                  </div>
                ) : (
                  <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent text-fg p-2 group flex items-center gap-2 bg-background-secondary">
                    <FileVideo className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-fg flex-1 truncate text-sm font-medium">
                      {project.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setIsEditing(true)}
                      type="button"
                      aria-label="Rename project"
                      title="Rename project"
                      className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-text-muted opacity-0 hover:bg-background-tertiary hover:text-text-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                    >
                      {<Pencil className="h-3.5 w-3.5" aria-hidden />}
                    </Button>
                  </Card>
                )}
              </div>

              <div className="p-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIsOpen(false);
                    setFilesOpen(true);
                  }}
                  type="button"
                  aria-label="Project backups"
                  className="group/card h-auto min-w-0 whitespace-normal rounded-[7px] border transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 border-transparent bg-transparent p-3 flex w-full items-start gap-3 text-left hover:bg-background-secondary"
                >
                  <FolderOpen
                    className="h-4 w-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <span className="text-fg-2 block text-sm font-medium leading-5">
                      Project backups
                    </span>
                    <span className="text-fg-2 font-normal block text-xs leading-4">
                      Download or open a project with media
                    </span>
                  </div>
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleNewProject}
                  type="button"
                  aria-label="New Project"
                  disabled={isLoading}
                  className="group/card h-auto min-w-0 whitespace-normal rounded-[7px] border transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 border-transparent bg-transparent p-3 group flex w-full items-center gap-3 text-left hover:bg-background-secondary"
                >
                  <div className="p-1.5 bg-primary/10 rounded-md text-primary group-hover:bg-primary/20 transition-colors">
                    <Plus className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <span className="text-fg block text-sm font-medium leading-5">
                      New Project
                    </span>
                    <span className="text-fg-2 font-normal block text-xs leading-4">
                      Start fresh with a new canvas
                    </span>
                  </div>
                </Button>
              </div>

              {otherProjects.length > 0 && (
                <>
                  <div className="px-3 py-2 border-t border-border">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3 h-3" />
                      <span className="text-fg-2 text-xs font-medium uppercase tracking-wider">
                        Recent Projects
                      </span>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto px-2 pb-2">
                    {otherProjects.map((save) => (
                      <Button
                        variant="ghost"
                        key={save.id}
                        onClick={() => handleSwitchProject(save.id)}
                        type="button"
                        aria-label={`Open ${save.projectName}`}
                        disabled={isLoading}
                        className="group/card h-auto min-w-0 whitespace-normal rounded-[7px] border transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 border-transparent bg-transparent p-3 group flex w-full items-center gap-3 text-left hover:bg-background-secondary"
                      >
                        <div className="p-1.5 bg-background-tertiary rounded-md text-text-muted group-hover:text-text-secondary transition-colors">
                          <FolderOpen className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <span className="text-fg block truncate text-sm font-medium group-hover:text-primary">
                            {save.projectName}
                          </span>
                          <span className="text-fg-2 font-normal block text-xs leading-4">
                            {formatTimeAgo(save.timestamp)}
                          </span>
                        </div>
                      </Button>
                    ))}
                  </div>
                </>
              )}
              {menuContent && (
                <div className="border-t border-border p-2">{menuContent}</div>
              )}
            </Card>
          }
        </ShadcnPopoverContent>
      </ShadcnPopover>
      {filesOpen && <ErrorBoundary fallback={createPortal(
        <div role="alert" className="fixed right-3 top-[72px] z-[10000] max-w-sm rounded-lg border border-border bg-bg-1 p-4 text-sm text-fg shadow-lg">
          <p>Project backups couldn’t open. You can keep editing, or save your project and reload the editor to try again.</p>
          <Button onClick={() => setFilesOpen(false)} type="button" aria-label="Dismiss" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg mt-2">
            <span className="truncate">{"Dismiss"}</span>
          </Button>
        </div>, document.body,
      )}>
        <Suspense fallback={createPortal(<div role="status" className="fixed right-3 top-[72px] z-[10000] rounded-lg border border-border bg-bg-1 p-4 text-sm text-fg shadow-lg">Opening project backups…</div>, document.body)}>
          <ProjectPackageDialog onClose={() => setFilesOpen(false)} />
        </Suspense>
      </ErrorBoundary>}
    </div>
  );
};
