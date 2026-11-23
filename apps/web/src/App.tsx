import {
  useEffect,
  useCallback,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { ToastContainer } from "./components/Toast";
import { MobileBlocker } from "./components/MobileBlocker";
import { WelcomeScreen } from "./components/welcome";
import { useUIStore } from "./stores/ui-store";
import { useProjectStore } from "./stores/project-store";
import { useOnboardingStore } from "./stores/onboarding-store";
import { isDesktopRuntime } from "./components/onboarding/shell/useOnboardingGate";
import { useRouter } from "./hooks/use-router";
import { useCollabInvite } from "./hooks/useCollabInvite";
import { useProjectRecovery } from "./hooks/useProjectRecovery";
import { SOCIAL_MEDIA_PRESETS, type SocialMediaCategory } from "@openreel/core";

import { getLoadedEditor, loadEditorModule } from "./editor-loader";
import { keyboardShortcuts } from "./services/keyboard-shortcuts";
import { createEditorProject } from "./services/project-creation";
import { toast } from "./stores/notification-store";
import { useSceneDetectionDialogStore } from "./stores/scene-detection-dialog-store";

// Polls accepted KieAI generations; loads after first paint so the poller and the KieAI client are not in the startup chunk.
const KieAIPollerHost = lazy(() => import("./hooks/KieAIPollerHost"));

const LazyEditorInterface = lazy(() =>
  loadEditorModule().then((m) => ({ default: m.EditorInterface })),
);
/** Renders synchronously when the chunk is already loaded (see editor-loader). */
const EditorInterface: React.FC = () => {
  const Loaded = getLoadedEditor();
  return Loaded ? <Loaded /> : <LazyEditorInterface />;
};
// Only shown when crash-recovery saves exist; pulls Collapsible (framer-motion), so keep it off the startup entry.
const RecoveryDialog = lazy(() =>
  import("./components/welcome/RecoveryDialog").then((m) => ({
    default: m.RecoveryDialog,
  })),
);
const ScriptViewDialog = lazy(() =>
  import("./components/editor/ScriptViewDialog").then((m) => ({
    default: m.ScriptViewDialog,
  })),
);
const SceneDetectionDialog = lazy(() =>
  import("./components/editor/SceneDetectionDialog").then((m) => ({
    default: m.SceneDetectionDialog,
  })),
);
const SearchModal = lazy(() =>
  import("./components/editor/SearchModal").then((m) => ({
    default: m.SearchModal,
  })),
);
const SharePage = lazy(() =>
  import("./pages/SharePage").then((m) => ({ default: m.SharePage })),
);
const LoadingSpinner: React.FC<{ message: string }> = ({ message }) => (
  <div className="h-screen w-screen bg-background flex flex-col items-center justify-center">
    <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
    <span className="font-normal text-sm text-text-secondary">{message}</span>
  </div>
);

const PRESET_DIMENSIONS: Record<string, SocialMediaCategory> = {
  "1080x1920": "tiktok",
  "1920x1080": "youtube-video",
  "1080x1080": "instagram-post",
  "720x1280": "instagram-stories",
  "1280x720": "youtube-video",
};

function App() {
  const activeModal = useUIStore((state) => state.activeModal);
  const closeModal = useUIStore((state) => state.closeModal);
  const skipWelcomeScreen = useUIStore((state) => state.skipWelcomeScreen);
  const openSearchModal = useUIStore((state) => state.openModal);
  const sceneDetectionClipId = useSceneDetectionDialogStore((state) => state.clipId);
  const [hasOpenedScriptView, setHasOpenedScriptView] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const hasOpenProject = useProjectStore((state) => state.hasOpenProject);
  const { isChecking, showDialog, availableSaves, recover, dismiss, clearAll } =
    useProjectRecovery();

  const { route, params, navigate, parsedDimensions, fps } = useRouter();
  const hasHandledNewRoute = useRef(false);
  const handledNewKey = useRef<string | null>(null);
  const newRequestId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useCollabInvite();
  // Help > "Welcome & Setup" re-opens the welcome screen even when it is skipped on startup.
  const onboardingBandOpen = useOnboardingStore((state) => state.bandOpen === true);
  const showWelcome =
    route === "templates" ||
    route === "recent" ||
    (route === "welcome" && (!skipWelcomeScreen || onboardingBandOpen));
  const isSharePage = route === "share" && params.shareId;

  useEffect(() => {
    if (activeModal === "scriptView") setHasOpenedScriptView(true);
  }, [activeModal]);

  useEffect(() => {
    if (route !== "new") {
      hasHandledNewRoute.current = false;
      handledNewKey.current = null;
      newRequestId.current++;
      return;
    }
    const key = JSON.stringify(params);
    if (
      (hasHandledNewRoute.current && handledNewKey.current === key) ||
      isChecking ||
      showDialog ||
      isRecovering
    )
      return;

    if (route === "new") {
      hasHandledNewRoute.current = true;
      handledNewKey.current = key;
      const request = ++newRequestId.current;
      const requestedHash = window.location.hash;

      let projectName = "New Project";
      let width = 1920;
      let height = 1080;
      let frameRate = fps;

      if (params.preset) {
        const presetKey = params.preset as SocialMediaCategory;
        const preset = SOCIAL_MEDIA_PRESETS[presetKey];
        if (preset) {
          width = preset.width;
          height = preset.height;
          frameRate = params.fps ? fps : preset.frameRate || fps;
          projectName = `New ${presetKey.charAt(0).toUpperCase() + presetKey.slice(1).replace(/-/g, " ")} Project`;
        }
      } else if (parsedDimensions) {
        width = parsedDimensions.width;
        height = parsedDimensions.height;

        const dimensionKey = `${width}x${height}`;
        const matchingPreset = PRESET_DIMENSIONS[dimensionKey];
        if (matchingPreset) {
          const preset = SOCIAL_MEDIA_PRESETS[matchingPreset];
          frameRate = params.fps ? fps : preset.frameRate || fps;
        }

        const aspectRatio = width / height;
        if (aspectRatio < 1) {
          projectName = "New Vertical Video";
        } else if (aspectRatio > 1) {
          projectName = "New Horizontal Video";
        } else {
          projectName = "New Square Video";
        }
      }

      void (async () => {
        try {
          await createEditorProject({
            name: projectName,
            settings: { width, height, frameRate },
            isCurrent: () =>
              mounted.current &&
              request === newRequestId.current &&
              window.location.hash === requestedHash,
          });
          if (
            !mounted.current ||
            request !== newRequestId.current ||
            window.location.hash !== requestedHash
          )
            return;
          // The New project flow finished: retire onboarding now, not before it could be cancelled.
          if (isDesktopRuntime()) useOnboardingStore.getState().skip("user");
          navigate("editor");
        } catch (error) {
          if (
            !mounted.current ||
            request !== newRequestId.current ||
            window.location.hash !== requestedHash
          )
            return;
          toast.error(
            "Could not create project",
            error instanceof Error
              ? error.message
              : "Your current project is still open. Please try again.",
          );
          navigate(
            useProjectStore.getState().hasOpenProject ? "editor" : "welcome",
          );
        }
      })();
    }
  }, [
    route,
    params,
    parsedDimensions,
    fps,
    createNewProject,
    navigate,
    isChecking,
    showDialog,
    isRecovering,
  ]);

  useEffect(() => {
    // Recovery owns the choice until it settles. A bare editor URL still needs
    // a real project for autosave and preview-proxy lifecycle subscriptions.
    if (
      showWelcome ||
      isSharePage ||
      route === "new" ||
      isChecking ||
      showDialog ||
      isRecovering ||
      hasOpenProject
    )
      return;
    createNewProject("New Project");
  }, [
    showWelcome,
    isSharePage,
    route,
    isChecking,
    showDialog,
    isRecovering,
    hasOpenProject,
    createNewProject,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const controlOwnsEscape =
        e.target instanceof Element &&
        e.target.closest(
          "input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=listbox]",
        );
      if (e.key === "Escape" && route !== "editor" && !controlOwnsEscape) {
        navigate("editor");
      }
      if (keyboardShortcuts.isSearchPaletteEvent(e)) {
        e.preventDefault();
        openSearchModal("search");
      }
    },
    [route, navigate, openSearchModal],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const initialTab =
    route === "templates"
      ? "templates"
      : route === "recent"
        ? "recent"
        : undefined;

  return (
    <div className="h-screen h-[100dvh] w-screen bg-background text-text-primary overflow-hidden">
      <MobileBlocker />
      <Suspense fallback={null}>
        <KieAIPollerHost />
      </Suspense>
      {isSharePage ? (
        <Suspense
          fallback={<LoadingSpinner message="Loading shared video..." />}
        >
          <SharePage shareId={params.shareId!} />
        </Suspense>
      ) : showWelcome ? (
        <WelcomeScreen initialTab={initialTab} />
      ) : !hasOpenProject ? (
        <LoadingSpinner
          message={
            isChecking
              ? "Checking for saved projects..."
              : showDialog
                ? "Choose a saved project or start fresh..."
                : "Opening project..."
          }
        />
      ) : (
        <Suspense fallback={<LoadingSpinner message="Loading editor..." />}>
          <EditorInterface />
        </Suspense>
      )}
      <ToastContainer />
      <Suspense fallback={null}>
        {(hasOpenedScriptView || activeModal === "scriptView") && (
          <ScriptViewDialog
            isOpen={activeModal === "scriptView"}
            onClose={closeModal}
          />
        )}
        {hasOpenProject && sceneDetectionClipId !== null && (
          <SceneDetectionDialog />
        )}
        {activeModal === "search" && (
          <SearchModal isOpen onClose={closeModal} />
        )}
      </Suspense>
      {showDialog && availableSaves.length > 0 && (
        <Suspense fallback={null}>
          <RecoveryDialog
            saves={availableSaves}
            onRecover={async (saveId) => {
              // Loading a snapshot updates the store before the hash navigation
              // settles. Claim this /new visit so it cannot replace the snapshot.
              hasHandledNewRoute.current = true;
              handledNewKey.current = JSON.stringify(params);
              newRequestId.current++;
              setIsRecovering(true);
              let success = false;
              try {
                success = await recover(saveId);
                if (success) navigate("editor");
                return success;
              } finally {
                if (!success) hasHandledNewRoute.current = false;
                setIsRecovering(false);
              }
            }}
            onDismiss={dismiss}
            onClearAll={clearAll}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
