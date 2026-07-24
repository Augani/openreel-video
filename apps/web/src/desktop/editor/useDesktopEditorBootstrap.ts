import { useEffect, useState } from "react";

import { useEngineStore } from "../../stores/engine-store";
import { useProjectStore } from "../../stores/project-store";
import { initializeMediaBridge } from "../../bridges/media-bridge";
import { initializePlaybackBridge } from "../../bridges/playback-bridge";
import { initializeRenderBridge } from "../../bridges/render-bridge";
import { initializeEffectsBridge } from "../../bridges/effects-bridge";
import { initializeTransitionBridge } from "../../bridges/transition-bridge";

export interface DesktopEditorBootstrapState {
  ready: boolean;
  error: Error | null;
}

let bootstrapPromise: Promise<void> | null = null;

const waitForEngine = (): Promise<void> => {
  const state = useEngineStore.getState();
  if (state.initialized) {
    return Promise.resolve();
  }
  if (state.initError) {
    return Promise.reject(new Error(state.initError));
  }
  return new Promise<void>((resolve, reject) => {
    const unsubscribe = useEngineStore.subscribe((next) => {
      if (next.initialized) {
        unsubscribe();
        resolve();
      } else if (next.initError) {
        unsubscribe();
        reject(new Error(next.initError));
      }
    });
  });
};

const runBootstrap = async (): Promise<void> => {
  const engineState = useEngineStore.getState();
  if (!engineState.initialized && !engineState.initializing) {
    await engineState.initialize();
  } else if (engineState.initializing) {
    await waitForEngine();
  }

  const settledEngine = useEngineStore.getState();
  if (!settledEngine.initialized) {
    throw new Error(settledEngine.initError || "Engine initialization failed");
  }

  await initializeMediaBridge();
  await initializePlaybackBridge();
  await initializeRenderBridge();

  const { width, height } = useProjectStore.getState().project.settings;

  try {
    await initializeEffectsBridge(width, height);
  } catch (effectsError) {
    console.error(
      "[useDesktopEditorBootstrap] EffectsBridge initialization failed:",
      effectsError,
    );
  }

  try {
    initializeTransitionBridge(width, height);
  } catch (transitionError) {
    console.error(
      "[useDesktopEditorBootstrap] TransitionBridge initialization failed:",
      transitionError,
    );
  }

  // Enables crash recovery and feeds the desktop unsaved-changes guard.
  try {
    await useProjectStore.getState().initializeAutoSave();
  } catch (autoSaveError) {
    console.error(
      "[useDesktopEditorBootstrap] AutoSave initialization failed:",
      autoSaveError,
    );
  }
};

const ensureBootstrap = (): Promise<void> => {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap().catch((error) => {
      bootstrapPromise = null;
      throw error instanceof Error ? error : new Error(String(error));
    });
  }
  return bootstrapPromise;
};

export function useDesktopEditorBootstrap(): DesktopEditorBootstrapState {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    ensureBootstrap()
      .then(() => {
        if (isMounted) {
          setReady(true);
        }
      })
      .catch((bootstrapError: unknown) => {
        if (isMounted) {
          setError(
            bootstrapError instanceof Error
              ? bootstrapError
              : new Error(String(bootstrapError)),
          );
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return { ready, error };
}
