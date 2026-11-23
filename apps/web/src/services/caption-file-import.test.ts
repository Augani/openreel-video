import { describe, expect, it } from "vitest";
import { summariseImportNotes } from "./caption-file-import";
import { isCaptionFileName } from "./caption-file-names";

describe("caption file routing", () => {
  it("recognises caption files by extension, not media, XML timelines or text notes", () => {
    for (const name of ["a.srt", "A.VTT", "b.sbv", "c.ttml", "d.dfxp", "e.itt", "f.scc", "g.mcc", "h.STL"]) expect(isCaptionFileName(name), name).toBe(true);
    for (const name of ["a.mp4", "timeline.xml", "notes.txt", "x.json", "a.srt.bak", "scc"]) expect(isCaptionFileName(name), name).toBe(false);
  });
});

describe("import notes", () => {
  it("puts warnings before info, counts skipped blocks, and caps the list", () => {
    const r = summariseImportNotes(
      ["Cue has no text."],
      [
        { severity: "info", code: "a", message: "placed" },
        { severity: "warning", code: "b", message: "CC2 not imported" },
        ...Array.from({ length: 6 }, (_, i) => ({ severity: "info" as const, code: "c", message: `n${i}` })),
      ],
      3,
    );
    expect(r.problems).toBe(2);
    const lines = r.text!.split("\n");
    expect(lines[0]).toBe("Skipped: Cue has no text.");
    expect(lines[1]).toBe("CC2 not imported");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toMatch(/and 6 more notes/);
  });
  it("is empty when there is nothing to say", () => {
    expect(summariseImportNotes([], [])).toEqual({ text: undefined, problems: 0 });
  });
});
