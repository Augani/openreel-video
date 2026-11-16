import { describe, expect, it } from "vitest";
import {
  createBrowserFontAvailability,
  describeMissingFonts,
  findMissingProjectFonts,
  primaryFontFamily,
  FALLBACK_FONT_LABEL,
  type FontAvailability,
} from "./project-fonts";
import { GOOGLE_FONT_SPECS } from "./font-catalog";
import { createEmptyProject } from "../stores/project/project-helpers";

const none: FontAvailability = { isBuiltIn: () => false, isLoaded: () => false, isInstalled: () => false };

function projectWith(families: { text?: string[]; caption?: string[] }) {
  const base = createEmptyProject("Fonts");
  const textClips = (families.text ?? []).map((fontFamily, i) => ({
    id: `t${i}`, trackId: "x", startTime: 0, duration: 1, text: `Title ${i}`, keyframes: [],
    style: { fontFamily, fontSize: 40, fontWeight: "normal" },
  })) as unknown as NonNullable<typeof base.textClips>;
  const subtitles = (families.caption ?? []).map((fontFamily, i) => ({
    id: `s${i}`, text: `Line ${i}`, startTime: 0, endTime: 1,
    style: { fontFamily, fontSize: 24, color: "w", backgroundColor: "b", position: "bottom" as const },
  }));
  return { ...base, textClips, timeline: { ...base.timeline, subtitles } };
}

describe("findMissingProjectFonts", () => {
  it("reports unavailable fonts with usage locations and the fallback", () => {
    const missing = findMissingProjectFonts(projectWith({ text: ["Zapfino", "Zapfino"], caption: ["Zapfino", "Papyrus"] }), none);
    expect(missing.map((m) => m.family)).toEqual(["Papyrus", "Zapfino"]);
    const zapfino = missing[1];
    expect(zapfino.usages).toEqual(['Text clip "Title 0"', 'Text clip "Title 1"', 'Caption "Line 0"']);
    expect(zapfino.fallback).toBe(FALLBACK_FONT_LABEL);
  });

  it("skips built-in, loaded, installed and generic families", () => {
    const env: FontAvailability = {
      isBuiltIn: (f) => f === "Inter",
      isLoaded: (f) => f === "MyUpload",
      isInstalled: (f) => f === "Helvetica Neue",
    };
    const project = projectWith({ text: ["Inter", "MyUpload", "Helvetica Neue", "sans-serif", "Ghost"] });
    expect(findMissingProjectFonts(project, env).map((m) => m.family)).toEqual(["Ghost"]);
  });

  it("uses the first family of a CSS stack, unquoted", () => {
    expect(primaryFontFamily('"Gill Sans", Arial, sans-serif')).toBe("Gill Sans");
    const missing = findMissingProjectFonts(projectWith({ text: ["'Gill Sans', Arial"] }), none);
    expect(missing[0].family).toBe("Gill Sans");
  });

  it("returns nothing for a project with no text and formats report lines", () => {
    expect(findMissingProjectFonts(createEmptyProject("Empty"), none)).toEqual([]);
    const lines = describeMissingFonts(findMissingProjectFonts(projectWith({ text: ["Zapfino"] }), none));
    expect(lines).toEqual([`Zapfino: used in Text clip "Title 0". Falls back to ${FALLBACK_FONT_LABEL}.`]);
  });
});

describe("createBrowserFontAvailability", () => {
  const probe = (installed: boolean) => {
    let font = "";
    const calls: string[] = [];
    return {
      calls,
      ctx: {
        get font() { return font; },
        set font(v: string) { font = v; },
        measureText: () => {
          calls.push(font);
          return { width: installed ? 100 : font.includes("monospace") ? 100 : 90 };
        },
      },
    };
  };

  it("treats a family as installed only when width ignores the fallback, and memoises", () => {
    const yes = probe(true);
    const a = createBrowserFontAvailability({ measureContext: yes.ctx, fontFaces: () => [] });
    expect(a.isInstalled("Foo")).toBe(true);
    expect(a.isInstalled("foo")).toBe(true);
    expect(yes.calls).toHaveLength(2);
    const no = probe(false);
    expect(createBrowserFontAvailability({ measureContext: no.ctx, fontFaces: () => [] }).isInstalled("Foo")).toBe(false);
  });

  it("does not raise false alarms when no canvas is available", () => {
    const a = createBrowserFontAvailability({ measureContext: null, fontFaces: () => [] });
    expect(a.isInstalled("Foo")).toBe(true);
  });

  it("counts catalog fonts built-in only on web while online", () => {
    const family = Object.keys(GOOGLE_FONT_SPECS).find((f) => !["Geist", "Geist Mono", "Inter"].includes(f))!;
    const faces = () => [] as Array<{ family: string }>;
    expect(createBrowserFontAvailability({ isDesktop: false, online: true, fontFaces: faces }).isBuiltIn(family)).toBe(true);
    expect(createBrowserFontAvailability({ isDesktop: true, online: true, fontFaces: faces }).isBuiltIn(family)).toBe(false);
    expect(createBrowserFontAvailability({ isDesktop: false, online: false, fontFaces: faces }).isBuiltIn(family)).toBe(false);
    expect(createBrowserFontAvailability({ isDesktop: true, fontFaces: faces }).isBuiltIn("Inter")).toBe(true);
    expect(createBrowserFontAvailability({ isDesktop: true, fontFaces: () => [{ family: `"${family}"` }] }).isLoaded(family)).toBe(true);
  });
});
