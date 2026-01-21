import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronDown,
  Plus,
  FolderOpen,
  Clock,
  Check,
  Pencil,
  FileVideo,
} from "lucide-react";
import { Input } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { autoSaveManager, type AutoSaveMetadata } from "../../services/auto-save";

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

export const ProjectSwitcher: React.FC = () => {
  const { project, createNewProject, recoverFromAutoSave, renameProject } = useProjectStore();
  const [isOpen, setIsOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState<AutoSaveMetadata[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsEditing(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  const handleNewProject = useCallback(() => {
    createNewProject();
    setIsOpen(false);
  }, [createNewProject]);

  const handleSwitchProject = useCallback(
    async (saveId: string) => {
      setIsLoading(true);
      try {
        await recoverFromAutoSave(saveId);
        setIsOpen(false);
      } catch (err) {
        console.error("[ProjectSwitcher] Failed to switch project:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [recoverFromAutoSave]
  );

  const otherProjects = savedProjects.filter((s) => s.projectId !== project.id);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-background-secondary transition-colors group max-w-[200px]"
      >
        <FileVideo className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-medium text-text-primary truncate">
          {project.name}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-text-muted transition-transform duration-200 shrink-0 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-background border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="p-3 border-b border-border">
            <div className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
              Current Project
            </div>
            {isEditing ? (
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={handleKeyDown}
                  className="flex-1 bg-background-secondary border-primary text-text-primary"
                />
                <button
                  onClick={handleSaveName}
                  className="p-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-2 bg-background-secondary rounded-lg group">
                <FileVideo className="w-4 h-4 text-primary shrink-0" />
                <span className="flex-1 text-sm font-medium text-text-primary truncate">
                  {project.name}
                </span>
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-background-tertiary transition-colors opacity-0 group-hover:opacity-100"
                  title="Rename project"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="p-2">
            <button
              onClick={handleNewProject}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-background-secondary transition-colors text-left group"
            >
              <div className="p-1.5 bg-primary/10 rounded-md text-primary group-hover:bg-primary/20 transition-colors">
                <Plus className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-text-primary">New Project</div>
                <div className="text-xs text-text-muted">Start fresh with a new canvas</div>
              </div>
            </button>
          </div>

          {otherProjects.length > 0 && (
            <>
              <div className="px-3 py-2 border-t border-border">
                <div className="text-xs font-medium text-text-muted uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  Recent Projects
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto px-2 pb-2">
                {otherProjects.map((save) => (
                  <button
                    key={save.id}
                    onClick={() => handleSwitchProject(save.id)}
                    disabled={isLoading}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-background-secondary transition-colors text-left group disabled:opacity-50"
                  >
                    <div className="p-1.5 bg-background-tertiary rounded-md text-text-muted group-hover:text-text-secondary transition-colors">
                      <FolderOpen className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">
                        {save.projectName}
                      </div>
                      <div className="text-xs text-text-muted">
                        {formatTimeAgo(save.timestamp)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
