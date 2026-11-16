import React, { useState, useEffect, useCallback } from "react";
import { Plug, Eye, EyeOff, Copy, RefreshCw, Wifi, TriangleAlert, Plus, X } from "@/icons/lucide-compat";
import { Switch, cn } from "@openreel/ui";
import { Button } from "@openreel/ui";


import { useSettingsStore } from "../../../stores/settings-store";
import { toast } from "../../../stores/notification-store";
import { ConnectSnippets, copyText } from "../../onboarding/agent/ConnectSnippets";
import { connectionLabel, useMcpConnection } from "../../onboarding/agent/mcp-connect";
import type { OpenReelMcpPolicy } from "../../../types/global";

const isDesktop = (): boolean =>
  typeof window !== "undefined" && window.openreel?.platform === "desktop";

const copy = copyText;

const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/]|\\\\)/;

/**
 * Folders agents may read from and write to. Enforced in the main process; this only edits the list.
 * Paths are typed or pasted because there is no folder picker in the preload API.
 */
const AllowedRootsEditor: React.FC = () => {
  const [policy, setPolicy] = useState<OpenReelMcpPolicy | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const supported = typeof window.openreel?.mcp?.getPolicy === "function";

  useEffect(() => {
    let alive = true;
    const get = window.openreel?.mcp?.getPolicy;
    if (!get) return;
    void get()
      .then((p) => {
        if (alive) setPolicy(p);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // An empty allowedRoots means "use the defaults" (the main process owns the default list, which
  // includes dynamic roots such as the open project's folder). Only a non-empty list is an override.
  const usingDefaults = policy !== null && policy.allowedRoots.length === 0;
  const roots = policy ? (usingDefaults ? policy.defaultRoots : policy.allowedRoots) : [];

  const save = useCallback(async (next: string[]) => {
    const set = window.openreel?.mcp?.setPolicy;
    if (!set) return;
    try {
      setPolicy(await set({ allowedRoots: next }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the folder list.");
    }
  }, []);

  const add = useCallback(async () => {
    const value = draft.trim();
    if (!value) return;
    if (!ABSOLUTE_PATH.test(value)) {
      setError("Enter an absolute folder path, for example /Users/me/Footage.");
      return;
    }
    if (roots.includes(value)) {
      setError("That folder is already allowed.");
      return;
    }
    await save([...roots, value]);
    setDraft("");
  }, [draft, roots, save]);

  if (!supported) return null;

  return (
    <div className="space-y-3">
      <div>
        <span className="block text-fg text-sm font-medium">Allowed folders</span>
        <span className="block text-fg-2 font-normal mt-0.5 text-xs">
          Agents can only read media from and write exports to these folders (and the open project's folder). Anything
          else is refused with OUTSIDE_ALLOWED_ROOTS.
        </span>
      </div>
      <ul className="space-y-1.5" aria-label="Allowed folders">
        {policy === null && <li className="text-xs text-fg-2">Loading…</li>}
        {roots.map((root) => (
          <li key={root} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
            <code className="flex-1 truncate font-mono text-xs text-fg-2" title={root}>
              {root}
            </code>
            <button
              type="button"
              aria-label={`Remove ${root}`}
              title="Remove"
              onClick={() => void save(roots.filter((r) => r !== root))}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-2 outline-none transition-colors hover:bg-bg-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={12} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Folder path to allow"
          placeholder="/Users/me/Footage"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="submit"
          className="inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-border bg-bg-2 px-2.5 text-[12px] font-semibold text-fg-2 hover:bg-bg-3 hover:text-fg"
        >
          <Plus size={14} aria-hidden />
          Add folder
        </Button>
        {policy && !usingDefaults && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void save([])}
            className="h-7 px-2 text-[12px] text-fg-2 hover:text-fg"
          >
            Reset to defaults
          </Button>
        )}
      </form>
      {usingDefaults && (
        <p className="text-xs text-fg-2">Using the default folders. Adding one makes this a custom list.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-fg-2">
          {error}
        </p>
      )}
    </div>
  );
};

export const McpPanel: React.FC = () => {
  const mcpAutoAllow = useSettingsStore((s) => s.mcpAutoAllowTrustedLocal);
  const setMcpAutoAllow = useSettingsStore((s) => s.setMcpAutoAllowTrustedLocal);

  const { status, toolCount, clientStatus, setStatus, setToolCount } = useMcpConnection();
  const [revealToken, setRevealToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const connection = connectionLabel(clientStatus);
  const startError = clientStatus?.startError ?? null;

  const handleRotate = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    try {
      setStatus(await bridge.rotateToken());
      toast.success("Token rotated", "Update your MCP clients with the new token.");
    } catch (err) {
      toast.error("Rotate failed", err instanceof Error ? err.message : "Unknown error");
    }
  }, [setStatus]);

  const handleTest = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    setTesting(true);
    try {
      const result = await bridge.testConnection();
      if (result.ok) {
        setToolCount(result.toolCount ?? 0);
        toast.success(
          "Connection OK",
          `Server responded with ${result.toolCount ?? 0} tools.`,
        );
      } else {
        setToolCount(null);
        toast.error("Connection failed", result.message ?? "No response");
      }
    } catch (err) {
      toast.error("Connection failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setTesting(false);
    }
  }, [setToolCount]);

  if (!isDesktop()) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Plug size={28} className="mb-3 text-text-muted" />
        <span className="block text-fg text-sm font-medium">
          Desktop only
        </span>
        <span className="block text-fg-2 font-normal mt-1 max-w-sm text-xs">
          The MCP server runs inside the OpenReel desktop app, letting external AI
          clients (Claude Desktop, Cursor, Cline) edit your project. Open OpenReel
          on desktop to configure it.
        </span>
      </div>
    );
  }

  const tokenDisplay = status?.token
    ? revealToken
      ? status.token
      : "•".repeat(32)
    : "—";

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <span className="block text-fg text-sm font-medium">
            MCP Server
          </span>
          <span className="block text-fg-2 font-normal mt-0.5 text-xs">
            A local Model Context Protocol server lets AI clients drive this
            editor through the same tools as the built-in chat. It listens on
            loopback only and requires the bearer token below.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-fg-2 font-normal w-20 shrink-0 text-xs">
            Status
          </span>
          <span className={cn("text-[12px] leading-5", "text-fg-2", "font-normal", `inline-flex items-center gap-1.5 text-xs font-medium ${
              status?.running ? "text-status-success" : "text-text-muted"
            }`)}
          >
            <i
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                status?.running ? "bg-status-success" : "bg-text-muted"
              }`}
            />
            {status?.running ? "Running" : "Stopped"}
          </span>
        </div>

        {startError && (
          <div role="alert" className="flex gap-2 rounded-md border border-border bg-background px-3 py-2.5 text-xs text-fg">
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-fg-2" aria-hidden />
            <span>
              The server could not start: <span className="font-mono">{startError}</span>. Quit and reopen OpenReel, or set
              OPENREEL_MCP_PORT to a free port.
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-fg-2 font-normal w-20 shrink-0 text-xs">
            Client
          </span>
          <span role="status" aria-live="polite" data-testid="mcp-connection-indicator" className="text-fg-2 font-normal text-xs">
            {connection.text}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-fg-2 font-normal w-20 shrink-0 text-xs">
            Tools
          </span>
          <span className="text-fg-2 font-normal text-xs">
            {toolCount === null
              ? status?.running
                ? "Checking catalog…"
                : "—"
              : `${toolCount} available`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-fg-2 font-normal w-20 shrink-0 text-xs">
            URL
          </span>
          <code className="flex-1 font-mono text-xs bg-background rounded px-3 py-2 text-text-secondary truncate">
            {status?.url || "—"}
          </code>
          <Button variant="ghost" size="icon-sm" onClick={() => status?.url && copy(status.url, "URL")} type="button" aria-label="Copy URL" title="Copy URL" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-text-muted hover:bg-background-tertiary hover:text-text-primary">
            {<Copy size={14} aria-hidden />}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-fg-2 font-normal w-20 shrink-0 text-xs">
            Token
          </span>
          <code className="flex-1 font-mono text-xs bg-background rounded px-3 py-2 text-text-secondary truncate">
            {tokenDisplay}
          </code>
          <Button variant="ghost" size="icon-sm" onClick={() => setRevealToken((v) => !v)} type="button" aria-label={revealToken ? "Hide token" : "Show token"} title={revealToken ? "Hide token" : "Show token"} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-text-muted hover:bg-background-tertiary hover:text-text-primary">
            {revealToken ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => status?.token && copy(status.token, "Token")} type="button" aria-label="Copy token" title="Copy token" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-text-muted hover:bg-background-tertiary hover:text-text-primary">
            {<Copy size={14} aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleRotate} type="button" aria-label="Rotate token" title="Rotate token" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-text-muted hover:bg-background-tertiary hover:text-text-primary">
            {<RefreshCw size={14} aria-hidden />}
          </Button>
        </div>

        <Button onClick={handleTest} type="button" aria-label={(testing ? "Testing..." : "Test connection").trim() || undefined} disabled={(testing)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Wifi size={14} aria-hidden />}</span>
          <span className="truncate">{testing ? "Testing..." : "Test connection"}</span>
        </Button>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-3">
        <div>
          <span className="block text-fg text-sm font-medium">
            Available Workflows
          </span>
          <span className="block text-fg-2 font-normal mt-0.5 text-xs">
            The live catalog includes focused tools for each desktop workspace.
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Video Editor", "Tracks, clips, effects, transitions, audio and subtitles"],
            ["Motion Creator", "Layers, animation, shaders, masks, effects and render queue"],
            ["Creation & 3D", "Scenes, products, materials, cameras, rigging and previews"],
            ["Project Operations", "Inspect, import, save, undo, export and diagnostics"],
          ].map(([label, description]) => (
            <div key={label} className="rounded-md border border-border bg-background px-3 py-2.5">
              <span className="block text-fg text-xs font-medium">
                {label}
              </span>
              <span className="block text-fg-2 font-normal mt-1 text-[11px] leading-4">
                {description}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-4">
        <div>
          <span className="block text-fg text-sm font-medium">
            Client Setup
          </span>
          <span className="block text-fg-2 font-normal mt-0.5 text-xs">
            Pick your client. The shim connects to the running app automatically and survives token rotation and app
            restarts. OpenReel does not need to be open in front.
          </span>
        </div>
        <ConnectSnippets status={status} />
      </div>

      <div className="h-px bg-border" />

      <AllowedRootsEditor />

      <div className="h-px bg-border" />

      <div className="space-y-4">
        <span className="block text-fg text-sm font-medium">
          Trusted Local
        </span>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-fg-2 font-normal text-sm">
              Allow agents to delete and export without asking
            </span>
            <span className="block text-fg-2 font-normal mt-0.5 max-w-md text-xs">
              When off, destructive or expensive tool calls over MCP
              are refused with a confirmation-required notice. Turn on only if you
              trust every connected local client.
            </span>
          </div>
          <Switch
            aria-label="Allow agents to delete and export without asking"
            checked={mcpAutoAllow}
            onCheckedChange={setMcpAutoAllow}
          />
        </div>
      </div>
    </div>
  );
};
