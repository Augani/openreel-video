import { describe, it, expect, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MockLLMClient } from "@openreel/agent";
import type { LLMResponse } from "@openreel/agent";
import { runHeadlessEdit, runHeadlessEditFile } from "./run";
import { createEmptyProject, loadProjectFile, saveProjectFile } from "./project-io";

const tempFiles: string[] = [];
function tmpFile(): string {
  const file = path.join(tmpdir(), `openreel-run-${randomUUID()}.json`);
  tempFiles.push(file);
  return file;
}
afterEach(async () => {
  await Promise.all(tempFiles.splice(0).map((f) => rm(f, { force: true })));
});

function script(...responses: LLMResponse[]): MockLLMClient {
  return new MockLLMClient(responses);
}

describe("runHeadlessEdit", () => {
  it("performs a multi-tool editing turn against an in-memory project", async () => {
    const llm = script(
      {
        text: "Renaming and adding a track.",
        stopReason: "tool_use",
        toolUses: [
          { id: "t1", name: "rename_project", input: { name: "Edited" } },
          { id: "t2", name: "add_track", input: { trackType: "video" } },
        ],
      },
      { text: "Done.", stopReason: "end_turn", toolUses: [] },
    );

    const { project, result } = await runHeadlessEdit({
      project: createEmptyProject("Original"),
      prompt: "Rename to Edited and add a video track",
      provider: "anthropic",
      model: "mock",
      apiKey: "unused",
      llm,
    });

    expect(result.stoppedReason).toBe("end_turn");
    expect(result.committed).toBe(true);
    expect(result.toolCalls).toBe(2);
    expect(project.name).toBe("Edited");
    expect(project.timeline.tracks).toHaveLength(1);
  });

  it("rolls the project back atomically when a turn errors", async () => {
    const llm: { complete: () => Promise<LLMResponse> } = {
      complete: async () => {
        throw new Error("LLM exploded");
      },
    };
    const project = createEmptyProject("KeepMe");
    const { project: after, result } = await runHeadlessEdit({
      project,
      prompt: "do something",
      provider: "anthropic",
      model: "mock",
      apiKey: "unused",
      llm,
    });
    expect(result.stoppedReason).toBe("error");
    expect(result.committed).toBe(false);
    expect(after.name).toBe("KeepMe");
  });
});

describe("runHeadlessEditFile", () => {
  it("loads a stored project, edits it, and saves the result — no app", async () => {
    const inPath = tmpFile();
    const outPath = tmpFile();
    await saveProjectFile(inPath, createEmptyProject("Stored"));

    const llm = script(
      {
        text: "Adding a track.",
        stopReason: "tool_use",
        toolUses: [{ id: "t1", name: "add_track", input: { trackType: "audio" } }],
      },
      { text: "Done.", stopReason: "end_turn", toolUses: [] },
    );

    const { result } = await runHeadlessEditFile({
      projectPath: inPath,
      outPath,
      prompt: "add an audio track",
      provider: "anthropic",
      model: "mock",
      apiKey: "unused",
      llm,
    });

    expect(result.toolCalls).toBe(1);
    const saved = await loadProjectFile(outPath);
    expect(saved.timeline.tracks).toHaveLength(1);
    expect(saved.timeline.tracks[0].type).toBe("audio");
  });

  it("does not save when the turn errors", async () => {
    const inPath = tmpFile();
    const outPath = tmpFile();
    await saveProjectFile(inPath, createEmptyProject("Errored"));
    const llm = { complete: async () => { throw new Error("boom"); } };

    const { result, saved } = await runHeadlessEditFile({
      projectPath: inPath,
      outPath,
      prompt: "do something",
      provider: "anthropic",
      model: "mock",
      apiKey: "unused",
      llm,
    });
    expect(result.stoppedReason).toBe("error");
    expect(saved).toBe(false);
    await expect(loadProjectFile(outPath)).rejects.toThrow();
  });

  it("does not save on a dry-run", async () => {
    const inPath = tmpFile();
    const outPath = tmpFile();
    await saveProjectFile(inPath, createEmptyProject("DryRun"));
    const llm = script(
      {
        text: "",
        stopReason: "tool_use",
        toolUses: [{ id: "t1", name: "add_track", input: { trackType: "video" } }],
      },
      { text: "planned", stopReason: "end_turn", toolUses: [] },
    );

    const { saved } = await runHeadlessEditFile({
      projectPath: inPath,
      outPath,
      prompt: "add a track",
      provider: "anthropic",
      model: "mock",
      apiKey: "unused",
      llm,
      dryRun: true,
    });
    expect(saved).toBe(false);
    await expect(loadProjectFile(outPath)).rejects.toThrow();
  });
});
