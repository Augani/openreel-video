import { useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/project-store';
import { useHistoryStore } from '../stores/history-store';

const AUTO_SAVE_DELAY = 2000;
const STORAGE_KEY_PREFIX = 'openreel-image-project-';

export function useAutoSave() {
  const { project, isDirty, markClean } = useProjectStore();
  const { pushState } = useHistoryStore();
  const lastSavedRef = useRef<string>('');
  const timeoutRef = useRef<number>();

  useEffect(() => {
    if (!project || !isDirty) return;

    const projectJson = JSON.stringify(project);
    if (projectJson === lastSavedRef.current) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${project.id}`, projectJson);
        lastSavedRef.current = projectJson;
        markClean();

        pushState(project, 'Auto-save');
      } catch (error) {
        console.error('Failed to auto-save:', error);
      }
    }, AUTO_SAVE_DELAY);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [project, isDirty, markClean, pushState]);
}

export function loadSavedProject(projectId: string) {
  try {
    const json = localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`);
    if (json) {
      return JSON.parse(json);
    }
  } catch (error) {
    console.error('Failed to load saved project:', error);
  }
  return null;
}

export function getSavedProjectIds(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_KEY_PREFIX)) {
      ids.push(key.replace(STORAGE_KEY_PREFIX, ''));
    }
  }
  return ids;
}

export function deleteSavedProject(projectId: string): void {
  localStorage.removeItem(`${STORAGE_KEY_PREFIX}${projectId}`);
}
