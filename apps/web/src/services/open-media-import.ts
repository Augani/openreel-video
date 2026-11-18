import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { useUIStore } from "../stores/ui-store";

/** Keep menu and keyboard import on the asset browser's existing file pipeline. */
export function openMediaImport() {
  useEditorWorkspaceStore.getState().setSection("media");
  useUIStore.getState().setPanelVisible("agentChat", false);
  document.querySelector<HTMLInputElement>('[data-tour="assets"] input[type="file"]')?.click();
}
