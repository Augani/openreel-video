import React from "react";
import { v4 as uuidv4 } from "uuid";
import { useProjectStore } from "../../../stores/project-store";
import { useOcioInspection } from "../../../services/ocio-inspection";

const sectionTitle = "text-[10px] font-semibold uppercase tracking-wide text-fg-3";

/** OCIO mode: the colour space of the config this clip's pixels are in (one undoable clip edit). */
const OcioClipInputPicker: React.FC<{ clipId: string }> = ({ clipId }) => {
  const ocio = useProjectStore((s) => s.project.settings.ocio);
  const override = useProjectStore((s) => s.getClip(clipId)?.ocioInputSpace);
  const inspection = useOcioInspection(ocio);
  const spaces = inspection && !("error" in inspection) ? inspection.spaces.filter((s) => !s.isData && s.referenceSpaceType === "scene" && !s.problem) : [];

  const change = (next: string): void => {
    void useProjectStore.getState().executeAction({
      type: "clip/setOcioInputSpace",
      id: uuidv4(),
      timestamp: Date.now(),
      params: { clipId, ocioInputSpace: next === "" ? null : next },
    });
  };

  return (
    <div className="space-y-2" data-testid="ocio-clip-input">
      <div className={sectionTitle}>OCIO input colour space (this clip)</div>
      <select
        aria-label="OCIO input colour space for this clip"
        value={override ?? ""}
        onChange={(e) => change(e.target.value)}
        className="h-7 w-full min-w-0 rounded-[6px] border border-border bg-bg-1 px-2 text-[11px] text-fg"
        data-testid="ocio-clip-input-select"
      >
        <option value="">{`Project default${ocio ? ` (${ocio.defaultInputSpace})` : ""}`}</option>
        {spaces.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
        {override && !spaces.some((s) => s.name === override) && <option value={override}>{`${override} (not available)`}</option>}
      </select>
      <div className="text-[9px] leading-snug text-fg-3">
        The pixels of this clip are read as this colour space of the loaded OCIO config and converted to the working space. Set the project
        default, the display, view and looks in Preview options &gt; Color management &gt; OCIO configuration.
      </div>
    </div>
  );
};

export default OcioClipInputPicker;
