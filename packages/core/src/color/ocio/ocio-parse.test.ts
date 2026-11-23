import { describe, expect, it } from "vitest";
import { parseYaml, YamlError } from "./yaml";
import { parseOcioFull, OcioParseError } from "./config";
import { parseCsp, parseCube, parseLutFile, parseSpi1d, parseSpi3d, LutParseError } from "./luts";
import { applyOps, lut1dInverse, lut1dSample, lut3dSample, OcioUnsupportedError } from "./ops";
import { buildOcioPipeline, inspectOcioConfig, optimizeOps, compileOps } from "./runtime";
import { loadFixtureConfig } from "./test-support";
import { OcioContext } from "./compile";
import { MAX_OCIO_FILES, ocioSettingsKey, validateOcioSettings, type OcioProjectSettings } from "./settings";

describe("YAML reader", () => {
  it("reads block maps, lists, flow collections, tags, quoted scalars and block scalars", () => {
    const doc = parseYaml(`
a: 1
b: "two: with colon"
c: [1, 2.5, three]
d:
  - x
  - !<Tag> {k: v, n: [1, 2]}
  - !<Block>
    name: nested
    items: [a, b]
e: |
  line one
  line two
f: 'it''s'
g: {a: 1, b: {c: 2}}
`) as Record<string, unknown>;
    expect(doc.a).toBe(1);
    expect(doc.b).toBe("two: with colon");
    expect(doc.c).toEqual([1, 2.5, "three"]);
    expect(doc.d).toEqual(["x", { $tag: "Tag", k: "v", n: [1, 2] }, { $tag: "Block", name: "nested", items: ["a", "b"] }]);
    expect(doc.e).toBe("line one\nline two\n");
    expect(doc.f).toBe("it's");
    expect(doc.g).toEqual({ a: 1, b: { c: 2 } });
  });

  it("accepts a list at the key's own indent, comments, and flow lists over several lines", () => {
    const doc = parseYaml(`
names:
- a   # first
- b
matrix: [1, 0, 0,
         0, 1, 0,
         0, 0, 1]
`) as Record<string, unknown>;
    expect(doc.names).toEqual(["a", "b"]);
    expect(doc.matrix).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("rejects tabs, duplicate keys and unterminated collections instead of misreading them", () => {
    expect(() => parseYaml("a:\n\tb: 1")).toThrow(YamlError);
    expect(() => parseYaml("a: 1\na: 2")).toThrow(/Duplicate key/);
    expect(() => parseYaml("a: [1, 2")).toThrow(YamlError);
  });
});

describe("OCIO config structure", () => {
  it("reads the ACES studio config: spaces, display spaces, shared views, view transforms, looks, roles", () => {
    const { config } = loadFixtureConfig("studio");
    expect(config.version.major).toBe(2);
    expect(config.roles.scene_linear).toBe("ACEScg");
    expect(config.spaces.some((s) => s.name === "ACEScg" && s.referenceSpaceType === "scene")).toBe(true);
    const display = config.spaces.find((s) => s.name === "sRGB - Display");
    expect(display?.referenceSpaceType).toBe("display");
    expect(display?.fromDisplay).not.toBeNull();
    expect(config.displays.length).toBeGreaterThan(5);
    const srgb = config.displays.find((d) => d.name === "sRGB - Display")!;
    expect(srgb.views.map((v) => v.name)).toContain("ACES 1.0 - SDR Video");
    expect(srgb.views.find((v) => v.name === "ACES 1.0 - SDR Video")?.viewTransform).toBe("ACES 1.0 - SDR Video");
    expect(config.viewTransforms.length).toBeGreaterThan(10);
    expect(config.looks.map((l) => l.name)).toContain("ACES 1.3 Reference Gamut Compression");
    expect(config.defaultViewTransform).toBe("Un-tone-mapped");
  });

  it("reads the hand-made config: environment, search path, looks with inverse-only transforms", () => {
    const { config } = loadFixtureConfig("handmade");
    expect(config.environment.LUT_DIR).toBe("luts");
    expect(config.looks.find((l) => l.name === "Inverse Only")?.transform).toBeNull();
    expect(config.looks.find((l) => l.name === "Inverse Only")?.inverseTransform).not.toBeNull();
    expect(config.spaces.find((s) => s.name === "Raw")?.isData).toBe(true);
  });

  it("rejects text that is not a config", () => {
    expect(() => parseOcioFull("hello: world")).toThrow(OcioParseError);
    expect(() => parseOcioFull("ocio_profile_version: 2\ncolorspaces: []")).toThrow(/no colour spaces/);
    expect(() => parseOcioFull("ocio_profile_version: 2\ncolorspaces:\n  - !<ColorSpace>\n  name: bad")).toThrow(OcioParseError);
  });
});

describe("LUT files", () => {
  it("reads .cube 1D and 3D with a domain, and rejects short data and unknown keywords", () => {
    const one = parseCube("LUT_1D_SIZE 3\nDOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1\n0 0 0\n0.5 0.5 0.5\n1 1 1\n");
    expect(one.parts[0]).toMatchObject({ kind: "lut1d", size: 3, domainMin: [-1, -1, -1] });
    const three = parseCube("LUT_3D_SIZE 2\n" + "0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n");
    expect(three.parts[0]).toMatchObject({ kind: "lut3d", size: 2 });
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0\n")).toThrow(LutParseError);
    expect(() => parseCube("NONSENSE 1\n")).toThrow(/Unknown/);
  });

  it("reads .spi1d (one component expands to three) and .spi3d (index order does not matter)", () => {
    const mono = parseSpi1d("Version 1\nFrom 0 1\nLength 3\nComponents 1\n{\n0\n0.25\n1\n}\n");
    const lut = mono.parts[0];
    expect(lut.kind).toBe("lut1d");
    if (lut.kind === "lut1d") expect(Array.from(lut.data)).toEqual([0, 0, 0, 0.25, 0.25, 0.25, 1, 1, 1]);
    const lines = ["SPILUT 1.0", "3 3", "2 2 2"];
    for (let b = 1; b >= 0; b--) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${r} ${g} ${b} ${r} ${g} ${b}`);
    const spi = parseSpi3d(lines.join("\n"));
    const t = spi.parts[0];
    if (t.kind === "lut3d") {
      // entry (r=1,g=0,b=0) sits at index 1 whatever order the file listed it in
      expect(Array.from(t.data.slice(3, 6))).toEqual([1, 0, 0]);
    }
    expect(() => parseSpi3d("SPILUT 1.0\n3 3\n2 2 2\n0 0 0 0 0 0\n")).toThrow(/of 8/);
  });

  it("reads .csp with a pre-LUT and a 3D table, and routes by extension", () => {
    const csp = parseCsp(["CSPLUTV100", "3D", "", "BEGIN METADATA", "END METADATA", "", ...[0, 1, 2].flatMap(() => ["2", "0 1", "0 1"]), "", "2 2 2", "0 0 0", "1 0 0", "0 1 0", "1 1 0", "0 0 1", "1 0 1", "0 1 1", "1 1 1"].join("\n"));
    expect(csp.parts.map((p) => p.kind)).toEqual(["prelut", "lut3d"]);
    expect(() => parseLutFile("x.3dl", "")).toThrow(/not supported/);
    expect(() => parseLutFile("x.cube", "LUT_3D_SIZE 2\n")).toThrow(LutParseError);
  });
});

describe("LUT interpolation", () => {
  const lut = { kind: "lut1d" as const, size: 3, data: Float32Array.from([0, 0, 0, 0.5, 0.25, 1, 1, 1, 0]), domainMin: [0, 0, 0] as const, domainMax: [1, 1, 1] as const };
  it("1D: linear between entries, clamped outside, and its exact inverse", () => {
    expect(lut1dSample(lut, 0.25, 0)).toBeCloseTo(0.25, 6);
    expect(lut1dSample(lut, 1.7, 0)).toBe(1);
    expect(lut1dSample(lut, -3, 2)).toBe(0);
    for (const x of [0.1, 0.4, 0.8]) expect(lut1dInverse(lut, lut1dSample(lut, x, 0), 0)).toBeCloseTo(x, 6);
    // a decreasing table inverts too (channel 2 goes 0 -> 1 -> 0 so use a monotone one)
    const down = { ...lut, data: Float32Array.from([1, 1, 1, 0.5, 0.5, 0.5, 0, 0, 0]) };
    expect(lut1dInverse(down, 0.75, 0)).toBeCloseTo(0.25, 6);
  });

  it("3D: trilinear and tetrahedral agree on the lattice and on affine tables, and differ on a curved one", () => {
    const n = 5;
    const affine = new Float32Array(n * n * n * 3);
    const curved = new Float32Array(n * n * n * 3);
    for (let b = 0; b < n; b++)
      for (let g = 0; g < n; g++)
        for (let r = 0; r < n; r++) {
          const i = (r + n * (g + n * b)) * 3;
          const [x, y, z] = [r / (n - 1), g / (n - 1), b / (n - 1)];
          affine.set([0.9 * x + 0.1 * y, 0.5 * y + 0.2, 0.7 * z + 0.1 * x], i);
          curved.set([x * x, y * x, z * z * y], i);
        }
    const mk = (data: Float32Array) => ({ kind: "lut3d" as const, size: n, data, domainMin: [0, 0, 0] as const, domainMax: [1, 1, 1] as const });
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    for (const p of [[0.13, 0.62, 0.41], [0.9, 0.2, 0.55], [0.5, 0.5, 0.5]] as const) {
      lut3dSample(mk(affine), p, false, a);
      lut3dSample(mk(affine), p, true, b);
      for (let c = 0; c < 3; c++) expect(a[c]).toBeCloseTo(b[c], 5);
    }
    lut3dSample(mk(curved), [0.13, 0.62, 0.41], false, a);
    lut3dSample(mk(curved), [0.13, 0.62, 0.41], true, b);
    expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])).toBeGreaterThan(1e-4);
    // a lattice point returns its entry exactly in both modes
    lut3dSample(mk(curved), [0.5, 0.25, 1], true, b);
    expect(b[0]).toBeCloseTo(0.25, 6);
    expect(b[1]).toBeCloseTo(0.5 * 0.25, 6);
  });
});

describe("unsupported things are reported, never skipped", () => {
  it("lists per colour space why it cannot run", () => {
    const { text, files } = loadFixtureConfig("handmade");
    const report = inspectOcioConfig(text, files);
    const problem = (name: string) => report.spaces.find((s) => s.name === name)?.problem ?? null;
    expect(problem("Gamma 2.2")).toBeNull();
    expect(problem("Film Scan Cube")).toBeNull();
    expect(problem("Needs Missing LUT")).toMatch(/not_provided\.cube/);
    expect(problem("Uses Grading")).toMatch(/ExposureContrastTransform/);
    expect(problem("Cinespace Curved Prelut")).toMatch(/pre-LUT/);
    expect(problem("RGB To HSV")).toMatch(/RGB_TO_HSV/);
    expect(problem("FF RedMod03 Unsupported")).toMatch(/ACES_RedMod03/);
    expect(report.missingFiles).toContain("not_provided.cube");
    expect(report.displays[0].views.every((v) => v.problem === null)).toBe(true);
    expect(report.looks.every((l) => l.problem === null)).toBe(true);
    expect(report.defaults).toMatchObject({ workingSpace: "Linear", display: "Test Display" });
  });

  it("names the LUT files a config needs when none are provided, and the studio config's unsupported builtins", () => {
    const { text } = loadFixtureConfig("handmade");
    const withoutLuts = inspectOcioConfig(text, {});
    expect(withoutLuts.spaces.find((s) => s.name === "Film Scan Cube")?.problem).toMatch(/was not provided/);
    expect(withoutLuts.looks.find((l) => l.name === "Film Print")?.problem).toMatch(/film_twist\.cube/);
    expect(withoutLuts.missingFiles).toEqual(expect.arrayContaining(["film_twist.cube", "shaper.cube"]));
    const studio = loadFixtureConfig("studio");
    const report = inspectOcioConfig(studio.text, {});
    expect(report.spaces.find((s) => s.name === "ACEScg")?.problem).toBeNull();
    expect(report.spaces.find((s) => s.name === "ADX10")?.problem).toMatch(/table inside OpenColorIO/);
    const unsupportedViews = report.displays.flatMap((d) => d.views).filter((v) => v.problem);
    expect(unsupportedViews.length).toBeGreaterThan(5);
    expect(unsupportedViews.every((v) => /not implemented/.test(v.problem ?? ""))).toBe(true);
    expect(report.defaults).toMatchObject({ workingSpace: "ACEScg", defaultInputSpace: "sRGB - Texture" });
  });

  it("finds LUT files by search path, case-insensitively, by base name, and refuses ambiguous ones", () => {
    const { config } = loadFixtureConfig("handmade");
    const cube = "LUT_3D_SIZE 2\n" + "0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";
    expect(new OcioContext(config, { "luts/film_twist.cube": cube }).lutFile("film_twist.cube").path).toBe("luts/film_twist.cube");
    expect(new OcioContext(config, { "FILM_TWIST.CUBE": cube }).lutFile("film_twist.cube").path).toBe("FILM_TWIST.CUBE");
    expect(new OcioContext(config, { "deep/dir/film_twist.cube": cube }).lutFile("film_twist.cube").path).toBe("deep/dir/film_twist.cube");
    expect(() => new OcioContext(config, { "a/film_twist.cube": cube, "b/film_twist.cube": cube }).lutFile("film_twist.cube")).toThrow(/matches 2/);
  });
});

describe("hostile and broken configs", () => {
  const config = (looks: string, extra = "") => `ocio_profile_version: 2
roles:
  scene_linear: A
displays:
  D:
    - !<View> {name: V, colorspace: A}
looks:
${looks}
colorspaces:
  - !<ColorSpace> {name: A}
${extra}`;

  it("a look that contains itself is reported, not recursed into until the stack overflows", () => {
    const text = config("  - !<Look> {name: L, process_space: A, transform: !<LookTransform> {src: A, dst: A, looks: L}}");
    const report = inspectOcioConfig(text, {});
    expect(report.looks[0].problem).toMatch(/nests transforms too deeply/);
  });

  it("a colour space that refers to itself is reported", () => {
    const text = config("  []", "  - !<ColorSpace>\n    name: B\n    to_scene_reference: !<ColorSpaceTransform> {src: B, dst: A}\n");
    const report = inspectOcioConfig(text.replace("looks:\n  []", "looks: []"), {});
    expect(report.spaces.find((s) => s.name === "B")?.problem).toMatch(/refers to itself/);
  });

  it("malformed transform parameters are reported as unsupported, and building never throws", () => {
    const text = config(
      "  []",
      "  - !<ColorSpace>\n    name: M\n    to_scene_reference: !<MatrixTransform> {matrix: [1, 2, 3]}\n  - !<ColorSpace>\n    name: G\n    to_scene_reference: !<GroupTransform> {children: 5}\n  - !<ColorSpace>\n    name: X\n    to_scene_reference: !<ExponentTransform> {value: [a, b, c]}\n",
    ).replace("looks:\n  []", "looks: []");
    const report = inspectOcioConfig(text, {});
    expect(report.spaces.find((s) => s.name === "M")?.problem).toMatch(/16 numbers/);
    expect(report.spaces.find((s) => s.name === "X")?.problem).toMatch(/number/);
    const built = buildOcioPipeline({ configName: "x", configText: text, files: {}, workingSpace: "M", defaultInputSpace: "A", display: "D", view: "V" });
    expect(built.ok).toBe(false);
    expect(buildOcioPipeline({ configName: "x", configText: "ocio_profile_version: 2\ncolorspaces:\n  - !<ColorSpace> {name: A, to_reference: !<MatrixTransform> {matrix: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1]}}", files: {}, workingSpace: "A", defaultInputSpace: "A", display: "D", view: "V" }).ok).toBe(false);
  });
});

describe("pipeline building", () => {
  const handmade = loadFixtureConfig("handmade");
  const base: OcioProjectSettings = {
    configName: "config.ocio",
    configText: handmade.text,
    files: handmade.files,
    workingSpace: "Linear",
    defaultInputSpace: "sRGB Curve",
    display: "Test Display",
    view: "Standard",
  };

  it("builds input, output and overlay transforms and they compose to what the config says", () => {
    const built = buildOcioPipeline(base);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const rgb = [0, 0, 0];
    // sRGB Curve decodes 0.5 to 0.2140... in the working (linear) space
    built.parts.input("sRGB Curve").apply(0.5, 0.5, 0.5, rgb);
    expect(rgb[0]).toBeCloseTo(0.21404, 4);
    built.parts.overlay.apply(1, 1, 1, rgb);
    expect(rgb[0]).toBeCloseTo(1, 6);
    // the view is matrix -> sRGB-style curve inverse -> forward again (identity) -> display gamma 2.4 inverse
    built.parts.output.apply(0.18, 0.18, 0.18, rgb);
    expect(rgb[0]).toBeGreaterThan(0.4);
    expect(rgb[0]).toBeLessThan(0.6);
    expect(built.parts.input("Gamma 2.2")).toBe(built.parts.input("Gamma 2.2"));
  });

  it("applies looks in order, reverses with a minus sign, and a look changes the output", () => {
    const plain = buildOcioPipeline(base);
    const looked = buildOcioPipeline({ ...base, looks: ["Warm CDL"] });
    const reversed = buildOcioPipeline({ ...base, looks: ["-Warm CDL"] });
    if (!plain.ok || !looked.ok || !reversed.ok) throw new Error("build failed");
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const c = [0, 0, 0];
    plain.parts.output.apply(0.3, 0.3, 0.3, a);
    looked.parts.output.apply(0.3, 0.3, 0.3, b);
    reversed.parts.output.apply(0.3, 0.3, 0.3, c);
    expect(Math.abs(a[0] - b[0])).toBeGreaterThan(0.01);
    expect(Math.abs(a[0] - c[0])).toBeGreaterThan(0.01);
    expect(b[0] - a[0]).toBeGreaterThan(0);
    expect(c[0] - a[0]).toBeLessThan(0);
  });

  it("fails with the reason when the settings cannot run", () => {
    expect(buildOcioPipeline({ ...base, files: {} })).toMatchObject({ ok: true });
    expect(buildOcioPipeline({ ...base, workingSpace: "Needs Missing LUT" })).toMatchObject({ ok: false, error: expect.stringMatching(/not_provided/) });
    expect(buildOcioPipeline({ ...base, workingSpace: "Raw" })).toMatchObject({ ok: false, error: expect.stringMatching(/scene-referred/) });
    expect(buildOcioPipeline({ ...base, view: "Nope" })).toMatchObject({ ok: false, error: expect.stringMatching(/no view named/) });
    expect(buildOcioPipeline({ ...base, display: "Nope" })).toMatchObject({ ok: false, error: expect.stringMatching(/no display named/) });
    expect(buildOcioPipeline({ ...base, looks: ["Nope"] })).toMatchObject({ ok: false, error: expect.stringMatching(/no look named/) });
    expect(buildOcioPipeline({ ...base, configText: "nonsense" })).toMatchObject({ ok: false });
    // a clip's colour space that cannot run throws from `input`, so the engine can fall back and say so
    const built = buildOcioPipeline(base);
    if (built.ok) expect(() => built.parts.input("Uses Grading")).toThrow(OcioUnsupportedError);
  });

  it("merges neighbouring matrices and drops identities without changing the result", () => {
    const ops = [
      { k: "mat" as const, m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0] as const },
      { k: "mat" as const, m: [2, 0, 0, 0, 2, 0, 0, 0, 2], o: [0.1, 0, 0] as const },
      { k: "mat" as const, m: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5], o: [0, 0.2, 0] as const },
    ];
    const merged = optimizeOps(ops);
    expect(merged.length).toBe(1);
    const a = [0.3, 0.4, 0.5];
    const b = [0.3, 0.4, 0.5];
    applyOps(ops, a);
    applyOps(merged, b);
    for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i], 12);
    expect(optimizeOps([ops[0]])).toEqual([]);
    expect(compileOps(ops, "k").opCount).toBe(1);
  });

  it("keys differ when anything that changes the picture differs", () => {
    const k = ocioSettingsKey(base);
    expect(ocioSettingsKey({ ...base })).toBe(k);
    expect(ocioSettingsKey({ ...base, view: "Film" })).not.toBe(k);
    expect(ocioSettingsKey({ ...base, looks: ["Warm CDL"] })).not.toBe(k);
    expect(ocioSettingsKey({ ...base, files: { ...base.files, "film_twist.cube": "x" } })).not.toBe(k);
    expect(ocioSettingsKey({ ...base, defaultInputSpace: "Gamma 2.2" })).not.toBe(k);
  });
});

describe("project settings validation", () => {
  const ok: OcioProjectSettings = { configName: "c.ocio", configText: "ocio_profile_version: 2", files: { "a.cube": "x" }, workingSpace: "a", defaultInputSpace: "b", display: "d", view: "v" };
  it("accepts good settings and says why bad ones are bad", () => {
    expect(validateOcioSettings(ok)).toBeNull();
    expect(validateOcioSettings(null)).toMatch(/object/);
    expect(validateOcioSettings({ ...ok, configText: "" })).toMatch(/empty/);
    expect(validateOcioSettings({ ...ok, view: 3 })).toMatch(/"view"/);
    expect(validateOcioSettings({ ...ok, files: { "../x.cube": "x" } })).toMatch(/relative/);
    expect(validateOcioSettings({ ...ok, files: { "/abs.cube": "x" } })).toMatch(/relative/);
    expect(validateOcioSettings({ ...ok, files: { a: 1 } })).toMatch(/map a path/);
    expect(validateOcioSettings({ ...ok, looks: [1] })).toMatch(/looks/);
    const many: Record<string, string> = {};
    for (let i = 0; i <= MAX_OCIO_FILES; i++) many[`f${i}.cube`] = "x";
    expect(validateOcioSettings({ ...ok, files: many })).toMatch(/At most/);
  });
});

describe("1D LUT inverse with flat ends (OpenColorIO effective domain)", () => {
  it("clamps to the end of the leading flat run and the start of the trailing one", () => {
    const lut = { kind: "lut1d" as const, size: 6, domainMin: [0, 0, 0] as const, domainMax: [1, 1, 1] as const, data: Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1, 1, 1, 1]) };
    expect(lut1dInverse(lut, -1, 0)).toBeCloseTo(2 / 5, 6);
    expect(lut1dInverse(lut, 0.75, 0)).toBeCloseTo(3.5 / 5, 6);
    expect(lut1dInverse(lut, 2, 0)).toBeCloseTo(4 / 5, 6);
  });
});
