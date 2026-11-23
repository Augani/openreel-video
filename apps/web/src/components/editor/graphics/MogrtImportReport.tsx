import React from "react";
import type { MogrtImportReport } from "@openreel/core";

/**
 * What a .mogrt import did: layers and controls brought over, and every item that was dropped or approximated.
 * Shown under the Browse tab after an import (also when the file was refused, e.g. After Effects templates).
 */
export const MogrtImportReportPanel: React.FC<{
  report: MogrtImportReport;
  /** Set when the file was refused: the reason, shown first. */
  failure?: string;
  onDismiss: () => void;
}> = ({ report, failure, onDismiss }) => {
  const shown = report.items.filter((item) => item.severity !== "info" || failure || report.items.length <= 6);
  return (
    <section
      className="flex flex-col gap-2 rounded-[4px] border border-border/60 bg-bg-2 p-2 text-[11px]"
      data-testid="mogrt-import-report"
      aria-label="Motion Graphics Template import report"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-fg" data-testid="mogrt-import-summary">
          {failure ?? report.summary}
        </p>
        <button type="button" className="text-fg-muted hover:text-fg" onClick={onDismiss} aria-label="Dismiss import report">
          Close
        </button>
      </div>
      {!failure && (
        <p className="text-fg-muted" data-testid="mogrt-import-counts">
          {report.layersImported}/{report.layersTotal} layers · {report.controlsImported}/{report.controlsTotal} controls
        </p>
      )}
      {shown.length > 0 && (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto" aria-label="Import report items">
          {shown.map((item, index) => (
            <li key={`${item.feature}-${index}`} className="flex gap-1.5" data-severity={item.severity}>
              <span
                className={`mt-px shrink-0 rounded-[3px] px-1 text-[10px] uppercase ${
                  item.severity === "dropped" ? "bg-red-500/20 text-red-300" : item.severity === "approximated" ? "bg-amber-500/20 text-amber-300" : "bg-bg-3 text-fg-muted"
                }`}
              >
                {item.severity}
              </span>
              <span className="min-w-0 text-fg-muted">
                <span className="text-fg">{item.feature}</span>: {item.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
