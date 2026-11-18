import React, { useMemo, useState } from "react";
import { planStems, STEM_MODE_LABELS, type StemMode } from "@openreel/core";
import { Layers } from "@/icons/lucide-compat";
import { Button } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { addDialogStemsToQueue } from "../../stores/export-queue-store";

const MODES: readonly StemMode[] = ["track", "audioType", "bus"];

const EMPTY_HINT: Record<StemMode, string> = {
  track: "No unmuted track carries audio yet.",
  audioType: "No clip carries audio yet. Tag clips Dialogue, Music, SFX or Ambience in Essential Sound, or give tracks a role.",
  bus: "No bus carries audio yet. Add a bus (the Dialogue / Music / FX preset in the Audio Mixer) and route tracks into it.",
};

const SOURCE_BLURB: Record<StemMode, string> = {
  track: "One WAV per track: its clips, effects, fader and rack, before buses and the master.",
  audioType: "One WAV per Essential Sound type, through each clip's own track and bus, before the master.",
  bus: "One WAV per bus: everything routed or sent into it, before the master.",
};

/**
 * Audio stems from the Export dialog: pick what to split by (track, Essential
 * Sound type or bus), tick the stems, and queue one zip of equal-length WAVs
 * rendered through the same offline mixdown as the master export.
 */
export const ExportStemsSection: React.FC<{ onQueued?: () => void }> = ({ onQueued }) => {
  const project = useProjectStore((state) => state.project);
  const [mode, setMode] = useState<StemMode>("track");
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [bitDepth, setBitDepth] = useState<16 | 24>(24);
  const plan = useMemo(() => planStems(project, { mode }), [project, mode]);
  const chosen = plan.filter((item) => !excluded.has(item.busId));
  return (
    <section className="rounded-[10px] border border-border bg-bg-1 p-4" data-testid="export-stems">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Layers size={14} aria-hidden />
        </span>
        <div className="min-w-0">
          <h4 className="text-[12px] font-semibold text-fg">Audio stems</h4>
          <p className="text-[10px] text-fg-muted">{SOURCE_BLURB[mode]}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1" role="group" aria-label="Split stems by">
        {MODES.map((entry) => (
          <Button
            key={entry}
            type="button"
            size="sm"
            variant={mode === entry ? "secondary" : "ghost"}
            className="h-6 px-2 text-[11px]"
            aria-pressed={mode === entry}
            data-testid={`export-stems-mode-${entry}`}
            onClick={() => {
              setMode(entry);
              setExcluded(new Set());
            }}
          >
            {STEM_MODE_LABELS[entry]}
          </Button>
        ))}
      </div>
      {plan.length === 0 ? (
        <p className="mt-3 text-[11px] text-fg-muted" data-testid="export-stems-empty">
          {EMPTY_HINT[mode]}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1" aria-label="Stems to export" data-testid="export-stems-list">
          {plan.map((item) => (
            <li key={item.busId}>
              <label className="flex items-center gap-2 text-[11px] text-fg-2">
                <input
                  type="checkbox"
                  checked={!excluded.has(item.busId)}
                  data-testid={`export-stems-item-${item.busId}`}
                  onChange={(event) =>
                    setExcluded((prev) => {
                      const next = new Set(prev);
                      if (event.target.checked) next.delete(item.busId);
                      else next.add(item.busId);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-fg-muted">{item.fileName}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-fg-2">
        <div className="flex items-center gap-2">
          <span>Bit depth</span>
          {[16, 24].map((depth) => (
            <Button
              key={depth}
              type="button"
              size="sm"
              variant={bitDepth === depth ? "secondary" : "ghost"}
              className="h-5 px-1.5 text-[10px]"
              aria-pressed={bitDepth === depth}
              onClick={() => setBitDepth(depth as 16 | 24)}
            >
              {depth}-bit
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 text-[11px]"
          disabled={chosen.length === 0}
          data-testid="export-stems-add"
          onClick={() => {
            const job = addDialogStemsToQueue({ mode, ids: chosen.map((item) => item.busId), bitDepth });
            if (job) onQueued?.();
          }}
        >
          Add {chosen.length} stem{chosen.length === 1 ? "" : "s"} to queue
        </Button>
      </div>
    </section>
  );
};
