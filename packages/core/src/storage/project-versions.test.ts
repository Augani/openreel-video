import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import {
  DEFAULT_VERSION_POLICY,
  autoSnapshotDue,
  createVersionRecord,
  summarizeProject,
  versionLabel,
  versionMeta,
  versionsToPrune,
  type ProjectVersionMeta,
  type VersionPolicy,
} from "./project-versions";

const project = {
  id: "p1",
  name: "Cut",
  createdAt: 0,
  modifiedAt: 0,
  settings: { width: 1920, height: 1080, frameRate: 24, sampleRate: 48000, channels: 2 },
  timeline: {
    duration: 12,
    tracks: [{ clips: [{}, {}] }, { clips: [{}] }],
    subtitles: [],
    markers: [
      { id: "a", time: 1, label: "x", color: "#fff" },
      { id: "b", time: 2, label: "y", color: "#fff", author: "A" },
      { id: "c", time: 3, label: "z", color: "#fff", author: "A", status: "resolved" },
    ],
  },
  mediaLibrary: { items: [{}, {}] },
} as unknown as Project;

const meta = (id: string, kind: "auto" | "manual", createdAt: number, bytes = 10): ProjectVersionMeta => ({
  id,
  projectId: "p1",
  projectName: "Cut",
  name: "",
  kind,
  createdAt,
  bytes,
  summary: summarizeProject(project),
});

describe("version records", () => {
  it("summarises the project", () => {
    expect(summarizeProject(project)).toMatchObject({
      duration: 12,
      tracks: 2,
      clips: 3,
      markers: 3,
      comments: 2,
      openComments: 1,
      mediaItems: 2,
      frameRate: 24,
    });
  });

  it("creates a record with the byte size of its data and a metadata view without it", () => {
    const record = createVersionRecord({ id: "v", project, data: "héllo", kind: "manual", name: "  Rough cut ", now: 5 });
    expect(record).toMatchObject({ id: "v", name: "Rough cut", kind: "manual", createdAt: 5, bytes: 6 });
    expect("data" in versionMeta(record)).toBe(false);
    expect(versionLabel(record)).toBe("Rough cut");
    expect(versionLabel({ name: "", kind: "auto" })).toBe("Auto-save");
  });
});

describe("retention", () => {
  const policy: VersionPolicy = { maxAuto: 2, maxManual: 2, maxBytes: 1000, autoIntervalMs: 1000 };

  it("keeps nothing to prune when within limits", () => {
    expect(versionsToPrune([meta("a", "auto", 1), meta("m", "manual", 2)], policy)).toEqual([]);
  });

  it("caps automatic versions, dropping the oldest", () => {
    const list = [1, 2, 3, 4].map((t) => meta(`a${t}`, "auto", t));
    expect(versionsToPrune(list, policy).sort()).toEqual(["a1", "a2"]);
  });

  it("caps manual versions separately", () => {
    const list = [1, 2, 3].map((t) => meta(`m${t}`, "manual", t));
    expect(versionsToPrune(list, policy)).toEqual(["m1"]);
  });

  it("spends the byte budget on automatic versions before manual ones", () => {
    const list = [meta("m1", "manual", 1, 400), meta("a1", "auto", 2, 400), meta("a2", "auto", 3, 400)];
    expect(versionsToPrune(list, { ...policy, maxBytes: 800 })).toEqual(["a1"]);
  });

  it("drops manual versions only when automatic ones cannot cover the budget, never the newest", () => {
    const list = [meta("m1", "manual", 1, 600), meta("m2", "manual", 2, 600)];
    expect(versionsToPrune(list, { ...policy, maxBytes: 700 })).toEqual(["m1"]);
    expect(versionsToPrune([meta("only", "manual", 1, 5000)], policy)).toEqual([]);
  });

  it("has sensible defaults", () => {
    expect(DEFAULT_VERSION_POLICY.maxAuto).toBeGreaterThan(0);
    expect(DEFAULT_VERSION_POLICY.maxBytes).toBeGreaterThan(1024 * 1024);
  });
});

describe("automatic snapshot schedule", () => {
  const policy: VersionPolicy = { maxAuto: 5, maxManual: 5, maxBytes: 1e6, autoIntervalMs: 1000 };

  it("waits for the interval and for a change", () => {
    expect(autoSnapshotDue({ lastAutoAt: 0, lastData: "a" }, "b", 500, policy)).toBe(false);
    expect(autoSnapshotDue({ lastAutoAt: 0, lastData: "a" }, "b", 1000, policy)).toBe(true);
    expect(autoSnapshotDue({ lastAutoAt: 0, lastData: "a" }, "a", 5000, policy)).toBe(false);
    expect(autoSnapshotDue({ lastAutoAt: null, lastData: null }, "a", 0, policy)).toBe(true);
  });
});
