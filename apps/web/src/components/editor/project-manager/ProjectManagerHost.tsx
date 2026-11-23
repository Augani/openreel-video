import { lazy, Suspense, useState } from "react";
import { useProjectManagerStore } from "../../../stores/project-manager-store";

const ProjectManagerDialog = lazy(() =>
  import("./ProjectManagerDialog").then((module) => ({ default: module.ProjectManagerDialog })),
);

/** Mounts the Project Manager dialog once (File > Project Manager). Its chunk loads the first time it opens. */
export function ProjectManagerHost() {
  const open = useProjectManagerStore((state) => state.open);
  const [everOpened, setEverOpened] = useState(false);
  if (open && !everOpened) setEverOpened(true);
  if (!everOpened) return null;
  return (
    <Suspense fallback={null}>
      <ProjectManagerDialog />
    </Suspense>
  );
}
