import { useCallback, useEffect, useState } from "react";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { loadEngineModules } from "../services/lazy-engines";
import { initPluginRegistry } from "../services/plugin-service";
import {
  initializePlaybackBridge,
  disposePlaybackBridge,
} from "../bridges/playback-bridge";
import {
  initializeMediaBridge,
  disposeMediaBridge,
} from "../bridges/media-bridge";
import {
  initializeRenderBridge,
  disposeRenderBridge,
} from "../bridges/render-bridge";
import {
  initializeEffectsBridge,
  disposeEffectsBridge,
} from "../bridges/effects-bridge";
import {
  initializeTransitionBridge,
  disposeTransitionBridge,
} from "../bridges/transition-bridge";

function mark(name: string): void {
  try {
    performance.mark(`openreel:init:${name}`);
  } catch {
    // Marks are diagnostics only.
  }
}

/**
 * Engine and bridge initialization hook
 * Ensures all engines and bridges are fully initialized before rendering editor
 */
export const useEditorInitialization = () => {
  const initialize = useEngineStore((state) => state.initialize);
  const initialized = useEngineStore((state) => state.initialized);
  const initializing = useEngineStore((state) => state.initializing);
  const initError = useEngineStore((state) => state.initError);
  const [bridgesReady, setBridgesReady] = useState(false);
  const [initStatus, setInitStatus] = useState("Starting...");
  const [localError, setLocalError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLocalError(null);
    setBridgesReady(false);
    setAttempt((previous) => previous + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;
    let cancelWait: (() => void) | undefined;

    const initAll = async () => {
      try {
        await loadEngineModules();
        // Installed effect plugins load in the background; frames that use one re-render when they arrive.
        void initPluginRegistry();
        const currentState = useEngineStore.getState();
        if (!currentState.initialized && !currentState.initializing) {
          setInitStatus("Initializing video engine...");
          await initialize();
        } else if (currentState.initializing) {
          await new Promise<void>((resolve) => {
            const unsubscribe = useEngineStore.subscribe((state) => {
              if (state.initialized || state.initError) {
                unsubscribe();
                cancelWait = undefined;
                resolve();
              }
            });
            cancelWait = () => {
              unsubscribe();
              resolve();
            };
          });
        }

        if (!isMounted) return;

        const engineState = useEngineStore.getState();
        if (!engineState.initialized) {
          throw new Error(
            engineState.initError || "Engine initialization failed",
          );
        }

        mark("engine");
        setInitStatus("Initializing media bridge...");
        await initializeMediaBridge();
        mark("media-bridge");
        if (!isMounted) return;

        setInitStatus("Initializing playback bridge...");
        await initializePlaybackBridge();
        mark("playback-bridge");
        if (!isMounted) return;

        setInitStatus("Initializing render bridge...");
        await initializeRenderBridge();
        mark("render-bridge");
        if (!isMounted) return;

        setInitStatus("Initializing effects bridge...");
        const projectState = useProjectStore.getState();
        const { width, height } = projectState.project.settings;
        try {
          await initializeEffectsBridge(width, height);
        } catch (effectsError) {
          console.error(
            "[EditorInterface] EffectsBridge initialization failed:",
            effectsError,
          );
        }
        mark("effects-bridge");
        if (!isMounted) return;

        setInitStatus("Initializing transition bridge...");
        try {
          initializeTransitionBridge(width, height);
        } catch (transitionError) {
          console.error(
            "[EditorInterface] TransitionBridge initialization failed:",
            transitionError,
          );
        }
        if (!isMounted) return;

        // Recovery can finish before processing bridges exist. Read the current
        // project again after setup so saved effects, grades and transitions paint
        // on the first frame, without needing an authoring edit to sync them.
        useProjectStore.getState().syncProjectProcessing();
        mark("ready");
        setBridgesReady(true);
      } catch (error) {
        console.error("Failed to initialize engines/bridges:", error);
        if (isMounted) {
          setLocalError(
            error instanceof Error ? error.message : "Unknown error",
          );
          setInitStatus(
            `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
    };

    initAll();

    return () => {
      isMounted = false;
      cancelWait?.();
      disposePlaybackBridge();
      disposeMediaBridge();
      disposeRenderBridge();
      disposeEffectsBridge();
      disposeTransitionBridge();
    };
  }, [initialize, attempt]);

  return {
    initialized: initialized && bridgesReady,
    initializing: initializing || (!bridgesReady && initialized),
    initError: initError || localError,
    initStatus,
    retry,
  };
};
