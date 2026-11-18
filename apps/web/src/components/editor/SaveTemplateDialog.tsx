import { useEffect, useId, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Upload,
  Cloud,
  HardDrive,
  Check,
  AlertCircle,
  Loader2,
  X,
} from "@/icons/lucide-compat";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Textarea,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  RadioGroup,
  RadioGroupItem,
  cn,
} from "@openreel/ui";
import { TEMPLATE_CATEGORIES, type TemplateCategory } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { saveProjectTemplate } from "../../services/project-templates";

interface SaveTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const inputClass =
  "h-8 w-full min-w-0 rounded-[7px] border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 placeholder:text-fg-muted focus:border-accent";
const labelClass = "text-[11px] font-medium text-text-secondary";
type Phase = "idle" | "preparing" | "saving";

export function SaveTemplateDialog({
  isOpen,
  onClose,
}: SaveTemplateDialogProps) {
  const owner = useProjectStore(
    useShallow((state) => ({
      projectId: state.project.id,
      history: state.actionHistory,
    })),
  );
  const id = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("custom");
  const [tags, setTags] = useState("");
  const [author, setAuthor] = useState("");
  const [location, setLocation] = useState<"local" | "cloud">("cloud");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const phaseRef = useRef<Phase>("idle");
  const operation = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(isOpen);
  const closeRef = useRef(onClose);
  openRef.current = isOpen;
  closeRef.current = onClose;

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const resetDraft = () => {
    setName("");
    setDescription("");
    setCategory("custom");
    setTags("");
    setAuthor("");
    setSuccess(false);
  };

  useEffect(() => {
    setError(null);
    setSuccess(false);
    phaseRef.current = "idle";
    setPhase("idle");
    return () => {
      operation.current?.abort();
      operation.current = null;
      clearTimer();
    };
  }, [isOpen, owner.projectId, owner.history]);

  const close = () => {
    if (phaseRef.current === "saving") return;
    operation.current?.abort();
    clearTimer();
    if (success) resetDraft();
    closeRef.current();
  };

  const save = async () => {
    if (!isOpen || phaseRef.current !== "idle" || success) return;
    operation.current?.abort();
    clearTimer();
    const controller = new AbortController();
    operation.current = controller;
    phaseRef.current = "preparing";
    setPhase("preparing");
    setError(null);
    try {
      await saveProjectTemplate({
        owner,
        signal: controller.signal,
        name,
        description,
        category,
        tags,
        author,
        location,
        onWriting: () => {
          phaseRef.current = "saving";
          setPhase("saving");
        },
      });
      if (
        operation.current !== controller ||
        controller.signal.aborted ||
        !openRef.current
      )
        return;
      setSuccess(true);
      timer.current = setTimeout(() => {
        if (
          operation.current !== controller ||
          controller.signal.aborted ||
          !openRef.current
        )
          return;
        resetDraft();
        closeRef.current();
      }, 1500);
    } catch (cause) {
      if (
        operation.current === controller &&
        !controller.signal.aborted &&
        openRef.current
      )
        setError(
          cause instanceof Error ? cause.message : "Failed to save template",
        );
    } finally {
      if (operation.current === controller) {
        phaseRef.current = "idle";
        setPhase("idle");
      }
    }
  };

  // Stays mounted while closed so the dialog plays its exit animation (the owner remounts it, keyed, per opening).
  const busy = phase !== "idle";
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        hideCloseButton
        className="flex max-h-[90dvh] w-[calc(100vw-32px)] max-w-[512px] flex-col gap-0 overflow-hidden border-border bg-bg-1 p-0 text-fg shadow-xl"
        onEscapeKeyDown={(event) => {
          if (phaseRef.current === "saving") event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (phaseRef.current === "saving") event.preventDefault();
        }}
      >
        <form
          className="flex max-h-[90dvh] min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader className="shrink-0 flex-row items-start gap-3 space-y-0 border-b border-border px-5 py-4 text-left">
            <DialogTitle className="min-w-0 flex-1 text-[15px] font-semibold leading-5">
              Save as Template
            </DialogTitle>
            <DialogDescription className="sr-only">
              Save your current project's editable content as a reusable
              template.
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label="Close dialog"
              onClick={close}
              disabled={phase === "saving"}
              className="h-7 w-7 shrink-0 text-fg-muted"
            >
              <X size={15} aria-hidden />
            </Button>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              {success && (
                <Card
                  role="status"
                  className="flex items-center gap-2 rounded-[7px] border-green-500/30 bg-status-success/10 p-3 text-[12px] text-green-400 shadow-none"
                >
                  <Check size={16} aria-hidden />
                  Template saved successfully!
                </Card>
              )}
              {error && (
                <Card
                  role="alert"
                  className="flex items-center gap-2 rounded-[7px] border-red-500/30 bg-status-error/10 p-3 text-[12px] text-red-400 shadow-none"
                >
                  <AlertCircle size={16} aria-hidden />
                  {error}
                </Card>
              )}
              <fieldset
                disabled={busy || success}
                className="min-w-0 space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-name`} className={labelClass}>
                    Template Name
                  </Label>
                  <Input
                    id={`${id}-name`}
                    required
                    maxLength={50}
                    value={name}
                    onChange={(event) =>
                      setName(event.target.value.slice(0, 50))
                    }
                    placeholder="My Awesome Template"
                    className={inputClass}
                    aria-describedby={`${id}-name-length`}
                  />
                  <p id={`${id}-name-length`} className="text-[10px] text-fg-2">
                    {name.length}/50 characters
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-description`} className={labelClass}>
                    Description
                  </Label>
                  <Textarea
                    id={`${id}-description`}
                    required
                    maxLength={500}
                    rows={4}
                    value={description}
                    onChange={(event) =>
                      setDescription(event.target.value.slice(0, 500))
                    }
                    placeholder="Describe what this template is for and how to use it..."
                    className={cn(
                      inputClass,
                      "min-h-[5.75rem] resize-y leading-5",
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-category`} className={labelClass}>
                    Category
                  </Label>
                  <Select
                    value={category}
                    disabled={busy || success}
                    onValueChange={(value) =>
                      setCategory(value as TemplateCategory)
                    }
                  >
                    <SelectTrigger id={`${id}-category`} className={inputClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_CATEGORIES.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-tags`} className={labelClass}>
                    Tags (comma-separated)
                  </Label>
                  <Input
                    id={`${id}-tags`}
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                    placeholder="intro, animated, youtube"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-author`} className={labelClass}>
                    Author Name
                  </Label>
                  <Input
                    id={`${id}-author`}
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                    placeholder="Your name or username"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    id={`${id}-location`}
                    className="text-[12px] font-bold text-fg-2"
                  >
                    Save Location
                  </Label>
                  <RadioGroup
                    value={location}
                    disabled={busy || success}
                    onValueChange={(value) =>
                      setLocation(value as "cloud" | "local")
                    }
                    aria-labelledby={`${id}-location`}
                    className="grid grid-cols-2 gap-2"
                  >
                    {(["cloud", "local"] as const).map((value) => {
                      const Icon = value === "cloud" ? Cloud : HardDrive;
                      const title = value === "cloud" ? "Cloud" : "Local";
                      return (
                        <Label
                          key={value}
                          htmlFor={`${id}-${value}`}
                          className={cn(
                            "relative flex cursor-pointer items-center justify-center gap-2 rounded-[7px] border p-3 text-[12px] font-bold text-fg-2 transition-colors focus-within:ring-2 focus-within:ring-ring",
                            location === value
                              ? "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]"
                              : "border-border bg-bg-1 hover:bg-bg-2",
                          )}
                        >
                          <RadioGroupItem
                            id={`${id}-${value}`}
                            value={value}
                            aria-label={title}
                            className="sr-only"
                          />
                          <Icon size={16} aria-hidden />
                          {title}
                        </Label>
                      );
                    })}
                  </RadioGroup>
                  <p className="text-[10px] text-fg-2">
                    {location === "cloud"
                      ? "Saves your edits to cloud. Original media must be relinked on another device."
                      : "Saved on this device with the original media."}
                  </p>
                </div>
              </fieldset>
            </div>
          </div>
          <DialogFooter className="shrink-0 flex-row justify-end gap-2 space-x-0 border-t border-border px-5 py-4">
            <Button
              variant="ghost"
              type="button"
              onClick={close}
              disabled={phase === "saving"}
              className="h-8 rounded-[7px] px-3 text-[12px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || success || !name.trim() || !description.trim()}
              className="h-8 gap-1.5 rounded-[7px] bg-accent px-3 text-[12px] text-accent-fg hover:bg-accent/90"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" aria-hidden />
              ) : (
                <Upload size={16} aria-hidden />
              )}
              {busy ? "Saving..." : "Save Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
