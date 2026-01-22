import { useState } from 'react';
import {
  History,
  Undo2,
  Redo2,
  Trash2,
  Clock,
  Camera,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Edit2,
  Check,
  X,
} from 'lucide-react';
import { useHistoryStore } from '../../../stores/history-store';
import { useProjectStore } from '../../../stores/project-store';
import { formatDistanceToNow } from '../../../utils/time';

export function HistoryPanel() {
  const {
    entries,
    currentIndex,
    snapshots,
    clear,
    canUndo,
    canRedo,
    goToEntry,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    renameSnapshot,
  } = useHistoryStore();
  const { project, loadProject } = useProjectStore();
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  const [showSnapshots, setShowSnapshots] = useState(true);
  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleUndo = () => {
    const state = undo();
    if (state) {
      loadProject(state);
    }
  };

  const handleRedo = () => {
    const state = redo();
    if (state) {
      loadProject(state);
    }
  };

  const handleJumpToState = (index: number) => {
    if (index === currentIndex) return;
    const state = goToEntry(index);
    if (state) {
      loadProject(state);
    }
  };

  const handleCreateSnapshot = () => {
    if (!project) return;
    const name = `Snapshot ${snapshots.length + 1}`;
    createSnapshot(name, project);
  };

  const handleRestoreSnapshot = (id: string) => {
    const state = restoreSnapshot(id);
    if (state) {
      loadProject(state);
    }
  };

  const handleStartRename = (id: string, currentName: string) => {
    setEditingSnapshotId(id);
    setEditingName(currentName);
  };

  const handleSaveRename = () => {
    if (editingSnapshotId && editingName.trim()) {
      renameSnapshot(editingSnapshotId, editingName.trim());
    }
    setEditingSnapshotId(null);
    setEditingName('');
  };

  const handleCancelRename = () => {
    setEditingSnapshotId(null);
    setEditingName('');
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <History size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">History</h3>
          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
            {entries.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleUndo}
            disabled={!canUndo()}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo()}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 size={14} />
          </button>
          <button
            onClick={clear}
            disabled={entries.length === 0}
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
            title="Clear history"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-border">
          <button
            onClick={() => setShowSnapshots(!showSnapshots)}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors"
          >
            {showSnapshots ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Bookmark size={12} className="text-muted-foreground" />
            <span className="text-[11px] font-medium">Snapshots</span>
            <span className="text-[10px] text-muted-foreground ml-auto">{snapshots.length}</span>
          </button>

          {showSnapshots && (
            <div className="px-2 pb-2">
              <button
                onClick={handleCreateSnapshot}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 mb-2 text-[10px] rounded bg-secondary hover:bg-secondary/80 transition-colors"
              >
                <Camera size={10} />
                New Snapshot
              </button>

              {snapshots.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-2">
                  No snapshots yet
                </p>
              ) : (
                <div className="space-y-1">
                  {snapshots.map((snapshot) => (
                    <div
                      key={snapshot.id}
                      className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 transition-colors"
                    >
                      {editingSnapshotId === snapshot.id ? (
                        <div className="flex-1 flex items-center gap-1">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename();
                              if (e.key === 'Escape') handleCancelRename();
                            }}
                            className="flex-1 px-1 py-0.5 text-[10px] bg-background border border-border rounded"
                            autoFocus
                          />
                          <button
                            onClick={handleSaveRename}
                            className="p-0.5 text-green-500 hover:text-green-400"
                          >
                            <Check size={10} />
                          </button>
                          <button
                            onClick={handleCancelRename}
                            className="p-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => handleRestoreSnapshot(snapshot.id)}
                            className="flex-1 text-left"
                          >
                            <p className="text-[10px] font-medium truncate">{snapshot.name}</p>
                            <p className="text-[9px] text-muted-foreground">
                              {formatDistanceToNow(snapshot.timestamp)}
                            </p>
                          </button>
                          <div className="hidden group-hover:flex items-center gap-0.5">
                            <button
                              onClick={() => handleStartRename(snapshot.id, snapshot.name)}
                              className="p-0.5 text-muted-foreground hover:text-foreground"
                            >
                              <Edit2 size={10} />
                            </button>
                            <button
                              onClick={() => deleteSnapshot(snapshot.id)}
                              className="p-0.5 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Clock size={32} className="text-muted-foreground/50 mb-3" />
            <p className="text-xs text-muted-foreground">No history yet</p>
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              Your actions will appear here
            </p>
          </div>
        ) : (
          <div className="py-1">
            {[...entries].reverse().map((entry, reverseIndex) => {
              const index = entries.length - 1 - reverseIndex;
              const isCurrent = index === currentIndex;
              const isFuture = index > currentIndex;

              return (
                <button
                  key={entry.id}
                  onClick={() => handleJumpToState(index)}
                  className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                    isCurrent
                      ? 'bg-primary/10 border-l-2 border-primary'
                      : isFuture
                      ? 'opacity-50 hover:opacity-75 hover:bg-accent/50'
                      : 'hover:bg-accent'
                  }`}
                >
                  <div
                    className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                      isCurrent
                        ? 'bg-primary'
                        : isFuture
                        ? 'bg-muted-foreground/30'
                        : 'bg-muted-foreground/50'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-xs truncate ${
                        isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {entry.description}
                    </p>
                    <p className="text-[9px] text-muted-foreground/70">
                      {formatDistanceToNow(entry.timestamp)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
