import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@openreel/ui";
import { version as appVersion } from "../../../package.json";

import { DOCS_URL, ISSUES_URL } from "./about-links";

export { DOCS_URL, ISSUES_URL };
const LICENSE_URL = "https://github.com/Augani/openreel-video/blob/main/LICENSE";

function runtimeLabel(): string {
  return typeof window !== "undefined" && window.openreel?.platform === "desktop" ? "Desktop app" : "Browser";
}

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Version, licence and where to find help. */
export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const link = (href: string, label: string) => (
    <Button asChild variant="outline" size="sm">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    </Button>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="about-dialog">
        <DialogHeader>
          <DialogTitle>About OpenReel</DialogTitle>
          <DialogDescription>An open source video editor for the browser and desktop.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[12px]">
          <dt className="text-fg-muted">Version</dt>
          <dd className="text-fg" data-testid="about-version">{appVersion}</dd>
          <dt className="text-fg-muted">Running as</dt>
          <dd className="text-fg">{runtimeLabel()}</dd>
          <dt className="text-fg-muted">Licence</dt>
          <dd className="text-fg">
            <a className="underline decoration-fg-muted underline-offset-2 hover:text-accent" href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
              MIT
            </a>
          </dd>
        </dl>
        <div className="flex flex-wrap gap-2 pt-1">
          {link(DOCS_URL, "Documentation")}
          {link(ISSUES_URL, "Report an issue")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
