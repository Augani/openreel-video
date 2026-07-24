import type { JSX } from "react";
import type React from "react";

import { OpenReelMark } from "../brand/OpenReelMark";
import { useDesktopEditorBootstrap } from "./useDesktopEditorBootstrap";

export function EditorBootstrapGate({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { ready, error } = useDesktopEditorBootstrap();
  if (error) {
    return (
      <div className="grid h-full place-items-center bg-bg p-4 text-sm text-red-300">
        Editor failed to start: {error.message}
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="grid h-full place-items-center bg-bg">
        <div className="flex flex-col items-center gap-4">
          <OpenReelMark
            size={48}
            className="animate-spin text-accent"
          />
          <span className="text-sm text-fg-muted">Loading editor…</span>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
