import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureFontFamily, ensureProjectFonts, collectProjectFonts, collectFontUsages } from "./project-fonts";
import { createEmptyProject } from "../stores/project/project-helpers";

const load = vi.fn(async () => []);
beforeEach(() => { load.mockClear(); Object.defineProperty(document, "fonts", { value: { load }, configurable: true }); });
afterEach(() => { delete (document as unknown as { fonts?: unknown }).fonts; document.querySelectorAll('link[data-openreel-font]').forEach((link) => link.remove()); vi.restoreAllMocks(); });
describe("fonts on demand", () => {
  it("requests one stylesheet for a selected family and waits for it before loading glyphs", async () => {
    const first = ensureFontFamily("Bangers", 400, "Olá");
    const second = ensureFontFamily("Bangers", 700, "字幕");
    const links = document.querySelectorAll('link[data-openreel-font="Bangers"]');
    expect(links).toHaveLength(1); expect(load).not.toHaveBeenCalled();
    links[0].dispatchEvent(new Event("load"));
    await Promise.all([first, second]);
    expect(load).toHaveBeenCalledWith('400 48px "Bangers"', "Olá");
    expect(load).toHaveBeenCalledWith('700 48px "Bangers"', "字幕");
  });
  it("does not add network requests for startup or system fonts", async () => {
    await ensureFontFamily("Inter", 800, "Title"); await ensureFontFamily("Arial", 400);
    expect(document.querySelector('link[data-openreel-font]')).toBeNull();
  });
  it.each([["Space Grotesk", '"space grotesk"'], ["Playfair Display", "Playfair Display"], ["Fraunces", "Fraunces"]])("uses the registered local %s font without fetching another stylesheet", async (family, registeredFamily) => {
    Object.defineProperty(document, "fonts", { value: {
      load,
      *[Symbol.iterator]() { yield { family: registeredFamily }; },
    }, configurable: true });
    const weight = family === "Fraunces" ? 600 : 700;
    const pending = ensureFontFamily(family, weight, "BREAKING");
    const link = document.querySelector(`link[data-openreel-font="${family}"]`);
    // Complete a redundant request so the failing implementation cannot leave
    // a download timeout behind in this offline-font regression.
    link?.dispatchEvent(new Event("load"));
    await pending;
    expect(link).toBeNull();
    expect(load).toHaveBeenCalledWith(`${weight} 48px "${family}"`, "BREAKING");
  });
  it("retries a failed stylesheet and reports the font that was unavailable", async () => {
    const failed = ensureFontFamily("Lobster").catch((error: unknown) => error);
    document.querySelector('link[data-openreel-font="Lobster"]')!.dispatchEvent(new Event("error"));
    expect((await failed as Error).message).toContain("Lobster");
    const retry = ensureFontFamily("Lobster");
    document.querySelector('link[data-openreel-font="Lobster"]')!.dispatchEvent(new Event("load"));
    await retry;
  });
  it("collects caption glyphs and waits for project fonts before export", async () => {
    const project = createEmptyProject("Font sample");
    const modified = { ...project, timeline: { ...project.timeline, subtitles: [{ id: "subtitle", text: "Olá 字幕", startTime: 0, endTime: 1, style: { fontFamily: "Inter", fontSize: 24, color: "white", backgroundColor: "black", position: "bottom" as const } }] } };
    expect(collectProjectFonts(modified)).toEqual([{ family: "Inter", weight: "700", sample: "Olá 字幕" }]);
    await ensureProjectFonts(modified);
    expect(load).toHaveBeenCalledWith('700 48px "Inter"', "Olá 字幕");
  });

  it("skips text clips and motion text layers saved without a style instead of throwing", () => {
    const project = createEmptyProject("No style");
    const modified = {
      ...project,
      textClips: [{ id: "t", trackId: "x", startTime: 0, duration: 1, text: "Title" }],
      motionCompositions: [{ id: "c", name: "Comp", layers: [{ id: "l", type: "text", name: "Layer", text: "Hi" }] }],
    } as unknown as typeof project;
    expect(collectProjectFonts(modified)).toEqual([]);
    expect([...collectFontUsages(modified)]).toEqual([]);
  });
});
