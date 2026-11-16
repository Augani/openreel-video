import { useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@openreel/ui";
import { toast } from "../../stores/notification-store";
import { BUILT_IN_WORKSPACES, MAX_WORKSPACE_NAME, normalizeWorkspaceName, useWorkspaceLayoutStore } from "../../stores/workspace-layout-store";

/** Name the current dock layout and keep it as a workspace (Window > Workspaces > Save as new workspace). */
export function WorkspaceSaveDialog() {
  const open = useWorkspaceLayoutStore((s) => s.saveDialogOpen);
  const setOpen = useWorkspaceLayoutStore((s) => s.setSaveDialogOpen);
  const userWorkspaces = useWorkspaceLayoutStore((s) => s.userWorkspaces);
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const clean = normalizeWorkspaceName(name);
  const builtInClash = BUILT_IN_WORKSPACES.some((w) => w.name.toLowerCase() === clean.toLowerCase());
  const overwrites = userWorkspaces.some((w) => w.name.toLowerCase() === clean.toLowerCase());
  const error = builtInClash ? "That name belongs to a built-in workspace." : "";

  const save = () => {
    if (!clean || builtInClash) return;
    const saved = useWorkspaceLayoutStore.getState().saveWorkspace(clean);
    if (!saved) return;
    toast.success(overwrites ? "Workspace updated" : "Workspace saved", `${saved.name} is in Window > Workspaces.`);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm" aria-describedby="workspace-save-hint">
        <DialogHeader>
          <DialogTitle>Save workspace</DialogTitle>
          <DialogDescription id="workspace-save-hint">
            Keeps the panel sizes, timeline height and open browser section so you can come back to this layout.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="space-y-2"
        >
          <Input
            autoFocus
            aria-label="Workspace name"
            placeholder="Workspace name"
            maxLength={MAX_WORKSPACE_NAME}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {error ? <p role="alert" className="text-xs text-status-error">{error}</p> : overwrites ? <p className="text-xs text-fg-muted">A workspace with this name exists and will be replaced.</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!clean || builtInClash}>{overwrites ? "Replace" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
