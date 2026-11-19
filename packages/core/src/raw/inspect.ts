import { developedSize } from "./develop";
import type { DngRaw } from "./dng";
import { defaultRawSettings } from "./settings";
import { asShotKelvinTint } from "./color";
import type { RawInspection } from "./raw-media";

export function describeCfa(raw: DngRaw): string {
  return raw.samplesPerPixel === 3 ? "RGB" : raw.cfa.map((c) => "RGB"[c]).join("");
}

export function inspectDngRaw(raw: DngRaw): RawInspection {
  const settings = defaultRawSettings(raw);
  const size = developedSize(raw, settings);
  const asShot = asShotKelvinTint(raw);
  return {
    info: {
      format: "dng",
      developedBy: "openreel",
      make: raw.make,
      model: raw.model,
      bitDepth: raw.bitsPerSample,
      cfa: describeCfa(raw),
      settings,
      asShot: { temperature: asShot.kelvin, tint: asShot.tint },
    },
    width: size.width,
    height: size.height,
  };
}
