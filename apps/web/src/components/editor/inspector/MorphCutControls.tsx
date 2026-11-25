import React, { useSyncExternalStore } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";
import { getMorphCutRegistry } from "@openreel/core/video/morph-cut/registry";
import { MORPH_CUT_QUALITIES, morphCutQualityOf, type MorphCutQuality } from "@openreel/core/video/morph-cut/types";

const QUALITY_LABEL: Record<MorphCutQuality, string> = { low: "Low (fast)", medium: "Medium", high: "High (detailed)" };

/** The wording of a Morph Cut transition's analysis status, shared by the inspector, the timeline badge and tests. */
export function morphCutStatusLine(state: ReturnType<ReturnType<typeof getMorphCutRegistry>["getState"]>): string {
  switch (state.status) {
    case "analysing":
      return `Analysing in background (${Math.round(state.progress * 100)}%). Renders as a cross dissolve until it finishes.`;
    case "ready":
      return `Analysed${state.backend ? ` on the ${state.backend === "gpu" ? "GPU" : "CPU"}` : ""}${state.analysisMs !== undefined ? ` in ${(state.analysisMs / 1000).toFixed(1)} s` : ""}, confidence ${Math.round((state.confidence ?? 0) * 100)}%.`;
    case "cancelled":
      return "Analysis cancelled. Renders as a cross dissolve.";
    case "failed":
      return `${state.message}. Rendering as a cross dissolve.`;
    default:
      return "Not analysed yet. Renders as a cross dissolve until the analysis runs.";
  }
}

/** Live status of a transition's Morph Cut analysis. */
export function useMorphCutState(transitionId: string | undefined) {
  const registry = getMorphCutRegistry();
  useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => registry.getVersion(),
  );
  return transitionId ? registry.getState(transitionId) : registry.getState("");
}

export const MorphCutControls: React.FC<{
  transitionId?: string;
  params: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}> = ({ transitionId, params, onChange }) => {
  const state = useMorphCutState(transitionId);
  const quality = morphCutQualityOf(params);
  const analysing = state.status === "analysing";
  return (
    <div className="space-y-2" data-testid="morph-cut-controls">
      <div className="space-y-1">
        <span className="text-fg-2 font-normal text-[10px]">Analysis detail</span>
        <Select value={quality} onValueChange={(value) => onChange("quality", value)}>
          <SelectTrigger aria-label="Morph Cut analysis detail" icon={<span aria-hidden="true">▾</span>}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MORPH_CUT_QUALITIES.map((value) => (
              <SelectItem key={value} value={value}>
                {QUALITY_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-fg-2 text-[10px] leading-snug" role="status" aria-live="polite" data-testid="morph-cut-status" data-status={state.status}>
        {transitionId ? morphCutStatusLine(state) : "Add the transition, then it analyses in the background."}
      </p>
      {analysing && transitionId && (
        <button
          type="button"
          className="text-[10px] text-accent underline"
          data-testid="morph-cut-cancel"
          onClick={() => {
            void import("@openreel/core/video/morph-cut/analyse-job").then((m) => m.cancelMorphCutAnalysis(transitionId));
          }}
        >
          Cancel analysis
        </button>
      )}
      {state.status === "cancelled" && transitionId && (
        <button
          type="button"
          className="text-[10px] text-accent underline"
          data-testid="morph-cut-reanalyse"
          onClick={() => {
            void import("@openreel/core/video/morph-cut/analyse-job").then((m) => {
              m.restartMorphCutAnalysis(transitionId);
              void import("../../../services/morph-cut-service").then((s) => s.scheduleMorphCutScan());
            });
          }}
        >
          Analyse again
        </button>
      )}
      {analysing && (
        <div className="h-1 w-full overflow-hidden rounded bg-bg-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress * 100)}>
          <div className="h-full bg-accent" style={{ width: `${Math.round(state.progress * 100)}%` }} />
        </div>
      )}
      <p className="text-fg-2 text-[10px] leading-snug">
        Best for jump cuts in one continuous shot (a talking head). It matches the last frame of the outgoing clip to the first frame of the incoming clip; shots that differ too much stay a cross dissolve.
      </p>
    </div>
  );
};
