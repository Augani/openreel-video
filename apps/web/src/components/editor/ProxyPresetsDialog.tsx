import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@openreel/ui";
import {
  CUSTOM_PROXY_WIDTH_MAX,
  CUSTOM_PROXY_WIDTH_MIN,
  DESKTOP_PROXY_CODECS,
  DESKTOP_PROXY_SIZES,
  allIngestPresets,
  describeDesktopProxyProfile,
  normalizeProxyProfile,
  type DesktopProxyCodec,
  type DesktopProxyDestinationMode,
  type DesktopProxyProfile,
  type DesktopProxySize,
} from "@openreel/core";
import { pickPresetFolder } from "../../services/desktop-ingest";
import { useIngestPresetsStore } from "../../services/ingest-presets-store";

interface ProxyPresetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preset to show first (the project's). */
  initialId?: string;
}

const DESTINATIONS: Array<{ id: DesktopProxyDestinationMode; label: string }> = [
  { id: "project", label: "The project's Proxies folder" },
  { id: "media", label: "Next to the media (a Proxies folder)" },
  { id: "custom", label: "A folder I choose" },
];

const fieldLabel = "block min-w-0 text-[11px] text-fg-muted";
const triggerClass = "mt-1 h-8 min-w-0 text-[11px]";

/** Manage proxy presets: built-ins are read-only (duplicate one to change it); your own presets can be created, edited, renamed and deleted. */
export const ProxyPresetsDialog: React.FC<ProxyPresetsDialogProps> = ({ open, onOpenChange, initialId }) => {
  const user = useIngestPresetsStore((s) => s.presets);
  const store = useIngestPresetsStore.getState;
  const all = useMemo(() => allIngestPresets(user), [user]);
  const [selectedId, setSelectedId] = useState(initialId ?? all[0].id);
  const selected = all.find((preset) => preset.id === selectedId) ?? all[0];
  const [name, setName] = useState(selected.name);
  const [profile, setProfile] = useState<DesktopProxyProfile>(selected.profile);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open && initialId && all.some((preset) => preset.id === initialId)) setSelectedId(initialId);
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    setName(selected.name);
    setProfile(selected.profile);
  }, [selected.id, selected.name, selected.profile]);
  // A message belongs to the preset it was shown for ("Saved." survives the re-render the save itself causes).
  useEffect(() => setMessage(null), [selected.id]);

  const readOnly = selected.builtIn;
  const dirty = !readOnly && (name.trim() !== selected.name || JSON.stringify(normalizeProxyProfile(profile)) !== JSON.stringify(normalizeProxyProfile(selected.profile)));
  const patch = (next: Partial<DesktopProxyProfile>): void => setProfile((current) => ({ ...current, ...next }));

  const fail = (error: string): void => setMessage(error);
  const save = (): void => {
    let working = selected;
    if (name.trim() !== selected.name) {
      const renamed = store().rename(selected.id, name);
      if (!renamed.ok) return fail(renamed.error);
      working = renamed.preset;
    }
    const updated = store().updateProfile(working.id, profile);
    if (!updated.ok) return fail(updated.error);
    setMessage("Saved.");
  };
  const duplicate = (): void => {
    const result = store().duplicate(selected.id);
    if (!result.ok) return fail(result.error);
    setSelectedId(result.preset.id);
  };
  const createNew = (): void => {
    let n = 1;
    const taken = new Set(all.map((preset) => preset.name.toLowerCase()));
    while (taken.has(`my preset ${n}`)) n++;
    const result = store().create(`My preset ${n}`, { codec: "h264", size: "half" });
    if (!result.ok) return fail(result.error);
    setSelectedId(result.preset.id);
  };
  const remove = (): void => {
    const result = store().remove(selected.id);
    if (!result.ok) return fail(result.error);
    setSelectedId(all[0].id);
  };
  const chooseFolder = async (): Promise<void> => {
    const folder = await pickPresetFolder();
    if (folder) patch({ destination: { mode: "custom", folder } });
  };

  const destination = profile.destination?.mode ?? "project";
  const burn = profile.burnIn ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="proxy-presets-dialog">
        <DialogHeader>
          <DialogTitle>Proxy presets</DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            A preset names a proxy format, size, audio, burn-in and destination. Your presets are kept in the app settings and shared by every project. Frame rate is always kept.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-3 sm:grid-cols-[13rem_1fr]">
          <div className="min-w-0">
            <ul className="max-h-72 space-y-1 overflow-y-auto pr-1" aria-label="Presets">
              {all.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    data-testid={`preset-row-${preset.id}`}
                    aria-current={preset.id === selected.id ? "true" : undefined}
                    onClick={() => setSelectedId(preset.id)}
                    className={cn("flex w-full min-w-0 items-center gap-1 rounded border border-border bg-bg-1 px-2 py-1.5 text-left text-[11px] hover:bg-bg-2", preset.id === selected.id && "border-accent bg-selected")}
                  >
                    <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                    {preset.builtIn && <span className="shrink-0 text-[10px] text-fg-muted">Built-in</span>}
                  </button>
                </li>
              ))}
            </ul>
            <Button type="button" variant="secondary" className="mt-2 h-7 w-full text-[11px]" onClick={createNew}>New preset</Button>
          </div>
          <div className="min-w-0 space-y-2" data-testid="preset-editor">
            <label className={fieldLabel}>
              Name
              <Input aria-label="Preset name" className="mt-1 h-8 text-[11px]" value={name} disabled={readOnly} onChange={(event) => setName(event.target.value)} maxLength={60} />
            </label>
            {readOnly && <p className="text-[10px] leading-snug text-fg-muted">Built-in presets cannot be changed. Duplicate it to make your own.</p>}
            <div className="grid grid-cols-2 gap-2">
              <label className={fieldLabel}>
                Format
                <Select value={profile.codec} disabled={readOnly} onValueChange={(value) => patch({ codec: value as DesktopProxyCodec })}>
                  <SelectTrigger aria-label="Preset format" className={triggerClass}><SelectValue /></SelectTrigger>
                  <SelectContent>{DESKTOP_PROXY_CODECS.map((codec) => <SelectItem key={codec.id} value={codec.id}>{codec.label}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className={fieldLabel}>
                Size
                <Select
                  value={profile.size}
                  disabled={readOnly}
                  onValueChange={(value) => {
                    const size = value as DesktopProxySize;
                    setProfile((current) => {
                      const { customWidth: _drop, ...rest } = current;
                      void _drop;
                      return size === "custom" ? { ...rest, size, customWidth: current.customWidth ?? 1280 } : { ...rest, size };
                    });
                  }}
                >
                  <SelectTrigger aria-label="Preset size" className={triggerClass}><SelectValue /></SelectTrigger>
                  <SelectContent>{DESKTOP_PROXY_SIZES.map((size) => <SelectItem key={size.id} value={size.id}>{size.label}</SelectItem>)}</SelectContent>
                </Select>
              </label>
            </div>
            {profile.size === "custom" && (
              <label className={fieldLabel}>
                Width in pixels ({CUSTOM_PROXY_WIDTH_MIN} to {CUSTOM_PROXY_WIDTH_MAX}; never larger than the source)
                <Input
                  aria-label="Custom width"
                  type="number"
                  min={CUSTOM_PROXY_WIDTH_MIN}
                  max={CUSTOM_PROXY_WIDTH_MAX}
                  className="mt-1 h-8 text-[11px]"
                  disabled={readOnly}
                  value={profile.customWidth ?? ""}
                  onChange={(event) => patch({ customWidth: Math.max(CUSTOM_PROXY_WIDTH_MIN, Math.min(CUSTOM_PROXY_WIDTH_MAX, Math.round(Number(event.target.value) || CUSTOM_PROXY_WIDTH_MIN))) })}
                />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className={fieldLabel}>
                Frame rate
                <div className="mt-1 flex h-8 items-center rounded border border-border bg-bg-1 px-2 text-fg-2">Keep source</div>
              </div>
              <label className={fieldLabel}>
                Audio
                <Select value={profile.audio ?? "keep"} disabled={readOnly} onValueChange={(value) => patch({ audio: value === "strip" ? "strip" : undefined })}>
                  <SelectTrigger aria-label="Preset audio" className={triggerClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Keep audio</SelectItem>
                    <SelectItem value="strip">Strip audio</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            <fieldset className="space-y-1 text-[11px] text-fg-muted" disabled={readOnly}>
              <legend>Burn-in (a viewing copy, not for delivery)</legend>
              <label className="flex items-center gap-1.5"><input type="checkbox" aria-label="Burn in clip name" checked={Boolean(burn.clipName)} onChange={(event) => patch({ burnIn: { ...burn, clipName: event.target.checked } })} /> Clip name</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" aria-label="Burn in timecode" checked={Boolean(burn.timecode)} onChange={(event) => patch({ burnIn: { ...burn, timecode: event.target.checked } })} /> Timecode</label>
            </fieldset>
            <label className={fieldLabel}>
              Destination
              <Select
                value={destination}
                disabled={readOnly}
                onValueChange={(value) => {
                  const mode = value as DesktopProxyDestinationMode;
                  if (mode === "custom") void chooseFolder();
                  else patch({ destination: { mode } });
                }}
              >
                <SelectTrigger aria-label="Preset destination" className={triggerClass}><SelectValue /></SelectTrigger>
                <SelectContent>{DESTINATIONS.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            {destination === "custom" && (
              <div className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 flex-1 truncate rounded border border-border bg-bg-1 px-1.5 py-1 text-[11px] text-fg-2" title={profile.destination?.folder}>{profile.destination?.folder ?? "No folder chosen"}</span>
                <Button type="button" variant="secondary" className="h-7 text-[11px]" disabled={readOnly} onClick={() => void chooseFolder()}>Choose…</Button>
              </div>
            )}
            <p className="text-[10px] leading-snug text-fg-muted" data-testid="preset-summary">{describeDesktopProxyProfile(profile)}</p>
            {message && <p role="status" className="text-[11px] text-fg-2" data-testid="preset-message">{message}</p>}
          </div>
        </div>
        <DialogFooter className="gap-1">
          <Button type="button" variant="secondary" onClick={duplicate}>Duplicate</Button>
          <Button type="button" variant="secondary" onClick={remove} disabled={readOnly}>Delete</Button>
          <Button type="button" onClick={save} disabled={!dirty} data-testid="preset-save">Save</Button>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProxyPresetsDialog;
