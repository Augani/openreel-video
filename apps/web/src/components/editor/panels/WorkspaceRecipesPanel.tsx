import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Button,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Progress,
  ScrollArea,
} from "@openreel/ui";
import {
  Activity,
  Smartphone,
  Music2,
  ChevronLeft,
  Mic,
  SlidersHorizontal,
} from "lucide-react";
import { WorkspaceTabs, workspaceTabPanel } from "../WorkspacePrimitives";
import { RecipesTab } from "./RecipesTab";
import {
  AutoCutSilenceSection,
  type SilenceActivity,
} from "../inspector/AutoCutSilenceSection";
import { AutoEditPanel } from "./AutoEditPanel";
import { AutoCaptionPanel } from "../inspector/AutoCaptionPanel";
import { NoiseReductionSection } from "../inspector/NoiseReductionSection";
import { AudioEffectsSection } from "../inspector/AudioEffectsSection";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { useAIConnectionStore } from "../../../stores/ai-connection-store";
import { useChatStore } from "../../../stores/chat-store";
import { useClipRecipesStore } from "../../../stores/clip-recipes-store";
import {
  applyClipRecipe,
  recentClipRecipeSteps,
  type ClipRecipeStep,
} from "../../../services/clip-recipes";
import { toast } from "../../../stores/notification-store";
const recipes = [
  {
    id: "silence",
    name: "Remove silences",
    icon: Activity,
    color: "#2bd49a",
    description:
      "Cut pauses longer than 0.6 s on dialogue tracks and close the gaps.",
    steps: "4 steps · On device",
  },
  {
    id: "shorts",
    name: "Podcast to Shorts",
    icon: Smartphone,
    color: "#9e79ff",
    description:
      "Find the 3 strongest moments, reframe to 9:16 and add captions.",
    steps: "6 steps · AI",
  },
  {
    id: "beats",
    name: "Beat-sync montage",
    icon: Music2,
    color: "#efa838",
    description: "Cut selected B-roll on the beats of the music track.",
    steps: "4 steps",
  },
  {
    id: "dialogue",
    name: "Clean up dialogue",
    icon: Mic,
    color: "#67a3f6",
    description: "Reduce background noise and adjust voice EQ and compression.",
    steps: "3 steps · On device",
  },
] as const;
export function WorkspaceRecipesPanel() {
  const [tab, setTab] = useState("featured");
  const [active, setActive] = useState<string | null>(null);
  const [silenceActivity, setSilenceActivity] =
    useState<SilenceActivity | null>(null);
  const recipeScroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (silenceActivity?.status !== "running") return;
    const viewport = recipeScroll.current?.querySelector<HTMLDivElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport) viewport.scrollTop = 0;
  }, [silenceActivity?.status]);
  const [showClipLibrary, setShowClipLibrary] = useState(false);
  const [savingSteps, setSavingSteps] = useState<ClipRecipeStep[] | null>(null);
  const [recipeName, setRecipeName] = useState("");
  const [applying, setApplying] = useState(false);
  const history = useProjectStore((state) => state.actionHistory);
  useSyncExternalStore(
    useCallback((listener) => history.subscribe(listener), [history]),
    () => history.getUndoStackSize(),
  );
  const recentSteps = recentClipRecipeSteps(history);
  const savedRecipes = useClipRecipesStore((state) => state.recipes);
  const project = useProjectStore((s) => s.project);
  const selected = useUIStore((s) => s.selectedItems);
  const clips = project.timeline.tracks
    .flatMap((t) => t.clips)
    .filter((c) =>
      project.mediaLibrary.items.some(
        (m) => m.id === c.mediaId && (m.type === "audio" || m.type === "video"),
      ),
    );
  const [target, setTarget] = useState(
    selected.find((s) => s.type === "clip")?.id ?? "",
  );
  const clipId = clips.some((c) => c.id === target) ? target : clips[0]?.id;
  const run = (id: string) => {
    if (id === "shorts") {
      const c = useAIConnectionStore.getState();
      if (!c.model.trim() || (!c.apiKey && c.provider !== "compatible")) {
        useEditorWorkspaceStore.getState().setAIConnectionOpen(true);
        return;
      }
      useUIStore.getState().setPanelVisible("agentChat", true);
      void useChatStore
        .getState()
        .send(
          "Create a short portrait cut from this podcast. Inspect the timeline and transcript, find the strongest moments, reframe the clips for 9:16 and add captions. Ask before destructive changes.",
        );
    } else {
      setActive(id);
      if (id === "silence") setSilenceActivity(null);
    }
  };
  const browseClipLibrary = () => {
    setTab("my");
    setShowClipLibrary(true);
    setActive(null);
  };
  return (
    <div className="workspace-recipes flex h-full min-h-0 flex-col">
      <WorkspaceTabs
        label="Recipe libraries"
        value={tab}
        onChange={(v) => {
          setTab(v);
          setActive(null);
          setShowClipLibrary(false);
        }}
        options={[
          { value: "featured", label: "Featured" },
          { value: "my", label: "My recipes" },
          { value: "community", label: "Community" },
        ]}
      />
      <div
        {...workspaceTabPanel("Recipe libraries", tab)}
        className="flex flex-col flex-1 min-h-0"
      >
        {showClipLibrary ? (
          <>
            <Button
              variant="ghost"
              className="h-8 text-xs shrink-0 justify-start"
              onClick={() => setShowClipLibrary(false)}
            >
              <ChevronLeft size={13} />
              My recipes
            </Button>
            <RecipesTab />
          </>
        ) : (
          <ScrollArea ref={recipeScroll} className="flex-1 min-h-0">
            <div className="p-2.5">
              {active && active !== "silence" ? (
                <>
                  <Button
                    variant="ghost"
                    className="h-7 px-0 mb-3 text-xs"
                    onClick={() => setActive(null)}
                  >
                    <ChevronLeft size={13} />
                    All recipes
                  </Button>
                  <h3>{recipes.find((r) => r.id === active)?.name}</h3>
                  {active !== "beats" && (
                    <Select value={clipId ?? ""} onValueChange={setTarget}>
                      <SelectTrigger
                        aria-label="Recipe source clip"
                        className="h-8 my-3 text-xs"
                      >
                        <SelectValue placeholder="Select a source clip" />
                      </SelectTrigger>
                      <SelectContent>
                        {clips.map((c) => (
                          <SelectItem value={c.id} key={c.id}>
                            {
                              project.mediaLibrary.items.find(
                                (m) => m.id === c.mediaId,
                              )?.name
                            }{" "}
                            · {c.startTime.toFixed(1)}s
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {active === "beats" ? (
                    <AutoEditPanel onClose={() => setActive(null)} />
                  ) : clipId ? (
                    active === "silence" ? (
                      <AutoCutSilenceSection
                        key={clipId}
                        clipId={clipId}
                        initialSettings={{ minSilenceDuration: 0.6 }}
                      />
                    ) : active === "dialogue" ? (
                      <div className="space-y-4">
                        <NoiseReductionSection key={clipId} clipId={clipId} />
                        <AudioEffectsSection clipId={clipId} />
                      </div>
                    ) : (
                      <AutoCaptionPanel clipId={clipId} />
                    )
                  ) : (
                    <p className="text-xs text-fg-muted">
                      Add a video or audio clip to the timeline to run this
                      recipe.
                    </p>
                  )}
                </>
              ) : tab === "community" ? (
                <div className="workspace-recipes-note">
                  <SlidersHorizontal size={22} />
                  <strong>Bring your own recipes</strong>
                  <p>
                    Open the clip recipe library to apply and customize all
                    built-in looks. Project packages preserve their settings
                    when you share.
                  </p>
                  <Button variant="secondary" onClick={browseClipLibrary}>
                    Browse clip recipes
                  </Button>
                </div>
              ) : tab === "my" ? (
                <>
                  <p className="workspace-recipe-intro">
                    Record recent clip adjustments and apply them to another
                    selected clip.
                  </p>
                  {savedRecipes.length === 0 && (
                    <p className="workspace-recipe-intro">
                      Your saved recipes will appear here.
                    </p>
                  )}
                  {savedRecipes.map((recipe) => (
                    <article key={recipe.id} className="workspace-recipe-card">
                      <h3>{recipe.name}</h3>
                      <p>
                        {recipe.steps
                          .map((step) => step.description)
                          .join(" · ")}
                      </p>
                      <footer>
                        <small>
                          {recipe.steps.length} steps · Saved locally
                        </small>
                        <Button
                          variant="secondary"
                          disabled={applying}
                          onClick={async () => {
                            const selectedClip = selected.find(
                              (item) => item.type === "clip",
                            );
                            if (!selectedClip) {
                              toast.warning(
                                "Select a clip",
                                "Choose the clip that should receive this recipe.",
                              );
                              return;
                            }
                            setApplying(true);
                            try {
                              await applyClipRecipe(recipe, selectedClip.id);
                              toast.success("Recipe applied", recipe.name);
                            } catch (error) {
                              toast.error(
                                "Recipe could not be applied",
                                error instanceof Error
                                  ? error.message
                                  : "Try again.",
                              );
                            } finally {
                              setApplying(false);
                            }
                          }}
                        >
                          Run
                        </Button>
                      </footer>
                    </article>
                  ))}
                  <Button
                    variant="outline"
                    className="w-full h-8 text-xs"
                    onClick={browseClipLibrary}
                  >
                    <SlidersHorizontal size={13} />
                    Browse built-in clip recipes
                  </Button>
                </>
              ) : (
                <>
                  <p className="workspace-recipe-intro">
                    Multi-step edits you can run on any timeline. Every step
                    lands on the undo stack.
                  </p>
                  {recipes.map((r) => (
                    <article
                      className={`workspace-recipe-card ${r.id === "silence" && active === "silence" ? "is-active" : ""}`}
                      key={r.id}
                    >
                      <div>
                        <span
                          style={{ color: r.color, background: `${r.color}18` }}
                        >
                          <r.icon size={16} />
                        </span>
                        <div>
                          <h3>{r.name}</h3>
                          <p>{r.description}</p>
                        </div>
                      </div>
                      <footer>
                        <small>{r.steps}</small>
                        {r.id === "silence" &&
                        active === "silence" &&
                        silenceActivity?.status === "running" ? (
                          <span
                            className="workspace-recipe-progress"
                            role="status"
                            title={silenceActivity.message}
                          >
                            <span>Step {silenceActivity.stage} of 4</span>
                            <Progress
                              aria-label="Remove silences progress"
                              value={silenceActivity.progress}
                            />
                          </span>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              r.id === "silence" && active === "silence"
                                ? setActive(null)
                                : run(r.id)
                            }
                          >
                            {r.id === "silence" && active === "silence"
                              ? silenceActivity?.status === "done"
                                ? "Done"
                                : "Close"
                              : "Run"}
                          </Button>
                        )}
                      </footer>
                      {r.id === "silence" && active === "silence" && (
                        <div
                          className="workspace-recipe-config"
                          hidden={
                            silenceActivity?.status === "running" ||
                            silenceActivity?.status === "done"
                          }
                        >
                          {clipId ? (
                            <>
                              <Select
                                value={clipId}
                                onValueChange={(value) => {
                                  setTarget(value);
                                  setSilenceActivity(null);
                                }}
                              >
                                <SelectTrigger
                                  aria-label="Recipe source clip"
                                  className="h-8 my-3 text-xs"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {clips.map((clip) => (
                                    <SelectItem value={clip.id} key={clip.id}>
                                      {
                                        project.mediaLibrary.items.find(
                                          (item) => item.id === clip.mediaId,
                                        )?.name
                                      }{" "}
                                      · {clip.startTime.toFixed(1)}s
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <AutoCutSilenceSection
                                key={clipId}
                                clipId={clipId}
                                initialSettings={{ minSilenceDuration: 0.6 }}
                                onActivity={setSilenceActivity}
                              />
                            </>
                          ) : (
                            <p className="pt-3 text-xs text-fg-muted">
                              Add a video or audio clip to the timeline to run
                              this recipe.
                            </p>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </>
              )}
            </div>
          </ScrollArea>
        )}
        {!showClipLibrary &&
          (!active || active === "silence") &&
          tab !== "community" && (
            <div className="workspace-recipe-save">
              <Button
                variant="outline"
                disabled={!recentSteps.length}
                title="Record up to six recent transform, blend, color, volume or fade adjustments on one clip. Cuts and imported media cannot be rebound to another clip."
                onClick={() => {
                  setSavingSteps(recentSteps);
                  setRecipeName("My recipe");
                }}
              >
                Save my last {recentSteps.length || ""}{" "}
                {recentSteps.length === 1 ? "edit" : "edits"} as a recipe
              </Button>
            </div>
          )}
      </div>
      <Dialog
        open={savingSteps !== null}
        onOpenChange={(open) => {
          if (!open) setSavingSteps(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save a clip recipe</DialogTitle>
            <DialogDescription>
              These adjustments will be available in My recipes on this device.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Recipe name"
            value={recipeName}
            onChange={(event) => setRecipeName(event.target.value)}
          />
          <ol className="text-xs list-decimal pl-5 space-y-1">
            {savingSteps?.map((step, index) => (
              <li key={index}>{step.description}</li>
            ))}
          </ol>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!savingSteps?.length) return;
                useClipRecipesStore.getState().save(recipeName, savingSteps);
                setSavingSteps(null);
                setTab("my");
              }}
            >
              Save recipe
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
