import { describe, expect, it } from "vitest";
import { createCaptionSearch } from "./caption-search";
describe("caption corrections", () => {
  it("finds Portuguese words across case and preserves hard line breaks", () => {
    const search = createCaptionSearch("edição");
    expect(search.count("A EDIÇÃO\nprecisa de edição.")).toBe(2);
    expect(search.replace("A EDIÇÃO\nprecisa de edição.", "montagem")).toBe("A montagem\nprecisa de montagem.");
  });
  it("treats punctuation and replacement dollars literally", () => {
    const search = createCaptionSearch("$5.00 (today)");
    expect(search.count("$5.00 (today) and $5X00 today")).toBe(1);
    expect(search.replace("$5.00 (today)", "$&" )).toBe("$&");
  });
  it("uses Unicode word boundaries instead of matching inside accented words", () => {
    const search = createCaptionSearch("ação", { wholeWords: true });
    expect(search.count("ação, reação, ação! ação123 ação_ação")).toBe(2);
    expect(search.replace("reação\nação", "movimento")).toBe("reação\nmovimento");
  });
  it("honors case-sensitive searches and safely ignores an empty query", () => {
    expect(createCaptionSearch("Edit", { matchCase: true }).count("Edit edit EDIT")).toBe(1);
    expect(createCaptionSearch("").count("anything")).toBe(0);
    expect(createCaptionSearch("").replace("unchanged", "wrong")).toBe("unchanged");
  });
});
