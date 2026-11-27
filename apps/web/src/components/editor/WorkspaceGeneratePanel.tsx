import { useState } from "react";
import {
  Button,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  ScrollArea,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Progress,
} from "@openreel/ui";
import {
  Sparkle,
  Loader2,
  Plus,
  ImageIcon,
  AlertCircle,
  Settings2,
  ChevronLeft,
  Film,
  Camera,
  Newspaper,
  PenTool,
} from "lucide-react";
import { ConnectionStatus, useServiceKeyStatus } from "./AIConnectionStatus";
import { WorkspaceTabs, workspaceTabPanel } from "./WorkspacePrimitives";
import { TextToSpeechPanel } from "./inspector/TextToSpeechPanel";
import { MusicLibraryPanel } from "./inspector/MusicLibraryPanel";
import { AIGenTab } from "./AIGenTab";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useKieAIStore } from "../../stores/kieai-store";
import { useSettingsStore } from "../../stores/settings-store";
import {
  createImageTask,
  IMAGE_MODELS,
} from "../../services/kieai/image-generation";
import { kieaiPostJson } from "../../services/kieai/client";
import { toast } from "../../stores/notification-store";
import { useT } from "@openreel/i18n/react";
import { translateNow } from "@openreel/i18n/translate";

const STYLE_CHIPS = [
  ["Cinematic", Film],
  ["Photo", Camera],
  ["Documentary", Newspaper],
  ["Illustration", PenTool],
] as const;

export function WorkspaceGeneratePanel() {
  const t = useT();
  const [tab, setTab] = useState("image");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("Cinematic");
  const [ratio, setRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [model, setModel] = useState("z-image");
  const [count, setCount] = useState("4");
  const [duration, setDuration] = useState("5");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const project = useProjectStore((s) => s.project);
  const tasks = useKieAIStore((s) => s.tasks);
  const keyStatus = useServiceKeyStatus("kie-ai");
  const keyConnected = keyStatus === "ready";
  const results = project.mediaLibrary.items.filter(
    (m) =>
      m.name.startsWith("AI_") &&
      m.type === (tab === "video" ? "video" : "image"),
  );
  const selectedResult =
    results.find(
      (media) =>
        media.id === selected &&
        !media.isPending &&
        !media.isPlaceholder &&
        !media.kieaiError,
    ) ??
    results.find(
      (media) => !media.isPending && !media.isPlaceholder && !media.kieaiError,
    );
  const modelName =
    tab === "video"
      ? "Kling 2.6"
      : model === "nano-banana-2"
        ? "Nano Banana 2"
        : "Z-Image";
  const disabledReason =
    keyStatus === "missing"
      ? "Add your KieAI API key to generate."
      : keyStatus === "locked"
        ? "Unlock your API keys to generate."
        : keyStatus === "checking"
          ? "Checking your KieAI key…"
          : !prompt.trim()
      ? "Describe what to generate."
      : null;
  const generate = async () => {
    if (!prompt.trim() || submitting || !keyConnected) return;
    setSubmitting(true);
    setError(null);
    const projectId = project.id;
    let created = 0;
    try {
      for (let i = 0; i < Number(count); i++) {
        if (useProjectStore.getState().project.id !== projectId) break;
        const text = `${prompt.trim()}\nVisual style: ${style.toLowerCase()}.`;
        const video = tab === "video";
        const taskId = video
          ? (
              await kieaiPostJson<
                { model: string; input: object },
                { taskId: string }
              >(
                "/api/v1/jobs/createTask",
                {
                  model: "kling-2.6/text-to-video",
                  input: {
                    prompt: text,
                    sound: false,
                    aspect_ratio: ratio,
                    duration,
                  },
                },
                "https://api.kie.ai",
              )
            ).taskId
          : await createImageTask(
              model === "nano-banana-2"
                ? IMAGE_MODELS.NANO_BANANA2
                : IMAGE_MODELS.Z_IMAGE,
              { prompt: text, aspect_ratio: ratio },
            );
        const mediaId = crypto.randomUUID();
        const name = `AI_${prompt
          .trim()
          .slice(0, 30)
          .replace(/[^\p{L}\p{N} -]/gu, "")
          .replaceAll(
            " ",
            "_",
          )}_${Date.now()}_${i + 1}.${video ? "mp4" : "png"}`;
        // A generation belongs to the project which requested it, never a newly opened one.
        if (useProjectStore.getState().project.id !== projectId) {
          toast.warning(
            translateNow("Project changed"),
            "A provider task was submitted. Its result remains available in your provider account.",
          );
          break;
        }
        useProjectStore.getState().addPlaceholderMedia({
          id: mediaId,
          name,
          type: video ? "video" : "image",
          fileHandle: null,
          blob: null,
          metadata: {
            duration: video ? Number(duration) : 0,
            width: 0,
            height: 0,
            frameRate: 0,
            codec: "",
            sampleRate: 0,
            channels: 0,
            fileSize: 0,
          },
          thumbnailUrl: null,
          waveformData: null,
          isPlaceholder: true,
          isPending: true,
          kieaiTaskId: taskId,
        });
        useKieAIStore.getState().addTask({
          taskId,
          mediaId,
          projectId,
          type: video ? "video" : "image",
          suggestedName: name,
          createdAt: Date.now(),
        });
        created++;
      }
    } catch (e) {
      setError(
        `${created ? `${created} task${created === 1 ? "" : "s"} submitted. ` : ""}${e instanceof Error ? e.message : "Generation failed. Try again."}`,
      );
    } finally {
      setSubmitting(false);
    }
  };
  const add = async () => {
    const state = useProjectStore.getState();
    const media = state.getMediaItem(selectedResult?.id ?? "");
    if (!media || media.isPending || media.isPlaceholder || media.kieaiError)
      return;
    const result = await state.placeMediaClip(
      media.id,
      undefined,
      useTimelineStore.getState().playheadPosition,
    );
    if (!result.success)
      toast.error(translateNow("Could not add result"), result.error?.message);
  };
  return (
    <div className="workspace-generate flex h-full min-h-0 flex-col">
      <WorkspaceTabs
        label="Generation types"
        value={tab}
        onChange={(v) => {
          setTab(v);
          setSettingsOpen(false);
          setSelected(null);
          setError(null);
        }}
        options={[
          { value: "image", label: "Image" },
          { value: "video", label: "Video" },
          { value: "voice", label: "Voice" },
          { value: "music", label: "Music" },
        ]}
      />
      <ScrollArea
        {...workspaceTabPanel("Generation types", tab)}
        className="flex-1 min-h-0"
      >
        <div className="p-2.5">
          {tab === "voice" ? (
            <TextToSpeechPanel />
          ) : tab === "music" ? (
            <MusicLibraryPanel source="music" />
          ) : tab === "tools" ? (
            <>
              <Button
                variant="ghost"
                className="text-xs h-7 mb-2"
                onClick={() => setTab("image")}
              >
                <ChevronLeft size={13} />
                {t("Back to Generate")}
              </Button>
              <AIGenTab />
            </>
          ) : (
            <>
              <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="workspace-generation-model"
                    aria-label={t("Generation model and settings")}
                  >
                    <ConnectionStatus
                      ready={keyConnected}
                      label={
                        keyConnected
                          ? `Model · ${modelName}`
                          : keyStatus === "locked"
                            ? "Unlock keys to generate"
                            : keyStatus === "checking"
                              ? "Checking key…"
                              : "Add a key to generate"
                      }
                    />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="workspace-generation-settings"
                  aria-label={t("Generation settings")}
                >
                  <h3>{t("Generation settings")}</h3>
                  <div className="workspace-generation-options">
                    <label>{t("Model")}</label>
                    <Select
                      value={tab === "video" ? "kling-2.6" : model}
                      onValueChange={setModel}
                    >
                      <SelectTrigger
                        aria-label={t("Generation model")}
                        className="workspace-generation-model"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {tab === "video" ? (
                          <SelectItem value="kling-2.6">
                            {t("Kling 2.6 · KieAI")}
                          </SelectItem>
                        ) : (
                          <>
                            <SelectItem value="z-image">
                              {t("Z-Image · KieAI")}
                            </SelectItem>
                            <SelectItem value="nano-banana-2">
                              {t("Nano Banana 2 · KieAI")}
                            </SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <label>{t("Variations")}</label>
                    <Select value={count} onValueChange={setCount}>
                      <SelectTrigger
                        aria-label={t("Number of variations")}
                        className="h-8 w-full text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["1", "2", "4"].map((c) => (
                          <SelectItem value={c} key={c}>
                            {c} {c === "1" ? t("variation") : t("variations")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {tab === "video" && (
                      <div className="contents">
                        <label>{t("Duration")}</label>
                        <Select value={duration} onValueChange={setDuration}>
                          <SelectTrigger
                            aria-label={t("Video duration")}
                            className="h-8 w-full text-xs"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="5">5 seconds</SelectItem>
                            <SelectItem value="10">10 seconds</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <p className="workspace-generate-disclosure">
                    {t("Uses your KieAI credits. Results save to Project media.")}
                  </p>
                  <div className="workspace-generation-settings-actions">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSettingsOpen(false);
                        setTab("tools");
                      }}
                    >
                      <Settings2 size={12} />
                      {t("All AI tools")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSettingsOpen(false);
                        useSettingsStore.getState().openSettings("api-keys");
                      }}
                    >
                      {t("Provider settings")}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <label className="workspace-generate-prompt">
                PROMPT
                <Textarea
                  aria-label={t("Generation prompt")}
                  placeholder={
                    tab === "video"
                      ? t("Describe a shot, camera movement and mood…")
                      : t("Describe the image you want to create…")
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>
              <div className="workspace-chips">
                {STYLE_CHIPS.map(
                  ([s, Icon]) => (
                    <Button
                      key={s}
                      variant="ghost"
                      aria-pressed={style === s}
                      onClick={() => setStyle(s)}
                    >
                      <Icon aria-hidden="true" />
                      {s}
                    </Button>
                  ),
                )}
              </div>
              <div className="workspace-generate-ratios">
                {(["16:9", "9:16", "1:1"] as const).map((r) => (
                  <Button
                    key={r}
                    variant="outline"
                    aria-pressed={ratio === r}
                    onClick={() => setRatio(r)}
                  >
                    {r}
                  </Button>
                ))}
              </div>

              <Button
                className="workspace-ai-primary w-full h-8 text-xs"
                disabled={!prompt.trim() || submitting || !keyConnected}
                title={disabledReason ?? undefined}
                onClick={() => void generate()}
              >
                {submitting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Sparkle size={13} />
                )}
                {t("Generate")} {count} {count === "1" ? t("variation") : t("variations")}
              </Button>
              {disabledReason && (
                <p className="workspace-generate-hint">
                  {disabledReason}
                  {(keyStatus === "missing" || keyStatus === "locked") && (
                    <Button
                      variant="link"
                      onClick={() =>
                        useSettingsStore.getState().openSettings("api-keys")
                      }
                    >
                      {keyStatus === "locked" ? t("Unlock") : t("Connect")}
                    </Button>
                  )}
                </p>
              )}
              {error && (
                <div role="alert" className="workspace-generate-error">
                  <AlertCircle size={13} />
                  <p>{error}</p>
                  <Button
                    variant="link"
                    onClick={() =>
                      useSettingsStore.getState().openSettings("api-keys")
                    }
                  >
                    {t("API key settings")}
                  </Button>
                </div>
              )}
              <div className="workspace-library-label">
                <span>RESULTS</span>
                <small>{t("Saved to Project › AI")}</small>
              </div>
              <div className="workspace-generation-results">
                {results.map((m) => (
                  <div
                    key={m.id}
                    className="workspace-generation-result"
                    data-status={
                      m.kieaiError
                        ? "failed"
                        : m.isPending
                          ? "pending"
                          : m.isPlaceholder
                            ? "unavailable"
                            : "ready"
                    }
                  >
                    <Button
                      variant="outline"
                      aria-label={`Select result ${m.name}`}
                      aria-pressed={selectedResult?.id === m.id}
                      disabled={
                        !!m.isPending || !!m.isPlaceholder || !!m.kieaiError
                      }
                      onClick={() => setSelected(m.id)}
                    >
                      {m.kieaiError ? (
                        <span>
                          <AlertCircle size={18} />
                          <small>{t("Generation failed")}</small>
                        </span>
                      ) : m.isPending ? (
                        <span role="status">
                          <small>{t("Generating…")}</small>
                          <Progress
                            className="workspace-generation-progress"
                            aria-label={`Generating ${m.name}`}
                          />
                        </span>
                      ) : m.thumbnailUrl ? (
                        <img src={m.thumbnailUrl} alt="" />
                      ) : (
                        <span>
                          <ImageIcon size={22} />
                          <small>
                            {m.isPlaceholder ? t("Result unavailable") : m.name}
                          </small>
                        </span>
                      )}
                    </Button>
                    {m.kieaiError && (
                      <Button
                        variant="secondary"
                        className="workspace-generation-retry"
                        aria-label={`Retry generation ${m.name}`}
                        disabled={!tasks.some((task) => task.mediaId === m.id)}
                        title={
                          tasks.some((task) => task.mediaId === m.id)
                            ? undefined
                            : t("The provider task is unavailable on this device. Generate a new variation.")
                        }
                        onClick={() => {
                          const task = tasks.find(
                            (task) => task.mediaId === m.id,
                          );
                          if (task) {
                            useKieAIStore.getState().retryTask(task.taskId);
                            useProjectStore
                              .getState()
                              .setKieAIItemState(m.id, true, false);
                          }
                        }}
                      >
                        {t("Retry")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {!results.length && (
                <div className="workspace-generation-empty">
                  <ImageIcon size={22} />
                  <p>{t("Your generated variations will appear here.")}</p>
                </div>
              )}
              <Button
                variant="secondary"
                className="w-full h-8 mt-3 text-xs"
                disabled={!selectedResult}
                onClick={() => void add()}
              >
                <Plus size={13} />
                {t("Add selected to timeline")}
              </Button>
            </>
          )}
        </div>
      </ScrollArea>
      {(tab === "voice" || tab === "music" || tab === "tools") && (
        <footer className="workspace-panel-footer">
          <Button
            variant="ghost"
            className="h-6 p-0 text-[10px]"
            onClick={() => setTab("tools")}
          >
            <Settings2 size={12} />
            {t("All AI tools")}
          </Button>
          <Button
            variant="ghost"
            className="h-6 p-0 text-[10px]"
            onClick={() => useSettingsStore.getState().openSettings("api-keys")}
          >
            {t("Provider settings")}
          </Button>
        </footer>
      )}
    </div>
  );
}
