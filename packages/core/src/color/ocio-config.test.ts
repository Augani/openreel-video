import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapOcioColorSpaces, OcioConfigError, parseOcioConfig } from "./ocio-config";
import { footageColorPresetSpace } from "./source-color";

// Serialised by OpenColorIO 2.6 from its builtin config cg-config-v2.1.0_aces-v1.3_ocio-v2.3 (see scripts/aces-reference.py).
const CG = readFileSync(new URL("./fixtures/cg-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio", import.meta.url), "utf8");

describe("OCIO config import: the builtin ACES 1.3 cg config", () => {
  const config = parseOcioConfig(CG);
  const mapping = mapOcioColorSpaces(config);

  it("reads the version, roles and all 15 colour spaces with their aliases", () => {
    expect(config.profileVersion).toBe("2.3");
    expect(config.roles.scene_linear).toBe("ACEScg");
    expect(config.roles.compositing_log).toBe("ACEScct");
    expect(config.colorSpaces.map((c) => c.name)).toEqual([
      "ACES2065-1", "ACEScc", "ACEScct", "ACEScg", "Linear P3-D65", "Linear Rec.2020", "Linear Rec.709 (sRGB)",
      "Gamma 1.8 Rec.709 - Texture", "Gamma 2.2 AP1 - Texture", "Gamma 2.2 Rec.709 - Texture", "Gamma 2.4 Rec.709 - Texture",
      "sRGB Encoded AP1 - Texture", "sRGB Encoded P3-D65 - Texture", "sRGB - Texture", "Raw",
    ]);
    const cct = config.colorSpaces.find((c) => c.name === "ACEScct")!;
    expect(cct.aliases).toEqual(["ACES - ACEScct", "acescct_ap1"]);
    expect(cct.builtinStyles).toEqual(["ACEScct_to_ACES2065-1"]);
    expect(cct.transformKinds).toContain("BuiltinTransform");
    expect(config.colorSpaces.find((c) => c.name === "Raw")!.isData).toBe(true);
  });

  it("maps the spaces that are one of the built-in analytic transforms", () => {
    const byName = new Map(mapping.supported.map((s) => [s.name, s]));
    expect(byName.get("ACEScg")).toMatchObject({ preset: "aces-acescg", via: "builtin-transform" });
    expect(byName.get("ACEScct")).toMatchObject({ preset: "aces-acescct", via: "builtin-transform" });
    expect(byName.get("ACES2065-1")).toMatchObject({ preset: "aces-aces2065", via: "name" });
    expect(byName.get("sRGB - Texture")?.preset).toBe("srgb");
    expect(byName.get("Linear Rec.709 (sRGB)")?.preset).toBe("linear-rec709");
    expect(byName.get("Linear Rec.2020")?.preset).toBe("linear-rec2020");
    expect(byName.get("Linear P3-D65")?.preset).toBe("linear-p3");
    expect(byName.get("sRGB Encoded P3-D65 - Texture")?.preset).toBe("p3");
    // Each mapped preset is a real Interpret Footage space.
    for (const s of mapping.supported) expect(() => footageColorPresetSpace(s.preset)).not.toThrow();
  });

  it("reports every other space as unsupported, with a reason", () => {
    const names = mapping.unsupported.map((u) => u.name);
    expect(names).toEqual(["ACEScc", "Gamma 1.8 Rec.709 - Texture", "Gamma 2.2 AP1 - Texture", "Gamma 2.2 Rec.709 - Texture", "Gamma 2.4 Rec.709 - Texture", "sRGB Encoded AP1 - Texture", "Raw"]);
    expect(mapping.supported.length + mapping.unsupported.length).toBe(15);
    for (const u of mapping.unsupported) expect(u.reason.length).toBeGreaterThan(10);
    expect(mapping.unsupported.find((u) => u.name === "Raw")!.reason).toMatch(/data/);
    expect(mapping.unsupported.find((u) => u.name === "ACEScc")!.reason).toMatch(/ACEScc_to_ACES2065-1/);
  });
});

const V1 = `ocio_profile_version: 1

search_path: luts
roles:
  reference: lin
  default: raw

displays:
  sRGB:
    - !<View> {name: Film, colorspace: lin}

colorspaces:
  - !<ColorSpace>
    name: lin
    family: ""
    equalitygroup: ""
    bitdepth: 32f
    isdata: false
    allocation: uniform

  - !<ColorSpace>
    name: Input - ARRI - V3 LogC (EI800) - Wide Gamut
    family: Input/ARRI
    isdata: false
    to_reference: !<GroupTransform>
      children:
        - !<FileTransform> {src: LogC_to_lin.spi1d, interpolation: linear}
        - !<MatrixTransform> {matrix: [0.68, 0.24, 0.07, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}

  - !<ColorSpace>
    name: Camera Log One
    aliases:
      - cam_log_one
      - "Sony Cam"
    family: Camera
    to_scene_reference: !<BuiltinTransform> {style: SONY_SLOG3-SGAMUT3.CINE_to_ACES2065-1}

  - !<ColorSpace>
    name: Graded Look
    family: Look
    to_reference: !<ExponentWithLinearTransform> {gamma: 2.4, offset: 0.055}

  - !<ColorSpace>
    name: raw
    isdata: true
`;

describe("OCIO config import: a v1 style config", () => {
  const mapping = mapOcioColorSpaces(parseOcioConfig(V1));

  it("parses block lists, group transforms and inline tags", () => {
    const config = parseOcioConfig(V1);
    expect(config.profileVersion).toBe("1");
    expect(config.colorSpaces.map((c) => c.name)).toEqual(["lin", "Input - ARRI - V3 LogC (EI800) - Wide Gamut", "Camera Log One", "Graded Look", "raw"]);
    const cam = config.colorSpaces[2];
    expect(cam.aliases).toEqual(["cam_log_one", "Sony Cam"]);
    expect(config.colorSpaces[1].files).toEqual(["LogC_to_lin.spi1d"]);
    expect(config.colorSpaces[1].transformKinds).toEqual(expect.arrayContaining(["GroupTransform", "FileTransform", "MatrixTransform"]));
  });

  it("maps by builtin style even when the space is renamed, and refuses LUT and parametric spaces with a reason", () => {
    expect(mapping.supported).toEqual([{ name: "Camera Log One", preset: "log-slog3", via: "builtin-transform" }]);
    // The ARRI name is well known, but this space carries its own LUT, so the name is not trusted.
    const byName = new Map(mapping.unsupported.map((u) => [u.name, u.reason]));
    expect(byName.get("Input - ARRI - V3 LogC (EI800) - Wide Gamut")).toMatch(/LogC_to_lin\.spi1d/);
    expect(byName.get("Graded Look")).toMatch(/parametric/);
    expect(byName.get("raw")).toMatch(/data/);
    expect(byName.get("lin")).toMatch(/no transform/);
  });
});

describe("OCIO config import: rejects what is not a config", () => {
  it("throws OcioConfigError", () => {
    expect(() => parseOcioConfig("hello world")).toThrow(OcioConfigError);
    expect(() => parseOcioConfig("ocio_profile_version: 2\ncolorspaces:\n")).toThrow(/no colour spaces/);
    expect(() => parseOcioConfig("x".repeat(9 * 1024 * 1024))).toThrow(/too large/);
  });
});
