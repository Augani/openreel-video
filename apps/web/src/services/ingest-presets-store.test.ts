import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INGEST_PRESETS_STORAGE_KEY, readStoredPresets, useIngestPresetsStore, writeStoredPresets } from "./ingest-presets-store";

const profile = { codec: "prores-lt", size: "half", audio: "strip" } as const;

beforeEach(() => {
  localStorage.clear();
  useIngestPresetsStore.setState({ presets: [] });
});

describe("user presets in app settings", () => {
  it("creates, duplicates, renames, edits and deletes, saving after each change", () => {
    const store = useIngestPresetsStore.getState();
    const created = store.create("Dailies", profile);
    expect(created.ok).toBe(true);
    const id = created.ok ? created.preset.id : "";
    expect(readStoredPresets().map((p) => p.name)).toEqual(["Dailies"]);
    const copy = useIngestPresetsStore.getState().duplicate("prores-proxy");
    expect(copy.ok && copy.preset.name).toBe("ProRes Proxy copy");
    expect(useIngestPresetsStore.getState().rename(id, "Rushes").ok).toBe(true);
    expect(useIngestPresetsStore.getState().updateProfile(id, { codec: "h264", size: "720p" }).ok).toBe(true);
    expect(readStoredPresets().find((p) => p.id === id)).toMatchObject({ name: "Rushes", profile: { codec: "h264", size: "720p" } });
    expect(useIngestPresetsStore.getState().remove(id).ok).toBe(true);
    expect(readStoredPresets().map((p) => p.name)).toEqual(["ProRes Proxy copy"]);
  });
  it("survives a restart: a fresh read of the stored settings returns the same presets", () => {
    useIngestPresetsStore.getState().create("Dailies", profile);
    const before = useIngestPresetsStore.getState().presets;
    useIngestPresetsStore.setState({ presets: [] });
    useIngestPresetsStore.getState().reload();
    expect(useIngestPresetsStore.getState().presets).toEqual(before);
  });
  it("reports errors without changing anything", () => {
    const store = useIngestPresetsStore.getState();
    expect(store.create("", profile).ok).toBe(false);
    expect(store.create("ProRes Proxy", profile).ok).toBe(false);
    expect(store.rename("h264-half", "Mine").ok).toBe(false);
    expect(store.remove("h264-half").ok).toBe(false);
    expect(localStorage.getItem(INGEST_PRESETS_STORAGE_KEY)).toBeNull();
  });
  it("reads corrupt or foreign storage as no presets", () => {
    localStorage.setItem(INGEST_PRESETS_STORAGE_KEY, "{not json");
    expect(readStoredPresets()).toEqual([]);
    localStorage.setItem(INGEST_PRESETS_STORAGE_KEY, JSON.stringify({ version: 9, presets: [{ id: "x", name: "N", profile: { codec: "nope", size: "half" } }] }));
    expect(readStoredPresets()).toEqual([]);
  });
  it("keeps working for the session when storage throws", () => {
    const failing = { setItem: vi.fn(() => { throw new Error("quota"); }) };
    expect(() => writeStoredPresets([], failing)).not.toThrow();
    expect(readStoredPresets({ getItem: () => { throw new Error("blocked"); } })).toEqual([]);
  });
  it("follows a change made by another window", () => {
    writeStoredPresets([{ id: "user-x", name: "Elsewhere", builtIn: false, profile: { codec: "h264", size: "half" } }]);
    window.dispatchEvent(new StorageEvent("storage", { key: INGEST_PRESETS_STORAGE_KEY }));
    expect(useIngestPresetsStore.getState().presets.map((p) => p.name)).toEqual(["Elsewhere"]);
  });
});
