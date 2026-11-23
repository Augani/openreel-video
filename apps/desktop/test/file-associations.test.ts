import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { CAPTION_EXTENSIONS, FILE_ASSOCIATIONS, PROJECT_EXTENSIONS, classifyOpenFile } from "../src/shared/file-associations";
import { CAPTION_IMPORT_EXTENSIONS } from "../../../packages/core/src/captions/caption-import";

const requireFrom = createRequire(require.resolve("electron-builder/package.json"));
const yaml = requireFrom("js-yaml") as { load(text: string): Record<string, unknown> };
const config = yaml.load(readFileSync(path.join(__dirname, "../electron-builder.yml"), "utf8")) as {
  fileAssociations: Array<Record<string, string>>;
  mac: { extendInfo: Record<string, unknown> };
};

describe("file associations in electron-builder.yml", () => {
  it("match the single list the app routes by, in the same order", () => {
    expect(config.fileAssociations).toEqual(FILE_ASSOCIATIONS.map((a) => ({ ext: a.ext, name: a.name, description: a.description, role: a.role, rank: a.rank, mimeType: a.mimeType })));
  });
  it("cover the project extension and every caption format the task names", () => {
    const exts = config.fileAssociations.map((a) => a.ext).sort();
    expect(exts).toEqual(["dfxp", "mcc", "oreel", "scc", "srt", "stl", "ttml", "vtt"]);
  });
  it("only register caption formats the editor can import", () => {
    for (const ext of CAPTION_EXTENSIONS) expect(CAPTION_IMPORT_EXTENSIONS as readonly string[]).toContain(ext);
  });
  it("never take over a caption format from the user's other apps (macOS rank Alternate); the project type is ours", () => {
    for (const a of config.fileAssociations) expect(a.rank).toBe(a.ext === "oreel" ? "Owner" : "Alternate");
    expect(config.fileAssociations.find((a) => a.ext === "oreel")?.role).toBe("Editor");
  });
  it("gives every association a unique extension and a MIME type for Linux", () => {
    expect(new Set(config.fileAssociations.map((a) => a.ext)).size).toBe(config.fileAssociations.length);
    for (const a of config.fileAssociations) expect(a.mimeType).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
  });
  it("declares the .oreel type for macOS Launch Services", () => {
    const declarations = config.mac.extendInfo.UTExportedTypeDeclarations as Array<Record<string, unknown>>;
    expect(declarations).toHaveLength(1);
    expect(declarations[0].UTTypeIdentifier).toBe("video.openreel.project");
    expect((declarations[0].UTTypeTagSpecification as Record<string, string[]>)["public.filename-extension"]).toEqual(["oreel"]);
  });
});

describe("classifyOpenFile", () => {
  it("knows projects and captions, case-insensitively, and nothing else", () => {
    expect(PROJECT_EXTENSIONS).toEqual([".oreel"]);
    expect(classifyOpenFile("/a/My Film.oreel")).toBe("project");
    expect(classifyOpenFile("C:\\clips\\Cap.SRT")).toBe("captions");
    for (const ext of CAPTION_EXTENSIONS) expect(classifyOpenFile(`/x/a${ext}`)).toBe("captions");
    expect(classifyOpenFile("/x/a.mov")).toBeNull();
    expect(classifyOpenFile("/x/a.json")).toBeNull();
    expect(classifyOpenFile("/x/.srt")).toBeNull();
    expect(classifyOpenFile("/x/noext")).toBeNull();
  });
});
