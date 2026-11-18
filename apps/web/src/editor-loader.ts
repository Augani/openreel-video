import type { ComponentType } from "react";
import { loadEngineModules } from "./services/lazy-engines";

type EditorModule = typeof import("./components/editor/EditorInterface");

let editorLoad: Promise<EditorModule> | null = null;
let EditorComponent: ComponentType | null = null;

/**
 * Single entry point for loading the (heavy) editor chunk. Every preloader and
 * the route share it so the route can render the component synchronously once
 * it has loaded: a React.lazy boundary that suspends always shows its fallback
 * first and React then holds the reveal back for ~300 ms, which is what made
 * "New project" feel slow even when the chunk was already in memory.
 */
export function loadEditorModule(): Promise<EditorModule> {
  if (!editorLoad) {
    // The engine modules (video/motion/audio/media...) are not in the startup
    // chunk; the editor needs them synchronously, so they load with it.
    editorLoad = Promise.all([
      import("./components/editor/EditorInterface"),
      loadEngineModules(),
    ]).then(([module]) => {
      EditorComponent = module.EditorInterface;
      return module;
    });
    editorLoad.catch(() => {
      editorLoad = null;
    });
  }
  return editorLoad;
}

/** The editor component if its chunk has finished loading, else null. */
export function getLoadedEditor(): ComponentType | null {
  return EditorComponent;
}
