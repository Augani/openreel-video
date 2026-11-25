import type { ComplianceResult, LoudnessExportReport } from "@openreel/core";
import { useLoudnessStore } from "../stores/loudness-store";
import { toast } from "../stores/notification-store";

const formatValue = (value: number, unit: string): string =>
  Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : "silence";

const UNITS: Record<string, string> = { loudness: "LUFS", truePeak: "dBTP", loudnessRange: "LU" };

/** Silent programs measure -Infinity LUFS; a pass/fail verdict is meaningless there. */
export function isSilentCompliance(compliance: ComplianceResult): boolean {
  const loudness = compliance.checks.find((check) => check.id === "loudness");
  return loudness !== undefined && !Number.isFinite(loudness.measured);
}

/** Headline verdict for a compliance result: "compliant", "not compliant" or "n/a (silence)". */
export function describeVerdict(compliance: ComplianceResult): string {
  if (isSilentCompliance(compliance)) return "n/a (silence)";
  return compliance.pass ? "compliant" : "not compliant";
}

/** One line per check: "PASS Integrated loudness -23.1 LUFS (-23 ±0.5 LUFS)". */
export function describeCompliance(compliance: ComplianceResult): string[] {
  return compliance.checks.map(
    (check) =>
      `${check.pass ? "Pass" : "Fail"}: ${check.label} ${formatValue(check.measured, UNITS[check.id] ?? "")} (${check.requirement})`,
  );
}

/**
 * Post-export compliance readout: keeps the last loudness report for the mixer
 * panel and tells the user pass / fail per delivery-spec target.
 */
export function reportExportLoudness(report: LoudnessExportReport | undefined): void {
  if (!report) return;
  useLoudnessStore.getState().setExportReport(report);
  const compliance = report.compliance;
  if (!compliance) return;
  const lines = describeCompliance(compliance);
  if (compliance.dialogueFallback) lines.push("No dialogue was detected, so the program loudness was used.");
  const title = `${compliance.specLabel}: ${describeVerdict(compliance)}`;
  if (isSilentCompliance(compliance)) toast.info(title, lines.join("\n"));
  else if (compliance.pass) toast.success(title, lines.join("\n"));
  else toast.warning(title, lines.join("\n"));
}
