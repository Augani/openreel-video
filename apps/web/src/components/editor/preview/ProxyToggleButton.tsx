import { Gauge } from "@/icons/lucide-compat";
import { Button } from "@openreel/ui";
import { usePreviewProxyStore } from "../../../stores/preview-proxy-store";
import { toggleProxies } from "../../../services/proxy-ingest";
import { toast } from "../../../stores/notification-store";

/** Toggle Proxies (Shift+P): decode proxies for preview/scrub/playback, or the full-resolution media. */
export function toggleProxiesWithFeedback(): void {
  const on = toggleProxies();
  toast.info(
    on ? "Proxies on" : "Proxies off",
    on ? "Preview uses proxies where they exist. Export always uses full resolution." : "Preview decodes the full-resolution media.",
  );
}

/** Program monitor header button for Toggle Proxies. */
export function ProxyToggleButton() {
  const on = usePreviewProxyStore((state) => state.proxiesOn);
  const ready = usePreviewProxyStore((state) => Object.values(state.entries).filter((entry) => entry.status === "ready").length);
  return (
    <Button
      variant={on ? "secondary" : "ghost"}
      aria-label="Toggle proxies"
      aria-pressed={on}
      data-testid="toggle-proxies"
      title={`Toggle proxies (Shift+P): ${on ? "preview is using proxies" : "preview is using full-resolution media"}${ready ? ` · ${ready} ready` : ""}. Exports always use full resolution.`}
      onClick={toggleProxiesWithFeedback}
      className={`workspace-preview-guides relative h-7 w-7 p-0 ${on ? "text-accent bg-accent-soft" : ""}`}
    >
      <Gauge size={14} aria-hidden />
      {ready > 0 && <span aria-hidden className={`absolute right-0.5 top-0.5 size-1.5 rounded-full ${on ? "bg-accent" : "bg-fg-muted"}`} />}
    </Button>
  );
}
