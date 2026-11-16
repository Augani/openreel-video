import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {},
  ipcMain: { on: vi.fn(), handle: vi.fn() },
}));

import {
  AUTOMATION_ENV_VARS,
  buildPickFilesOptions,
  computeAutomation,
  readOnboardingMirror,
  writeOnboardingMirror,
} from "../src/main/ipc/onboarding";

describe("computeAutomation", () => {
  it("is false on a plain launch", () => {
    expect(computeAutomation({}, ["electron", "."])).toBe(false);
  });
  it.each(AUTOMATION_ENV_VARS)("is true when %s is set", (name) => {
    expect(computeAutomation({ [name]: "1" }, [])).toBe(true);
  });
  it("ignores empty, 0 and false values", () => {
    expect(computeAutomation({ CI: "", OPENREEL_PERF: "0", OPENREEL_E2E: "false" }, [])).toBe(false);
  });
  it("honours --no-onboarding", () => {
    expect(computeAutomation({}, ["x", "--no-onboarding"])).toBe(true);
  });
  it("OPENREEL_FORCE_ONBOARDING overrides every other signal", () => {
    expect(
      computeAutomation({ CI: "true", OPENREEL_PERF: "1", OPENREEL_FORCE_ONBOARDING: "1" }, ["--no-onboarding"]),
    ).toBe(false);
  });
});

describe("onboarding mirror file", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "onb-mirror-"));
    dirs.push(d);
    return path.join(d, "onboarding.json");
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("round trips and returns null when missing or corrupt", async () => {
    const file = tmp();
    expect(await readOnboardingMirror(file)).toBeNull();
    await writeOnboardingMirror({ v: 1, status: "done", persona: "pro", completedAt: 5 }, file);
    expect(await readOnboardingMirror(file)).toEqual({ v: 1, status: "done", persona: "pro", completedAt: 5 });
    fs.writeFileSync(file, "{not json");
    expect(await readOnboardingMirror(file)).toBeNull();
  });

  it("never persists an automation skip", async () => {
    const file = tmp();
    await writeOnboardingMirror({ v: 1, status: "skipped", skippedBy: "automation" }, file);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("buildPickFilesOptions", () => {
  it("defaults to multi-select over all media kinds", () => {
    const o = buildPickFilesOptions(undefined);
    expect(o.properties).toContain("multiSelections");
    expect(o.filters?.[0].extensions).toEqual(expect.arrayContaining(["mp4", "wav", "png"]));
  });
  it("restricts to the requested kind and single select", () => {
    const o = buildPickFilesOptions({ kinds: ["audio"], multiple: false });
    expect(o.properties).toEqual(["openFile"]);
    expect(o.filters?.[0].extensions).toContain("mp3");
    expect(o.filters?.[0].extensions).not.toContain("mp4");
  });
});
