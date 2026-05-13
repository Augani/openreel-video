import { useCallback, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@openreel/ui";
import { generateImageWithCodexLocal } from "../../../services/codex-local";
import { useProjectStore } from "../../../stores/project-store";
import { useSettingsStore } from "../../../stores/settings-store";

type Step = "form" | "submitting" | "error";

interface Props {
  open: boolean;
  onClose: () => void;
  sourceFile: File;
  previewUrl: string | null;
}

const ASPECT_RATIOS = ["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "21:9"] as const;

export function CodexLocalImageDialog({ open, onClose, sourceFile, previewUrl }: Props) {
  const [step, setStep] = useState<Step>("form");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIOS)[number]>("auto");
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const codexLocalEndpoint = useSettingsStore((s) => s.codexLocalEndpoint);
  const { project, addPlaceholderMedia, replacePlaceholderMedia, setKieAIItemState } = useProjectStore();

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStep("form");
    setPrompt("");
    setAspectRatio("auto");
    setErrorMsg("");
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleSubmit = useCallback(async () => {
    if (!project) return;
    if (!prompt.trim()) {
      setErrorMsg("Enter a prompt for Codex Local image generation.");
      setStep("error");
      return;
    }

    setStep("submitting");
    setErrorMsg("");

    const ac = new AbortController();
    abortRef.current = ac;
    const mediaId = uuidv4();
    const base = sourceFile.name.replace(/\.[^.]+$/, "");
    const suggestedName = `${base}_codex.png`;

    addPlaceholderMedia({
      id: mediaId,
      name: suggestedName,
      type: "image",
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
    });

    try {
      const blob = await generateImageWithCodexLocal({
        endpoint: codexLocalEndpoint,
        prompt: prompt.trim(),
        sourceFile,
        aspectRatio,
        signal: ac.signal,
      });

      if (ac.signal.aborted) return;

      const ext = blob.type === "image/jpeg" ? "jpg" : "png";
      await replacePlaceholderMedia(mediaId, blob, `${base}_codex.${ext}`);
      handleClose();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setKieAIItemState(mediaId, false, true);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }, [
    addPlaceholderMedia,
    aspectRatio,
    codexLocalEndpoint,
    handleClose,
    previewUrl,
    project,
    prompt,
    replacePlaceholderMedia,
    setKieAIItemState,
    sourceFile,
  ]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "submitting" ? "Generating with Codex Local..." : "Create with Codex Local"}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-2 max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background-elevated p-2">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Source"
                className="h-10 w-10 flex-shrink-0 rounded object-cover"
              />
            ) : (
              <div className="h-10 w-10 flex-shrink-0 rounded bg-background-tertiary" />
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-text-primary">{sourceFile.name}</p>
              <p className="text-[10px] text-text-muted">Source image</p>
            </div>
          </div>

          {step !== "submitting" && (
            <>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-text-secondary">Prompt</span>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary"
                  placeholder="Describe the edit or new version to generate"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-text-secondary">Aspect ratio</span>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as (typeof ASPECT_RATIOS)[number])}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {ASPECT_RATIOS.map((ratio) => (
                    <option key={ratio} value={ratio}>
                      {ratio}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {step === "submitting" && (
            <div className="space-y-4 py-4 text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
              <p className="text-sm text-text-secondary">Sending request to local Codex bridge...</p>
              <Button variant="outline" size="sm" onClick={() => { abortRef.current?.abort(); handleClose(); }}>
                Cancel
              </Button>
            </div>
          )}

          {step === "error" && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              {errorMsg}
            </div>
          )}

          {step !== "submitting" && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!prompt.trim()}>
                Generate
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
