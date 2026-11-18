import { Input as ShadcnInput, Button, cn, Card } from "@openreel/ui";
import React, { useState, useEffect, useCallback } from "react";
import {
  History,
  Undo2,
  Redo2,
  Bookmark,
  BookmarkPlus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Type,
  Shapes,
  FileCode,
  Smile,
} from "@/icons/lucide-compat";






import { useProjectStore } from "../../../stores/project-store";
import type { HistorySnapshot } from "@openreel/core";

interface DisplayEntry {
  id: string;
  description: string;
  timestamp: number;
  isCurrent: boolean;
  isClipEntry: boolean;
  clipType?: "shape" | "text" | "svg" | "sticker";
  groupId?: string;
}

export const HistoryPanel: React.FC = () => {
  const { actionHistory, undo, redo, canUndo, canRedo, clipUndoStack, clipRedoStack } = useProjectStore();
  const [combinedHistory, setCombinedHistory] = useState<DisplayEntry[]>([]);
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [newSnapshotName, setNewSnapshotName] = useState("");
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);

  const getClipDescription = (type: "shape" | "text" | "svg" | "sticker"): string => {
    switch (type) {
      case "text": return "Create text clip";
      case "shape": return "Create shape";
      case "svg": return "Import SVG";
      case "sticker": return "Add sticker";
      default: return "Create clip";
    }
  };

  useEffect(() => {
    const updateHistory = () => {
      const actionEntries = actionHistory.getDisplayHistory();
      setSnapshots(actionHistory.getSnapshots());

      const displayEntries: DisplayEntry[] = actionEntries.map((item, idx) => ({
        id: `action-${item.entry.action.id}-${idx}`,
        description: item.entry.description,
        timestamp: item.entry.timestamp,
        isCurrent: item.isCurrent,
        isClipEntry: false,
        groupId: item.entry.groupId,
      }));

      clipUndoStack.forEach((entry, idx) => {
        displayEntries.push({
          id: `clip-${entry.clipId}-${idx}`,
          description: getClipDescription(entry.type),
          timestamp: Date.now() - (clipUndoStack.length - idx) * 1000,
          isCurrent: idx === clipUndoStack.length - 1 && clipRedoStack.length === 0,
          isClipEntry: true,
          clipType: entry.type,
        });
      });

      displayEntries.sort((a, b) => a.timestamp - b.timestamp);
      setCombinedHistory(displayEntries);
    };

    updateHistory();
    const unsubscribe = actionHistory.subscribe(updateHistory);
    return () => unsubscribe();
  }, [actionHistory, clipUndoStack, clipRedoStack]);

  const handleUndo = useCallback(async () => {
    if (canUndo()) {
      await undo();
    }
  }, [undo, canUndo]);

  const handleRedo = useCallback(async () => {
    if (canRedo()) {
      await redo();
    }
  }, [redo, canRedo]);

  const handleCreateSnapshot = useCallback(() => {
    if (newSnapshotName.trim()) {
      actionHistory.createSnapshot(newSnapshotName.trim());
      setNewSnapshotName("");
      setIsCreatingSnapshot(false);
    }
  }, [actionHistory, newSnapshotName]);

  const handleDeleteSnapshot = useCallback(
    (id: string) => {
      actionHistory.deleteSnapshot(id);
    },
    [actionHistory],
  );

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const undoCount = actionHistory.getUndoStackSize() + clipUndoStack.length;
  const redoCount = actionHistory.getRedoStackSize() + clipRedoStack.length;

  const getClipIcon = (type?: "shape" | "text" | "svg" | "sticker") => {
    switch (type) {
      case "text": return Type;
      case "shape": return Shapes;
      case "svg": return FileCode;
      case "sticker": return Smile;
      default: return History;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <History size={14} className="text-primary" aria-hidden />
          <span className="text-fg font-bold text-sm">
            History
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={handleUndo} type="button" aria-label={`Undo (${undoCount})`} title={`Undo (${undoCount})`} disabled={(!canUndo())} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {<Undo2 size={14} aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleRedo} type="button" aria-label={`Redo (${redoCount})`} title={`Redo (${redoCount})`} disabled={(!canRedo())} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {<Redo2 size={14} aria-hidden />}
          </Button>
        </div>
      </div>

      <div className="border-b border-border">
        <Button variant="ghost" onClick={() => setShowSnapshots(!showSnapshots)} type="button" aria-label={`${showSnapshots ? "Hide" : "Show"} snapshots`} className="group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 border-transparent bg-transparent hover:bg-bg-2 p-2 w-full">
          <div className="flex items-center gap-2">
            {showSnapshots ? (
              <ChevronDown size={12} aria-hidden />
            ) : (
              <ChevronRight size={12} aria-hidden />
            )}
            <Bookmark size={12} className="text-yellow-500" aria-hidden />
            <span className="text-fg-2 font-normal text-xs">
              Snapshots ({snapshots.length})
            </span>
          </div>
        </Button>

        {showSnapshots && (
          <div className="px-2 pb-2">
            {snapshots.length === 0 && !isCreatingSnapshot && (
              <span className="text-fg-2 font-normal block text-[10px] py-2 text-center">
                No snapshots saved
              </span>
            )}

            {snapshots.map((snapshot) => (
              <Card key={snapshot.id} className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-transparent text-fg p-2 group flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <Bookmark size={10} className="text-yellow-500" aria-hidden />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-fg font-normal block text-xs">
                      {snapshot.name}
                    </span>
                    <span className="text-fg-2 font-normal block text-[10px]">
                      {formatTime(snapshot.timestamp)}
                    </span>
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => handleDeleteSnapshot(snapshot.id)} type="button" aria-label={`Delete snapshot ${snapshot.name}`} title={`Delete snapshot ${snapshot.name}`} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent hover:bg-bg-2 text-fg-3 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                  {<Trash2 size={10} aria-hidden />}
                </Button>
              </Card>
            ))}

            {isCreatingSnapshot ? (
              <div className="flex items-center gap-2 p-2">
                <ShadcnInput
                  value={newSnapshotName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateSnapshot();
                    if (e.key === "Escape") setIsCreatingSnapshot(false);
                  }}
                  placeholder="Snapshot name..."
                  aria-label={"Snapshot name"}
                  onChange={(event) => setNewSnapshotName(event.currentTarget.value)}
                  autoFocus={true}
                  style={{ width: "100%" }}
                  className={cn(
                    "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]",
                    "h-7 text-[12px] md:text-[12px]",
                  )}
                />
                <Button onClick={handleCreateSnapshot} type="button" aria-label="Save" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90">
                  <span className="truncate">{"Save"}</span>
                </Button>
              </div>
            ) : (
              <Button onClick={() => setIsCreatingSnapshot(true)} type="button" aria-label="Create Snapshot" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full border border-dashed border-border">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<BookmarkPlus size={12} aria-hidden />}</span>
                <span className="truncate">{"Create Snapshot"}</span>
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {combinedHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-fg-3">
            <History size={24} className="mb-2 opacity-30" aria-hidden />
            <span className="text-fg-2 font-normal text-xs">
              No actions yet
            </span>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {combinedHistory.map((item) => {
              const ClipIcon = item.isClipEntry ? getClipIcon(item.clipType) : null;
              return (
                <Card key={item.id} className={cn("min-w-0 rounded-[7px] border shadow-none", (item.isCurrent ? "border-status-success/25 bg-status-success/10 text-fg" : "border-transparent bg-transparent text-fg"), "p-2", `flex items-center gap-2 p-2 rounded transition-colors ${
                    item.isCurrent
                      ? "bg-primary/20 border border-primary/30"
                      : "hover:bg-bg-2"
                  }`)}
                >
                  {item.isClipEntry && ClipIcon ? (
                    <ClipIcon
                      size={12}
                      className={item.isCurrent ? "text-primary" : "text-fg-3"}
                      aria-hidden
                    />
                  ) : (
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${
                        item.isCurrent ? "bg-primary" : "bg-text-muted"
                      }`}
                    />
                  )}
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className={cn("text-[12px] leading-5", (item.isCurrent ? "text-fg" : "text-fg-2"), "font-normal", "block", `text-xs truncate ${
                        item.isCurrent
                          ? "text-fg"
                          : "text-fg-2"
                      }`)}
                    >
                      {item.description}
                    </span>
                    <span className="text-fg-2 font-normal block text-[10px]">
                      {formatTime(item.timestamp)}
                    </span>
                  </div>
                  {item.groupId && (
                    <span className="text-fg-2 font-normal px-1 py-0.5 bg-bg-2 rounded text-[8px]">
                      grouped
                    </span>
                  )}
                  {item.isClipEntry && (
                    <span className="font-normal px-1 py-0.5 bg-amber-500/20 rounded text-[8px] text-amber-400">
                      clip
                    </span>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-2 border-t border-border bg-bg-2">
        <div className="flex items-center justify-between text-[10px] text-fg-3">
          <span className="text-fg-2 font-normal text-[10px]">
            {undoCount} actions
          </span>
          <span className="text-fg-2 font-normal text-[10px]">
            {redoCount} redoable
          </span>
        </div>
      </div>
    </div>
  );
};

