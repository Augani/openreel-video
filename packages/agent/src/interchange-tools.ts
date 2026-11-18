import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import { ensureSequences, listSequences } from "@openreel/core/timeline/sequences";
import {
  exportTimeline,
  importTimeline,
  applyTimelineImport,
  type InterchangeFormat,
} from "@openreel/core/interchange/index";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Timeline interchange for the agent: hand a cut to Premiere / Resolve /
 * Final Cut, or bring one back. Same pure core as File > Export / Import.
 */

const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});

const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const fail = (message: string, code = "ERROR"): ToolResult => ({
  ok: false,
  summary: message,
  error: { code, message },
});

const FORMATS: InterchangeFormat[] = ["xmeml", "fcpxml", "edl", "otio"];

export const INTERCHANGE_TOOLS: RegisteredTool[] = [
  {
    name: "export_timeline_xml",
    domain: "export",
    title: "Export timeline XML",
    description:
      'Serialize the video/audio timeline for another editor and return the file text. format "xmeml" (default) = Final Cut Pro 7 XML v5 that Premiere Pro and DaVinci Resolve import; "fcpxml" = Final Cut Pro X FCPXML 1.10; "edl" = CMX3600, one file per video track; "otio" = OpenTimelineIO JSON (Resolve, Avid, Premiere plugins; also carries sync lock and track targeting). Clips, tracks, speed, opacity, volume, cross dissolves and markers are included. Pass "sequence" (id or name, see list_sequences) to export ANY sequence, open or not; it defaults to the active one. Nested sequences stay nested in xmeml (nested sequence), otio (stacks) and fcpxml (compound clips / ref-clip); edl gets them flattened, with a report entry. Multicam cuts are written as multiclip (xmeml) or mc-clip (fcpxml) with every angle; otio and edl flatten them to the active angle, with a report entry. Everything dropped or approximated (effects, speed ramps, text clips, sync lock where the format has no field...) is listed per clip in `report.items`, never silently; `report.notes` says AAF is available only from File > Export timeline in the editor (it is a binary file, so this text tool does not return it; see docs/interchange.md). Read-only.',
    inputSchema: obj({
      format: { type: "string", enum: FORMATS },
      sequence: { type: "string", description: "Sequence id or name to export; defaults to the active sequence." },
      dropFrame: { type: "boolean", description: "Drop-frame timecode for 29.97 / 59.94 projects." },
    }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: (args, host) => {
      try {
        host.requireOpenProject();
        const format = (args.format ?? "xmeml") as InterchangeFormat;
        if (!FORMATS.includes(format)) return fail(`format must be one of ${FORMATS.join(", ")}.`, "INVALID_PARAMS");
        const project = host.getProject();
        let sequenceId: string | undefined;
        if (typeof args.sequence === "string" && args.sequence) {
          const all = listSequences(ensureSequences(project));
          const byId = all.find((s) => s.id === args.sequence);
          const byName = all.filter((s) => s.name.toLowerCase() === String(args.sequence).toLowerCase());
          if (!byId && byName.length === 0) return fail(`No sequence "${args.sequence}". Use list_sequences to see ids.`, "INVALID_PARAMS");
          if (!byId && byName.length > 1) return fail(`More than one sequence is named "${args.sequence}"; use its id.`, "INVALID_PARAMS");
          sequenceId = (byId ?? byName[0]).id;
        }
        const result = exportTimeline(project, format, {
          ...(sequenceId ? { sequenceId } : {}),
          dropFrame: args.dropFrame === true,
          targetedTrackIds: host.targeting?.getState().targetedTrackIds,
        });
        const { report } = result;
        return {
          ok: true,
          summary: `Exported ${format} (${result.files.map((f) => f.filename).join(", ")}); ${report.dropped} dropped, ${report.approximated} approximated`,
          data: { format, files: result.files, warnings: result.warnings, report },
        };
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Export failed", "EXPORT_FAILED");
      }
    },
  },
  {
    name: "import_timeline_xml",
    domain: "project",
    title: "Import timeline XML",
    description:
      'Import a Final Cut Pro XML (xmeml, from Premiere/Resolve/FCP7), FCPXML, OpenTimelineIO (.otio JSON) or CMX3600 EDL sequence passed as `xml` text (the OTIO JSON or EDL text goes in the same argument). An EDL carries no frame rate: pass `frameRate` (default 24, or 29.97 for drop frame); each clip keeps its reel and source timecodes in metadata.edl, and reels are relinked to bin media by reel name (the media embedded start timecode decides the in-point; when several files share a reel name the source timecode picks one). Media is relinked to the media bin by filename; files not in the bin become offline placeholders and are listed in `unmatched`. mode "replace" (default) swaps video/audio tracks and markers (text/graphics tracks stay); "append" adds the imported tracks. Nested sequences (xmeml clipitem sequences, otio stacks, fcpxml compound clips) become project sequences with nest clips, and xmeml multiclips become multicam sources with their angles. One undo step. Pass dryRun:true to only report what would be imported.',
    inputSchema: obj(
      {
        xml: { type: "string" },
        mode: { type: "string", enum: ["replace", "append"] },
        dryRun: { type: "boolean" },
        frameRate: { type: "number" },
      },
      ["xml"],
    ),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      try {
        host.requireOpenProject();
        if (typeof args.xml !== "string" || !args.xml.trim()) return fail("xml is required.", "INVALID_PARAMS");
        const mode = args.mode === "append" ? "append" : "replace";
        const project = host.getProject();
        const frameRate = typeof args.frameRate === "number" && args.frameRate > 0 ? args.frameRate : undefined;
        const result = importTimeline(args.xml, { mediaItems: project.mediaLibrary.items, ...(frameRate ? { frameRate } : {}) });
        const report = {
          format: result.format,
          sequenceName: result.sequenceName,
          clipCount: result.clipCount,
          trackCount: result.tracks.length,
          markerCount: result.markers.length,
          matched: result.matched,
          unmatched: result.unmatched,
          nestedSequences: result.nests?.map((nest) => nest.name) ?? [],
          multicamSources: result.multicamSources?.map((source) => source.name) ?? [],
          warnings: result.warnings,
        };
        if (args.dryRun === true) {
          return { ok: true, summary: `Dry run: ${result.clipCount} clips on ${result.tracks.length} tracks`, data: { ...report, applied: false } };
        }
        if (result.clipCount === 0) return fail("The file contains no importable clips.", "NO_CLIPS");
        const outcome = await host.applyAction({
          type: "project/applyEditSnapshot",
          id: genId(),
          timestamp: Date.now(),
          params: {
            snapshot: editSnapshot(applyTimelineImport(project, result, mode)),
          },
        });
        if (!outcome.success) return fail(outcome.error?.message ?? "The import failed", outcome.error?.code ?? "ACTION_FAILED");
        return {
          ok: true,
          summary: `Imported ${result.clipCount} clips on ${result.tracks.length} tracks (${mode}); ${result.unmatched.length} media file(s) unmatched`,
          data: { ...report, applied: true, mode },
        };
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Import failed", "INVALID_PARAMS");
      }
    },
  },
];
