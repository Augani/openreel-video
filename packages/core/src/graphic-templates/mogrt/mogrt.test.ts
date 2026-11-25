import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { importMogrt, splitFontName, fontWeightOf } from "./import";
import { parseMogrtColor, parseMogrtDefinition, localizedString } from "./definition";
import { parsePrgraphic, parsePrgraphicXml } from "./prgraphic";
import { readZip, ZipError } from "./zip";
import { validateGraphicTemplate } from "../validate";
import { expandGraphicInstance } from "../expand";
import {
  FIXTURE_CONTROL_IDS as C,
  afterEffectsMogrt,
  cardMogrt,
  lowerThirdGraphicXml,
  lowerThirdMogrt,
  solidPng,
  ticks,
  zipFiles,
} from "./__fixtures__/build-mogrt";

const OK = async (bytes: Uint8Array, name = "x.mogrt") => {
  const result = await importMogrt(bytes, { fileName: name });
  if (!result.ok) throw new Error(`import failed: ${result.message}`);
  return result;
};

describe("zip reader", () => {
  it("reads deflated and stored entries", () => {
    const bytes = zipFiles({ "a.txt": "hello ".repeat(500), "dir/b.json": "{}", "c.bin": new Uint8Array([1, 2, 3]) }, ["c.bin"]);
    const entries = readZip(bytes);
    expect(entries.map((e) => e.name)).toEqual(["a.txt", "dir/b.json", "c.bin"]);
    expect(entries[0].method).toBe(8);
    expect(entries[2].method).toBe(0);
    expect(new TextDecoder().decode(entries[0].read())).toBe("hello ".repeat(500));
    expect([...entries[2].read()]).toEqual([1, 2, 3]);
  });
  it("rejects non-zip, truncated and lying archives", () => {
    expect(() => readZip(new Uint8Array(100))).toThrow(ZipError);
    const good = zipFiles({ "a.txt": "x".repeat(2000) });
    expect(() => readZip(good.subarray(0, good.length - 10))).toThrow(/directory/);
    // an entry whose declared size is far smaller than its data must not inflate unbounded
    const entries = readZip(good);
    expect(entries[0].size).toBe(2000);
  });
  it("refuses an implausible compression ratio", () => {
    const bomb = zipFiles({ "big.xml": "a".repeat(5_000_000) });
    expect(() => readZip(bomb)).toThrow(/ratio/);
  });
});

describe("definition.json", () => {
  it("reads localised names, control kinds and font capabilities", () => {
    const def = parseMogrtDefinition(JSON.stringify({
      authorApp: "ppro",
      sourceInfoLocalized: { en_US: { name: "My Title", description: "d" } },
      capsule: { clientControls: [
        { id: "a", type: "00000000-0000-0000-0000-000000000000", uiName: { strDB: [{ locale: "fr_FR", str: "Texte" }, { locale: "en_US", str: "Text" }] }, textEditValue: "Hi", fonteditinfo: { capPropFontEdit: true, capPropFontSizeEdit: false, fontEditValue: "Arial-BoldMT", fontSizeEditValue: 80, fontFSAllCapsValue: true } },
        { id: "b", type: "t", uiName: "Fill", value: [255, 128, 0, 255] },
        { id: "c", uiName: "Amount", value: 42, min: 0, max: 100 },
        { id: "d", uiName: "Show", value: false },
        { id: "e", uiName: "Spot", value: { x: 10, y: 20 } },
        { id: "f", type: "image-placeholder", uiName: "Logo" },
        { id: "g", uiName: "Mystery", value: null },
      ] },
      extraKey: 1,
    }));
    expect(def.authorApp).toBe("ppro");
    expect(def.name).toBe("My Title");
    expect(def.unreadKeys).toEqual(["extraKey"]);
    const byId = Object.fromEntries(def.controls.map((c) => [c.id, c]));
    expect(byId.a).toMatchObject({ name: "Text", kind: "text", defaultValue: "Hi", font: { fontEditable: true, fontSizeEditable: false, fontFamily: "Arial-BoldMT", fontSize: 80, allCaps: true } });
    expect(byId.b).toMatchObject({ kind: "color", defaultValue: "#ff8000" });
    expect(byId.c).toMatchObject({ kind: "slider", defaultValue: 42, min: 0, max: 100 });
    expect(byId.d).toMatchObject({ kind: "checkbox", defaultValue: false });
    expect(byId.e).toMatchObject({ kind: "point", defaultValue: { x: 10, y: 20 } });
    expect(byId.f.kind).toBe("media");
    expect(byId.g.kind).toBe("unknown");
  });
  it("rejects malformed JSON", () => {
    expect(() => parseMogrtDefinition("{nope")).toThrow(/not valid JSON/);
    expect(() => parseMogrtDefinition("[]")).toThrow(/not a JSON object/);
  });
  it("parses colour shapes and localised strings", () => {
    expect(parseMogrtColor([1, 0, 0])).toBe("#ff0000");
    expect(parseMogrtColor({ red: 0, green: 1, blue: 0, alpha: 0.5 })).toBe("#00ff0080");
    expect(parseMogrtColor("#ABCDEF")).toBe("#abcdef");
    expect(parseMogrtColor("blue")).toBeUndefined();
    expect(localizedString({ strDB: [{ locale: "en_US", str: "x" }] })).toBe("x");
    expect(localizedString({ en_US: { name: "n" } })).toBe("n");
  });
});

describe("font names", () => {
  it("splits PostScript names and maps weights", () => {
    expect(splitFontName("MyriadPro-Bold")).toEqual({ family: "Myriad Pro", style: "Bold" });
    expect(splitFontName("Arial-BoldMT")).toEqual({ family: "Arial", style: "BoldMT" });
    expect(splitFontName("Open Sans")).toEqual({ family: "Open Sans" });
    expect(fontWeightOf("Bold Italic")).toBe(700);
    expect(fontWeightOf("SemiBold")).toBe(600);
    expect(fontWeightOf("Light")).toBe(300);
    expect(fontWeightOf("ExtraBold")).toBe(800);
    expect(fontWeightOf("Regular")).toBe(400);
  });
});

describe("prgraphic parsing", () => {
  it("reads ticks, keyframes, controls and layer order", async () => {
    const g = await parsePrgraphic(new Uint8Array(gzipSync(Buffer.from(lowerThirdGraphicXml()))));
    expect(g.width).toBe(1920);
    expect(g.duration).toBeCloseTo(6, 6);
    expect(g.introDuration).toBe(0.8);
    expect(g.outroDuration).toBe(0.6);
    // XML lists the top layer first; the model is bottom to top.
    expect(g.layers.map((l) => l.name)).toEqual(["Plate", "Accent", "Swoosh", "Name", "Title", "Dot", "Logo"]);
    const name = g.layers.find((l) => l.name === "Name")!;
    expect(name.controls).toMatchObject({ text: C.NAME_CTL, fillColor: C.NAME_COLOR_CTL });
    expect(name.opacity!.keys.map((k) => [round(k.t), k.v[0]])).toEqual([[0.2, 0], [0.7, 100]]);
    expect(name.text).toMatchObject({ text: "ALEX MORGAN", fontFamily: "Montserrat", fontStyle: "Bold", fontSize: 56, tracking: 20, stroke: { width: 2 } });
    expect(g.layers.find((l) => l.name === "Plate")!.controls.opacity).toBe(C.OPACITY_CTL);
    expect(g.layers.find((l) => l.name === "Swoosh")!.kind).toBe("unsupported");
  });
  it("reads plain (uncompressed) XML and reports multiple runs", () => {
    const g = parsePrgraphicXml(`<PremiereData><Graphic><Layers Order="BottomToTop">
      <TextLayer Name="A"><Bounds Width="100" Height="20"/><Runs><Run><Text>He</Text><FontSize>20</FontSize></Run><Run><Text>llo</Text><FontSize>30</FontSize></Run></Runs></TextLayer>
      <GroupLayer Name="G"><Transform><Position Value="10,20"/><Opacity Value="50"/></Transform><Layers><RectangleLayer Name="R"><Bounds Width="5" Height="5"/></RectangleLayer></Layers></GroupLayer>
    </Layers></Graphic></PremiereData>`);
    expect(g.layers[0].text?.text).toBe("Hello");
    expect(g.layers[0].unsupported.join()).not.toMatch(/mixed styling/);
    expect(g.layers[0].text?.runs?.map((r) => [r.text, r.fontSize])).toEqual([["He", 20], ["llo", 30]]);
    expect(g.layers[1]).toMatchObject({ name: "R", groupOffset: { x: 10, y: 20 }, groupOpacity: 0.5 });
  });
  it("converts ticks exactly", () => {
    expect(ticks(1)).toBe("254016000000");
    expect(ticks(0.5)).toBe("127008000000");
  });
});

const round = (n: number) => Math.round(n * 1e6) / 1e6;

describe("importMogrt: Premiere lower third", () => {
  it("maps layers, transforms, text styling and shapes", async () => {
    const { template, report } = await OK(lowerThirdMogrt(), "Lower Third.mogrt");
    expect(validateGraphicTemplate(template).ok).toBe(true);
    expect(template.name).toBe("Broadcast Lower Third");
    expect(template.category).toBe("lower-third");
    expect(template.duration).toBe(6);
    expect(template.introDuration).toBe(0.8);
    expect(template.outroDuration).toBe(0.6);
    expect(report.layersImported).toBe(6);
    expect(report.layersTotal).toBe(7);
    expect(template.layers.map((l) => l.name)).toEqual(["Plate", "Accent", "Name", "Title", "Dot", "Logo"]);

    const plate = template.layers.find((l) => l.name === "Plate")!;
    // anchor (0,0) at (150,870) and a 780x150 box: centre (540, 945)
    expect(plate).toMatchObject({ kind: "shape", x: 540, y: 945, width: 780, height: 150, opacity: 0.85 });
    expect(plate.shape).toMatchObject({ shapeType: "rectangle", style: { cornerRadius: 12, fill: { type: "solid", color: "#0f172a" } } });
    // shadow angle 180 (down), distance 8
    expect(plate.shape!.style.shadow).toMatchObject({ blur: 16, offsetX: 0 });
    expect(plate.shape!.style.shadow!.offsetY).toBeCloseTo(8, 1);

    const name = template.layers.find((l) => l.name === "Name")!;
    expect(name.text!.text).toBe("ALEX MORGAN");
    expect(name.text!.style).toMatchObject({ fontFamily: "Montserrat", fontWeight: 700, fontSize: 56, color: "#ffffff", textAlign: "left", strokeColor: "#000000", strokeWidth: 2 });
    expect(name.text!.style.letterSpacing).toBeCloseTo(1.12, 2);
    expect(name).toMatchObject({ x: 190 + 350, y: 840 + 32, width: 700, height: 64 });

    const title = template.layers.find((l) => l.name === "Title")!;
    expect(title.text!.style).toMatchObject({ fontFamily: "Montserrat", fontWeight: 500, fontSize: 30, textAlign: "left" });
    expect(title.text!.style.lineHeight).toBeCloseTo(36 / 30, 3);
    expect(title.text!.style.color).toBe("#cbd5e1");
    // shadow direction 135 deg = down-right, 60% opacity
    expect(title.text!.style.shadowOffsetX!).toBeGreaterThan(2);
    expect(title.text!.style.shadowOffsetY!).toBeGreaterThan(2);
    expect(title.text!.style.shadowColor).toBe("#00000099");

    const dot = template.layers.find((l) => l.name === "Dot")!;
    expect(dot.shape!.shapeType).toBe("ellipse");
    expect(template.layers.find((l) => l.name === "Logo")!.image!.src).toMatch(/^data:image\/png;base64,/);
  });

  it("carries opacity, scale and position keyframes with intro/outro anchoring", async () => {
    const { template } = await OK(lowerThirdMogrt());
    const name = template.layers.find((l) => l.name === "Name")!;
    expect(name.keyframes!.map((k) => [k.property, k.time, k.anchor, k.value, k.easing])).toEqual([
      ["opacity", 0.2, "start", 0, "ease-in-out"],
      ["opacity", 0.7, "start", 1, "ease-in-out"],
    ]);
    const accent = template.layers.find((l) => l.name === "Accent")!;
    // grow-in 0 -> 100 vertically; baked at the fullest scale so keyframes are relative: 0 then 1
    expect(accent.height).toBe(150);
    const sy = accent.keyframes!.filter((k) => k.property === "scale.y").map((k) => [k.time, k.value]);
    expect(sy).toEqual([[0, 0], [0.5, 1]]);
    // anchor (0,0) with a growing height moves the centre: position.y keys follow it
    const py = accent.keyframes!.filter((k) => k.property === "position.y").map((k) => [k.time, round(k.value * 1080)]);
    expect(py[0][1]).toBeCloseTo(870, 0);
    expect(py[1][1]).toBeCloseTo(945, 0);
  });

  it("exposes the editable controls, bound by ControlID, definition and name", async () => {
    const { template, report } = await OK(lowerThirdMogrt());
    const byLabel = Object.fromEntries(template.parameters.map((p) => [p.label, p]));
    expect(Object.keys(byLabel).sort()).toEqual([
      "Accent Colour", "Name", "Name Colour", "Name font", "Name size", "Plate Colour", "Plate Opacity", "Show Dot", "Title",
    ].sort());
    const layerName = (id: string) => template.layers.find((l) => l.id === id)!.name;
    expect(byLabel.Name).toMatchObject({ type: "text", defaultValue: "ALEX MORGAN", group: "Text" });
    expect(byLabel.Name.targets.map((t) => [layerName(t.layerId), t.property])).toEqual([["Name", "text"]]);
    expect(byLabel["Name Colour"].targets.map((t) => [layerName(t.layerId), t.property])).toEqual([["Name", "textColor"]]);
    expect(byLabel["Name font"]).toMatchObject({ type: "font", defaultValue: "Montserrat" });
    expect(byLabel["Name size"]).toMatchObject({ type: "slider", defaultValue: 56 });
    expect(byLabel["Accent Colour"].targets.map((t) => [layerName(t.layerId), t.property])).toEqual([["Accent", "fill"]]);
    expect(byLabel["Accent Colour"].defaultValue).toBe("#f97316");
    // by the definition's own target list
    expect(byLabel.Title.targets.map((t) => [layerName(t.layerId), t.property])).toEqual([["Title", "text"]]);
    expect(byLabel["Plate Colour"].targets.map((t) => [layerName(t.layerId), t.property])).toEqual([["Plate", "fill"]]);
    expect(byLabel["Plate Opacity"]).toMatchObject({ type: "slider", defaultValue: 0.85, min: 0, max: 1 });
    expect(byLabel["Show Dot"]).toMatchObject({ type: "checkbox", defaultValue: true });

    expect(report.controlsTotal).toBe(10);
    expect(report.controlsImported).toBe(7);
  });

  it("reports everything it could not carry over", async () => {
    const { report } = await OK(lowerThirdMogrt());
    const text = report.items.map((i) => `${i.severity}|${i.feature}|${i.detail}`).join("\n");
    expect(text).toMatch(/dropped\|Path layer/);
    expect(text).toMatch(/dropped\|Layer effects/);
    expect(text).toMatch(/dropped\|Control: Logo\|media-replacement/);
    expect(text).toMatch(/dropped\|Control: Tilt\|no layer property/);
    expect(text).toMatch(/dropped\|Control: Corner Roundness/);
    expect(text).toMatch(/info\|Preview video/);
    expect(report.dropped).toBeGreaterThanOrEqual(5);
    expect(report.summary).toMatch(/Imported "Broadcast Lower Third": 6 of 7 layers, 7 of 10 controls\./);
  });

  it("expands into ordinary clips with the parameters applied", async () => {
    const { template } = await OK(lowerThirdMogrt());
    const accent = template.parameters.find((p) => p.label === "Accent Colour")!;
    const name = template.parameters.find((p) => p.label === "Name")!;
    const instance = {
      id: "g1", name: "x", trackId: "t", startTime: 0, duration: 6, template,
      values: { [accent.id]: "#00ff00", [name.id]: "JAMIE LEE" },
    };
    const expanded = expandGraphicInstance(instance, { width: 1920, height: 1080 });
    expect(expanded.textClips.map((c) => c.text).sort()).toEqual(["JAMIE LEE", "Senior Correspondent"]);
    expect(expanded.shapeClips.some((c) => c.style.fill.color === "#00ff00")).toBe(true);
  });

  it("is deterministic and reads a project.prproj graphic and stored entries", async () => {
    const a = await OK(lowerThirdMogrt());
    const b = await OK(lowerThirdMogrt({ graphicName: "project.prproj", stored: ["definition.json"] }));
    expect(b.template.layers).toEqual(a.template.layers);
    expect(b.template.id).toBe(a.template.id);
  });

  it("returns the thumbnail", async () => {
    const result = await OK(lowerThirdMogrt());
    expect(result.thumbnail).toMatch(/^data:image\/png;base64,/);
  });
});

describe("importMogrt: failures", () => {
  it("names After Effects templates clearly and lists their controls", async () => {
    const result = await importMogrt(afterEffectsMogrt(), { fileName: "ae.mogrt" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("after-effects");
    expect(result.message).toMatch(/After Effects/);
    expect(result.report.controlsTotal).toBe(2);
    expect(result.report.authorApp).toBe("aeft");
    expect(result.report.items.map((i) => i.feature)).toContain("Editable controls found");
  });
  it("treats an .aegraphic-only archive as After Effects even without authorApp", async () => {
    const result = await importMogrt(zipFiles({ "definition.json": "{}", "x.aegraphic": "bin" }));
    expect(result.ok === false && result.reason).toBe("after-effects");
  });
  it("rejects non-zip, empty-graphic and no-graphic files", async () => {
    expect((await importMogrt(new TextEncoder().encode("not a zip at all, plain text file here"))).ok).toBe(false);
    const none = await importMogrt(zipFiles({ "definition.json": JSON.stringify({ authorApp: "ppro" }), "thumb.png": solidPng(2, 2, [0, 0, 0]) }));
    expect(none.ok === false && none.reason).toBe("no-graphic");
    const empty = await importMogrt(zipFiles({ "a.prgraphic": gzipSync(Buffer.from("<PremiereData><Graphic><Layers/></Graphic></PremiereData>")) }));
    expect(empty.ok === false && empty.reason).toBe("no-graphic");
    const bad = await importMogrt(zipFiles({ "a.prgraphic": gzipSync(Buffer.from("<PremiereData><oops")) }));
    expect(bad.ok === false && bad.reason).toBe("invalid");
  });
  it("still imports the layers when definition.json is broken, and says so", async () => {
    const result = await OK(zipFiles({ "definition.json": "{broken", "g.prgraphic": gzipSync(Buffer.from(lowerThirdGraphicXml())) }));
    expect(result.template.parameters).toEqual([]);
    expect(result.report.items.some((i) => i.feature === "definition.json" && i.severity === "dropped")).toBe(true);
  });
  it("skips an image that is missing from the archive", async () => {
    const files = { "g.prgraphic": gzipSync(Buffer.from(`<PremiereData><Graphic><Layers><ImageLayer Name="Pic"><Source>media/gone.png</Source><Bounds Width="10" Height="10"/></ImageLayer><RectangleLayer Name="R"><Bounds Width="10" Height="10"/></RectangleLayer></Layers></Graphic></PremiereData>`)) };
    const result = await OK(zipFiles(files));
    expect(result.template.layers.map((l) => l.name)).toEqual(["R"]);
    expect(result.report.items.some((i) => i.feature === "Image layer")).toBe(true);
  });
});

describe("importMogrt: card fixture", () => {
  it("imports a one-control-per-layer template", async () => {
    const { template, report } = await OK(cardMogrt());
    expect(template.layers.map((l) => l.name)).toEqual(["Card", "Headline"]);
    expect(template.parameters.map((p) => [p.label, p.type])).toEqual([["Headline", "text"], ["Card Colour", "color"]]);
    expect(template.parameters[1].defaultValue).toBe("#1d4ed8");
    expect(report.controlsImported).toBe(2);
    expect(report.dropped).toBe(0);
  });
});

describe("importMogrt: styled text maps to runs", () => {
  const styledMogrt = () => {
    const xml = `<PremiereData Version="3"><Graphic><Name>Styled</Name><Width>1920</Width><Height>1080</Height><DurationSeconds>4</DurationSeconds>
    <Layers><TextLayer ID="head" Name="Headline"><Bounds X="0" Y="0" Width="1200" Height="120"/><Transform><Position Value="960,540"/></Transform>
      <Alignment>Center</Alignment>
      <Runs>
        <Run><Text Value="Big "/><Font>Inter-Regular</Font><FontSize>60</FontSize><FillColor><Color>#ffffff</Color></FillColor></Run>
        <Run><Text Value="bold "/><Font>Inter-Bold</Font><FontSize>60</FontSize><FillColor><Color>#ffffff</Color></FillColor></Run>
        <Run><Text Value="red"/><Font>Inter-BoldItalic</Font><FontSize>90</FontSize><FillColor><Color>#ff0000</Color></FillColor><Tracking>100</Tracking><Underline>true</Underline></Run>
      </Runs></TextLayer></Layers></Graphic></PremiereData>`;
    return zipFiles({
      "definition.json": JSON.stringify({ authorApp: "ppro", sourceInfoLocalized: { en_US: { name: "Styled" } }, clientControls: [] }),
      "Styled.prgraphic": gzipSync(Buffer.from(xml, "utf8")),
      "thumb.png": solidPng(16, 9, [0, 0, 0]),
    });
  };

  it("keeps the per-run font, weight, size, colour, tracking and underline instead of flattening to the first run", async () => {
    const { template, report } = await OK(styledMogrt());
    const text = template.layers.find((l) => l.kind === "text")!.text!;
    expect(text.text).toBe("Big bold red");
    expect(text.runs?.map((r) => [r.text, r.style])).toEqual([
      ["Big ", {}],
      ["bold ", { fontWeight: 700 }],
      ["red", { fontWeight: 700, fontStyle: "italic", fontSize: 90, color: "#ff0000", letterSpacing: 9, underline: true }],
    ]);
    expect(JSON.stringify(report)).not.toMatch(/first run's style/);
  });

  it("expands to a text clip whose runs are scaled with the frame and still cover its text", async () => {
    const { template } = await OK(styledMogrt());
    const instance = { id: "g1", name: "x", trackId: "t", startTime: 0, duration: 4, template, values: {} };
    const half = expandGraphicInstance(instance, { width: 960, height: 540 });
    const clip = half.textClips[0];
    expect(clip.runs!.map((r) => r.text).join("")).toBe(clip.text);
    expect(clip.runs![2].style.fontSize).toBeCloseTo(45, 1);
    expect(clip.style.fontSize).toBeCloseTo(30, 1);
    // a text control edit re-flows the runs instead of discarding them
    const text = template.layers.find((l) => l.kind === "text")!;
    expect(text.text!.runs).toHaveLength(3);
  });
});
