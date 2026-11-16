import type { Action } from "@openreel/core/types/actions";
import { isIngestPreset } from "@openreel/core/media/proxy-workflow";
import { DESKTOP_PROXY_CODECS, DESKTOP_PROXY_SIZES, isDesktopIngestConfig } from "@openreel/core/media/desktop-ingest";
import type { DesktopIngestConfig } from "@openreel/core/types/project";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Proxy / ingest tools. Building, attaching and toggling proxies needs the live editor's media
 * pipeline and preview cache, so those go through the optional `host.proxies` bridge and fail
 * clearly on headless hosts. Proxies are preview-only: every export reads full-resolution media.
 * Linking a proxy and changing the ingest preset are each ONE `media/organize` action (one undo step).
 */

const str: JSONSchema = { type: "string" };
const bool: JSONSchema = { type: "boolean" };
const strings: JSONSchema = { type: "array", items: str };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({ ok: false, summary: message, error: { code, message } });
const UNSUPPORTED = "Proxies need the live editor's media pipeline and are not available on this host.";
const QUALITIES = ["low", "medium", "high"] as const;
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const PROXY_TOOLS: RegisteredTool[] = [
  {
    name: "create_proxies",
    domain: "media",
    title: "Create proxies",
    description:
      "Queue background builds of low-resolution H.264 proxies for video media (Project panel > Proxies > Create proxies). mediaIds picks items (default: every video without a proxy); quality is low (up to 540p), medium (720p, default) or high (1080p); force rebuilds an existing proxy. Jobs run one at a time in the background with progress in the Project panel and survive a reload; each finished proxy is linked to its media as one undo step. Proxies only change what preview, scrub and playback decode: transforms, masks, effects and text are resolution independent, and exports ALWAYS read the full-resolution media. Returns queued ids and skipped items with reasons; poll list_proxies for status.",
    inputSchema: obj({ mediaIds: strings, quality: { type: "string", enum: [...QUALITIES] }, force: bool }),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.proxies) return fail(UNSUPPORTED, "UNSUPPORTED_HOST");
      if (args.mediaIds !== undefined && (!Array.isArray(args.mediaIds) || args.mediaIds.some((id) => typeof id !== "string")))
        return fail("mediaIds must be an array of media ids.");
      const quality = args.quality === undefined ? "medium" : (QUALITIES as readonly unknown[]).includes(args.quality) ? (args.quality as (typeof QUALITIES)[number]) : null;
      if (!quality) return fail(`quality must be one of ${QUALITIES.join(", ")}.`);
      const result = host.proxies.create(args.mediaIds as string[] | undefined, quality, args.force === true);
      return ok(
        `Queued ${result.queued.length} proxy build${result.queued.length === 1 ? "" : "s"}${result.skipped.length ? `, skipped ${result.skipped.length}` : ""}.`,
        result,
      );
    },
  },
  {
    name: "attach_proxies",
    domain: "media",
    title: "Attach proxies",
    description:
      "Attach existing proxy files that are already imported into the project to their full-resolution media (Project panel > Proxies > Attach proxies). Pass pairs [{mediaId, proxyMediaId}], or omit pairs to match by file name (extension and _proxy / -proxy suffixes ignored). Each proxy is validated against the original: it must decode, keep the aspect ratio, match the duration within 0.25 s / 1 % and the frame rate within 0.5 fps; mismatches are reported and skipped. All accepted proxies are linked as ONE undo step. The proxy media items stay in the library (delete them separately if unwanted). Exports still use full resolution.",
    inputSchema: obj({
      pairs: { type: "array", items: obj({ mediaId: str, proxyMediaId: str }, ["mediaId", "proxyMediaId"]) },
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.proxies) return fail(UNSUPPORTED, "UNSUPPORTED_HOST");
      let pairs: Array<{ mediaId: string; proxyMediaId: string }> | undefined;
      if (args.pairs !== undefined) {
        if (!Array.isArray(args.pairs)) return fail("pairs must be an array of {mediaId, proxyMediaId}.");
        pairs = [];
        for (const pair of args.pairs as Array<Record<string, unknown>>) {
          if (typeof pair?.mediaId !== "string" || typeof pair?.proxyMediaId !== "string") return fail("Every pair needs mediaId and proxyMediaId.");
          pairs.push({ mediaId: pair.mediaId, proxyMediaId: pair.proxyMediaId });
        }
      }
      const result = await host.proxies.attach(pairs);
      if (!result.attached.length && result.skipped.length)
        return { ok: false, summary: `No proxies attached: ${result.skipped[0].reason}`, error: { code: "VALIDATION_FAILED", message: result.skipped[0].reason }, data: result };
      return ok(`Attached ${result.attached.length} prox${result.attached.length === 1 ? "y" : "ies"}${result.skipped.length ? `, rejected ${result.skipped.length}` : ""}.`, result);
    },
  },
  {
    name: "toggle_proxies",
    domain: "media",
    title: "Toggle proxies",
    description:
      "Toggle Proxies (Program monitor button, Shift+P): on = preview, scrub and playback decode proxies where they exist; off = they decode the full-resolution media. Pass on=true/false to set it explicitly, or omit to flip it. Not an edit: no undo step. Export is unaffected and always uses full resolution.",
    inputSchema: obj({ on: bool }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.proxies) return fail(UNSUPPORTED, "UNSUPPORTED_HOST");
      if (args.on !== undefined && typeof args.on !== "boolean") return fail("on must be true or false.");
      const state = host.proxies.toggle(args.on as boolean | undefined);
      return ok(`Proxies are ${state.on ? "on: preview decodes proxies where they exist" : "off: preview decodes full-resolution media"}.`, state);
    },
  },
  {
    name: "list_proxies",
    domain: "read",
    title: "List proxies",
    description:
      "Report the proxy state of every video: none | ready | building | failed | missing-proxy (link exists but the proxy bytes are gone) | missing-full (the full-resolution media is offline), its proxy resolution, build progress, whether Toggle Proxies is on and the project's ingest preset. Read-only.",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (_args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.proxies) return fail(UNSUPPORTED, "UNSUPPORTED_HOST");
      const status = host.proxies.status();
      return ok(`Proxies ${status.on ? "on" : "off"}; ${status.items.filter((i) => i.state === "ready").length} of ${status.items.length} videos have a ready proxy.`, status);
    },
  },
  {
    name: "set_ingest_preset",
    domain: "media",
    title: "Set ingest preset",
    description:
      "Set the project's ingest preset: none (default) or proxies (build proxies in the background for every video imported from now on). On the desktop app copy is also available: copy imported media into the project's Media folder (checksum-verified, originals never deleted). One undo step. Existing media is not touched; use create_proxies / copy_media_to_project for that.",
    inputSchema: obj({ preset: { type: "string", enum: ["none", "proxies", "copy"] } }, ["preset"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      const desktop = Boolean(host.proxies?.desktop);
      if (args.preset === "copy" && !desktop) return fail("Copy to project is available on the desktop app only. preset must be none or proxies.");
      if (!isIngestPreset(args.preset)) return fail(`preset must be none, proxies${desktop ? " or copy" : ""}.`);
      const action: Action = {
        type: "media/organize",
        id: genId(),
        timestamp: Date.now(),
        params: { label: "Set ingest preset", ingestPreset: args.preset },
      };
      const result = await host.applyAction(action);
      if (!result.success) return fail(result.error?.message ?? "The change failed.", "ACTION_FAILED");
      return ok(`Ingest preset set to ${args.preset}.`, { preset: args.preset });
    },
  },
  {
    name: "set_proxy_format",
    domain: "media",
    title: "Set desktop proxy format",
    description:
      "Desktop app only. Set the project's native proxy settings (Project panel > Proxies): codec prores-proxy (ProRes 422 Proxy .mov) or h264 (.mp4), size half | quarter | 720p | 1080p (a fixed height never upscales), jobs at once 1-2, the Proxies folder and Media folder (absolute, or relative to the project file's folder; default Proxies/ and Media/ beside the project), and proxiesWithCopy (also build proxies when the copy preset ingests media). Only the fields you pass change. One undo step. Affects proxies built from now on; use create_proxies with force to rebuild.",
    inputSchema: obj({
      codec: { type: "string", enum: DESKTOP_PROXY_CODECS.map((entry) => entry.id) },
      size: { type: "string", enum: DESKTOP_PROXY_SIZES.map((entry) => entry.id) },
      concurrency: { type: "number", enum: [1, 2] },
      proxyFolder: str,
      mediaFolder: str,
      proxiesWithCopy: bool,
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.proxies?.desktop) return fail("Native proxy settings are available on the desktop app only.", "UNSUPPORTED_HOST");
      const current = host.getProject().mediaLibrary.desktopIngest;
      const next: Record<string, unknown> = { ...current };
      if (args.codec !== undefined || args.size !== undefined)
        next.proxyProfile = { ...(current?.proxyProfile ?? { codec: "h264", size: "half" }), ...(args.codec !== undefined ? { codec: args.codec } : {}), ...(args.size !== undefined ? { size: args.size } : {}) };
      if (args.concurrency !== undefined) next.concurrency = args.concurrency;
      if (args.proxyFolder !== undefined) next.proxyFolder = args.proxyFolder;
      if (args.mediaFolder !== undefined) next.mediaFolder = args.mediaFolder;
      if (args.proxiesWithCopy !== undefined) next.proxiesWithCopy = args.proxiesWithCopy;
      if (!isDesktopIngestConfig(next)) return fail("Invalid settings: codec is prores-proxy or h264, size is half, quarter, 720p or 1080p, concurrency is 1 or 2, folders are non-empty paths.");
      const action: Action = {
        type: "media/organize",
        id: genId(),
        timestamp: Date.now(),
        params: { label: "Change ingest settings", desktopIngest: next as DesktopIngestConfig },
      };
      const result = await host.applyAction(action);
      if (!result.success) return fail(result.error?.message ?? "The change failed.", "ACTION_FAILED");
      return ok("Desktop proxy settings updated.", next);
    },
  },
  {
    name: "retry_failed_proxies",
    domain: "media",
    title: "Retry failed proxies",
    description: "Desktop app only (Project panel > Proxies > Retry failed). Re-queue every proxy build that failed in this project. Returns how many were retried; poll list_proxies for status.",
    inputSchema: obj({}),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (_args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.proxies?.desktop) return fail("Retrying native proxy jobs is available on the desktop app only.", "UNSUPPORTED_HOST");
      const result = await host.proxies.desktop.retryFailed();
      return ok(`Retried ${result.retried} failed prox${result.retried === 1 ? "y" : "ies"}.`, result);
    },
  },
  {
    name: "copy_media_to_project",
    domain: "media",
    title: "Copy media to project",
    description:
      "Desktop app only. Copy media files into the project's Media folder and point the project at the copies. Every copy is verified by SHA-256 (the copy is re-read and compared) and the originals are never modified or deleted. mediaIds picks items (default: every online item not yet copied). The whole batch is ONE undo step for the reference change (undo re-points to the originals; the copied files stay on disk). The project must be saved first so its Media folder has a home.",
    inputSchema: obj({ mediaIds: strings }),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.proxies?.desktop) return fail("Copy to project is available on the desktop app only.", "UNSUPPORTED_HOST");
      if (args.mediaIds !== undefined && (!Array.isArray(args.mediaIds) || args.mediaIds.some((id) => typeof id !== "string")))
        return fail("mediaIds must be an array of media ids.");
      const report = await host.proxies.desktop.copyToProject(args.mediaIds as string[] | undefined);
      if (!report.copied.length && report.skipped.length)
        return { ok: false, summary: `Nothing copied: ${report.skipped[0].reason}`, error: { code: "COPY_FAILED", message: report.skipped[0].reason }, data: report };
      return ok(`Copied ${report.copied.length} file${report.copied.length === 1 ? "" : "s"} into the project${report.skipped.length ? `, skipped ${report.skipped.length}` : ""}.`, report);
    },
  },
  {
    name: "relink_media",
    domain: "media",
    title: "Relink media by folder search",
    description:
      "Desktop app only (Project panel: Reconnect full resolution / Find proxies). Search a folder (recursively, hidden folders skipped) for offline media (kind full, default) or missing proxies (kind proxy) and relink every match by file name + duration (0.25 s / 1 %) + frame rate. A media item that two files fit equally well is reported as ambiguous and left alone. Returns linked, ambiguous, notFound and failed items.",
    inputSchema: obj({ folder: str, kind: { type: "string", enum: ["full", "proxy"] } }, ["folder"]),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.proxies?.desktop) return fail("Relinking by folder search is available on the desktop app only.", "UNSUPPORTED_HOST");
      if (typeof args.folder !== "string" || !args.folder.trim()) return fail("folder must be an absolute folder path.");
      const kind = args.kind === undefined ? "full" : args.kind === "full" || args.kind === "proxy" ? args.kind : null;
      if (!kind) return fail("kind must be full or proxy.");
      const report = await host.proxies.desktop.relink(kind, args.folder);
      return ok(`Relinked ${report.linked.length}; ${report.ambiguous.length} ambiguous, ${report.notFound.length} not found, ${report.failed.length} failed.`, report);
    },
  },
];
