import React from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@openreel/ui";

interface WhichProjectDialogProps {
  /** How many caption files are waiting for a project. */
  fileCount: number;
  onChoose: () => void;
  onCancel: () => void;
}

/**
 * Shown when the operating system opens caption files with OpenReel and no project is open: the files need a
 * project to go into, so the user picks one (the project file picker opens) or backs out. Loaded on demand by
 * `askWhichProject` in services/open-files.ts, never at startup.
 */
export const WhichProjectDialog: React.FC<WhichProjectDialogProps> = ({ fileCount, onChoose, onCancel }) => (
  <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
    <DialogContent className="max-w-md" data-testid="which-project-dialog">
      <DialogHeader>
        <DialogTitle>Which project?</DialogTitle>
        <DialogDescription>
          No project is open. Choose the project to import {fileCount === 1 ? "this caption file" : `these ${fileCount} caption files`} into.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} data-testid="which-project-cancel">
          Cancel
        </Button>
        <Button onClick={onChoose} data-testid="which-project-choose" autoFocus>
          Choose project…
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
