import { describe, expect, it } from "vitest";
import { TRANSITION_TYPES, type TransitionType } from "../types/effects";
import type { Project } from "../types/project";
import { exportTimeline, importTimeline } from "./index";
import { TRANSITION_NAMES, hasCustomSettings, transitionTypeFromName } from "./transition-names";
import { FCP_CLOSEST } from "./transition-fcp";
import { buildProject } from "./__fixtures__/project";

let n = 0;
const makeId = () => `id-${(n += 1)}`;
const NAMED = TRANSITION_TYPES.filter((type) => TRANSITION_NAMES[type] && type !== "morphCut");
const UNNAMED = TRANSITION_TYPES.filter((type) => !TRANSITION_NAMES[type] && !["crossfade", "dipToBlack", "dipToWhite", "wipe", "push", "slide"].includes(type));

function withTransition(type: TransitionType, params: Record<string, unknown> = {}): Project {
  const project = buildProject(24);
  const main = project.timeline.tracks.find((t) => t.id === "t-main")!;
  main.transitions[0] = { ...main.transitions[0]!, type, params };
  return project;
}
const transitionsAfterImport = (project: Project, format: "xmeml" | "otio" | "fcpxml") => {
  const text = exportTimeline(project, format).files[0]!.content;
  const imported = importTimeline(text, { mediaItems: project.mediaLibrary.items, makeId });
  return imported.tracks.flatMap((t) => t.transitions);
};
const transitionItems = (project: Project, format: "xmeml" | "otio" | "fcpxml" | "edl" | "aaf") =>
  exportTimeline(project, format).report.items.filter((i) => i.feature === "Transition");

describe("transition names in interchange", () => {
  it("every new and previous-round transition has a Premiere name, or is reported as approximated", () => {
    for (const type of ["crossZoom", "pagePeel", "checkerboard", "checkerWipe", "inset", "split", "wedgeWipe", "randomBlocks", "randomWipe", "flipOver", "cubeSpin", "irisRound", "irisBox", "irisCross", "irisDiamond", "bandWipe", "barnDoor", "clockWipe", "gradientWipe", "filmDissolve", "additiveDissolve"] as const) {
      expect(TRANSITION_NAMES[type], type).toBeDefined();
    }
    expect(NAMED.length).toBeGreaterThan(20);
    for (const type of UNNAMED) expect(TRANSITION_NAMES[type], type).toBeUndefined();
    expect(UNNAMED).toContain("glitch");
  });

  it("names are unique and resolve back to their type", () => {
    const names = NAMED.map((type) => TRANSITION_NAMES[type]!.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const type of NAMED) expect(transitionTypeFromName(TRANSITION_NAMES[type]!.name), type).toBe(type);
    expect(transitionTypeFromName("  barn DOOR ")).toBe("barnDoor");
    expect(transitionTypeFromName("Cross Dissolve")).toBeNull();
  });

  it.each(NAMED)("%s: xmeml writes Premiere's name and reads it back as the same transition", (type) => {
    const project = withTransition(type);
    const text = exportTimeline(project, "xmeml").files[0]!.content;
    const name = TRANSITION_NAMES[type]!;
    expect(text).toContain(`<name>${name.name}</name>`);
    expect(text).toContain(`<effectid>${name.name}</effectid>`);
    expect(text).toContain(`<effectcategory>${name.category}</effectcategory>`);
    expect(transitionsAfterImport(project, "xmeml").map((t) => t.type)).toEqual([type]);
    expect(transitionItems(project, "xmeml")).toEqual([]);
  });

  it.each(NAMED)("%s: OTIO carries the name and the exact type", (type) => {
    const project = withTransition(type);
    const text = exportTimeline(project, "otio").files[0]!.content;
    expect(text).toContain(`"name": "${TRANSITION_NAMES[type]!.name}"`);
    expect(transitionsAfterImport(project, "otio").map((t) => t.type)).toEqual([type]);
  });

  it.each(NAMED)("%s: FCPXML, EDL and AAF write a dissolve and say so, naming the closest Final Cut transition", (type) => {
    const project = withTransition(type);
    for (const format of ["fcpxml", "edl", "aaf"] as const) {
      const items = transitionItems(project, format);
      expect(items, `${type} ${format}`).toHaveLength(1);
      expect(items[0]!.severity).toBe("approximated");
      expect(items[0]!.detail).toContain(TRANSITION_NAMES[type]!.name);
      expect(items[0]!.detail).toMatch(/dissolve/);
    }
    expect(transitionItems(project, "fcpxml")[0]!.detail).toContain(`"${FCP_CLOSEST[type]}"`);
    expect(exportTimeline(project, "edl").files[0]!.content).toContain(`* EFFECT NAME: ${TRANSITION_NAMES[type]!.name.toUpperCase()}`);
    expect(transitionsAfterImport(project, "fcpxml").map((t) => t.type)).toEqual(["crossfade"]);
  });

  it.each(UNNAMED)("%s: no equivalent, so every format writes a cross dissolve and reports it approximated", (type) => {
    const project = withTransition(type);
    for (const format of ["xmeml", "otio", "fcpxml", "edl", "aaf"] as const) {
      expect(exportTimeline(project, format).report.items.some((i) => i.feature === "Transition" && i.severity === "approximated" && i.detail.includes("cross dissolve")), `${type} ${format}`).toBe(true);
    }
    expect(transitionsAfterImport(project, "xmeml").map((t) => t.type)).toEqual(["crossfade"]);
  });

  it("settings that Premiere's XML cannot carry are reported, and OTIO says they come back through OpenReel's metadata", () => {
    const custom = withTransition("cubeSpin", { direction: "up", borderWidth: 4 });
    expect(transitionItems(custom, "xmeml")[0]!.detail).toMatch(/settings .* are not carried/);
    expect(transitionItems(custom, "otio")[0]!.detail).toMatch(/restored when this file is imported back/);
    expect(transitionItems(withTransition("cubeSpin", { direction: "left", borderWidth: 0, alignment: "start", curve: "ease" }), "xmeml")).toEqual([]);
    expect(hasCustomSettings("cubeSpin", { direction: "left" })).toBe(false);
    expect(hasCustomSettings("randomBlocks", { seed: 5 })).toBe(true);
  });

  it("transitions that already had a kind still export under their old names", () => {
    const project = withTransition("wipe");
    const text = exportTimeline(project, "xmeml").files[0]!.content;
    expect(text).toContain("<name>Wipe</name>");
    expect(transitionsAfterImport(project, "xmeml").map((t) => t.type)).toEqual(["wipe"]);
    expect(transitionsAfterImport(withTransition("push"), "xmeml").map((t) => t.type)).toEqual(["push"]);
    expect(transitionsAfterImport(withTransition("dipToBlack"), "otio").map((t) => t.type)).toEqual(["dipToBlack"]);
  });
});

describe("Morph Cut in interchange", () => {
  it("is named \"Morph Cut\" in Premiere XML and OTIO, reads back as the same transition, and says its analysis is not carried", () => {
    const project = withTransition("morphCut", { quality: "high" });
    expect(TRANSITION_NAMES.morphCut).toEqual({ name: "Morph Cut", category: "Dissolve" });
    expect(transitionTypeFromName("Morph Cut")).toBe("morphCut");
    const xml = exportTimeline(project, "xmeml").files[0]!.content;
    expect(xml).toContain("<name>Morph Cut</name>");
    expect(transitionsAfterImport(project, "xmeml").map((t) => t.type)).toEqual(["morphCut"]);
    expect(transitionsAfterImport(project, "otio").map((t) => t.type)).toEqual(["morphCut"]);
    for (const format of ["xmeml", "otio"] as const) {
      const items = transitionItems(project, format);
      expect(items, format).toHaveLength(1);
      expect(items[0]!.severity).toBe("approximated");
      expect(items[0]!.detail).toContain("analysis is not exported");
    }
  });

  it("FCPXML, EDL and AAF write a cross dissolve and report it approximated", () => {
    const project = withTransition("morphCut");
    for (const format of ["fcpxml", "edl", "aaf"] as const) {
      const items = transitionItems(project, format);
      expect(items, format).toHaveLength(1);
      expect(items[0]!.severity).toBe("approximated");
      expect(items[0]!.detail).toMatch(/Morph Cut.*dissolve/);
    }
    expect(transitionsAfterImport(project, "fcpxml").map((t) => t.type)).toEqual(["crossfade"]);
  });
});
