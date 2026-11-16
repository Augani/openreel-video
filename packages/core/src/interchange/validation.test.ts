import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProject } from "./__fixtures__/project";
import { exportTimeline, validateXmeml } from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const DTD = join(here, "__fixtures__", "fcpxml-1.10.dtd");

const RATES: { fps: number; drop: boolean }[] = [
  { fps: 23.976, drop: false },
  { fps: 24, drop: false },
  { fps: 25, drop: false },
  { fps: 29.97, drop: false },
  { fps: 29.97, drop: true },
  { fps: 30, drop: false },
  { fps: 50, drop: false },
  { fps: 59.94, drop: false },
  { fps: 59.94, drop: true },
  { fps: 60, drop: false },
];

/**
 * Validation is always on: when xmllint is missing these tests FAIL (they never
 * skip), so a CI image without libxml2-utils cannot silently pass.
 */
function xmllint(args: string[]): { ok: boolean; output: string } {
  const r = spawnSync("xmllint", args, { encoding: "utf8" });
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    throw new Error(
      "xmllint is not installed. Interchange validation is mandatory: install libxml2-utils (apt-get install libxml2-utils); macOS ships /usr/bin/xmllint.",
    );
  }
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.replaceAll(DTD, "<dtd>") };
}

const tmp = (): string => mkdtempSync(join(tmpdir(), "interchange-"));
const write = (dir: string, name: string, text: string): string => {
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
};

describe("validators are present", () => {
  it("xmllint is installed (this test fails, it does not skip, when it is missing)", () => {
    const dir = tmp();
    expect(xmllint(["--noout", write(dir, "ok.xml", "<a/>")]).ok).toBe(true);
  });

  it("the FCPXML DTD itself loads without content-model errors", () => {
    const dir = tmp();
    const doc = write(dir, "min.fcpxml", '<?xml version="1.0"?><fcpxml version="1.10"/>');
    const r = xmllint(["--noout", "--dtdvalid", DTD, doc]);
    expect(r.output).toBe("");
    expect(r.ok).toBe(true);
  });
});

describe("FCPXML 1.10 against the full DTD", () => {
  it.each(RATES)("export validates at $fps (drop=$drop)", ({ fps, drop }) => {
    const dir = tmp();
    const xml = exportTimeline(buildProject(fps), "fcpxml", { dropFrame: drop }).files[0].content;
    const r = xmllint(["--noout", "--dtdvalid", DTD, write(dir, "t.fcpxml", xml)]);
    expect(r.output).toBe("");
    expect(r.ok).toBe(true);
  });

  it("every time attribute is a rational number of seconds", () => {
    const xml = exportTimeline(buildProject(29.97), "fcpxml").files[0].content;
    const times = [...xml.matchAll(/\b(?:offset|start|duration|time|value|frameDuration|tcStart)="([^"]*)"/g)].map((m) => m[1]);
    const timeLike = times.filter((t) => /^-?\d/.test(t) && /s$/.test(t));
    expect(timeLike.length).toBeGreaterThan(20);
    for (const t of timeLike) expect(t).toMatch(/^-?\d+(\/\d+)?s$/);
  });

  const wrap = (spine: string, resources = '<format id="r1"/>'): string =>
    `<?xml version="1.0"?><fcpxml version="1.10"><resources>${resources}</resources><library><event name="e"><project name="p"><sequence format="r1"><spine>${spine}</spine></sequence></project></event></library></fcpxml>`;
  const BAD: [string, string][] = [
    ["unknown element in the spine", wrap("<bogus/>")],
    ["missing required sequence format", '<?xml version="1.0"?><fcpxml version="1.10"><resources/><library><event name="e"><project name="p"><sequence><spine/></sequence></project></event></library></fcpxml>'],
    ["unresolved IDREF", wrap('<asset-clip ref="nope" offset="0s" duration="1s"/>')],
    ["duplicate ID", '<?xml version="1.0"?><fcpxml version="1.10"><resources><format id="r1"/><format id="r1"/></resources></fcpxml>'],
    ["bad enumerated attribute", '<?xml version="1.0"?><fcpxml version="1.10"><resources><format id="r1"/></resources><library><event name="e"><project name="p"><sequence format="r1" tcFormat="XX"><spine/></sequence></project></event></library></fcpxml>'],
    ["unsupported version", '<?xml version="1.0"?><fcpxml version="0.1"><resources/></fcpxml>'],
    ["transition missing duration", wrap('<transition offset="0s"/>')],
    ["marker missing value", wrap('<gap duration="1s"><marker start="0s"/></gap>')],
    ["asset-clip children out of order", wrap('<asset-clip ref="a1" offset="0s" duration="1s"><adjust-volume amount="0dB"/><adjust-blend amount="1"/></asset-clip>', '<format id="r1"/><asset id="a1"><media-rep kind="original-media" src="file:///x"/></asset>')],
    ["bad srcEnable", wrap('<asset-clip ref="a1" offset="0s" duration="1s" srcEnable="video+audio"/>', '<format id="r1"/><asset id="a1"/>')],
  ];
  it.each(BAD)("rejects: %s", (_name, doc) => {
    const dir = tmp();
    const r = xmllint(["--noout", "--dtdvalid", DTD, write(dir, "bad.fcpxml", doc)]);
    expect(r.ok).toBe(false);
  });
});

describe("xmeml", () => {
  it.each(RATES)("export is well-formed and structurally valid at $fps (drop=$drop)", ({ fps, drop }) => {
    const xml = exportTimeline(buildProject(fps), "xmeml", { dropFrame: drop }).files[0].content;
    const dir = tmp();
    expect(xmllint(["--noout", write(dir, "t.xml", xml)]).ok).toBe(true);
    expect(validateXmeml(xml)).toEqual([]);
  });

  it("the hand-authored Premiere sample is well-formed", () => {
    const text = readFileSync(join(here, "__fixtures__", "premiere-sample.xml"), "utf8");
    expect(xmllint(["--noout", write(tmp(), "p.xml", text)]).ok).toBe(true);
  });

  const mutate = (replace: (xml: string) => string): string[] =>
    validateXmeml(replace(exportTimeline(buildProject(25), "xmeml").files[0].content));

  it("flags every required element when it is removed or wrong", () => {
    expect(mutate((x) => x.replace(/<rate>[\s\S]*?<\/rate>/, ""))).not.toEqual([]);
    expect(mutate((x) => x.replace('<xmeml version="5">', '<xmeml version="4">'))).toEqual([expect.stringContaining("version")]);
    expect(mutate((x) => x.replace(/<start>\d+<\/start>/, ""))).toEqual([expect.stringContaining("<start>")]);
    expect(mutate((x) => x.replace("<timecode>", "<tc>").replace("</timecode>", "</tc>"))).not.toEqual([]);
    expect(mutate((x) => x.replace(/<ntsc>FALSE<\/ntsc>/, "<ntsc>maybe</ntsc>"))).not.toEqual([]);
  });

  it("flags a clipitem whose file was never defined", () => {
    const problems = mutate((x) => x.replace(/<file id="file-1">[\s\S]*?<\/file>/, '<file id="file-1"/>'));
    expect(problems.some((p) => p.includes("never defined"))).toBe(true);
  });

  it("flags a broken link and a duplicate clipitem id", () => {
    expect(mutate((x) => x.replace("<linkclipref>clipitem-a1-1<", "<linkclipref>clipitem-zz<")).some((p) => p.includes("unknown clipitem"))).toBe(true);
    expect(mutate((x) => x.replace('id="clipitem-v1-2"', 'id="clipitem-v1-1"')).some((p) => p.includes("duplicate"))).toBe(true);
  });

  it("flags non-xmeml and malformed XML", () => {
    expect(validateXmeml("<fcpxml/>")).toEqual(["root element must be <xmeml>"]);
    expect(validateXmeml("<xmeml")[0]).toMatch(/not well-formed/);
  });
});
