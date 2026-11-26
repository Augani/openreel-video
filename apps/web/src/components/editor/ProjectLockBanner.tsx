import { useState } from "react";
import { Button } from "@openreel/ui";
import { projectManager } from "../../services/project-manager";
import { readOnlyMessage, retryProjectLock, useProjectLockStore } from "../../services/project-lock";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { useT } from "@openreel/i18n/react";
import { translateNow } from "@openreel/i18n/translate";

/** Shown while the open project is locked by another window or app instance (desktop). */
export function ProjectLockBanner() {
  const t = useT();
  const readOnly = useProjectLockStore((s) => s.readOnly);
  const holder = useProjectLockStore((s) => s.holder);
  const [busy, setBusy] = useState(false);
  if (!readOnly) return null;

  const saveCopy = async () => {
    setBusy(true);
    try {
      const state = useProjectStore.getState();
      await projectManager.saveProjectAs(state.getFullProject(), async () => useProjectStore.getState().getFullProject());
    } catch (error) {
      toast.error(translateNow("Could not save a copy"), error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" data-testid="project-lock-banner" className="flex flex-wrap items-center gap-2 border-b border-border bg-status-warning/10 px-3 py-1.5 text-xs text-fg">
      <span className="font-semibold">{t("Read-only.")}</span>
      <span className="min-w-0 flex-1 text-fg-2">{readOnlyMessage(holder)} {t("Edits and saving are disabled.")}</span>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void retryProjectLock()}>{t("Retry")}</Button>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void saveCopy()}>{t("Save a copy…")}</Button>
    </div>
  );
}
