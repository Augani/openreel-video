import React from "react";
import { Button, cn } from "@openreel/ui";
import { Camera, Trash2 } from "@/icons/lucide-compat";
import {
  useColorMonitorStore,
  type ComparisonMode,
  type ComparisonReference,
} from "../../../stores/color-monitor-store";
import {
  grabStill,
  pinReferenceToPlayhead,
  removeStill,
} from "../../../services/comparison-service";

const MODES: ReadonlyArray<{ value: ComparisonMode; label: string }> = [
  { value: "off", label: "Off" },
  { value: "side", label: "Side by side" },
  { value: "split-v", label: "Split |" },
  { value: "split-h", label: "Split —" },
];

const REFERENCES: ReadonlyArray<{ value: ComparisonReference; label: string }> = [
  { value: "bypass", label: "Ungraded" },
  { value: "still", label: "Still" },
  { value: "playhead", label: "Playhead" },
];

const segment = (active: boolean) =>
  cn(
    "flex-1 whitespace-nowrap px-1.5 py-1 text-[10px] font-medium transition-colors",
    active ? "bg-accent text-white" : "bg-bg-1 text-fg-2 hover:bg-bg-3",
  );

/**
 * Program monitor comparison view: current frame against an ungraded frame, a
 * stored still, or a pinned playhead position. Preview only (Shift+C toggles);
 * it never affects the scopes or an export.
 */
export const ComparisonSection: React.FC = () => {
  const comparison = useColorMonitorStore((state) => state.comparison);
  const stills = useColorMonitorStore((state) => state.stills);
  const setComparison = useColorMonitorStore((state) => state.setComparison);

  return (
    <div className="flex flex-col gap-2" data-testid="comparison-section">
      <div role="group" aria-label="Comparison mode" className="flex overflow-hidden rounded-[6px] border border-border">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            aria-pressed={comparison.mode === mode.value}
            className={segment(comparison.mode === mode.value)}
            onClick={() => setComparison({ mode: mode.value })}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <span className="text-[10px] font-medium text-fg-2">Reference</span>
      <div role="group" aria-label="Comparison reference" className="flex overflow-hidden rounded-[6px] border border-border">
        {REFERENCES.map((reference) => (
          <button
            key={reference.value}
            type="button"
            aria-pressed={comparison.reference === reference.value}
            className={segment(comparison.reference === reference.value)}
            onClick={() =>
              reference.value === "playhead"
                ? pinReferenceToPlayhead()
                : setComparison({ reference: reference.value })
            }
          >
            {reference.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[10px]"
          onClick={() => void grabStill()}
        >
          <Camera className="mr-1 h-3 w-3" />
          Grab still
        </Button>
        <span className="text-[9px] leading-snug text-fg-3">
          {comparison.reference === "playhead"
            ? "Pinned to the playhead position when selected."
            : "Stills are kept for this session only."}
        </span>
      </div>
      {stills.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {stills.map((still) => (
            <div
              key={still.id}
              className={cn(
                "group relative overflow-hidden rounded-[6px] border",
                comparison.stillId === still.id ? "border-accent" : "border-border",
              )}
            >
              <button
                type="button"
                aria-label={`Use ${still.label} as the reference`}
                aria-pressed={comparison.stillId === still.id && comparison.reference === "still"}
                className="block w-full"
                onClick={() => setComparison({ stillId: still.id, reference: "still" })}
              >
                {still.thumb ? (
                  <img src={still.thumb} alt={still.label} className="block w-full" />
                ) : (
                  <span className="block py-3 text-[9px] text-fg-3">{still.label}</span>
                )}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${still.label}`}
                className="absolute right-0 top-0 h-5 w-5 bg-black/55 text-white opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => removeStill(still.id)}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
