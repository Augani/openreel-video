import "../test/install-local-storage-mock";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionExecutor, type Clip, type MediaItem, type Project, type ProjectVersionRecord, type VersionPolicy } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { projectManager } from "./project-manager";
import {
  createSidecarBackend,
  createVersion,
  indexedDbBackend,
  listVersions,
  setVersionBackendsForTests,
  sidecarPathFor,
  type VersionBackend,
} from "./project-versions";
import {
  deleteVersion,
  mergeRestoredMedia,
  restoreVersion,
  restoreVersionAsCopy,
  runAutoVersionCheck,
  saveNamedVersion,
  stopAutoVersioning,
} from "./version-commands";

const state = () => useProjectStore.getState();
const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };
const clip = (id: string, startTime: number): Clip => ({
  id, trackId: "v1", mediaId: "m1", startTime, duration: 4, inPoint: 0, outPoint: 4, transform, volume: 1, effects: [], audioEffects: [], keyframes: [],
});
const media = (id: string, blob: Blob | null): MediaItem =>
  ({ id, name: id, type: "video", fileHandle: null, blob, metadata: { duration: 10, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 0, channels: 0, fileSize: 1 }, thumbnailUrl: null, waveformData: null }) as unknown as MediaItem;

function open(clips: Clip[], items: MediaItem[] = [media("m1", new Blob(["x"]))]): Project {
  const base = createEmptyProject("Versioned");
  const project: Project = {
    ...base,
    timeline: {
      ...base.timeline,
      duration: 8,
      tracks: [{ id: "v1", name: "V1", type: "video", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false }],
    },
    mediaLibrary: { items },
  };
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project, actionExecutor: executor, actionHistory: executor.getHistory(), hasOpenProject: true,
    clipUndoStack: [], clipRedoStack: [], templateUndoStack: [], templateRedoStack: [], redoJournal: [],
  });
  return project;
}
const clipIds = () => state().project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id));

function memoryBackend(): VersionBackend & { records: Map<string, ProjectVersionRecord> } {
  const records = new Map<string, ProjectVersionRecord>();
  return {
    records,
    list: async (projectId) => [...records.values()].filter((r) => r.projectId === projectId),
    put: async (record) => void records.set(record.id, record),
    remove: async (ids) => ids.forEach((id) => records.delete(id)),
  };
}

let backend: ReturnType<typeof memoryBackend>;

beforeEach(() => {
  backend = memoryBackend();
  setVersionBackendsForTests([backend]);
  useUIStore.setState({ effectApplicationClipId: null, exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  useTimelineStore.setState({ playbackLockedReason: null });
  // The schema normalizers live in lazily loaded engine modules; a version is the same JSON a file holds.
  vi.spyOn(projectManager, "parseProjectContent").mockImplementation(async (content: string) => JSON.parse(content) as Project);
});
afterEach(() => {
  setVersionBackendsForTests(null);
  stopAutoVersioning();
  vi.restoreAllMocks();
});

describe("named versions", () => {
  it("saves a manual snapshot with metadata and no media blobs", async () => {
    open([clip("a", 0), clip("b", 4)]);
    const meta = await saveNamedVersion("Rough cut");
    expect(meta).toMatchObject({ name: "Rough cut", kind: "manual" });
    expect(meta?.summary).toMatchObject({ clips: 2, tracks: 1, mediaItems: 1 });
    const [record] = [...backend.records.values()];
    const stored = JSON.parse(record.data) as Project;
    expect(stored.mediaLibrary.items[0].blob).toBeNull();
    expect(record.bytes).toBeGreaterThan(100);
  });

  it("lists newest first and deletes", async () => {
    open([clip("a", 0)]);
    const first = await createVersion(state().getFullProject(), { kind: "manual", name: "one" });
    await new Promise((r) => setTimeout(r, 5));
    await createVersion(state().getFullProject(), { kind: "manual", name: "two" });
    const list = await listVersions(state().project.id);
    expect(list.map((v) => v.name)).toEqual(["two", "one"]);
    await deleteVersion(first.id);
    expect((await listVersions(state().project.id)).map((v) => v.name)).toEqual(["two"]);
  });
});

describe("restore", () => {
  it("replaces the edit as one undoable step and keeps live media blobs", async () => {
    open([clip("a", 0), clip("b", 4)]);
    await saveNamedVersion("Two clips");
    // Edit afterwards: drop clip b, add clip c, and import more media.
    const edited = state().project;
    useProjectStore.setState({
      project: {
        ...edited,
        timeline: { ...edited.timeline, tracks: [{ ...edited.timeline.tracks[0], clips: [clip("a", 0), clip("c", 4)] }] },
        mediaLibrary: { items: [...edited.mediaLibrary.items, media("m2", new Blob(["y"]))] },
      },
    });
    const liveBlob = state().project.mediaLibrary.items[0].blob;
    const undoBefore = state().actionExecutor.getHistory().getUndoStackSize();

    expect(await restoreVersion([...backend.records.keys()][0])).toBe(true);
    expect(clipIds()).toEqual(["a", "b"]);
    expect(state().project.mediaLibrary.items.map((i) => i.id)).toEqual(["m1", "m2"]);
    expect(state().project.mediaLibrary.items[0].blob).toBe(liveBlob);
    expect(state().actionExecutor.getHistory().getUndoStackSize()).toBe(undoBefore + 1);

    await state().undo();
    expect(clipIds()).toEqual(["a", "c"]);
    await state().redo();
    expect(clipIds()).toEqual(["a", "b"]);
  });

  it("stores a safety version of the replaced edit before restoring", async () => {
    open([clip("a", 0)]);
    await saveNamedVersion("Base");
    const edited = state().project;
    useProjectStore.setState({ project: { ...edited, timeline: { ...edited.timeline, tracks: [{ ...edited.timeline.tracks[0], clips: [clip("z", 0)] }] } } });
    await restoreVersion([...backend.records.keys()][0]);
    const names = (await listVersions(state().project.id)).map((v) => v.name);
    expect(names).toContain('Before restoring "Base"');
    const safety = [...backend.records.values()].find((r) => r.name.startsWith("Before restoring"))!;
    expect((JSON.parse(safety.data) as Project).timeline.tracks[0].clips.map((c) => c.id)).toEqual(["z"]);
  });

  it("refuses while an export is running", async () => {
    open([clip("a", 0)]);
    await saveNamedVersion("Base");
    useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: true } });
    expect(await restoreVersion([...backend.records.keys()][0])).toBe(false);
  });

  it("opens a version as a new project and leaves the original alone", async () => {
    const original = open([clip("a", 0), clip("b", 4)]);
    await saveNamedVersion("Keep");
    const edited = state().project;
    useProjectStore.setState({ project: { ...edited, timeline: { ...edited.timeline, tracks: [{ ...edited.timeline.tracks[0], clips: [clip("a", 0)] }] } } });
    vi.spyOn(projectManager, "activatePickedProject").mockImplementation(() => {});
    const loadProject = vi.fn<[Project], void>();
    useProjectStore.setState({ forceSave: async () => {}, loadProject });

    expect(await restoreVersionAsCopy([...backend.records.keys()][0])).toBe(true);
    const copy = loadProject.mock.calls[0][0] as Project;
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Versioned (Keep)");
    expect(copy.timeline.tracks[0].clips.map((c) => c.id)).toEqual(["a", "b"]);
    expect(clipIds()).toEqual(["a"]);
  });
});

describe("mergeRestoredMedia", () => {
  it("prefers live items, keeps unknown live items and leaves missing ones as placeholders", () => {
    const live = new Blob(["live"]);
    const snapshot = { mediaLibrary: { items: [media("a", null), media("gone", null)] } } as unknown as Project;
    const current = { mediaLibrary: { items: [media("a", live), media("new", live)] } } as unknown as Project;
    const merged = mergeRestoredMedia(snapshot, current).mediaLibrary.items;
    expect(merged.map((i) => i.id)).toEqual(["a", "gone", "new"]);
    expect(merged[0].blob).toBe(live);
    expect(merged[1].blob).toBeNull();
  });
});

describe("automatic versions", () => {
  const policy: VersionPolicy = { maxAuto: 2, maxManual: 5, maxBytes: 10 * 1024 * 1024, autoIntervalMs: 1000 };

  it("baselines first, then snapshots only after the interval and a change, capped to the policy", async () => {
    open([clip("a", 0)]);
    expect(await runAutoVersionCheck(0, policy)).toBeNull();
    expect(await runAutoVersionCheck(2000, policy)).toBeNull();

    const change = (id: string) => {
      const p = state().project;
      useProjectStore.setState({ project: { ...p, timeline: { ...p.timeline, tracks: [{ ...p.timeline.tracks[0], clips: [clip(id, 0)] }] } } });
    };
    change("b");
    expect(await runAutoVersionCheck(2500, policy)).toMatchObject({ kind: "auto" });
    change("b2");
    expect(await runAutoVersionCheck(2600, policy)).toBeNull();
    expect(await runAutoVersionCheck(9000, policy)).not.toBeNull();
    expect(await runAutoVersionCheck(20_000, policy)).toBeNull();

    for (const [i, id] of ["c", "d", "e"].entries()) {
      change(id);
      await new Promise((r) => setTimeout(r, 3));
      expect(await runAutoVersionCheck(30_000 + i * 2000, policy)).not.toBeNull();
    }
    const autos = (await listVersions(state().project.id)).filter((v) => v.kind === "auto");
    expect(autos).toHaveLength(2);
  });
});

describe("storage backends", () => {
  it("round-trips through IndexedDB", async () => {
    setVersionBackendsForTests([indexedDbBackend]);
    open([clip("a", 0)]);
    const meta = await createVersion(state().getFullProject(), { kind: "manual", name: "idb" });
    expect((await listVersions(state().project.id)).map((v) => v.id)).toEqual([meta.id]);
    expect((await listVersions("other-project")).length).toBe(0);
  });

  it("keeps a desktop project's versions in a sidecar file next to it", async () => {
    const files = new Map<string, string>();
    window.openreel = {
      fs: {
        readFile: async (p: string) => {
          if (!files.has(p)) throw new Error("ENOENT");
          return files.get(p)!;
        },
        writeFile: async (p: string, data: string) => void files.set(p, data),
      },
    } as unknown as NonNullable<Window["openreel"]>;
    try {
      const sidecar = createSidecarBackend("/work/film.oreel");
      setVersionBackendsForTests([sidecar]);
      open([clip("a", 0)]);
      const first = await createVersion(state().getFullProject(), { kind: "manual", name: "one" });
      await createVersion(state().getFullProject(), { kind: "auto" });
      expect([...files.keys()]).toEqual([sidecarPathFor("/work/film.oreel")]);
      expect(sidecarPathFor("/work/film.oreel")).toBe("/work/film.oreel.versions.json");
      expect((await listVersions(state().project.id)).length).toBe(2);
      await deleteVersion(first.id);
      expect((await listVersions(state().project.id)).map((v) => v.kind)).toEqual(["auto"]);
    } finally {
      delete window.openreel;
    }
  });
});
