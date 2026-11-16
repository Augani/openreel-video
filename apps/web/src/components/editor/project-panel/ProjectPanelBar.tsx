import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@openreel/ui";
import { ChevronRight, Columns3, FolderPlus, FolderInput, FolderSearch, LayoutGrid, List, Search } from "@/icons/lucide-compat";
import {
  MEDIA_COLUMNS,
  binDeletionImpact,
  binsOf,
  savableSmartBinSearch,
  uniqueBinName,
  type MediaColumnId,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useProjectPanelStore } from "../../../stores/project-panel-store";
import { useUIStore } from "../../../stores/ui-store";
import {
  commitPendingBin,
  createBinHere,
  createSmartBin,
  deleteBinWithContents,
  deleteSmartBin,
  renameSmartBin,
  newBinFromSelection,
  renameMediaItem,
  runOrganize,
  setMediaText,
} from "../../../services/project-panel-commands";
import { useBinDropTarget } from "./BinViews";
import { InterpretFootageDialog } from "./InterpretFootageDialog";
import { RawSourceSettingsDialog } from "./RawSourceSettingsDialog";
import type { ProjectPanelData } from "./useProjectPanelData";

const iconButton = "h-[26px] w-[26px] shrink-0 border border-bg-3 bg-[#1c1d21] text-fg-3 hover:text-fg";

const Crumb: React.FC<{ label: string; binId: string | null; current: boolean }> = ({ label, binId, current }) => {
  const drop = useBinDropTarget(binId);
  return (
    <button
      type="button"
      data-testid="breadcrumb"
      data-bin-id={binId ?? "root"}
      aria-current={current ? "page" : undefined}
      onClick={() => useProjectPanelStore.getState().openBin(binId)}
      {...drop.handlers}
      className={`max-w-[120px] truncate rounded-[4px] px-1.5 py-0.5 text-[11.5px] ${
        drop.isOver ? "bg-accent-soft text-accent ring-1 ring-accent/60" : current ? "text-fg" : "text-fg-muted hover:bg-bg-2 hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
};

/** Breadcrumb + bin / view / column / search-scope controls above the media. */
/** Name field shown while a new bin is pending; Enter / blur creates it, Escape cancels. */
const PendingBinRow: React.FC<{ placeholder: string }> = ({ placeholder }) => {
  const pending = useProjectPanelStore((s) => s.pendingBin);
  const [value, setValue] = useState("");
  const done = React.useRef(false);
  useEffect(() => {
    done.current = false;
    setValue("");
  }, [pending]);
  if (!pending) return null;
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) void commitPendingBin(value.trim() || placeholder);
    else useProjectPanelStore.getState().setPendingBin(null);
  };
  return (
    <div className="flex items-center gap-2 px-[10px] pb-1.5 text-[11.5px] text-fg-muted" data-testid="pending-bin">
      <FolderPlus size={13} aria-hidden />
      <input
        autoFocus
        aria-label="New bin name"
        data-testid="bin-name-input"
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") finish(true);
          else if (event.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
        className="min-w-0 flex-1 rounded-[4px] border border-accent bg-bg-0 px-1.5 py-0.5 text-[11.5px] text-fg outline-none"
      />
      {pending.mediaIds.length > 0 && <span>{pending.mediaIds.length} selected</span>}
    </div>
  );
};

const SmartBinsMenu: React.FC<{ data: ProjectPanelData }> = ({ data }) => {
  const query = useProjectPanelStore((s) => s.query);
  const searchColumn = useProjectPanelStore((s) => s.searchColumn);
  const active = data.activeSmartBin;
  // Typed inside a smart bin, the view is the bin narrowed by the text: save exactly that.
  const savable = savableSmartBinSearch(active, query, searchColumn);
  const canSave = savable !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`${iconButton} ${active ? "text-accent" : ""}`}
          aria-label="Smart bins"
          title="Smart bins: saved searches that update live"
        >
          <FolderSearch size={14} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[320px] w-[260px] overflow-auto text-xs" data-testid="smart-bins-menu">
        <DropdownMenuLabel className="text-[11px]">Smart bins</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {data.smartBins.length === 0 && <div className="px-2 py-1.5 text-[11px] text-fg-muted">No smart bins yet. Search, then save it.</div>}
        {data.smartBins.map((bin) => (
          <DropdownMenuCheckboxItem
            key={bin.id}
            checked={active?.id === bin.id}
            data-testid="smart-bin-item"
            data-smart-bin-id={bin.id}
            onSelect={() => useProjectPanelStore.getState().openSmartBin(bin.id)}
          >
            <span className="min-w-0 flex-1 truncate">{bin.name}</span>
            <span className="ml-2 tabular-nums text-fg-muted" data-testid="smart-bin-count">{data.smartBinCounts.get(bin.id) ?? 0}</span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="save-smart-bin"
          disabled={!canSave}
          onSelect={() => {
            if (!savable) return;
            void createSmartBin({ name: query.trim().slice(0, 40), query: savable.query, column: savable.column }).then(({ outcome, smartBinId }) => {
              if (outcome.success && smartBinId) useProjectPanelStore.getState().openSmartBin(smartBinId);
            });
          }}
        >
          Save current search as smart bin
        </DropdownMenuItem>
        {active && query.trim() && !savable && (
          <div className="px-2 pb-1.5 text-[11px] text-fg-muted">Search in the same column as "{active.name}" to save it.</div>
        )}
        {active && (
          <>
            <DropdownMenuItem onSelect={() => useProjectPanelStore.getState().openDialog({ kind: "rename-smart-bin", smartBinId: active.id })}>
              Rename "{active.name}"…
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="delete-smart-bin" onSelect={() => void runOrganize("Delete smart bin", deleteSmartBin(active.id))}>
              Delete "{active.name}"
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const ProjectPanelBar: React.FC<{ data: ProjectPanelData; selectionCount: number }> = ({ data, selectionCount }) => {
  const view = useProjectPanelStore((s) => s.view);
  const setView = useProjectPanelStore((s) => s.setView);
  const columns = useProjectPanelStore((s) => s.columns);
  const toggleColumn = useProjectPanelStore((s) => s.toggleColumn);
  const searchColumn = useProjectPanelStore((s) => s.searchColumn);
  const setSearchColumn = useProjectPanelStore((s) => s.setSearchColumn);
  const query = useProjectPanelStore((s) => s.query);
  const searchLabel = searchColumn === "all" ? "All columns" : (MEDIA_COLUMNS.find((c) => c.id === searchColumn)?.title ?? "All columns");

  return (
    <>
    <div className="flex items-center gap-1 px-[10px] pb-1.5" data-testid="project-panel-bar">
      <nav aria-label="Bin path" className="flex min-w-0 flex-1 items-center overflow-hidden">
        {data.activeSmartBin ? (
          <span className="flex min-w-0 items-center gap-1.5 px-1.5 text-[11.5px] text-fg" data-testid="smart-bin-crumb">
            <FolderSearch size={12} className="shrink-0 text-accent" aria-hidden />
            <span className="truncate" title={`${data.activeSmartBin.name}: ${data.activeSmartBin.query}`}>{data.activeSmartBin.name}</span>
            <span className="shrink-0 tabular-nums text-fg-muted" data-testid="smart-bin-crumb-count">{data.items.length}</span>
            <button
              type="button"
              aria-label="Back to the project"
              title="Back to the project"
              data-testid="smart-bin-exit"
              onClick={() => useProjectPanelStore.getState().openSmartBin(null)}
              className="shrink-0 rounded-[4px] px-1 text-fg-muted hover:bg-bg-2 hover:text-fg"
            >
              ×
            </button>
          </span>
        ) : data.searching ? (
          <span className="truncate px-1.5 text-[11.5px] text-fg-muted" data-testid="search-scope">
            {data.items.length} result{data.items.length === 1 ? "" : "s"} for "{query.trim()}" in {searchLabel}
          </span>
        ) : (
          <>
            <Crumb label="Project" binId={null} current={data.path.length === 0} />
            {data.path.map((bin, index) => (
              <React.Fragment key={bin.id}>
                <ChevronRight size={11} className="shrink-0 text-fg-muted" aria-hidden />
                <Crumb label={bin.name} binId={bin.id} current={index === data.path.length - 1} />
              </React.Fragment>
            ))}
          </>
        )}
      </nav>
      <Button type="button" variant="ghost" size="icon" className={iconButton} aria-label="New bin" title="New bin" onClick={() => void createBinHere()}>
        <FolderPlus size={14} aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={iconButton}
        aria-label="New bin from selection"
        title="New bin from selection"
        disabled={selectionCount === 0}
        onClick={() => void newBinFromSelection()}
      >
        <FolderInput size={14} aria-hidden />
      </Button>
      <SmartBinsMenu data={data} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className={iconButton} aria-label="Search in column" title={`Search in: ${searchLabel}`}>
            <Search size={14} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[320px] w-[170px] overflow-auto text-xs">
          <DropdownMenuLabel className="text-[11px]">Search in</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {([{ id: "all", title: "All columns" }, ...MEDIA_COLUMNS] as Array<{ id: MediaColumnId | "all"; title: string }>).map((c) => (
            <DropdownMenuCheckboxItem
              key={c.id}
              checked={searchColumn === c.id}
              data-testid={`search-in-${c.id}`}
              onSelect={() => setSearchColumn(c.id)}
            >
              {c.title}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {view === "list" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className={iconButton} aria-label="Columns" title="Show or hide columns">
              <Columns3 size={14} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[360px] w-[170px] overflow-auto text-xs">
            <DropdownMenuLabel className="text-[11px]">Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {MEDIA_COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={columns.includes(c.id)}
                disabled={c.id === "name"}
                data-testid={`column-toggle-${c.id}`}
                onSelect={(event) => {
                  event.preventDefault();
                  toggleColumn(c.id);
                }}
              >
                {c.title}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div role="group" aria-label="View" className="flex shrink-0 overflow-hidden rounded-[6px] border border-bg-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Grid view"
          aria-pressed={view === "grid"}
          title="Grid view"
          className={`h-[24px] w-[26px] rounded-none ${view === "grid" ? "bg-[#26282d] text-fg" : "bg-[#1c1d21] text-fg-3"}`}
          onClick={() => setView("grid")}
        >
          <LayoutGrid size={14} aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="List view"
          aria-pressed={view === "list"}
          title="List view"
          className={`h-[24px] w-[26px] rounded-none ${view === "list" ? "bg-[#26282d] text-fg" : "bg-[#1c1d21] text-fg-3"}`}
          onClick={() => setView("list")}
        >
          <List size={14} aria-hidden />
        </Button>
      </div>
    </div>
    <PendingBinRow placeholder={uniqueBinName(data.bins, data.currentBinId ?? undefined)} />
    </>
  );
};

/** Rename / comment / description prompts and the delete-bin confirmation. */
export const ProjectPanelDialogs: React.FC = () => {
  const dialog = useProjectPanelStore((s) => s.dialog);
  const close = () => useProjectPanelStore.getState().openDialog(null);
  const project = useProjectStore((s) => s.project);
  const bins = useMemo(() => binsOf(project), [project]);
  const [text, setText] = useState("");
  const media = dialog && "mediaId" in dialog ? project.mediaLibrary.items.find((i) => i.id === dialog.mediaId) : undefined;

  useEffect(() => {
    if (dialog?.kind === "rename-smart-bin") {
      setText(project.smartBins?.find((b) => b.id === dialog.smartBinId)?.name ?? "");
      return;
    }
    if (!dialog || !media) return;
    setText(dialog.kind === "rename-media" ? media.name : dialog.kind === "delete-bin" || dialog.kind === "interpret-footage" || dialog.kind === "raw-settings" ? "" : (media[dialog.kind] ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog?.kind, media?.id]);

  if (dialog?.kind === "rename-smart-bin") {
    const bin = project.smartBins?.find((b) => b.id === dialog.smartBinId);
    if (!bin) return null;
    const submit = () => {
      const id = bin.id;
      close();
      void runOrganize("Rename smart bin", renameSmartBin(id, text));
    };
    return (
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-[400px] border-border bg-bg-1 text-fg">
          <DialogHeader>
            <DialogTitle>Rename smart bin</DialogTitle>
            <DialogDescription className="truncate">{bin.query}</DialogDescription>
          </DialogHeader>
          <Input autoFocus aria-label="Smart bin name" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />
          <DialogFooter>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={submit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (dialog?.kind === "delete-bin") {
    const bin = bins.find((b) => b.id === dialog.binId);
    const impact = bin ? binDeletionImpact(project, bin.id) : null;
    return (
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-[420px] border-border bg-bg-1 text-fg" data-testid="delete-bin-dialog">
          <DialogHeader>
            <DialogTitle>Delete bin "{bin?.name}"?</DialogTitle>
            <DialogDescription>
              {impact && impact.mediaIds.length + impact.binIds.length > 1
                ? `This also deletes ${impact.binIds.length - 1} nested bin${impact.binIds.length - 1 === 1 ? "" : "s"} and ${impact.mediaIds.length} media item${impact.mediaIds.length === 1 ? "" : "s"}${impact.clipCount ? `, including ${impact.clipCount} clip${impact.clipCount === 1 ? "" : "s"} used on the timeline` : ""}. You can undo this.`
                : impact && impact.mediaIds.length
                  ? `This also deletes ${impact.mediaIds.length} media item${impact.mediaIds.length === 1 ? "" : "s"}${impact.clipCount ? `, including ${impact.clipCount} clip${impact.clipCount === 1 ? "" : "s"} used on the timeline` : ""}. You can undo this.`
                  : "The bin is empty."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button
              data-testid="confirm-delete-bin"
              variant="destructive"
              onClick={() => {
                const id = dialog.binId;
                close();
                void runOrganize("Delete bin", deleteBinWithContents(id));
              }}
            >
              Delete bin{impact && impact.mediaIds.length ? " and contents" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (dialog?.kind === "raw-settings") {
    return media ? <RawSourceSettingsDialog key={media.id} media={media} onClose={close} /> : null;
  }

  if (dialog?.kind === "interpret-footage") {
    return media ? <InterpretFootageDialog key={media.id} media={media} onClose={close} /> : null;
  }

  if (dialog && media) {
    const title = dialog.kind === "rename-media" ? "Rename media" : dialog.kind.charAt(0).toUpperCase() + dialog.kind.slice(1);
    const submit = () => {
      const id = media.id;
      const kind = dialog.kind;
      close();
      void runOrganize(
        title,
        kind === "rename-media" ? renameMediaItem(id, text) : setMediaText(id, kind, text),
      );
    };
    return (
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-[400px] border-border bg-bg-1 text-fg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="truncate">{media.name}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={title}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
          />
          <DialogFooter>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={submit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  return null;
};

/** Selection count helper for the bar. */
export const useMediaSelectionCount = (): number => {
  const items = useProjectStore((s) => s.project.mediaLibrary.items);
  const ids = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  // A count, not the selection array: selecting a timeline clip leaves it unchanged, so the
  // bar and the panel that owns this hook stay out of that render.
  return useUIStore((s) => {
    let count = 0;
    for (const item of s.selectedItems) if (ids.has(item.id)) count++;
    return count;
  });
};
