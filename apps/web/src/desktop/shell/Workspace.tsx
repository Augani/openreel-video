import type { JSX } from "react";
import { lazy, Suspense } from "react";
import { EditorBootstrapGate } from "../editor/EditorBootstrapGate";
import { useUIStore, type DesktopPage } from "../../stores/ui-store";
import {
  WorkspaceModeTabs,
  type WorkspaceMode,
} from "../../components/WorkspaceModeTabs";

const EditPage = lazy(() =>
  import("../pages/EditPage").then((module) => ({ default: module.EditPage })),
);
const MotionPage = lazy(() =>
  import("../pages/MotionPage").then((module) => ({ default: module.MotionPage })),
);

type PrimaryDesktopPage = Extract<DesktopPage, "edit" | "motion">;

export function Workspace(): JSX.Element {
  const desktopPage = useUIStore((state) => state.desktopPage);
  const setDesktopPage = useUIStore((state) => state.setDesktopPage);
  const activePage: PrimaryDesktopPage =
    desktopPage === "motion" ? "motion" : "edit";
  const activeMode: WorkspaceMode =
    activePage === "motion" ? "motion" : "video";

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-fg" data-testid="desktop-workspace">
      <div className="flex h-10 shrink-0 items-center justify-center border-b border-border bg-bg-1 px-3">
        <WorkspaceModeTabs
          activeMode={activeMode}
          ariaLabel="Desktop workspaces"
          accessibleLabels={{
            video: "Video Editing",
            motion: "Motion Creation",
          }}
          onSelectMode={(mode) =>
            setDesktopPage(mode === "motion" ? "motion" : "edit")
          }
        />
      </div>
      <EditorBootstrapGate>
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-fg-muted">Loading…</div>}>
          <div className="min-h-0 flex-1">
            {activePage === "motion" ? <MotionPage /> : <EditPage />}
          </div>
        </Suspense>
      </EditorBootstrapGate>
    </div>
  );
}
