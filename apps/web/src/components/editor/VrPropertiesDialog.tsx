import React from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@openreel/ui";
import {
  VR_LAYOUTS,
  describeVrProperties,
  normalizeVrProperties,
  validateVrProperties,
  type VrFrameLayout,
  type VrProperties,
  type VrProjection,
} from "@openreel/core";

/**
 * VR Properties (Premiere: Sequence Settings > VR Properties, Interpret Footage > VR Properties): the projection of
 * the picture, the frame layout of stereo footage and the captured view. Used for the sequence and for a clip's source.
 */
const LAYOUT_LABELS: Record<VrFrameLayout, string> = {
  mono: "Monoscopic",
  "over-under": "Stereoscopic - over/under",
  "side-by-side": "Stereoscopic - side by side",
};

export const VrPropertiesDialog: React.FC<{
  title: string;
  subtitle?: string;
  /** The properties in force now. */
  value: VrProperties | undefined;
  /** What the file's metadata (or its 2:1 shape) suggested; shown as a hint with a "use detected" button. */
  detected?: VrProperties;
  /** Called with the new properties; null clears them. */
  onApply: (vr: VrProperties | null) => void;
  onClose: () => void;
}> = ({ title, subtitle, value, detected, onApply, onClose }) => {
  const initial = normalizeVrProperties(value);
  const [projection, setProjection] = React.useState<VrProjection>(initial.projection);
  const [layout, setLayout] = React.useState<VrFrameLayout>(initial.layout);
  const [hFov, setHFov] = React.useState(String(initial.horizontalFov));
  const [vFov, setVFov] = React.useState(String(initial.verticalFov));
  const [heading, setHeading] = React.useState(String(initial.initialView?.yaw ?? 0));
  const [pitch, setPitch] = React.useState(String(initial.initialView?.pitch ?? 0));
  const [roll, setRoll] = React.useState(String(initial.initialView?.roll ?? 0));
  const draft = { projection, layout, horizontalFov: Number(hFov), verticalFov: Number(vFov), initialView: { yaw: Number(heading), pitch: Number(pitch), roll: Number(roll) } };
  const error = projection === "none" ? null : validateVrProperties(draft);
  const off = projection === "none";

  const apply = () => {
    if (error) return;
    onClose();
    onApply(off ? null : normalizeVrProperties(draft));
  };

  const useDetected = () => {
    if (!detected) return;
    setProjection(detected.projection);
    setLayout(detected.layout);
    setHFov(String(detected.horizontalFov));
    setVFov(String(detected.verticalFov));
    setHeading(String(detected.initialView?.yaw ?? 0));
    setPitch(String(detected.initialView?.pitch ?? 0));
    setRoll(String(detected.initialView?.roll ?? 0));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[440px] border-border bg-bg-1 text-fg" data-testid="vr-properties-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate">{subtitle ?? "Immersive video (360 / VR) properties"}</DialogDescription>
        </DialogHeader>
        {detected ? (
          <p className="text-xs text-fg-3" data-testid="vr-detected">
            {detected.source === "metadata" ? "Detected from the file's spherical metadata" : "This picture is 2:1, which is typical of equirectangular 360 video"}:{" "}
            {describeVrProperties(detected)}.{" "}
            <button type="button" className="underline" onClick={useDetected} data-testid="vr-use-detected">
              Use detected
            </button>
          </p>
        ) : null}
        <div className="grid grid-cols-[130px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs">
          <label htmlFor="vr-projection" className="text-fg-3">Projection</label>
          <select id="vr-projection" data-testid="vr-projection" value={projection} onChange={(e) => setProjection(e.target.value as VrProjection)} className="h-7 w-full rounded border border-border bg-bg-2 px-1">
            <option value="none">None (flat)</option>
            <option value="equirectangular">Equirectangular</option>
          </select>
          <label htmlFor="vr-layout" className="text-fg-3">Layout</label>
          <select id="vr-layout" data-testid="vr-layout" disabled={off} value={layout} onChange={(e) => setLayout(e.target.value as VrFrameLayout)} className="h-7 w-full rounded border border-border bg-bg-2 px-1 disabled:opacity-50">
            {VR_LAYOUTS.map((l) => (
              <option key={l} value={l}>{LAYOUT_LABELS[l]}</option>
            ))}
          </select>
          <label htmlFor="vr-hfov" className="text-fg-3">Captured view (horizontal)</label>
          <input id="vr-hfov" data-testid="vr-hfov" disabled={off} inputMode="decimal" value={hFov} onChange={(e) => setHFov(e.target.value)} className="h-7 w-full rounded border border-border bg-bg-2 px-1 disabled:opacity-50" />
          <label htmlFor="vr-vfov" className="text-fg-3">Captured view (vertical)</label>
          <input id="vr-vfov" data-testid="vr-vfov" disabled={off} inputMode="decimal" value={vFov} onChange={(e) => setVFov(e.target.value)} className="h-7 w-full rounded border border-border bg-bg-2 px-1 disabled:opacity-50" />
          <label htmlFor="vr-heading" className="text-fg-3">Initial view heading</label>
          <input id="vr-heading" data-testid="vr-heading" disabled={off} inputMode="decimal" value={heading} onChange={(e) => setHeading(e.target.value)} className="h-7 w-full rounded border border-border bg-bg-2 px-1 disabled:opacity-50" />
          <label htmlFor="vr-pitch" className="text-fg-3">Initial view pitch</label>
          <input id="vr-pitch" data-testid="vr-pitch" disabled={off} inputMode="decimal" value={pitch} onChange={(e) => setPitch(e.target.value)} className="h-7 w-full rounded border border-border bg-bg-2 px-1 disabled:opacity-50" />
          <label htmlFor="vr-roll" className="text-fg-3">Initial view roll</label>
          <input id="vr-roll" data-testid="vr-roll" disabled={off} inputMode="decimal" value={roll} onChange={(e) => setRoll(e.target.value)} className="h-7 w-full rounded border border-border bg-bg-2 px-1 disabled:opacity-50" />
        </div>
        {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
        <p className="text-[11px] text-fg-3">
          A VR sequence exports with spherical metadata (MP4 / MOV, V2 and V1) so YouTube and 360 players recognise it; the initial view is where a player first looks. The VR view in the Program and Source monitors never changes the export.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={apply} disabled={Boolean(error)} data-testid="vr-apply">Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
