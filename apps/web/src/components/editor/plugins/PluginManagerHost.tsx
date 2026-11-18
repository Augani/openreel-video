import { lazy, Suspense, useState } from "react";
import { usePluginManagerStore } from "../../../stores/plugin-manager-store";

const ManagePluginsDialog = lazy(() =>
  import("./ManagePluginsDialog").then((module) => ({ default: module.ManagePluginsDialog })),
);

/**
 * Mounts the Manage Plugins dialog once for the whole app (web menu, desktop
 * native menu, Effects panel). The dialog chunk is only fetched the first time
 * it is opened.
 */
export function PluginManagerHost() {
  const open = usePluginManagerStore((state) => state.open);
  const [everOpened, setEverOpened] = useState(false);
  if (open && !everOpened) setEverOpened(true);
  if (!everOpened) return null;
  return (
    <Suspense fallback={null}>
      <ManagePluginsDialog />
    </Suspense>
  );
}
