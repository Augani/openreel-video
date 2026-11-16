import { useRef, useState } from "react";
import { Plug } from "@/icons/lucide-compat";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
} from "@openreel/ui";
import { getPluginRegistry, type LoadedPlugin } from "@openreel/core";
import { useInstalledPlugins } from "../../../hooks/use-plugin-registry";
import { usePluginManagerStore } from "../../../stores/plugin-manager-store";
import {
  PLUGIN_FILE_ACCEPT,
  installPluginFromFiles,
  isDesktopPluginStorage,
  retryPlugin,
  uninstallPlugin,
} from "../../../services/plugin-service";
import { toast } from "../../../stores/notification-store";

interface Report {
  readonly kind: "success" | "error";
  readonly title: string;
  readonly lines: readonly string[];
}

function implementationBadges(plugin: LoadedPlugin): string {
  return [plugin.wgsl !== undefined ? "WebGPU shader" : null, plugin.cpu !== undefined ? "CPU worker" : null]
    .filter(Boolean)
    .join(" + ");
}

function PluginRow({ plugin }: { plugin: LoadedPlugin }) {
  const { manifest } = plugin;
  const health = getPluginRegistry().getHealth(manifest.id);
  const [busy, setBusy] = useState(false);
  return (
    <li
      data-testid={`plugin-row-${manifest.id}`}
      className="rounded-lg border border-border bg-bg-2 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-fg">{manifest.name}</span>
            <span className="text-[11px] text-fg-2">v{manifest.version}</span>
            <span className="text-[11px] text-fg-2">{manifest.category}</span>
          </div>
          {manifest.description ? (
            <p className="mt-1 text-xs leading-5 text-fg-2">{manifest.description}</p>
          ) : null}
          <p className="mt-1 text-[11px] text-fg-3">
            {manifest.id} · {implementationBadges(plugin)}
            {manifest.author ? ` · ${manifest.author}` : ""}
          </p>
          {health.state !== "ok" ? (
            <p
              role="status"
              data-testid={`plugin-health-${manifest.id}`}
              className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-bg-1 p-2 text-[11px] leading-4 text-fg-2"
            >
              {health.state === "failed"
                ? `${health.tripped ? "Bypassed after repeated failures" : "Last frame failed"}: ${health.error ?? "unknown error"}`
                : `Shader error, using the CPU fallback: ${health.gpuError ?? ""}`}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {health.tripped ? (
            <Button variant="secondary" size="sm" onClick={() => retryPlugin(manifest.id)}>
              Retry
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-label={`Uninstall ${manifest.name}`}
            onClick={async () => {
              setBusy(true);
              try {
                await uninstallPlugin(manifest.id);
                toast.success("Plugin uninstalled", `${manifest.name} was removed. Effects that use it are kept and will render again once it is reinstalled.`);
              } catch (error) {
                toast.error("Could not uninstall", error instanceof Error ? error.message : String(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Uninstall
          </Button>
        </div>
      </div>
    </li>
  );
}

export function ManagePluginsDialog() {
  const open = usePluginManagerStore((state) => state.open);
  const setOpen = usePluginManagerStore((state) => state.setOpen);
  const plugins = useInstalledPlugins();
  const [report, setReport] = useState<Report | null>(null);
  const [installing, setInstalling] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const desktop = isDesktopPluginStorage();

  const install = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    setInstalling(true);
    try {
      const result = await installPluginFromFiles(files);
      if (result.ok) {
        const { manifest } = result.plugin;
        setReport({
          kind: "success",
          title: result.replaced
            ? `Updated ${manifest.name} from v${result.replaced} to v${manifest.version}`
            : `Installed ${manifest.name} v${manifest.version}`,
          lines: result.warnings,
        });
      } else {
        setReport({ kind: "error", title: "This plugin could not be installed", lines: result.errors });
      }
    } catch (error) {
      setReport({
        kind: "error",
        title: "This plugin could not be installed",
        lines: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      setInstalling(false);
      if (fileInput.current) fileInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(640px,calc(100dvh-32px))] w-[calc(100vw-24px)] max-w-[640px] flex-col gap-0 overflow-hidden rounded-xl border-border bg-bg-1 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Plug size={18} className="text-primary" aria-hidden />
            Manage Plugins
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 text-fg-2">
            Install effect plugins (.orplugin) built with the OpenReel plugin SDK. Installed plugins appear in the
            Effects panel and are saved by id and version in your projects.
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <Button size="sm" disabled={installing} onClick={() => fileInput.current?.click()}>
            Install from file…
          </Button>
          <Button size="sm" variant="secondary" disabled={installing} onClick={() => folderInput.current?.click()}>
            Install from folder…
          </Button>
          {desktop ? (
            <Button size="sm" variant="secondary" onClick={() => void window.openreel?.plugins?.revealFolder()}>
              Open plugins folder
            </Button>
          ) : null}
          <input
            ref={fileInput}
            type="file"
            accept={PLUGIN_FILE_ACCEPT}
            multiple
            hidden
            data-testid="plugin-file-input"
            aria-label="Plugin file"
            onChange={(event) => void install(event.target.files)}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            // @ts-expect-error webkitdirectory is a non-standard attribute React passes through
            webkitdirectory=""
            aria-label="Plugin folder"
            onChange={(event) => void install(event.target.files)}
          />
        </div>
        {report ? (
          <div
            role={report.kind === "error" ? "alert" : "status"}
            data-testid="plugin-install-report"
            className={`mx-5 mt-3 shrink-0 rounded-md border p-3 text-xs leading-5 ${
              report.kind === "error" ? "border-red-500/40 bg-red-500/10 text-fg" : "border-border bg-bg-2 text-fg"
            }`}
          >
            <strong className="block">{report.title}</strong>
            {report.lines.map((line, index) => (
              <span key={index} className="block whitespace-pre-wrap text-fg-2">
                {line}
              </span>
            ))}
          </div>
        ) : null}
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 py-4">
            {plugins.length === 0 ? (
              <p className="py-8 text-center text-xs text-fg-2" data-testid="plugin-empty">
                No plugins installed yet.
              </p>
            ) : (
              <ul className="space-y-2" aria-label="Installed plugins">
                {plugins.map((plugin) => (
                  <PluginRow key={plugin.manifest.id} plugin={plugin} />
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
