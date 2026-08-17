import React, { useState, useEffect, useCallback } from "react";
import { Plug, Eye, EyeOff, Copy, RefreshCw, Wifi } from "@/icons/lucide-compat";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useSettingsStore } from "../../../stores/settings-store";
import { toast } from "../../../stores/notification-store";
import type { OpenReelMcpStatus } from "../../../types/global";
import { useTranslation } from "react-i18next";

const isDesktop = (): boolean =>
  typeof window !== "undefined" && window.openreel?.platform === "desktop";

function clientConfigSnippet(shimPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        openreel: {
          command: "node",
          args: [shimPath || "<path to openreel-mcp shim>"],
        },
      },
    },
    null,
    2,
  );
}

async function copy(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Copy failed", "Clipboard is unavailable.");
  }
}

export const McpPanel: React.FC = () => {
  const { t } = useTranslation();
  const mcpAutoAllow = useSettingsStore((s) => s.mcpAutoAllowTrustedLocal);
  const setMcpAutoAllow = useSettingsStore((s) => s.setMcpAutoAllowTrustedLocal);

  const [status, setStatus] = useState<OpenReelMcpStatus | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [revealToken, setRevealToken] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    try {
      const nextStatus = await bridge.getStatus();
      setStatus(nextStatus);
      if (nextStatus.running) {
        const connection = await bridge.testConnection();
        setToolCount(connection.ok ? (connection.toolCount ?? 0) : null);
      } else {
        setToolCount(null);
      }
    } catch {
      setStatus(null);
      setToolCount(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRotate = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    try {
      setStatus(await bridge.rotateToken());
      toast.success("Token rotated", "Update your MCP clients with the new token.");
    } catch (err) {
      toast.error("Rotate failed", err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

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
  }, []);

  if (!isDesktop()) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Plug size={28} className="mb-3 text-text-muted" />
        <Text type="body" color="primary" className="text-sm font-medium">
          {t("Desktop only")}</Text>
        <Text type="supporting" color="secondary" className="mt-1 max-w-sm text-xs">
          {t("The MCP server runs inside the OpenReel desktop app, letting external AI clients (Claude Desktop, Cursor, Cline) edit your project. Open OpenReel on desktop to configure it.")}</Text>
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
          <Text type="body" color="primary" className="text-sm font-medium">
            {t("MCP Server")}</Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            {t("A local Model Context Protocol server lets AI clients drive this editor through the same tools as the built-in chat. It listens on loopback only and requires the bearer token below.")}</Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            {t("Status")}</Text>
          <Text
            type="supporting"
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              status?.running ? "text-status-success" : "text-text-muted"
            }`}
          >
            <i
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                status?.running ? "bg-status-success" : "bg-text-muted"
              }`}
            />
            {status?.running ? "Running" : "Stopped"}
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            {t("Tools")}</Text>
          <Text type="supporting" color="secondary" className="text-xs">
            {toolCount === null
              ? status?.running
                ? "Checking catalog…"
                : "—"
              : `${toolCount} available`}
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            {t("URL")}</Text>
          <code className="flex-1 font-mono text-xs bg-background rounded px-3 py-2 text-text-secondary truncate">
            {status?.url || "—"}
          </code>
          <IconButton
            label={t("Copy URL")}
            onClick={() => status?.url && copy(status.url, "URL")}
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            {t("Token")}</Text>
          <code className="flex-1 font-mono text-xs bg-background rounded px-3 py-2 text-text-secondary truncate">
            {tokenDisplay}
          </code>
          <IconButton
            label={revealToken ? t("Hide token") : t("Show token")}
            onClick={() => setRevealToken((v) => !v)}
            variant="ghost"
            size="sm"
            icon={revealToken ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
          <IconButton
            label={t("Copy token")}
            onClick={() => status?.token && copy(status.token, "Token")}
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
          <IconButton
            label={t("Rotate token")}
            onClick={handleRotate}
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>

        <Button
          label={testing ? t("Testing...") : t("Test connection")}
          size="sm"
          variant="secondary"
          onClick={handleTest}
          isDisabled={testing}
          icon={<Wifi size={14} aria-hidden />}
        />
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-3">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            {t("Available Workflows")}</Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            {t("The live catalog includes focused tools for each desktop workspace.")}</Text>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Video Editor", "Tracks, clips, effects, transitions, audio and subtitles"],
            ["Motion Creator", "Layers, animation, shaders, masks, effects and render queue"],
            ["Creation & 3D", "Scenes, products, materials, cameras, rigging and previews"],
            ["Project Operations", "Inspect, import, save, undo, export and diagnostics"],
          ].map(([label, description]) => (
            <div key={label} className="rounded-md border border-border bg-background px-3 py-2.5">
              <Text type="supporting" color="primary" className="text-xs font-medium">
                {label}
              </Text>
              <Text type="supporting" color="secondary" className="mt-1 text-[11px] leading-4">
                {description}
              </Text>
            </div>
          ))}
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            {t("Client Setup")}</Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            {t("Add this to your MCP client config (Claude Desktop, Cursor, Cline). The shim connects to the running app automatically.")}</Text>
        </div>
        <div className="relative">
          <pre className="overflow-x-auto rounded bg-background px-3 py-2 font-mono text-[11px] text-text-secondary">
            {clientConfigSnippet(status?.shimPath ?? "")}
          </pre>
          <IconButton
            label={t("Copy config")}
            onClick={() =>
              copy(clientConfigSnippet(status?.shimPath ?? ""), "Config")
            }
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="absolute right-2 top-2 text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-4">
        <Text type="body" color="primary" className="text-sm font-medium">
          {t("Trusted Local")}</Text>
        <div className="flex items-center justify-between">
          <div>
            <Text type="supporting" color="secondary" className="text-sm">
              {t("Auto-allow destructive actions")}</Text>
            <Text type="supporting" color="secondary" className="mt-0.5 max-w-md text-xs">
              {t("When off, destructive or expensive tool calls over MCP are refused with a confirmation-required notice. Turn on only if you trust every connected local client.")}</Text>
          </div>
          <ToolcraftSwitchControl
            ariaLabel={t("Auto-allow destructive actions")}
            checked={mcpAutoAllow}
            onCheckedChange={setMcpAutoAllow}
            showLabel={false}
          />
        </div>
      </div>
    </div>
  );
};
