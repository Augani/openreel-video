import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createEmptyProject, loadProjectFile, saveProjectFile } from "./project-io";

const tempFiles: string[] = [];
function tmpFile(): string {
  const file = path.join(tmpdir(), `openreel-proj-${randomUUID()}.json`);
  tempFiles.push(file);
  return file;
}

afterEach(async () => {
  await Promise.all(tempFiles.splice(0).map((f) => rm(f, { force: true })));
});

describe("project-io", () => {
  it("createEmptyProject produces a valid project", () => {
    const project = createEmptyProject("My Reel");
    expect(project.name).toBe("My Reel");
    expect(project.settings.width).toBe(1920);
    expect(project.timeline.tracks).toEqual([]);
    expect(typeof project.id).toBe("string");
  });

  it("round-trips a project through save and load", async () => {
    const file = tmpFile();
    const project = createEmptyProject("RoundTrip");
    await saveProjectFile(file, project);
    const loaded = await loadProjectFile(file);
    expect(loaded.name).toBe("RoundTrip");
    expect(loaded.settings).toEqual(project.settings);
    expect(loaded.id).toBe(project.id);
  });

  it("writes JSON wrapped with a schema version", async () => {
    const file = tmpFile();
    await saveProjectFile(file, createEmptyProject("V"));
    const raw = JSON.parse(await readFile(file, "utf8")) as { version: string; project: unknown };
    expect(typeof raw.version).toBe("string");
    expect(raw.project).toBeTruthy();
  });

  it("rejects an invalid project file", async () => {
    const file = tmpFile();
    await writeFile(file, "{not valid json", "utf8");
    await expect(loadProjectFile(file)).rejects.toThrow();
  });
});
