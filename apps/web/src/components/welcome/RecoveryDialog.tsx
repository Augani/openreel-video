import { useEffect, useRef, useState } from "react";
import {
  RotateCcw,
  Clock,
  FileVideo,
  ChevronDown,
  Trash2,
  X,
  Loader2,
} from "@/icons/lucide-compat";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  ScrollArea,
} from "@openreel/ui";
import type { AutoSaveMetadata } from "../../services/auto-save";

interface Props {
  saves: AutoSaveMetadata[];
  onRecover: (saveId: string) => boolean | void | Promise<boolean | void>;
  onDismiss: () => void;
  onClearAll?: () => void | Promise<void>;
}
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
function formatDate(timestamp: number): string {
  try {
    return dateFormatter.format(timestamp);
  } catch {
    return "Unknown date";
  }
}
function formatTimeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (!Number.isFinite(seconds)) return "at an unknown time";
  if (seconds < 60) return "just now";
  const amount =
    seconds < 3600
      ? Math.floor(seconds / 60)
      : seconds < 86400
        ? Math.floor(seconds / 3600)
        : Math.floor(seconds / 86400);
  const unit = seconds < 3600 ? "minute" : seconds < 86400 ? "hour" : "day";
  return `${amount} ${unit}${amount === 1 ? "" : "s"} ago`;
}
export function RecoveryDialog({
  saves,
  onRecover,
  onDismiss,
  onClearAll,
}: Props) {
  const [older, setOlder] = useState(false),
    [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null),
    [clearing, setClearing] = useState(false),
    [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const operation = useRef<"recover" | "clear" | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  const busy = selected !== null || clearing,
    latest = saves[0],
    previous = saves.slice(1);
  const pages = Math.max(1, Math.ceil(previous.length / 50)),
    activePage = Math.min(page, pages - 1),
    visible = previous.slice(activePage * 50, (activePage + 1) * 50);
  const dismiss = () => {
    if (!operation.current && !busy) onDismiss();
  };
  async function recover(id: string) {
    if (operation.current || busy) return;
    operation.current = "recover";
    setSelected(id);
    setError("");
    try {
      if ((await onRecover(id)) === false && mounted.current) {
        setError(
          "Could not recover this save. Your current project is still available. Try again or choose another save.",
        );
        setSelected(null);
      }
    } catch {
      if (mounted.current) {
        setError(
          "Could not recover this save. Try again or choose another save.",
        );
        setSelected(null);
      }
    } finally {
      operation.current = null;
    }
  }
  async function clear() {
    if (!onClearAll || operation.current || busy) return;
    operation.current = "clear";
    setClearing(true);
    setError("");
    try {
      await onClearAll();
      if (mounted.current) onDismiss();
    } catch {
      if (mounted.current)
        setError("Could not clear saved projects. Try again.");
    } finally {
      operation.current = null;
      if (mounted.current) setClearing(false);
    }
  }
  if (!latest) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent
        hideCloseButton
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md flex-col gap-0 overflow-hidden border-border bg-bg-1 p-0 text-fg shadow-xl"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 flex-row items-start gap-3 space-y-0 border-b border-border px-5 py-4 text-left">
          <RotateCcw
            size={20}
            aria-hidden
            className="mt-0.5 shrink-0 text-primary"
          />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[15px] font-semibold leading-5 text-fg">
              Recover Your Work
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-4 text-fg-muted">
              We found an unsaved project
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label="Close dialog"
            disabled={busy}
            onClick={dismiss}
            className="h-7 w-7 shrink-0 max-sm:h-11 max-sm:w-11"
          >
            <X size={16} aria-hidden />
          </Button>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          {error && (
            <p role="alert" className="text-xs text-status-error">
              {error}
            </p>
          )}
          <Button
            variant="ghost"
            type="button"
            aria-label={`Recover ${latest.projectName}`}
            disabled={busy}
            onClick={() => void recover(latest.id)}
            className="group block h-auto w-full min-w-0 whitespace-normal rounded-xl border border-border bg-bg-2 p-4 text-left hover:border-primary/50 hover:bg-bg-3 disabled:opacity-70"
          >
            <span className="mb-3 flex items-center gap-3">
              <FileVideo size={20} aria-hidden className="shrink-0 text-fg-3" />
              <span className="truncate text-xs font-medium leading-5 text-fg">
                {latest.projectName}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-fg-3">
              <Clock size={16} aria-hidden className="shrink-0" />
              <span>Last saved {formatTimeAgo(latest.timestamp, now)}</span>
              <span aria-hidden className="opacity-50">
                •
              </span>
              <span className="truncate text-xs opacity-70">
                {formatDate(latest.timestamp)}
              </span>
            </span>
          </Button>
          {!!previous.length && (
            <Collapsible
              open={older}
              onOpenChange={setOlder}
              className="border-t border-border pt-4"
            >
              <div className="flex items-center justify-between gap-2">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={busy}
                    className="h-8 min-w-0 gap-1.5 px-0 text-sm text-fg-3"
                  >
                    <ChevronDown
                      size={16}
                      aria-hidden
                      className={older ? "rotate-180" : ""}
                    />
                    <span className="truncate">
                      {previous.length} older{" "}
                      {previous.length === 1 ? "save" : "saves"} available
                    </span>
                  </Button>
                </CollapsibleTrigger>
                {onClearAll && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    aria-label="Clear all saved projects"
                    title="Clear all saved projects"
                    disabled={busy}
                    onClick={() => void clear()}
                    className="shrink-0 text-fg-3 hover:bg-red-500/10 hover:text-red-400"
                  >
                    {clearing ? (
                      <Loader2 size={16} aria-hidden className="animate-spin" />
                    ) : (
                      <Trash2 size={16} aria-hidden />
                    )}
                  </Button>
                )}
              </div>
              <CollapsibleContent className="mt-3 space-y-2">
                <ScrollArea
                  className={
                    visible.length > 2
                      ? "h-48"
                      : visible.length > 1
                        ? "h-32"
                        : "h-16"
                  }
                >
                  <div className="space-y-2 pr-3">
                    {visible.map((save) => (
                      <Button
                        variant="ghost"
                        key={save.id}
                        type="button"
                        aria-label={`Recover ${save.projectName}`}
                        disabled={busy}
                        onClick={() => void recover(save.id)}
                        className="group block h-auto w-full min-w-0 whitespace-normal rounded-lg border border-border bg-bg-2 p-3 text-left hover:bg-bg-3 disabled:opacity-70"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-fg">
                              {save.projectName}
                            </span>
                            <span className="mt-1 block text-xs text-fg-3">
                              {formatDate(save.timestamp)}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-fg-3">
                            {formatTimeAgo(save.timestamp, now)}
                          </span>
                        </span>
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
                {pages > 1 && (
                  <div className="flex items-center justify-between gap-2 text-xs text-fg-3">
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy || activePage === 0}
                      onClick={() => setPage(activePage - 1)}
                    >
                      Previous saves
                    </Button>
                    <span>
                      {activePage + 1} / {pages}
                    </span>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy || activePage + 1 >= pages}
                      onClick={() => setPage(activePage + 1)}
                    >
                      Next saves
                    </Button>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
        <DialogFooter className="shrink-0 flex-row gap-2 border-t border-border px-5 py-4 sm:space-x-0">
          <Button
            variant="outline"
            type="button"
            disabled={busy}
            onClick={dismiss}
            className="h-8 flex-1 px-3 text-xs max-sm:min-h-11"
          >
            Start Fresh
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void recover(latest.id)}
            className="h-8 flex-1 gap-1.5 px-3 text-xs max-sm:min-h-11"
          >
            {selected === latest.id && (
              <Loader2 size={14} aria-hidden className="animate-spin" />
            )}
            {selected === latest.id ? "Recovering..." : "Recover Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
