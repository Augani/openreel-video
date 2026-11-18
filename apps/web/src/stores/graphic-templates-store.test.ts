import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_GRAPHIC_TEMPLATES, getBuiltInGraphicTemplate } from "@openreel/core";

const KEY = "openreel-graphic-templates-v1";
const custom = (id: string, name = "Mine") => ({ ...getBuiltInGraphicTemplate("builtin-lt-classic-bar")!, id, name, category: "custom" as const });

async function freshStore() {
  vi.resetModules();
  return (await import("./graphic-templates-store")).useGraphicTemplatesStore;
}

describe("graphic templates store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("lists the built-ins first and persists saved templates", async () => {
    const store = await freshStore();
    store.getState().save(custom("custom-1"));
    expect(store.getState().list().slice(0, BUILT_IN_GRAPHIC_TEMPLATES.length)).toEqual([...BUILT_IN_GRAPHIC_TEMPLATES]);
    expect(store.getState().get("custom-1")?.name).toBe("Mine");
    const reloaded = await freshStore();
    expect(reloaded.getState().userTemplates.map((template) => template.id)).toEqual(["custom-1"]);
  });

  it("saving the same id replaces it; remove deletes it", async () => {
    const store = await freshStore();
    store.getState().save(custom("custom-1", "First"));
    store.getState().save(custom("custom-1", "Second"));
    expect(store.getState().userTemplates).toHaveLength(1);
    expect(store.getState().userTemplates[0].name).toBe("Second");
    store.getState().remove("custom-1");
    expect(store.getState().userTemplates).toHaveLength(0);
  });

  it("drops stored entries that fail validation (corrupt or tampered storage)", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([custom("good"), { id: "bad", layers: "nope" }, { ...custom("evil"), layers: [{ id: "x", name: "x", kind: "svg", x: 1, y: 1, width: 1, height: 1, svg: { svgContent: "<svg><script>1</script></svg>", viewBoxWidth: 1, viewBoxHeight: 1 } }] }]),
    );
    const store = await freshStore();
    expect(store.getState().userTemplates.map((template) => template.id)).toEqual(["good"]);
  });

  it("survives unreadable storage and reports a failed write", async () => {
    localStorage.setItem(KEY, "{not json");
    const store = await freshStore();
    expect(store.getState().userTemplates).toEqual([]);
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    store.getState().save(custom("custom-2"));
    expect(store.getState().persistenceFailed).toBe(true);
    expect(store.getState().get("custom-2")).toBeDefined();
    setItem.mockRestore();
  });
});
