import React, { useEffect, useMemo, useState } from "react";
import {
  allIngestPresets,
  describeDesktopProxyProfile,
  presetMatchingProfile,
  resolveDesktopProxyProfile,
  type DesktopProxyProfile,
} from "@openreel/core";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, RadioGroup, RadioGroupItem, cn } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { setDesktopProxyProfile } from "../../services/desktop-ingest";
import { useIngestPresetsStore } from "../../services/ingest-presets-store";

interface CreateProxiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many items the proxies will be built for. */
  count: number;
  /** Selected items, or every item that lacks a proxy. */
  scopeLabel: string;
  /** Builds the proxies. `profile` is the preset chosen for this batch only; null = the project's preset (already saved). */
  onCreate: (profile: DesktopProxyProfile | null) => void;
  /** Open the preset manager. */
  onManage?: () => void;
}

/** Create Proxies dialog (desktop): pick a preset for this batch, and optionally keep it as the project's preset. */
export const CreateProxiesDialog: React.FC<CreateProxiesDialogProps> = ({ open, onOpenChange, count, scopeLabel, onCreate, onManage }) => {
  const ingestConfig = useProjectStore((s) => s.project.mediaLibrary.desktopIngest);
  const user = useIngestPresetsStore((s) => s.presets);
  const presets = useMemo(() => allIngestPresets(user), [user]);
  const projectProfile = resolveDesktopProxyProfile({ mediaLibrary: { items: [], desktopIngest: ingestConfig } });
  const current = presetMatchingProfile(user, projectProfile, ingestConfig?.proxyPresetId);
  const [choice, setChoice] = useState<string>(current?.id ?? "h264-half");
  const [keep, setKeep] = useState(true);
  useEffect(() => {
    if (open) {
      setChoice(current?.id ?? "h264-half");
      setKeep(true);
    }
  }, [open, current?.id]);

  const submit = async (): Promise<void> => {
    const preset = presets.find((entry) => entry.id === choice) ?? presets[0];
    const same = current?.id === preset.id;
    if (keep && !same) await setDesktopProxyProfile(preset.profile, preset.id);
    onOpenChange(false);
    onCreate(keep || same ? null : preset.profile);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="create-proxies-dialog">
        <DialogHeader>
          <DialogTitle>Create Proxies</DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            {count} {count === 1 ? "clip" : "clips"} ({scopeLabel}). Pick a preset for this batch.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup aria-label="Proxy preset" value={choice} onValueChange={setChoice} className="grid max-h-72 gap-2 overflow-y-auto">
          {presets.map((preset) => (
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
              <RadioGroupItem id={`proxy-preset-${preset.id}`} value={preset.id} aria-label={preset.name} className="sr-only" />
              <span className="block text-[12px] font-semibold text-fg">{preset.name}</span>
              <span className="mt-0.5 block text-[10px] leading-snug text-fg-muted">{describeDesktopProxyProfile(preset.profile)}</span>
            </Label>
          ))}
        </RadioGroup>
        <label className="flex items-center gap-1.5 text-[11px] text-fg-2">
          <input type="checkbox" aria-label="Use as the project's preset" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
          Also use it as this project's preset for new imports
        </label>
        <p className="text-[10px] leading-snug text-fg-muted">Proxies are for editing only. Exports always read the full-resolution media.</p>
        <DialogFooter>
          {onManage && <Button type="button" variant="secondary" onClick={onManage}>Manage presets…</Button>}
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={count === 0} data-testid="create-proxies-confirm">Create proxies</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
