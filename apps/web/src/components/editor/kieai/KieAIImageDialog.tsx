import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openreel/ui";
import { ImageIcon, Loader2, X } from "@/icons/lucide-compat";
import {
  IMAGE_MODELS,
  type ImageModelId,
  type SeedreamInput,
  type ZImageInput,
  type NanoBanana2Input,
  type Flux2Input,
  type GrokInput,
  type QwenInput,
  createImageTask,
} from "../../../services/kieai/image-generation";
import { uploadFileStream } from "../../../services/kieai/file-upload";
import { registerAcceptedImageTask } from "../../../services/kieai/image-task-registration";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";
import { IMAGE_MODEL_OPTIONS, ModelPicker } from "./ModelPicker";
import { SeedreamForm } from "./forms/SeedreamForm";
import { ZImageForm } from "./forms/ZImageForm";
import { NanoBanana2Form } from "./forms/NanoBanana2Form";
import { Flux2Form } from "./forms/Flux2Form";
import { GrokForm } from "./forms/GrokForm";
import { QwenForm } from "./forms/QwenForm";

const defaultSeedream = (): SeedreamInput => ({
  prompt: "",
  image_urls: [],
  aspect_ratio: "1:1",
  quality: "basic",
});
const defaultZImage = (): ZImageInput => ({ prompt: "", aspect_ratio: "1:1" });
const defaultNanoBanana2 = (): NanoBanana2Input => ({
  prompt: "",
  aspect_ratio: "1:1",
  resolution: "2K",
  output_format: "png",
});
const defaultFlux2 = (): Flux2Input => ({
  prompt: "",
  input_urls: [],
  aspect_ratio: "1:1",
  resolution: "1K",
});
const defaultGrok = (): GrokInput => ({ image_urls: [] });
const defaultQwen = (): QwenInput => ({
  prompt: "",
  image_url: "",
  strength: 0.8,
  output_format: "png",
  acceleration: "regular",
});
type Step = "pick" | "form" | "submitting" | "error";
interface Props {
  open: boolean;
  onClose: () => void;
  sourceFile: File;
  previewUrl: string | null;
}
export const KieAIImageDialog = memo(function KieAIImageDialog(props: Props) {
  const session = useMemo(
    () => ({ file: props.sourceFile, key: uuidv4() }),
    [props.sourceFile],
  );
  return props.open ? (
    <ImageDialogSession key={session.key} {...props} />
  ) : null;
});
function ImageDialogSession({ onClose, sourceFile, previewUrl }: Props) {
  const [owner] = useState(() => {
    const state = useProjectStore.getState();
    return { projectId: state.project.id, executor: state.actionExecutor };
  });
  const isOrigin = useProjectStore(
    (state) =>
      state.hasOpenProject &&
      state.project.id === owner.projectId &&
      state.actionExecutor === owner.executor,
  );
  const [step, setStep] = useState<Step>("pick");
  const [selectedModel, setSelectedModel] = useState<ImageModelId | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"upload" | "request">("upload");
  const job = useRef<AbortController | null>(null);
  const active = useRef(true);
  const closed = useRef(false);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      job.current?.abort();
    };
  }, []);
  const close = useCallback(() => {
    job.current?.abort();
    active.current = false;
    if (!closed.current) {
      closed.current = true;
      closeCallback.current();
    }
  }, []);
  useEffect(() => {
    if (!isOrigin) close();
  }, [isOrigin, close]);
  const [seedream, setSeedream] = useState(defaultSeedream);
  const [zimage, setZimage] = useState(defaultZImage);
  const [nanoBanana2, setNanoBanana2] = useState(defaultNanoBanana2);
  const [flux2, setFlux2] = useState(defaultFlux2);
  const [grok, setGrok] = useState(defaultGrok);
  const [qwen, setQwen] = useState(defaultQwen);
  const originIsOpen = () => {
    const current = useProjectStore.getState();
    return (
      current.hasOpenProject &&
      current.project.id === owner.projectId &&
      current.actionExecutor === owner.executor
    );
  };
  const submit = async () => {
    if (!selectedModel || job.current || !active.current || !originIsOpen())
      return;
    const drafts = {
      [IMAGE_MODELS.SEEDREAM]: seedream,
      [IMAGE_MODELS.Z_IMAGE]: zimage,
      [IMAGE_MODELS.NANO_BANANA2]: nanoBanana2,
      [IMAGE_MODELS.FLUX2]: flux2,
      [IMAGE_MODELS.GROK]: grok,
      [IMAGE_MODELS.QWEN]: qwen,
    };
    if (
      selectedModel !== IMAGE_MODELS.GROK &&
      !drafts[selectedModel].prompt?.trim()
    )
      return;
    const controller = new AbortController();
    job.current = controller;
    const ownsView = () =>
      active.current &&
      job.current === controller &&
      !controller.signal.aborted &&
      originIsOpen();
    setStep("submitting");
    setError("");
    const needsUpload = selectedModel !== IMAGE_MODELS.Z_IMAGE;
    setPhase(needsUpload ? "upload" : "request");
    let requestWasSent = false;
    try {
      let uploadedUrl = "";
      if (needsUpload) {
        const uploaded = await uploadFileStream(
          sourceFile,
          {},
          controller.signal,
        );
        if (!ownsView()) return;
        const response = uploaded as unknown as Record<string, unknown>;
        uploadedUrl =
          [response.fileUrl, response.downloadUrl, response.url].find(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          ) ?? "";
        if (!uploadedUrl)
          throw new Error(
            "The upload did not return an image URL. Please try again.",
          );
      }
      if (!ownsView()) return;
      let input: Parameters<typeof createImageTask>[1];
      switch (selectedModel) {
        case IMAGE_MODELS.SEEDREAM:
          input = { ...seedream, image_urls: [uploadedUrl] };
          break;
        case IMAGE_MODELS.Z_IMAGE:
          input = { ...zimage };
          break;
        case IMAGE_MODELS.NANO_BANANA2:
          input = { ...nanoBanana2, image_input: [uploadedUrl] };
          break;
        case IMAGE_MODELS.FLUX2:
          input = { ...flux2, input_urls: [uploadedUrl] };
          break;
        case IMAGE_MODELS.GROK:
          input = { ...grok, image_urls: [uploadedUrl] };
          break;
        case IMAGE_MODELS.QWEN:
          input = { ...qwen, image_url: uploadedUrl };
          break;
      }
      setPhase("request");
      // Creation can be accepted remotely before its response arrives. Keep that
      // receipt tracked even if this view closes; abort only pre-creation uploads.
      requestWasSent = true;
      const taskId = await createImageTask(selectedModel, input);
      if (typeof taskId !== "string" || !taskId.trim())
        throw new Error(
          "The provider did not return a task ID. Please try again.",
        );
      const format =
        selectedModel === IMAGE_MODELS.NANO_BANANA2
          ? (nanoBanana2.output_format ?? "png")
          : selectedModel === IMAGE_MODELS.QWEN
            ? (qwen.output_format ?? "png")
            : "png";
      const base = sourceFile.name.replace(/\.[^.]+$/, "") || "image";
      registerAcceptedImageTask({
        taskId,
        mediaId: uuidv4(),
        projectId: owner.projectId,
        executor: owner.executor,
        suggestedName: `${base}_kieai.${format}`,
        previewUrl,
      });
      if (ownsView()) close();
    } catch (err) {
      if (ownsView()) {
        setError(err instanceof Error ? err.message : String(err));
        setStep("error");
      } else if (requestWasSent) {
        toast.error(
          "Image submission failed",
          err instanceof Error ? err.message : undefined,
        );
      }
    } finally {
      if (job.current === controller) job.current = null;
    }
  };
  const name =
    IMAGE_MODEL_OPTIONS.find((model) => model.id === selectedModel)?.name ?? "";
  const title =
    step === "pick"
      ? "Create with KieAI"
      : step === "submitting"
        ? "Submitting…"
        : step === "error"
          ? "Submission failed"
          : name;
  if (!isOrigin) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        hideCloseButton
        className="flex max-h-[calc(100dvh-32px)] w-[calc(100%_-_32px)] max-w-[512px] flex-col gap-0 overflow-hidden rounded-xl border-border bg-bg-1 p-0 text-fg"
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left sm:text-left">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-[15px] font-semibold">
              {title}
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close dialog"
              onClick={close}
              className="h-7 w-7 text-fg-2"
            >
              <X size={16} aria-hidden />
            </Button>
          </div>
          <DialogDescription className="sr-only">
            Create an image with your chosen model, using the source as a
            reference when supported.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <Card className="flex min-w-0 items-center gap-3 rounded-[7px] border-border bg-bg-2 p-3 text-fg shadow-none">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Source image"
                className="h-10 w-10 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-bg-3">
                <ImageIcon size={20} className="text-fg-3" aria-hidden />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold">
                {sourceFile.name}
              </p>
              <p className="text-[11px] text-fg-3">Source image</p>
            </div>
          </Card>
          {step === "pick" && (
            <ModelPicker
              onSelect={(model) => {
                setSelectedModel(model);
                setStep("form");
              }}
            />
          )}
          {step === "form" && selectedModel === IMAGE_MODELS.SEEDREAM && (
            <SeedreamForm
              value={seedream}
              onChange={setSeedream}
              onSubmit={() => {
                void submit();
              }}
              isLoading={false}
            />
          )}
          {step === "form" && selectedModel === IMAGE_MODELS.Z_IMAGE && (
            <ZImageForm
              value={zimage}
              onChange={setZimage}
              onSubmit={() => {
                void submit();
              }}
              isLoading={false}
            />
          )}
          {step === "form" && selectedModel === IMAGE_MODELS.NANO_BANANA2 && (
            <NanoBanana2Form
              value={nanoBanana2}
              onChange={setNanoBanana2}
              onSubmit={() => {
                void submit();
              }}
              isLoading={false}
            />
          )}
          {step === "form" && selectedModel === IMAGE_MODELS.FLUX2 && (
            <Flux2Form
              value={flux2}
              onChange={setFlux2}
              onSubmit={() => {
                void submit();
              }}
              isLoading={false}
            />
          )}
          {step === "form" && selectedModel === IMAGE_MODELS.GROK && (
            <GrokForm
              value={grok}
              onChange={setGrok}
              onSubmit={() => {
                void submit();
              }}
              isLoading={false}
            />
          )}
          {step === "form" && selectedModel === IMAGE_MODELS.QWEN && (
            <QwenForm
              value={qwen}
              onChange={setQwen}
              onSubmit={() => {
                void submit();
              }}
              isLoading={false}
            />
          )}
          {step === "submitting" && (
            <div className="space-y-3 py-4 text-center">
              <Loader2
                size={28}
                className="mx-auto animate-spin text-accent"
                aria-hidden
              />
              <p role="status" className="text-[13px] text-fg-2">
                {phase === "upload"
                  ? "Uploading source image…"
                  : "Submitting generation…"}
              </p>
              {phase === "request" && (
                <p className="text-[12px] leading-5 text-fg-3">
                  Accepted generations continue in the media library.
                </p>
              )}
            </div>
          )}
          {step === "error" && (
            <Alert
              variant="destructive"
              className="rounded-[7px] border-status-error/25 bg-status-error/10 p-3 text-fg"
            >
              <AlertDescription className="text-[12px] leading-5">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </div>
        {step !== "pick" && (
          <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border px-5 py-3 sm:space-x-0">
            {step === "form" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep("pick");
                  setSelectedModel(null);
                }}
              >
                Back to model selection
              </Button>
            )}
            {step === "submitting" && (
              <Button type="button" variant="outline" size="sm" onClick={close}>
                {phase === "upload" ? "Cancel" : "Close"}
              </Button>
            )}
            {step === "error" && (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={close}>
                  Close
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setStep("form")}
                  className="bg-accent text-accent-fg hover:bg-accent/90"
                >
                  Try Again
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
