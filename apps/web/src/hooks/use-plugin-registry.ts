import { useSyncExternalStore } from "react";
import { getPluginRegistry, type LoadedPlugin } from "@openreel/core";

const subscribe = (listener: () => void) => getPluginRegistry().subscribe(listener);
const revision = () => getPluginRegistry().getRevision();

/** Installed plugins; re-renders on install, uninstall and health changes. */
export function useInstalledPlugins(): readonly LoadedPlugin[] {
  useSyncExternalStore(subscribe, revision);
  return getPluginRegistry().list();
}
