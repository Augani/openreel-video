import React, { useCallback, useState } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@openreel/ui";
import {
  getMixerSnapshots,
  planDeleteSnapshot,
  planRecallSnapshot,
  planRenameSnapshot,
  planSaveSnapshot,
  type SnapshotPlan,
} from "@openreel/core/audio/mixer-snapshots";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";

async function commit(plan: SnapshotPlan): Promise<boolean> {
  const result = await useProjectStore.getState().applyMixerSnapshot(plan);
  if (!result.success) {
    toast.error(result.error?.message ?? (plan.ok ? "Could not change the snapshot." : plan.message));
    return false;
  }
  return true;
}

/** Save / recall / rename / delete of Audio Track Mixer snapshots. Loaded on demand from the mixer header. */
export default function MixerSnapshots(): React.ReactElement {
  const timeline = useProjectStore((state) => state.project.timeline);
  const snapshots = getMixerSnapshots(timeline);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const save = useCallback(async () => {
    const tl = useProjectStore.getState().project.timeline;
    const label = name.trim() || `Mix ${getMixerSnapshots(tl).length + 1}`;
    if (await commit(planSaveSnapshot(tl, label))) setName("");
  }, [name]);
  const recall = useCallback(async (id: string) => {
    if (await commit(planRecallSnapshot(useProjectStore.getState().project.timeline, id))) setOpen(false);
  }, []);
  const rename = useCallback((id: string, current: string) => {
    const next = window.prompt("Snapshot name", current);
    if (next) void commit(planRenameSnapshot(useProjectStore.getState().project.timeline, id, next));
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" data-testid="mixer-snapshots-open">
          Snapshots{snapshots.length > 0 ? ` (${snapshots.length})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end" data-testid="mixer-snapshots-panel">
        <div className="mb-2 flex gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            placeholder="Snapshot name"
            aria-label="Snapshot name"
            className="h-7 min-w-0 flex-1 rounded border border-border bg-bg-0 px-2 text-xs text-fg"
            data-testid="mixer-snapshot-name"
          />
          <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={() => void save()} data-testid="mixer-snapshot-save">
            Save
          </Button>
        </div>
        {snapshots.length === 0 ? (
          <p className="px-1 py-2 text-xs text-fg-muted">
            Saves every fader, pan, mute, solo and effect rack. Recall it later in one undoable step.
          </p>
        ) : (
          <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto" data-testid="mixer-snapshot-list">
            {snapshots.map((snap) => (
              <li key={snap.id} className="flex items-center gap-1" data-testid={`mixer-snapshot-${snap.id}`}>
                <Button type="button" variant="ghost" size="sm" className="h-7 min-w-0 flex-1 justify-start truncate px-2 text-xs" onClick={() => void recall(snap.id)} data-testid="mixer-snapshot-recall" title={`Recall ${snap.name}`}>
                  {snap.name}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5 text-xs" onClick={() => rename(snap.id, snap.name)} aria-label={`Rename ${snap.name}`}>
                  Rename
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5 text-xs" onClick={() => void commit(planDeleteSnapshot(useProjectStore.getState().project.timeline, snap.id))} aria-label={`Delete ${snap.name}`}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
