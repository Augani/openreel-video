import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Progress,
  Slider,
} from "@openreel/ui";
import { Search, Play, Pause, Volume2, VolumeX, X, ExternalLink, Copy } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import {
  downloadStockFootage,
  preferredFootageSource,
  searchStockFootage,
  stockCreditText,
  type StockFootage,
} from "../../services/stock-footage";

function formatClipDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function FootagePreview({
  item,
  onClose,
}: {
  item: StockFootage;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const source =
    item.sources.find((candidate) => candidate.height >= 480) ??
    item.sources[0];
  useEffect(() => {
    const element = video.current;
    return () => {
      element?.pause();
    };
  }, []);
  const time = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return (
    <div>
      <video
        ref={video}
        src={source.url}
        poster={item.thumbnailUrl}
        crossOrigin="anonymous"
        preload="metadata"
        playsInline
        aria-label={`Preview ${item.title}`}
        className="aspect-video w-full bg-black"
        onLoadedMetadata={(event) =>
          setDuration(
            Number.isFinite(event.currentTarget.duration)
              ? event.currentTarget.duration
              : 0,
          )
        }
        onTimeUpdate={(event) =>
          setPosition(Math.round(event.currentTarget.currentTime * 10) / 10)
        }
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() =>
          setError("Preview could not load. Close it and try again.")
        }
      />
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${playing ? "Pause" : "Play"} footage preview ${item.title}`}
          disabled={Boolean(error)}
          onClick={() => {
            const element = video.current;
            if (!element) return;
            if (playing) element.pause();
            else
              void element
                .play()
                .catch(() =>
                  setError("Preview could not play. Close it and try again."),
                );
          }}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Slider
          aria-label={`Preview position ${item.title}`}
          className="min-w-0 flex-1"
          min={0}
          max={duration || 1}
          step={0.1}
          value={[Math.min(position, duration || 1)]}
          disabled={!duration || Boolean(error)}
          onValueChange={(values) => {
            if (video.current) {
              video.current.currentTime = values[0];
              setPosition(values[0]);
            }
          }}
        />
        <span className="text-[10px] tabular-nums text-fg-muted">
          {time(position)} / {time(duration)}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Mute footage preview ${item.title}`}
          aria-pressed={muted}
          onClick={() => {
            if (video.current) {
              video.current.muted = !muted;
              setMuted(!muted);
            }
          }}
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Close footage preview ${item.title}`}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {error && (
        <Alert variant="destructive" className="m-2 w-auto p-2">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function StockFootagePanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockFootage[]>([]);
  const [nextOffset, setNextOffset] = useState<number>();
  const searchedQuery = useRef("nature");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<number>();
  const [importing, setImporting] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const importRequest = useRef<AbortController | null>(null);
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const lockedReason = useTimelineStore((state) => state.playbackLockedReason);

  const runSearch = useCallback(
    async (term: string, offset = 0, append = false) => {
      searchRequest.current?.abort();
      const request = new AbortController();
      searchRequest.current = request;
      searchedQuery.current = term;
      setLoading(true);
      setError("");
      if (!append) {
        setResults([]);
        setNextOffset(undefined);
        setPreview(null);
      }
      try {
        const page = await searchStockFootage(term, request.signal, offset);
        if (searchRequest.current !== request || request.signal.aborted) return;
        setResults((previous) =>
          append
            ? [
                ...previous,
                ...page.items.filter(
                  (item) => !previous.some((old) => old.id === item.id),
                ),
              ]
            : page.items,
        );
        setNextOffset(page.nextOffset);
      } catch (cause) {
        if (searchRequest.current === request && !request.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not search footage. Try again.",
          );
      } finally {
        if (searchRequest.current === request) setLoading(false);
      }
    },
    [],
  );

  const cancelImport = useCallback((message = "Import cancelled.") => {
    importRequest.current?.abort();
    importRequest.current = null;
    setImporting(null);
    setProgress(undefined);
    setStatus(message);
  }, []);

  useEffect(() => {
    void runSearch("nature");
    const projectSubscription = useProjectStore.subscribe((next, previous) => {
      if (
        next.project.id !== previous.project.id ||
        next.actionExecutor !== previous.actionExecutor
      )
        cancelImport("");
    });
    const exportSubscription = useUIStore.subscribe((state) => {
      if (state.exportState.isExporting && importRequest.current)
        cancelImport("Import cancelled while export is running.");
    });
    const lockSubscription = useTimelineStore.subscribe((state) => {
      if (state.playbackLockedReason && importRequest.current)
        cancelImport("Import cancelled while the editor is busy.");
    });
    return () => {
      searchRequest.current?.abort();
      searchRequest.current = null;
      importRequest.current?.abort();
      importRequest.current = null;
      projectSubscription();
      exportSubscription();
      lockSubscription();
    };
  }, [runSearch, cancelImport]);

  const importFootage = async (item: StockFootage) => {
    if (
      importRequest.current ||
      useUIStore.getState().exportState.isExporting ||
      useTimelineStore.getState().playbackLockedReason
    )
      return;
    const owner = useProjectStore.getState();
    const request = new AbortController();
    importRequest.current = request;
    const owns = () =>
      importRequest.current === request &&
      !request.signal.aborted &&
      useProjectStore.getState().project.id === owner.project.id &&
      useProjectStore.getState().actionExecutor === owner.actionExecutor &&
      !useUIStore.getState().exportState.isExporting &&
      !useTimelineStore.getState().playbackLockedReason;
    setImporting(item.id);
    setError("");
    setStatus("Preparing footage…");
    setProgress(undefined);
    try {
      const existing = owner.project.mediaLibrary.items.find(
        (media) =>
          media.metadata.stockSource?.id === item.id &&
          media.type === "video" &&
          !media.isPlaceholder &&
          !media.isPending,
      );
      let mediaId = existing?.id;
      if (!mediaId) {
        let lastLabel = "";
        const file = await downloadStockFootage(
          item,
          request.signal,
          (bytes, total) => {
            if (!owns()) return;
            const percent = total
              ? Math.min(100, Math.floor((bytes / total) * 100))
              : undefined;
            const label =
              percent === undefined
                ? `Downloading footage… ${Math.floor(bytes / 1048576)} MB`
                : `Downloading footage… ${percent}%`;
            if (label !== lastLabel) {
              lastLabel = label;
              setStatus(label);
              setProgress(percent);
            }
          },
        );
        if (!owns()) return;
        setStatus("Importing footage…");
        setProgress(undefined);
        const result = await owner.importMedia(
          file,
          (stage) => {
            if (owns()) setStatus(stage);
          },
          { stockSource: item.credit },
          { signal: request.signal, isCurrent: owns },
        );
        if (!owns()) return;
        if (!result.success || !result.actionId)
          throw new Error(
            result.error?.message || "Could not import footage. Try again.",
          );
        mediaId = result.actionId;
      }
      if (!owns()) return;
      const placement = await useProjectStore
        .getState()
        .addClipToNewTrack(mediaId);
      if (!owns()) return;
      if (!placement.success)
        throw new Error(
          placement.error?.message ||
            "The footage is in Project media. Add it to the timeline when the editor is ready.",
        );
      setStatus(`Added ${item.title} to the timeline.`);
    } catch (cause) {
      if (owns())
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not import footage. Try again.",
        );
    } finally {
      if (importRequest.current === request) {
        importRequest.current = null;
        setImporting(null);
        setProgress(undefined);
      }
    }
  };

  return (
    <div className="stock-footage-panel flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-2.5 pb-3">
      <form
        className="flex"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(query);
        }}
      >
        <div className="workspace-search min-w-0 flex-1">
          <Search />
          <Input
            aria-label="Search stock footage"
            placeholder="Search free footage"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </form>
      <p className="text-[11px] text-fg-muted">
        Free clips from Wikimedia Commons. Check each clip’s licence and
        credits.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void runSearch(searchedQuery.current)}
          >
            Retry search
          </Button>
        </Alert>
      )}
      {status && (
        <p role="status" className="text-[11px] text-fg-2">
          {status}
        </p>
      )}
      {importing && (
        <div className="flex items-center gap-2">
          {progress !== undefined && (
            <Progress
              aria-label="Footage download"
              value={progress}
              className="h-1 flex-1"
            />
          )}
          <Button size="sm" variant="secondary" onClick={() => cancelImport()}>
            Cancel import
          </Button>
        </div>
      )}
      <div
        className="workspace-footage-grid"
        aria-busy={loading}
        aria-label="Stock footage results"
      >
        {results.map((item) => {
          const source = preferredFootageSource(item);
          const hoverSource = item.sources.reduce((best, candidate) =>
            candidate.height < best.height ? candidate : best,
          );
          return (
            <article
              key={item.id}
              className={`workspace-footage-card${preview === item.id ? " col-span-2" : ""}`}
            >
              {preview === item.id ? (
                <FootagePreview item={item} onClose={() => setPreview(null)} />
              ) : (
                <Button
                  variant="ghost"
                  className="workspace-footage-poster"
                  aria-label={`Preview ${item.title}`}
                  onClick={() => setPreview(item.id)}
                  onMouseEnter={() => setHovered(item.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(item.id)}
                  onBlur={() => setHovered(null)}
                >
                  {item.thumbnailUrl ? (
                    <img
                      crossOrigin="anonymous"
                      src={item.thumbnailUrl}
                      alt={item.title}
                      loading="lazy"
                    />
                  ) : null}
                  {hovered === item.id && (
                    <video
                      src={hoverSource.url}
                      crossOrigin="anonymous"
                      muted
                      loop
                      autoPlay
                      playsInline
                      aria-hidden="true"
                      className="absolute inset-0"
                    />
                  )}
                  <span className="workspace-footage-duration">
                    {formatClipDuration(item.duration)}
                  </span>
                </Button>
              )}
              <div className="workspace-footage-meta">
                <strong title={item.title}>{item.title}</strong>
                <small className="workspace-footage-creator" title={`By ${item.credit.creator}`}>
                  {item.credit.creator}
                </small>
                <small>
                  {source.width}×{source.height} · {item.credit.license}
                </small>
              </div>
              <div className="workspace-footage-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    Boolean(importing) || exporting || Boolean(lockedReason)
                  }
                  title={
                    exporting
                      ? "Wait for export to finish"
                      : lockedReason || undefined
                  }
                  onClick={() => void importFootage(item)}
                  aria-label={`Add footage ${item.title}`}
                >
                  {importing === item.id ? "Adding…" : "Add"}
                </Button>
                <Button
                  size="icon-sm"
                  variant="secondary"
                  asChild
                  title="Source & licence"
                >
                  <a
                    href={item.credit.pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Source & licence for ${item.title}`}
                  >
                    <ExternalLink size={13} />
                  </a>
                </Button>
                <Button
                  size="icon-sm"
                  variant="secondary"
                  title="Copy credits"
                  aria-label={`Copy credits for ${item.title}`}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(stockCreditText(item.credit))
                      .then(
                        () => setStatus("Credits copied."),
                        () =>
                          setError(
                            "Could not copy credits. Open Source & licence to view them.",
                          ),
                      );
                  }}
                >
                  <Copy size={13} />
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {loading && (
        <p role="status" className="text-[11px] text-fg-muted">
          Searching footage…
        </p>
      )}
      {!loading && !error && !results.length && (
        <p className="text-[11px] text-fg-muted">
          No clips found. Try another search.
        </p>
      )}
      {nextOffset !== undefined && (
        <Button
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() =>
            void runSearch(searchedQuery.current, nextOffset, true)
          }
        >
          Load more footage
        </Button>
      )}
    </div>
  );
}
