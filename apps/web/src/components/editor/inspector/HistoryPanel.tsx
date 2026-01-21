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
} from "lucide-react";
import { Input, ScrollArea } from "@openreel/ui";
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
          <History size={14} className="text-primary" />
          <span className="text-sm font-medium text-text-primary">History</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleUndo}
            disabled={!canUndo()}
            className="p-1.5 rounded hover:bg-background-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={`Undo (${undoCount})`}
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo()}
            className="p-1.5 rounded hover:bg-background-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={`Redo (${redoCount})`}
          >
            <Redo2 size={14} />
          </button>
        </div>
      </div>

      <div className="border-b border-border">
        <button
          onClick={() => setShowSnapshots(!showSnapshots)}
          className="w-full flex items-center gap-2 p-2 hover:bg-background-tertiary transition-colors"
        >
          {showSnapshots ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
          <Bookmark size={12} className="text-yellow-500" />
          <span className="text-xs text-text-secondary">
            Snapshots ({snapshots.length})
          </span>
        </button>

        {showSnapshots && (
          <div className="px-2 pb-2">
            {snapshots.length === 0 && !isCreatingSnapshot && (
              <p className="text-[10px] text-text-muted py-2 text-center">
                No snapshots saved
              </p>
            )}

            {snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="flex items-center justify-between p-2 rounded hover:bg-background-tertiary group"
              >
                <div className="flex items-center gap-2">
                  <Bookmark size={10} className="text-yellow-500" />
                  <div>
                    <p className="text-xs text-text-primary">{snapshot.name}</p>
                    <p className="text-[10px] text-text-muted">
                      {formatTime(snapshot.timestamp)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteSnapshot(snapshot.id)}
                  className="p-1 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}

            {isCreatingSnapshot ? (
              <div className="flex items-center gap-2 p-2">
                <Input
                  type="text"
                  value={newSnapshotName}
                  onChange={(e) => setNewSnapshotName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateSnapshot();
                    if (e.key === "Escape") setIsCreatingSnapshot(false);
                  }}
                  placeholder="Snapshot name..."
                  className="flex-1 h-7 text-xs bg-background-tertiary border-border text-text-primary"
                  autoFocus
                />
                <button
                  onClick={handleCreateSnapshot}
                  className="px-2 py-1 bg-primary text-white rounded text-xs hover:bg-primary/80 transition-colors"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreatingSnapshot(true)}
                className="w-full flex items-center justify-center gap-1 p-2 rounded border border-dashed border-border hover:border-primary hover:text-primary transition-colors"
              >
                <BookmarkPlus size={12} />
                <span className="text-[10px]">Create Snapshot</span>
              </button>
            )}
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        {combinedHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <History size={24} className="mb-2 opacity-30" />
            <p className="text-xs">No actions yet</p>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {combinedHistory.map((item) => {
              const ClipIcon = item.isClipEntry ? getClipIcon(item.clipType) : null;
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 p-2 rounded transition-colors ${
                    item.isCurrent
                      ? "bg-primary/20 border border-primary/30"
                      : "hover:bg-background-tertiary"
                  }`}
                >
                  {item.isClipEntry && ClipIcon ? (
                    <ClipIcon size={12} className={item.isCurrent ? "text-primary" : "text-text-muted"} />
                  ) : (
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${
                        item.isCurrent ? "bg-primary" : "bg-text-muted"
                      }`}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-xs truncate ${
                        item.isCurrent
                          ? "text-text-primary"
                          : "text-text-secondary"
                      }`}
                    >
                      {item.description}
                    </p>
                    <p className="text-[10px] text-text-muted">
                      {formatTime(item.timestamp)}
                    </p>
                  </div>
                  {item.groupId && (
                    <span className="px-1 py-0.5 bg-background-tertiary rounded text-[8px] text-text-muted">
                      grouped
                    </span>
                  )}
                  {item.isClipEntry && (
                    <span className="px-1 py-0.5 bg-amber-500/20 rounded text-[8px] text-amber-400">
                      clip
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="p-2 border-t border-border bg-background-tertiary">
        <div className="flex items-center justify-between text-[10px] text-text-muted">
          <span>{undoCount} actions</span>
          <span>{redoCount} redoable</span>
        </div>
      </div>
    </div>
  );
};

export default HistoryPanel;
