import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Input,
  Label,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "@openreel/ui";
import { Video, Loader2, X } from "@/icons/lucide-compat";
import {
  computeCompressionPlan,
  estimateCompressedBytes,
  COMPRESSION_SIZE_PRESETS,
  downloadBlob,
  type CompressionSource,
  type CompressionQuality,
} from "@openreel/core";
import {
  probeCompressionSource,
  runCompression,
  formatBytes,
} from "../../services/video-compressor";

interface CompressDialogProps {
  isOpen: boolean;
  onClose: () => void;
}
interface Preferences {
  mode: "quality" | "size";
  quality: CompressionQuality;
  sizePresetId: string;
  customMB: string;
}
const QUALITY_TIERS: {
  value: CompressionQuality;
  label: string;
  hint: string;
}[] = [
  { value: "light", label: "Light", hint: "Best quality" },
  { value: "balanced", label: "Balanced", hint: "≈720p" },
  { value: "strong", label: "Strong", hint: "Smallest" },
];
const MB = 1024 * 1024;
type AcquireEncoder = (controller: AbortController) => (() => void) | null;

export function CompressDialog({ isOpen, onClose }: CompressDialogProps) {
  const [preferences, setPreferences] = useState<Preferences>({
    mode: "quality",
    quality: "balanced",
    sizePresetId: "whatsapp",
    customMB: "",
  });
  // Keep the lease until the encoder acknowledges cancellation, including across
  // externally closed/reopened sessions. An aborted promise may still be running.
  const encoder = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [encoderBusy, setEncoderBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      encoder.current?.abort();
    };
  }, []);
  const acquireEncoder = useCallback<AcquireEncoder>((controller) => {
    if (encoder.current) return null;
    encoder.current = controller;
    setEncoderBusy(true);
    return () => {
      if (encoder.current !== controller) return;
      encoder.current = null;
      if (mounted.current) setEncoderBusy(false);
    };
  }, []);
  return isOpen ? (
    <CompressionSession
      onClose={onClose}
      preferences={preferences}
      onPreferencesChange={setPreferences}
      encoderBusy={encoderBusy}
      acquireEncoder={acquireEncoder}
    />
  ) : null;
}

function CompressionSession({
  onClose,
  preferences,
  onPreferencesChange,
  encoderBusy,
  acquireEncoder,
}: {
  onClose: () => void;
  preferences: Preferences;
  onPreferencesChange: (value: Preferences) => void;
  encoderBusy: boolean;
  acquireEncoder: AcquireEncoder;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const probe = useRef<AbortController | null>(null);
  const job = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<CompressionSource | null>(null);
  const [probing, setProbing] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      probe.current?.abort();
      job.current?.abort();
    };
  }, []);
  const { mode, quality, sizePresetId, customMB } = preferences;
  const update = (value: Partial<Preferences>) =>
    onPreferencesChange({ ...preferences, ...value });
  const resetSource = () => {
    probe.current?.abort();
    probe.current = null;
    setFile(null);
    setSource(null);
    setProbing(false);
    setError(null);
    setProgress(0);
    if (input.current) input.current.value = "";
  };
  const dismiss = () => {
    if (job.current) return;
    resetSource();
    onClose();
  };
  const handlePick = async (picked: File) => {
    if (job.current) return;
    probe.current?.abort();
    const controller = new AbortController();
    probe.current = controller;
    const ownsProbe = () =>
      active.current &&
      probe.current === controller &&
      !controller.signal.aborted;
    setFile(picked);
    setSource(null);
    setError(null);
    setProgress(0);
    setProbing(true);
    try {
      const result = await probeCompressionSource(picked, controller.signal);
      if (!ownsProbe()) return;
      setSource(result);
      if (!result) setError("Couldn't read that video — try a different file.");
    } catch {
      if (ownsProbe())
        setError("Couldn't read that video — try a different file.");
    } finally {
      if (ownsProbe()) {
        probe.current = null;
        setProbing(false);
      }
    }
  };
  const customValue = /^\d*\.?\d+$/.test(customMB.trim())
    ? Number(customMB.trim()) * MB
    : NaN;
  const targetBytes =
    sizePresetId === "custom"
      ? customValue
      : (COMPRESSION_SIZE_PRESETS.find((preset) => preset.id === sizePresetId)
          ?.bytes ?? NaN);
  const invalidSize =
    mode === "size" && (!Number.isFinite(targetBytes) || targetBytes <= 0);
  const plan = useMemo(
    () =>
      source && !invalidSize
        ? computeCompressionPlan(
            source,
            mode === "quality" ? { mode, quality } : { mode, targetBytes },
          )
        : null,
    [source, invalidSize, mode, quality, targetBytes],
  );
  const estimated = useMemo(
    () =>
      plan && source ? estimateCompressedBytes(plan, source.durationSec) : 0,
    [plan, source],
  );
  const savings =
    file && file.size > 0 && estimated > 0
      ? Math.round((1 - estimated / file.size) * 100)
      : 0;
  const handleCompress = async () => {
    if (!file || !source || !plan || probing || job.current) return;
    const controller = new AbortController();
    const release = acquireEncoder(controller);
    if (!release) return;
    job.current = controller;
    const ownsJob = () => active.current && job.current === controller;
    setCompressing(true);
    setCancelling(false);
    setProgress(0);
    setError(null);
    try {
      const blob = await runCompression(
        file,
        plan,
        (value) => {
          if (ownsJob() && !controller.signal.aborted && Number.isFinite(value))
            setProgress(Math.min(1, Math.max(0, value)));
        },
        controller.signal,
      );
      if (!ownsJob() || controller.signal.aborted) return;
      const base = file.name.replace(/\.[^.]+$/, "") || "video";
      downloadBlob(blob, `${base}-compressed.mp4`);
      resetSource();
      onClose();
    } catch (err) {
      if (
        ownsJob() &&
        !controller.signal.aborted &&
        (err as Error)?.name !== "AbortError"
      )
        setError("Compression failed — try a lighter setting.");
    } finally {
      if (ownsJob()) {
        job.current = null;
        setCompressing(false);
        setCancelling(false);
      }
      release();
    }
  };
  const cardClass = (selected: boolean) =>
    cn(
      "relative flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-[7px] border bg-bg-1 p-3 text-center text-fg transition-colors hover:bg-bg-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
      selected && "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent
        hideCloseButton
        className="flex max-h-[calc(100dvh-32px)] w-[calc(100%_-_32px)] max-w-[512px] flex-col gap-0 overflow-hidden rounded-xl border-border bg-bg-1 p-0 text-fg"
        onEscapeKeyDown={(event) => {
          if (job.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (job.current) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left sm:text-left">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Video size={18} className="text-accent" aria-hidden />
              <DialogTitle className="text-[15px] font-semibold">
                Compress Video
              </DialogTitle>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-fg-2"
              aria-label="Close dialog"
              disabled={compressing}
              onClick={dismiss}
            >
              <X size={16} aria-hidden />
            </Button>
          </div>
          <DialogDescription className="sr-only">
            Compress a video by quality or target file size.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <Input
            ref={input}
            type="file"
            accept="video/*"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            disabled={compressing}
            onChange={(event) => {
              const picked = event.target.files?.[0];
              event.target.value = "";
              if (picked) void handlePick(picked);
            }}
          />
          <Button
            type="button"
            variant="outline"
            aria-label="Video file"
            disabled={compressing}
            onClick={() => input.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const picked = event.dataTransfer.files[0];
              if (picked && !job.current) void handlePick(picked);
            }}
            className="h-auto w-full flex-col gap-2 whitespace-normal rounded-lg border-dashed border-border bg-bg-2 px-4 py-6 text-fg hover:bg-bg-3"
          >
            {probing ? (
              <Loader2
                size={24}
                className="animate-spin text-accent"
                aria-hidden
              />
            ) : (
              <Video size={24} className="text-fg-2" aria-hidden />
            )}
            <span className="max-w-full truncate text-[13px] font-medium">
              {file?.name ?? "Choose a video to compress…"}
            </span>
            <span className="text-[12px] font-normal text-fg-2">
              {probing
                ? "Reading…"
                : file
                  ? `${source ? `${source.width}×${source.height} · ` : ""}${formatBytes(file.size)}`
                  : "Click to browse or drop a video file"}
            </span>
          </Button>
          {file && !compressing && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[12px] text-fg-2"
                onClick={resetSource}
              >
                Remove video
              </Button>
            </div>
          )}
          {source && !compressing && (
            <>
              <Tabs
                value={mode}
                onValueChange={(value) =>
                  update({ mode: value as Preferences["mode"] })
                }
              >
                <TabsList
                  className="grid w-full grid-cols-2 bg-bg-2"
                  aria-label="Compression mode"
                >
                  <TabsTrigger value="quality">Quality</TabsTrigger>
                  <TabsTrigger value="size">Target size</TabsTrigger>
                </TabsList>
                <TabsContent value={mode} className="mt-3">
                  {mode === "quality" ? (
                    <RadioGroup
                      aria-label="Compression quality"
                      value={quality}
                      onValueChange={(value) =>
                        update({ quality: value as CompressionQuality })
                      }
                      className="grid-cols-3"
                    >
                      {QUALITY_TIERS.map((tier) => (
                        <Label
                          key={tier.value}
                          htmlFor={`${id}-${tier.value}`}
                          className={cardClass(quality === tier.value)}
                        >
                          <RadioGroupItem
                            id={`${id}-${tier.value}`}
                            value={tier.value}
                            aria-label={tier.label}
                            className="sr-only"
                          />
                          <span className="text-[12px] font-semibold">
                            {tier.label}
                          </span>
                          <span className="text-[10px] font-normal text-fg-2">
                            {tier.hint}
                          </span>
                        </Label>
                      ))}
                    </RadioGroup>
                  ) : (
                    <div className="space-y-3">
                      <RadioGroup
                        aria-label="Target file size"
                        value={sizePresetId}
                        onValueChange={(value) =>
                          update({ sizePresetId: value })
                        }
                        className="grid-cols-3"
                      >
                        {COMPRESSION_SIZE_PRESETS.map((preset) => (
                          <Label
                            key={preset.id}
                            htmlFor={`${id}-${preset.id}`}
                            className={cardClass(sizePresetId === preset.id)}
                          >
                            <RadioGroupItem
                              id={`${id}-${preset.id}`}
                              value={preset.id}
                              aria-label={preset.label}
                              className="sr-only"
                            />
                            <span className="text-[12px] font-semibold">
                              {preset.label}
                            </span>
                          </Label>
                        ))}
                        <Label
                          htmlFor={`${id}-custom`}
                          className={cn(
                            cardClass(sizePresetId === "custom"),
                            "col-span-3 flex-row justify-center p-2",
                          )}
                        >
                          <RadioGroupItem
                            id={`${id}-custom`}
                            value="custom"
                            aria-label="Custom target size"
                            className="sr-only"
                          />
                          <span className="text-[12px] font-semibold">
                            Custom
                          </span>
                        </Label>
                      </RadioGroup>
                      {sizePresetId === "custom" && (
                        <div className="space-y-2">
                          <Label
                            htmlFor={`${id}-mb`}
                            className="text-[12px] text-fg-2"
                          >
                            Custom target size (MB)
                          </Label>
                          <Input
                            id={`${id}-mb`}
                            type="text"
                            inputMode="decimal"
                            value={customMB}
                            placeholder="e.g. 12.5"
                            onChange={(event) =>
                              update({ customMB: event.target.value })
                            }
                            aria-invalid={invalidSize}
                            aria-describedby={
                              invalidSize ? `${id}-size-error` : undefined
                            }
                            className="h-8 border-border bg-bg-2 text-[12px]"
                          />
                          {invalidSize && (
                            <p
                              id={`${id}-size-error`}
                              className="text-[12px] text-fg-2"
                            >
                              Enter a size greater than 0 MB.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
              {plan && (
                <Card className="rounded-[7px] border-border bg-bg-2 p-3 text-fg shadow-none">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                    <span className="text-fg-2">Estimated output</span>
                    <span className="font-semibold">
                      {plan.width}×{plan.height} · ~{formatBytes(estimated)}
                    </span>
                  </div>
                  {savings > 0 && file && (
                    <div className="mt-1 flex items-center justify-between gap-2 text-[12px]">
                      <span className="text-fg-2">
                        from {formatBytes(file.size)}
                      </span>
                      <span className="font-semibold text-accent">
                        -{savings}% smaller
                      </span>
                    </div>
                  )}
                </Card>
              )}
            </>
          )}
          {compressing && (
            <div className="space-y-2">
              <div
                role="status"
                className="flex items-center gap-2 text-[13px] font-semibold text-fg-2"
              >
                <Loader2
                  size={16}
                  className="animate-spin text-accent"
                  aria-hidden
                />
                {cancelling
                  ? "Cancelling…"
                  : `Compressing… ${Math.round(progress * 100)}%`}
              </div>
              <Progress
                aria-label="Compression progress"
                value={Math.round(progress * 100)}
                max={100}
              />
            </div>
          )}
          {encoderBusy && !compressing && (
            <p role="status" className="text-[12px] text-fg-2">
              Finishing previous cancellation…
            </p>
          )}
          {error && (
            <Alert
              variant="destructive"
              className="rounded-[7px] border-status-error/25 bg-status-error/10 p-3 text-fg"
            >
              <AlertDescription className="text-[12px]">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border px-5 py-3 sm:space-x-0">
          {compressing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={cancelling}
              onClick={() => {
                job.current?.abort();
                setCancelling(true);
              }}
            >
              Cancel
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
                Close
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!plan || probing || encoderBusy}
                onClick={() => {
                  void handleCompress();
                }}
                className="bg-accent text-accent-fg hover:bg-accent/90"
              >
                Compress
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
