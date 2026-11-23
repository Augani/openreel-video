import React, { useMemo } from "react";
import {
  CAMERA_FOOTAGE_COLOR_PRESETS,
  FOOTAGE_COLOR_PRESETS,
  cameraPresetOf,
  describeSourceColor,
  inputSpaceForItem,
  type FootageColorPreset,
} from "@openreel/core";
import { v4 as uuidv4 } from "uuid";
import { useProjectStore } from "../../../../stores/project-store";
import { applyFootageInterpretation, runOrganize } from "../../../../services/project-panel-commands";
import OcioClipInputPicker from "../../ocio/OcioClipInputPicker";

const sectionTitle = "text-[10px] font-semibold uppercase tracking-wide text-fg-3";

/**
 * "Camera input": the camera log transform for the footage under the selected clip. It is the same setting as
 * Interpret Footage > Camera input (one undoable media edit), so the preview, scopes and export all read one value.
 * The transform runs first, before the Input LUT and the grade, and is formula based (no LUT file).
 */
const CameraInputPicker: React.FC<{ clipId: string }> = ({ clipId }) => {
  const mediaId = useProjectStore((s) => s.getClip(clipId)?.mediaId);
  const media = useProjectStore((s) => (mediaId ? s.project.mediaLibrary.items.find((i) => i.id === mediaId) : undefined));
  const clipOverride = useProjectStore((s) => s.getClip(clipId)?.colorInterpretation);
  const makers = useMemo(() => [...new Set(CAMERA_FOOTAGE_COLOR_PRESETS.map((p) => p.camera!.maker))], []);

  if (!media || media.type === "audio") return null;
  const current = media.colorInterpretation;
  const camera = cameraPresetOf(current);
  const otherOverride = current && !camera ? FOOTAGE_COLOR_PRESETS.find((p) => p.id === current) : undefined;
  const value = camera ? camera.id : otherOverride ? otherOverride.id : "tagged";
  const transforming = inputSpaceForItem(media) !== null;
  const aces = useProjectStore((s) => s.project.settings.colorManagement === "aces");

  const change = (next: string) => {
    const color: FootageColorPreset | null = next === "tagged" ? null : (next as FootageColorPreset);
    void runOrganize("Camera input", applyFootageInterpretation([media.id], { color }));
  };

  const changeClip = (next: string) => {
    const colorInterpretation: FootageColorPreset | null = next === "footage" ? null : (next as FootageColorPreset);
    void useProjectStore.getState().executeAction({
      type: "clip/setColorInterpretation",
      id: uuidv4(),
      timestamp: Date.now(),
      params: { clipId, colorInterpretation },
    });
  };

  return (
    <div className="space-y-2" data-testid="camera-input">
      <div className={sectionTitle}>Camera input</div>
      <select
        aria-label="Camera input"
        value={value}
        onChange={(e) => change(e.target.value)}
        className="h-7 w-full min-w-0 rounded-[6px] border border-border bg-bg-1 px-2 text-[11px] text-fg"
        data-testid="camera-input-select"
      >
        <option value="tagged">None (as tagged)</option>
        {makers.map((maker) => (
          <optgroup key={maker} label={maker}>
            {CAMERA_FOOTAGE_COLOR_PRESETS.filter((p) => p.camera!.maker === maker).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
        ))}
        {otherOverride && <option value={otherOverride.id}>{otherOverride.label} (Interpret Footage)</option>}
      </select>
      <div className={sectionTitle}>This clip only</div>
      <select
        aria-label="Input color space for this clip"
        value={clipOverride ?? "footage"}
        onChange={(e) => changeClip(e.target.value)}
        className="h-7 w-full min-w-0 rounded-[6px] border border-border bg-bg-1 px-2 text-[11px] text-fg"
        data-testid="clip-input-select"
      >
        <option value="footage">Use the footage setting</option>
        {FOOTAGE_COLOR_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <div className="text-[9px] leading-snug text-fg-3" data-testid="camera-input-status">
        {camera
          ? `${describeSourceColor(camera.space)} to ${aces ? "ACEScg (ACES input transform)" : "Rec.709"}. A built-in formula, applied to every clip of "${media.name}" before the Input LUT and the grade, in the preview, scopes and export.`
          : transforming
            ? "Footage is converted with its Interpret Footage setting."
            : "Pick the camera that shot this clip to convert its log footage to Rec.709. Leave on None for footage that is already Rec.709."}
      </div>
    </div>
  );
};

/** In OCIO mode the input is a colour space of the loaded config, picked per clip; otherwise the built-in camera presets. */
const InputPicker: React.FC<{ clipId: string }> = ({ clipId }) => {
  const ocio = useProjectStore((s) => s.project.settings.colorManagement === "ocio");
  return ocio ? <OcioClipInputPicker clipId={clipId} /> : <CameraInputPicker clipId={clipId} />;
};

export default InputPicker;
