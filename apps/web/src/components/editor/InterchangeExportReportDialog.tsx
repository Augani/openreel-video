import { useMemo } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openreel/ui";
import type { ReportItem } from "@openreel/core/interchange/index";
import { toast } from "../../stores/notification-store";
import {
  formatExportReport,
  useInterchangeExportReportStore,
} from "../../services/timeline-interchange";

interface FeatureGroup {
  readonly key: string;
  readonly feature: string;
  readonly severity: ReportItem["severity"];
  readonly items: ReportItem[];
}

function groupByFeature(items: readonly ReportItem[]): FeatureGroup[] {
  const groups = new Map<string, FeatureGroup>();
  for (const item of items) {
    const key = `${item.severity}:${item.feature}`;
    const group = groups.get(key) ?? { key, feature: item.feature, severity: item.severity, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Shown after an interchange export: every feature that was dropped or approximated, per clip. */
export function InterchangeExportReportDialog() {
  const view = useInterchangeExportReportStore((s) => s.view);
  const setView = useInterchangeExportReportStore((s) => s.setView);
  const groups = useMemo(() => (view ? groupByFeature(view.report.items) : []), [view]);
  if (!view) return null;
  const { report } = view;
  const copy = () => {
    void navigator.clipboard
      .writeText(formatExportReport(view))
      .then(() => toast.success("Report copied"))
      .catch(() => toast.error("Could not copy the report"));
  };
  return (
    <Dialog open onOpenChange={(open) => !open && setView(null)}>
      <DialogContent
        aria-describedby="interchange-report-desc"
        className="flex max-h-[90dvh] w-[calc(100vw-32px)] max-w-[560px] flex-col gap-0 overflow-hidden border-border bg-bg-1 p-0 text-fg"
        data-testid="interchange-export-report"
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="text-[15px] font-semibold text-fg">Export report</DialogTitle>
          <DialogDescription id="interchange-report-desc" className="text-[12px] text-fg-muted">
            {view.label} · {view.filenames.join(", ")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto p-5 text-[13px]">
          <p data-testid="interchange-report-summary">
            <span data-testid="report-dropped-count" className="font-medium">{report.dropped}</span> dropped,{" "}
            <span data-testid="report-approximated-count" className="font-medium">{report.approximated}</span> approximated.
            <span className="block text-[12px] text-fg-muted">
              The file was saved. These parts of the project could not be carried into this format.
            </span>
          </p>
          <ul className="space-y-2">
            {groups.map((group) => (
              <li
                key={group.key}
                className="rounded-md border border-border bg-bg-2 p-3"
                data-testid="interchange-report-group"
                data-feature={group.feature}
                data-severity={group.severity}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{group.feature}</span>
                  <span className="shrink-0 text-[11px] uppercase tracking-wide text-fg-muted">
                    {group.severity} · {group.items.length}
                  </span>
                </div>
                <ul className="mt-2 space-y-1.5 text-[12px]">
                  {group.items.map((item, i) => (
                    <li key={`${i}-${item.clipId ?? item.trackName ?? ""}`} data-testid="interchange-report-item">
                      {(item.trackName || item.clipName) && (
                        <span className="font-medium">
                          {[item.trackName, item.clipName].filter(Boolean).join(" / ")}
                        </span>
                      )}
                      <span className="block break-words text-fg-muted">{item.detail}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {report.notes.length > 0 && (
            <ul className="space-y-1 text-[12px] text-fg-muted" data-testid="interchange-report-notes">
              {report.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter className="border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={copy}>
            Copy report
          </Button>
          <Button onClick={() => setView(null)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
