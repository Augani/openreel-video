import { describe, expect, it } from "vitest";
import { MEDIA_LABELS } from "@openreel/core/media/bins";
import { AUDIO_TYPE_LABELS } from "@openreel/core/audio/essential-sound";
import { TIME_INTERPOLATION_LABELS } from "@openreel/core/video/time-interpolation/types";
import { KEYFRAME_INTERPOLATION_LABELS } from "@openreel/core/animation/keyframe-interpolation";
import { SPATIAL_INTERPOLATION_LABELS } from "@openreel/core/animation/spatial-path";
import { SEQUENCE_COLOR_SPACES } from "@openreel/core/color/sequence-color";
import { translate } from "@openreel/i18n/translate";
import { getQuickExportPresets } from "../services/quick-export-presets";

const GRAPHICS_WHITE = ["100 nits", "150 nits", "203 nits (BT.2408, default)", "300 nits", "400 nits"];
const START_TIMECODES = ["00:00:00:00 (default)", "01:00:00:00", "10:00:00:00 (broadcast)"];
const SEQUENCE_COLOR_CHOICES = [...SEQUENCE_COLOR_SPACES.map((space) => space.label), "Rec.2020 (wide gamut SDR)"];
const QUICK_EXPORT_PRESETS = getQuickExportPresets({ width: 1920, height: 1080, frameRate: 30 });

function descriptionVars(preset: (typeof QUICK_EXPORT_PRESETS)[number]) {
  return preset.kind === "video"
    ? { width: preset.settings.width, height: preset.settings.height, fps: preset.settings.frameRate }
    : undefined;
}

describe("dynamic menu label tables", () => {
  it("has a zh-CN entry for every label the menus render through t(variable)", () => {
    const values = new Set<string>([
      ...MEDIA_LABELS.map((label) => label.name),
      ...Object.values(AUDIO_TYPE_LABELS),
      ...Object.values(TIME_INTERPOLATION_LABELS),
      ...Object.values(KEYFRAME_INTERPOLATION_LABELS),
      ...Object.values(SPATIAL_INTERPOLATION_LABELS),
      ...QUICK_EXPORT_PRESETS.map((preset) => preset.label),
      ...GRAPHICS_WHITE,
      ...START_TIMECODES,
      ...SEQUENCE_COLOR_CHOICES,
    ]);

    const missing = [...values].filter((value) => translate("zh-CN", value) === value);
    expect(missing).toEqual([]);
  });

  it("has a zh-CN entry for every quick-export description, including the templated MP4 one", () => {
    const rendered = QUICK_EXPORT_PRESETS.map((preset) =>
      translate("zh-CN", preset.description, descriptionVars(preset)),
    );
    const missing = QUICK_EXPORT_PRESETS
      .filter((preset, index) => rendered[index] === preset.description)
      .map((preset) => preset.description);
    expect(missing).toEqual([]);
    expect(rendered.filter((description) => /\{\w+\}/.test(description))).toEqual([]);
  });
});
