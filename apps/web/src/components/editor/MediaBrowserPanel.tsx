import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@openreel/ui";
import { ArrowUp, Download, Eye, Film, Folder, FolderOpen, HardDrive, Image as ImageIcon, LayoutGrid, List, Music2, Star } from "@/icons/lucide-compat";
import type { OpenReelBrowserEntry } from "../../types/global";
import { useMediaBrowserStore, visibleEntries, type BrowserTypeFilter } from "../../stores/media-browser-store";
import {
  addWebRoot,
  browserBackend,
  desktopBrowserBridge,
  importEntries,
  listPath,
  previewEntry,
  scrubFramesFor,
  thumbnailFor,
  webDirectoryPicker,
  webRootNames,
} from "../../services/media-browser";
import { toast } from "../../stores/notification-store";

const SELECT_CLASS = "h-7 rounded-md border border-border bg-bg-2 px-1.5 text-[12px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring";

const KIND_LABELS: Record<string, string> = {
  "sony-xavc": "Sony XAVC",
  "sony-xdcam": "Sony XDCAM",
  "canon-xf": "Canon XF",
  "panasonic-p2": "Panasonic P2",
  avchd: "AVCHD",
  gopro: "GoPro",
};

function formatSize(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function TypeGlyph({ entry, size }: { entry: OpenReelBrowserEntry; size: number }) {
  if (entry.kind === "dir") return <Folder size={size} aria-hidden="true" />;
  if (entry.mediaType === "audio") return <Music2 size={size} aria-hidden="true" />;
  if (entry.mediaType === "image") return <ImageIcon size={size} aria-hidden="true" />;
  return <Film size={size} aria-hidden="true" />;
}

/** Thumbnail that scrubs through the clip while the pointer moves across it (desktop). */
function BrowserThumb({ entry, className }: { entry: OpenReelBrowserEntry; className: string }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [frames, setFrames] = useState<Array<string | null> | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setThumb(null);
    setFrames(null);
    void thumbnailFor(entry).then((url) => live && setThumb(url));
    return () => {
      live = false;
      window.clearTimeout(hoverTimer.current);
    };
  }, [entry]);
  const shown = scrub !== null && frames?.[scrub] ? frames[scrub] : thumb;
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-bg-0 text-fg-3 ${className}`}
      data-testid="media-browser-thumb"
      onMouseEnter={() => {
        if (entry.mediaType !== "video" || frames || !desktopBrowserBridge()) return;
        hoverTimer.current = window.setTimeout(() => void scrubFramesFor(entry).then((result) => result && setFrames(result.frames)), 150);
      }}
      onMouseMove={(event) => {
        if (!frames) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setScrub(Math.max(0, Math.min(frames.length - 1, Math.floor(((event.clientX - rect.left) / Math.max(1, rect.width)) * frames.length))));
      }}
      onMouseLeave={() => {
        window.clearTimeout(hoverTimer.current);
        setScrub(null);
      }}
    >
      {shown ? <img src={shown} alt="" draggable={false} className="h-full w-full object-cover" /> : <TypeGlyph entry={entry} size={20} />}
      {scrub !== null && frames && <span aria-hidden="true" className="absolute bottom-0 left-0 h-[2px] bg-accent" style={{ width: `${((scrub + 1) / frames.length) * 100}%` }} />}
    </div>
  );
}

/**
 * Media Browser: browse the disk (desktop: volumes and places; web: a picked folder) for footage,
 * see camera cards as clips, scrub and preview before importing, and import the selection.
 */
export function MediaBrowserPanel() {
  const backend = browserBackend();
  const store = useMediaBrowserStore();
  const { path, listing, loading, view, typeFilter, query, favourites, selected, importing, importMessage, rawFolders } = store;
  const [places, setPlaces] = useState<Array<{ name: string; path: string; kind: "volume" | "place" }>>([]);
  const [pathDraft, setPathDraft] = useState("");
  const [webRoots, setWebRoots] = useState<string[]>(webRootNames());
  const requestId = useRef(0);

  const load = useCallback(async (target: string, raw: boolean) => {
    const id = ++requestId.current;
    useMediaBrowserStore.getState().setLoading(true);
    try {
      const result = await listPath(target, raw);
      if (id !== requestId.current) return;
      useMediaBrowserStore.getState().setListing(result);
      if (result.error) toast.warning("Media Browser", result.error);
    } catch (error) {
      if (id === requestId.current) {
        useMediaBrowserStore.getState().setListing({ path: target, parent: null, entries: [], error: error instanceof Error ? error.message : "The folder could not be read." });
      }
    } finally {
      if (id === requestId.current) useMediaBrowserStore.getState().setLoading(false);
    }
  }, []);

  // Desktop: the places list, then the last folder (or Home).
  useEffect(() => {
    const desktop = desktopBrowserBridge();
    if (!desktop) return;
    let live = true;
    void desktop.places().then((list) => {
      if (!live) return;
      setPlaces(list);
      if (!useMediaBrowserStore.getState().path) {
        let last: string | null = null;
        try {
          last = (JSON.parse(localStorage.getItem("openreel-media-browser") ?? "{}") as { lastPath?: string }).lastPath ?? null;
        } catch {
          last = null;
        }
        useMediaBrowserStore.getState().setPath(last ?? list.find((p) => p.name === "Home")?.path ?? list[0]?.path ?? null);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (path) {
      setPathDraft(path);
      void load(path, rawFolders);
    }
  }, [path, rawFolders, load]);

  const entries = useMemo(() => visibleEntries(listing, typeFilter, query), [listing, typeFilter, query]);
  const orderedIds = useMemo(() => entries.map((e) => e.id), [entries]);
  const selectedEntries = useMemo(() => entries.filter((e) => selected.includes(e.id)), [entries, selected]);
  const importable = selectedEntries.filter((e) => e.kind !== "dir");
  const isFavourite = !!path && favourites.some((f) => f.path === path);

  const go = (target: string | null): void => {
    if (target) store.setPath(target);
  };

  const runImport = useCallback(async (list: OpenReelBrowserEntry[]) => {
    const state = useMediaBrowserStore.getState();
    if (state.importing || list.length === 0) return;
    state.setImporting(true, "Importing...");
    try {
      await importEntries(list, (message) => useMediaBrowserStore.getState().setImporting(true, message));
    } finally {
      useMediaBrowserStore.getState().setImporting(false);
    }
  }, []);

  const onActivate = (entry: OpenReelBrowserEntry): void => {
    if (entry.kind === "dir") go(entry.path);
    else void previewEntry(entry, () => void runImport([entry]));
  };

  const onClickEntry = (event: React.MouseEvent, entry: OpenReelBrowserEntry): void => {
    store.select(entry.id, event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace", orderedIds);
  };

  const chooseWebFolder = async (): Promise<void> => {
    const pick = webDirectoryPicker();
    if (!pick) return;
    try {
      const handle = await pick();
      const name = addWebRoot(handle);
      setWebRoots(webRootNames());
      go(name);
    } catch {
      /* the picker was dismissed */
    }
  };

  if (!backend) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-fg-3" data-testid="media-browser-unsupported">
        <FolderOpen size={22} aria-hidden="true" />
        <p>The Media Browser needs the desktop app, or a browser that can open folders (Chrome, Edge). Use Import to add files here.</p>
      </div>
    );
  }

  const renderEntry = (entry: OpenReelBrowserEntry) => {
    const isSelected = selected.includes(entry.id);
    const badge = entry.clip ? (KIND_LABELS[entry.clip.kind] ?? entry.clip.kind) : null;
    const spanNote = entry.clip?.spanned ? `${entry.clip.segments.length} files` : null;
    const common = {
      "data-testid": "media-browser-entry",
      "data-entry-name": entry.name,
      "data-entry-kind": entry.kind,
      "data-entry-clip": entry.clip?.kind ?? "",
      "data-entry-segments": entry.clip?.segments.length ?? 1,
      "aria-selected": isSelected,
      role: "option" as const,
      tabIndex: 0,
      onClick: (event: React.MouseEvent) => onClickEntry(event, entry),
      onDoubleClick: () => onActivate(entry),
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === "Enter") onActivate(entry);
        else if (event.key === " ") {
          event.preventDefault();
          store.select(entry.id, "replace", orderedIds);
        }
      },
    };
    if (view === "list") {
      return (
        <div key={entry.id} {...common} className={`flex cursor-default items-center gap-2 border-b border-bg-2 px-2 py-1 text-[11px] ${isSelected ? "bg-accent/15" : "hover:bg-bg-2"}`}>
          {entry.kind === "dir" ? <span className="flex h-9 w-14 shrink-0 items-center justify-center text-fg-3"><Folder size={18} aria-hidden="true" /></span> : <BrowserThumb entry={entry} className="h-9 w-14 shrink-0 rounded-[3px]" />}
          <span className="min-w-0 flex-1 truncate text-fg-2" title={entry.name}>{entry.name}</span>
          {badge && <span className="shrink-0 rounded bg-bg-2 px-1.5 py-0.5 text-[10px] text-fg-3">{badge}{spanNote ? `, ${spanNote}` : ""}</span>}
          <span className="w-14 shrink-0 text-right text-fg-3">{formatSize(entry.size)}</span>
        </div>
      );
    }
    return (
      <div key={entry.id} {...common} className={`flex min-w-0 cursor-default flex-col gap-1 rounded-md border p-1 text-[11px] ${isSelected ? "border-accent bg-accent/15" : "border-transparent hover:bg-bg-2"}`}>
        {entry.kind === "dir" ? (
          <div className="flex aspect-video items-center justify-center rounded-[3px] bg-bg-0 text-fg-3"><Folder size={28} aria-hidden="true" /></div>
        ) : (
          <BrowserThumb entry={entry} className="aspect-video rounded-[3px]" />
        )}
        <span className="truncate text-fg-2" title={entry.name}>{entry.name}</span>
        {(badge || entry.size > 0) && (
          <span className="flex items-center justify-between gap-1 text-[10px] text-fg-3">
            <span className="truncate">{badge ? `${badge}${spanNote ? `, ${spanNote}` : ""}` : ""}</span>
            <span className="shrink-0">{formatSize(entry.size)}</span>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-1" data-testid="media-browser" data-backend={backend}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border p-2">
        <Button type="button" variant="ghost" size="icon" aria-label="Up one folder" title="Up one folder" disabled={!listing?.parent} onClick={() => go(listing?.parent ?? null)}>
          <ArrowUp size={14} aria-hidden="true" />
        </Button>
        {backend === "desktop" ? (
          <select
            aria-label="Locations"
            data-testid="media-browser-locations"
            className={`${SELECT_CLASS} max-w-[130px]`}
            value=""
            onChange={(event) => go(event.target.value)}
          >
            <option value="" disabled>Locations</option>
            {favourites.length > 0 && (
              <optgroup label="Favourites">
                {favourites.map((f) => <option key={`f:${f.path}`} value={f.path}>{f.name}</option>)}
              </optgroup>
            )}
            {places.some((p) => p.kind === "volume") && (
              <optgroup label="Volumes">
                {places.filter((p) => p.kind === "volume").map((p) => <option key={`v:${p.path}`} value={p.path}>{p.name}</option>)}
              </optgroup>
            )}
            <optgroup label="Places">
              {places.filter((p) => p.kind === "place").map((p) => <option key={`p:${p.path}`} value={p.path}>{p.name}</option>)}
            </optgroup>
          </select>
        ) : (
          <>
            <Button type="button" variant="secondary" size="sm" data-testid="media-browser-open-folder" onClick={() => void chooseWebFolder()}>
              <HardDrive size={13} aria-hidden="true" /> Open folder
            </Button>
            {webRoots.length > 1 && (
              <select aria-label="Opened folders" className={SELECT_CLASS} value={path?.split("/")[0] ?? ""} onChange={(event) => go(event.target.value)}>
                {webRoots.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            )}
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
          aria-pressed={isFavourite}
          title={isFavourite ? "Remove from favourites" : "Add this folder to favourites"}
          data-testid="media-browser-favourite"
          disabled={!path}
          onClick={() => path && store.toggleFavourite({ name: path.split(/[\\/]/).filter(Boolean).pop() ?? path, path })}
        >
          <Star size={14} aria-hidden="true" className={isFavourite ? "fill-current text-accent" : ""} />
        </Button>
        <span className="ml-auto flex items-center gap-0.5">
          <Button type="button" variant="ghost" size="icon" aria-label="Icon view" aria-pressed={view === "icons"} data-testid="media-browser-view-icons" onClick={() => store.setView("icons")}><LayoutGrid size={14} aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="List view" aria-pressed={view === "list"} data-testid="media-browser-view-list" onClick={() => store.setView("list")}><List size={14} aria-hidden="true" /></Button>
        </span>
      </div>

      {backend === "desktop" && (
        <form
          className="flex gap-1.5 border-b border-border px-2 py-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            go(pathDraft.trim());
          }}
        >
          <Input aria-label="Folder path" data-testid="media-browser-path" value={pathDraft} onChange={(event) => setPathDraft(event.target.value)} className="h-7 flex-1 text-[11px]" spellCheck={false} />
        </form>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5">
        <Input aria-label="Search this folder" placeholder="Search" data-testid="media-browser-search" value={query} onChange={(event) => store.setQuery(event.target.value)} className="h-7 min-w-[90px] flex-1 text-[11px]" />
        <select aria-label="Filter by type" data-testid="media-browser-type" className={SELECT_CLASS} value={typeFilter} onChange={(event) => store.setTypeFilter(event.target.value as BrowserTypeFilter)}>
          <option value="all">All</option>
          <option value="video">Video</option>
          <option value="audio">Audio</option>
          <option value="image">Images</option>
        </select>
      </div>

      {(listing?.card || rawFolders) && (
        <div className="flex items-center gap-2 border-b border-border bg-bg-2 px-2 py-1 text-[11px] text-fg-2" data-testid="media-browser-card-banner" data-raw={rawFolders}>
          {listing?.card ? <span className="rounded bg-accent/20 px-1.5 py-0.5 font-medium text-accent">{listing.card.kinds.map((k) => k.label).join(" + ")} card</span> : <span className="text-fg-3">Folder view</span>}
          <span className="min-w-0 truncate text-fg-3">{rawFolders ? "Showing folders" : "Showing clips"}</span>
          <label className="ml-auto flex shrink-0 items-center gap-1 text-fg-3">
            <input type="checkbox" data-testid="media-browser-raw" checked={rawFolders} onChange={(event) => store.setRawFolders(event.target.checked)} /> Folders
          </label>
        </div>
      )}

      <div
        role="listbox"
        aria-multiselectable="true"
        aria-label="Media in this folder"
        data-testid="media-browser-list"
        data-view={view}
        className={`min-h-0 flex-1 overflow-auto ${view === "icons" ? "grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] content-start gap-1.5 p-2" : ""}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) store.clearSelection();
        }}
      >
        {!path && backend === "web" && <p className="col-span-full p-3 text-[12px] text-fg-3">Open a folder (a card, a drive or a project folder) to browse its footage.</p>}
        {loading && entries.length === 0 && <p className="col-span-full p-3 text-[12px] text-fg-3" role="status">Reading folder...</p>}
        {!loading && path && entries.length === 0 && <p className="col-span-full p-3 text-[12px] text-fg-3" data-testid="media-browser-empty">{listing?.error ?? "No media here."}</p>}
        {entries.map(renderEntry)}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border p-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-fg-3" data-testid="media-browser-status" role="status">
          {importing ? importMessage : selected.length ? `${selected.length} selected` : `${entries.filter((e) => e.kind !== "dir").length} items`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="media-browser-preview"
          disabled={selectedEntries.length !== 1 || selectedEntries[0].kind === "dir"}
          title="Preview the selected clip in the Source monitor"
          onClick={() => selectedEntries[0] && onActivate(selectedEntries[0])}
        >
          <Eye size={13} aria-hidden="true" /> Preview
        </Button>
        <Button type="button" variant="secondary" size="sm" data-testid="media-browser-import" disabled={importing || importable.length === 0} onClick={() => void runImport(importable)}>
          <Download size={13} aria-hidden="true" /> Import{importable.length > 1 ? ` ${importable.length}` : ""}
        </Button>
      </div>
    </div>
  );
}
