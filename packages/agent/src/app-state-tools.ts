import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * App-level state for agents that drive OpenReel without looking at its window. Nothing here is a
 * precondition for any other tool: onboarding is UI-only state.
 */

const emptyObject: JSONSchema = { type: "object", properties: {}, required: [], additionalProperties: true };

const unsupported = (name: string): ToolResult => ({
  ok: false,
  summary: `${name} is not available in this host (it needs the live OpenReel app). Run OpenReel desktop.`,
  error: { code: "UNSUPPORTED", message: `${name} needs the live editor`, hint: "Run OpenReel desktop." },
});

export const APP_STATE_TOOLS: RegisteredTool[] = [
  {
    name: "get_app_state",
    domain: "project",
    title: "Get app state",
    description:
      "Report what OpenReel is doing right now, without needing its window: appVersion, platform, route (welcome|editor|...), windows {editor, count}, projectOpen and projectId, onboarding {status unseen|in-progress|done|skipped, path, skippedBy}, ai {configured, provider}, and mcp {toolCount, autoAllow, allowedRoots, protocolVersion}. mcp.allowedRoots are the folders the path tools (import_media_from_path, open_project_file, save_project_as, export outputPath) may read and write. Call this first in a session; it works with no project open. Read-only.",
    inputSchema: emptyObject,
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (_args, host) => {
      if (typeof host.getAppState !== "function") return unsupported("get_app_state");
      const state = await host.getAppState();
      const where = state.projectOpen ? `project ${state.projectId ?? ""} open` : "no project open";
      return {
        ok: true,
        summary: `OpenReel ${state.appVersion} on ${state.platform}, route ${state.route}, ${where}, onboarding ${state.onboarding.status}`,
        data: state,
      };
    },
  },
  {
    name: "dismiss_onboarding",
    domain: "project",
    title: "Dismiss onboarding",
    description:
      "Dismiss OpenReel's first-run onboarding (the welcome path chooser and any open setup sheet) so it never covers the UI during an agent session. Idempotent: calling it again, or after the user finished onboarding, changes nothing. It does not touch any project and is never required before other tools. Lesson and AI-setup progress is kept.",
    inputSchema: emptyObject,
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (_args, host) => {
      if (typeof host.dismissOnboarding !== "function") return unsupported("dismiss_onboarding");
      const outcome = await host.dismissOnboarding();
      return {
        ok: true,
        summary: outcome.changed ? `Onboarding dismissed (status ${outcome.status})` : `Onboarding already ${outcome.status}`,
        data: outcome,
      };
    },
  },
  {
    name: "get_project_fonts",
    domain: "project",
    title: "Get project fonts",
    description:
      "List every font family used by text clips, motion-graphics text layers and caption styles, with where it is used and how it travels when the project is packaged (Collect Files). status is one of: embedded (user font copied into the package; license fsType installable/editable), embedded-readonly (fsType preview&print: embedded for preview/export, not for editing), restricted (fsType forbids embedding; not copied, install it on the other machine), unknown-license (font file license unreadable, e.g. WOFF2 uploads, or file data unavailable; not copied: re-upload as TTF/OTF/WOFF to embed), web (catalog font recorded by family + url, not copied), bundled (ships with OpenReel), system (installed OS font; cannot be embedded). Read-only; works only in the live OpenReel app.",
    inputSchema: emptyObject,
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (_args, host) => {
      if (typeof host.getProjectFonts !== "function") return unsupported("get_project_fonts");
      const report = await host.getProjectFonts();
      const blocked = report.fonts.filter((f) => f.status === "restricted" || f.status === "unknown-license");
      return {
        ok: true,
        summary: `${report.fonts.length} font famil${report.fonts.length === 1 ? "y" : "ies"} used, ${blocked.length} that cannot be embedded`,
        data: report,
      };
    },
  },
];
