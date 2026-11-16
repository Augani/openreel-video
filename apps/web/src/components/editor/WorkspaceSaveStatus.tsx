import { useEffect, useState } from "react";
import { CloudOff, LoaderCircle } from "lucide-react";
import { EditorHeaderIcon } from "./EditorHeaderIcon";
import { autoSaveManager } from "../../services/auto-save";
import { useProjectStore } from "../../stores/project-store";
import { useSettingsStore } from "../../stores/settings-store";

export function WorkspaceSaveStatus() {
  const enabled = useSettingsStore((s) => s.autoSave);
  const [status, setStatus] = useState<"saved" | "pending" | "error">(() =>
    autoSaveManager.hasUnsavedChanges(
      useProjectStore.getState().getFullProject(),
    )
      ? "pending"
      : "saved",
  );
  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (state.project !== previous.project) setStatus("pending");
    });
    const saved = () => setStatus("saved");
    const failed = () => setStatus("error");
    autoSaveManager.on("saved", saved);
    autoSaveManager.on("error", failed);
    return () => {
      unsubscribe();
      autoSaveManager.off("saved", saved);
      autoSaveManager.off("error", failed);
    };
  }, []);
  const label =
    status === "error"
      ? "Save failed"
      : status === "pending"
        ? enabled
          ? "Saving…"
          : "Unsaved"
        : "Saved";
  return (
    <span
      role="status"
      className="workspace-project-meta workspace-saved"
      title={
        enabled
          ? "Projects are saved locally on this device"
          : "Auto-save is off"
      }
    >
      {status === "error" ? (
        <CloudOff />
      ) : status === "pending" && enabled ? (
        <LoaderCircle className="animate-spin" />
      ) : (
        <EditorHeaderIcon kind="saved" />
      )}
      {label}
    </span>
  );
}
