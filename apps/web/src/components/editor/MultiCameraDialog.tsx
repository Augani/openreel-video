import { lazy, Suspense } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@openreel/ui";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { useT } from "@openreel/i18n/react";

const MultiCameraPanel = lazy(() => import("./inspector/MultiCameraPanel"));

/** Sequence-level tools stay reachable with one, several, or no selected clips. */
export function MultiCameraDialog() {
  const t = useT();
  const open = useEditorWorkspaceStore((state) => state.multiCameraOpen);
  const setOpen = useEditorWorkspaceStore((state) => state.setMultiCameraOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[90dvh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden rounded-xl border-border bg-bg-1 p-0 text-fg">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left sm:text-left">
          <DialogTitle className="text-[15px] font-semibold">
            {t("Multi-camera editing")}
          </DialogTitle>
          <DialogDescription className="text-[12px] leading-5 text-fg-2">
            {t("Synchronize camera clips, choose angles, and apply the cut to your timeline.")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-5">
          <Suspense
            fallback={
              <p role="status" className="text-[12px] text-fg-2">
                {t("Loading camera tools…")}
              </p>
            }
          >
            <MultiCameraPanel />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
