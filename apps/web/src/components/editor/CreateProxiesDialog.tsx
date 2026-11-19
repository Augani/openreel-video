import React, { useEffect, useState } from "react";
import {
  PROXY_PRESETS,
  proxyPresetForProfile,
  resolveDesktopProxyProfile,
  type ProxyPresetId,
} from "@openreel/core";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, RadioGroup, RadioGroupItem, cn } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { setDesktopProxyProfile } from "../../services/desktop-ingest";

interface CreateProxiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many items the proxies will be built for. */
  count: number;
  /** Selected items, or every item that lacks a proxy. */
  scopeLabel: string;
  /** Builds the proxies once the chosen preset is saved to the project. */
  onCreate: () => void;
}

/** Create Proxies dialog (desktop): pick a preset, save it with the project, then build. */
export const CreateProxiesDialog: React.FC<CreateProxiesDialogProps> = ({ open, onOpenChange, count, scopeLabel, onCreate }) => {
  const ingestConfig = useProjectStore((s) => s.project.mediaLibrary.desktopIngest);
  const current = proxyPresetForProfile(resolveDesktopProxyProfile({ mediaLibrary: { items: [], desktopIngest: ingestConfig } }));
  const [choice, setChoice] = useState<ProxyPresetId>(current ?? "h264-half");
  useEffect(() => {
    if (open && current) setChoice(current);
  }, [open, current]);

  const submit = async (): Promise<void> => {
    const preset = PROXY_PRESETS.find((entry) => entry.id === choice) ?? PROXY_PRESETS[1];
    if (current !== preset.id) await setDesktopProxyProfile(preset.profile);
    onOpenChange(false);
    onCreate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="create-proxies-dialog">
        <DialogHeader>
          <DialogTitle>Create Proxies</DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            {count} {count === 1 ? "clip" : "clips"} ({scopeLabel}). The preset is saved with this project and used for new imports.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup aria-label="Proxy preset" value={choice} onValueChange={(value) => setChoice(value as ProxyPresetId)} className="grid gap-2">
          {PROXY_PRESETS.map((preset) => (
            <Label
              key={preset.id}
              htmlFor={`proxy-preset-${preset.id}`}
              data-testid={`proxy-preset-${preset.id}`}
              data-selected={choice === preset.id ? "true" : undefined}
              className={cn(
                "block cursor-pointer rounded-md border border-border bg-bg-1 px-3 py-2 text-left transition-colors hover:bg-bg-2 focus-within:ring-2 focus-within:ring-ring",
                choice === preset.id && "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
              )}
            >
              <RadioGroupItem id={`proxy-preset-${preset.id}`} value={preset.id} aria-label={preset.label} className="sr-only" />
              <span className="block text-[12px] font-semibold text-fg">{preset.label}</span>
              <span className="mt-0.5 block text-[10px] leading-snug text-fg-muted">{preset.description}</span>
            </Label>
          ))}
        </RadioGroup>
        <p className="text-[10px] leading-snug text-fg-muted">Proxies are for editing only. Exports always read the full-resolution media.</p>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={count === 0} data-testid="create-proxies-confirm">Create proxies</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
