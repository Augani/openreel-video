import { useState, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
} from "@openreel/ui";
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
import { useProjectStore } from "../../../stores/project-store";
import { useKieAIStore } from "../../../stores/kieai-store";
import { ModelPicker } from "./ModelPicker";
import { SeedreamForm } from "./forms/SeedreamForm";
import { ZImageForm } from "./forms/ZImageForm";
import { NanoBanana2Form } from "./forms/NanoBanana2Form";
import { Flux2Form } from "./forms/Flux2Form";
import { GrokForm } from "./forms/GrokForm";
import { QwenForm } from "./forms/QwenForm";

// ─── Default inputs per model ────────────────────────────────────────────────

function defaultSeedream(): SeedreamInput {
  return { prompt: "", image_urls: [], aspect_ratio: "1:1", quality: "basic" };
}
function defaultZImage(): ZImageInput {
  return { prompt: "", aspect_ratio: "1:1" };
}
function defaultNanoBanana2(): NanoBanana2Input {
  return { prompt: "", aspect_ratio: "1:1", resolution: "2K", output_format: "png" };
}
function defaultFlux2(): Flux2Input {
  return { prompt: "", input_urls: [], aspect_ratio: "1:1", resolution: "1K" };
}
function defaultGrok(): GrokInput {
  return { image_urls: [] };
}
function defaultQwen(imageUrl: string): QwenInput {
  return { prompt: "", image_url: imageUrl, strength: 0.8, output_format: "png", acceleration: "regular" };
}

// ─── Step types ───────────────────────────────────────────────────────────────

type Step = "pick" | "form" | "submitting" | "error";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The source image file that was right-clicked */
  sourceFile: File;
  /** Thumbnail data URL for preview (avoids blob URL lifecycle issues) */
  previewUrl: string | null;
}

export function KieAIImageDialog({ open, onClose, sourceFile, previewUrl }: Props) {
  const [step, setStep] = useState<Step>("pick");
  const [selectedModel, setSelectedModel] = useState<ImageModelId | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const { project, addPlaceholderMedia } = useProjectStore();
  const { addTask } = useKieAIStore();

  // Per-model form state
  const [seedream, setSeedream] = useState<SeedreamInput>(defaultSeedream);
  const [zimage, setZimage] = useState<ZImageInput>(defaultZImage);
  const [nanoBanana2, setNanoBanana2] = useState<NanoBanana2Input>(defaultNanoBanana2);
  const [flux2, setFlux2] = useState<Flux2Input>(defaultFlux2);
  const [grok, setGrok] = useState<GrokInput>(defaultGrok);
  const [qwen, setQwen] = useState<QwenInput>(() => defaultQwen(""));

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    // Reset state for next open
    setStep("pick");
    setSelectedModel(null);
    setErrorMsg("");
    setSeedream(defaultSeedream());
    setZimage(defaultZImage());
    setNanoBanana2(defaultNanoBanana2());
    setFlux2(defaultFlux2());
    setGrok(defaultGrok());
    setQwen(defaultQwen(""));
    onClose();
  }, [onClose]);

  const handleModelSelect = useCallback((model: ImageModelId) => {
    setSelectedModel(model);
    setStep("form");
  }, []);

  const handleBack = useCallback(() => {
    setStep("pick");
    setSelectedModel(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedModel || !project) return;

    setStep("submitting");
    setErrorMsg("");

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      // Upload source image first (for models that need it)
      let uploadedUrl = "";
      const needsUpload = selectedModel !== IMAGE_MODELS.Z_IMAGE;

      if (needsUpload) {
        const uploaded = await uploadFileStream(sourceFile);
        if (ac.signal.aborted) return;
        console.log("[KieAI] upload response:", uploaded);
        // KieAI API may return url under different field names
        uploadedUrl =
          uploaded.fileUrl ||
          uploaded.downloadUrl ||
          (uploaded as unknown as Record<string, string>)["url"] ||
          "";
        if (!uploadedUrl) {
          throw new Error("Upload succeeded but returned no file URL. Check console for response.");
        }
      }

      if (ac.signal.aborted) return;

      // Build model-specific input
      let input: Parameters<typeof createImageTask>[1];
      switch (selectedModel) {
        case IMAGE_MODELS.SEEDREAM:
          input = { ...seedream, image_urls: [uploadedUrl] };
          break;
        case IMAGE_MODELS.Z_IMAGE:
          input = zimage;
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
        default:
          throw new Error("Unknown model");
      }

      console.log("[KieAI] createTask payload:", { model: selectedModel, input });
      const taskId = await createImageTask(selectedModel, input);

      // Bail out if the user cancelled while the request was in flight
      if (ac.signal.aborted) return;

      // Create a placeholder in the media library immediately
      const ext = "png"; // optimistic; poller will use actual blob mime
      const base = sourceFile.name.replace(/\.[^.]+$/, "");
      const suggestedName = `${base}_kieai.${ext}`;
      const mediaId = uuidv4();

      const placeholder = {
        id: mediaId,
        name: suggestedName,
        type: "image" as const,
        fileHandle: null,
        blob: null,
        metadata: {
          duration: 0,
          width: 0,
          height: 0,
          frameRate: 0,
          codec: "",
          sampleRate: 0,
          channels: 0,
          fileSize: 0,
        },
        thumbnailUrl: previewUrl,
        waveformData: null,
        isPlaceholder: true,
        isPending: true,
        kieaiTaskId: taskId,
      };

      addPlaceholderMedia(placeholder);
      addTask({
        taskId,
        mediaId,
        projectId: project.id,
        type: "image",
        suggestedName,
        createdAt: Date.now(),
      });

      // Close the dialog immediately — background poller takes it from here
      handleClose();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }, [selectedModel, project, sourceFile, previewUrl, seedream, zimage, nanoBanana2, flux2, grok, qwen, addPlaceholderMedia, addTask, handleClose]);

  // ─── Derived display ──────────────────────────────────────────────────────

  const modelLabel = selectedModel
    ? selectedModel.split("/")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "pick" && "Create with KieAI"}
            {step === "form" && `${modelLabel}`}
            {step === "submitting" && "Submitting…"}
            {step === "error" && "Submission Failed"}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-2 max-h-[70vh] overflow-y-auto pr-1">
          {/* Source image preview strip */}
          {(
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-background-elevated p-2">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Source"
                  className="h-10 w-10 rounded object-cover flex-shrink-0"
                />
              ) : (
                <div className="h-10 w-10 rounded bg-background-tertiary flex items-center justify-center flex-shrink-0">
                  <svg className="h-5 w-5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="m3 9 4-4 4 4 4-4 4 4" /><circle cx="8.5" cy="14.5" r="1.5" />
                  </svg>
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-text-primary">{sourceFile.name}</p>
                <p className="text-[10px] text-text-muted">Source image</p>
              </div>
            </div>
          )}

          {step === "pick" && <ModelPicker onSelect={handleModelSelect} />}

          {step === "form" && selectedModel === IMAGE_MODELS.SEEDREAM && (
            <SeedreamForm value={seedream} onChange={setSeedream} onSubmit={handleSubmit} isLoading={false} />
          )}
          {step === "form" && selectedModel === IMAGE_MODELS.Z_IMAGE && (
            <ZImageForm value={zimage} onChange={setZimage} onSubmit={handleSubmit} isLoading={false} />
          )}
          {step === "form" && selectedModel === IMAGE_MODELS.NANO_BANANA2 && (
            <NanoBanana2Form value={nanoBanana2} onChange={setNanoBanana2} onSubmit={handleSubmit} isLoading={false} />
          )}
          {step === "form" && selectedModel === IMAGE_MODELS.FLUX2 && (
            <Flux2Form value={flux2} onChange={setFlux2} onSubmit={handleSubmit} isLoading={false} />
          )}
          {step === "form" && selectedModel === IMAGE_MODELS.GROK && (
            <GrokForm value={grok} onChange={setGrok} onSubmit={handleSubmit} isLoading={false} />
          )}
          {step === "form" && selectedModel === IMAGE_MODELS.QWEN && (
            <QwenForm value={qwen} onChange={setQwen} onSubmit={handleSubmit} isLoading={false} />
          )}

          {step === "submitting" && (
            <div className="space-y-4 py-4 text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
              <p className="text-sm text-text-secondary">Uploading & submitting task…</p>
              <Button variant="outline" size="sm" onClick={() => { abortRef.current?.abort(); handleClose(); }}>
                Cancel
              </Button>
            </div>
          )}

          {step === "error" && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {errorMsg}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handleClose}>
                  Close
                </Button>
                <Button className="flex-1" onClick={() => setStep("form")}>
                  Try Again
                </Button>
              </div>
            </div>
          )}
        </div>

        {step === "form" && (
          <div className="mt-2 flex justify-start">
            <button
              onClick={handleBack}
              className="text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              ← Back to model selection
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
