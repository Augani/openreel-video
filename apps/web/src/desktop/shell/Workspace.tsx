import type { JSX } from "react";
import { lazy, Suspense } from "react";
import { EditorBootstrapGate } from "../editor/EditorBootstrapGate";

const EditPage = lazy(() =>
  import("../pages/EditPage").then((module) => ({ default: module.EditPage })),
);
export function Workspace(): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-fg" data-testid="desktop-workspace">
      <EditorBootstrapGate>
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-fg-muted">Loading…</div>}>
          <div className="min-h-0 flex-1">
            <EditPage />
          </div>
        </Suspense>
      </EditorBootstrapGate>
    </div>
  );
}
