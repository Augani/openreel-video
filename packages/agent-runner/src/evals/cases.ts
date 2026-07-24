import { MockLLMClient } from "@openreel/agent";
import type { LLMResponse } from "@openreel/agent";
import { createEmptyProject } from "../project-io";
import type { EvalCase } from "./harness";

const END: LLMResponse = { text: "Done.", stopReason: "end_turn", toolUses: [] };

function scripted(...responses: LLMResponse[]): MockLLMClient {
  return new MockLLMClient([...responses, END]);
}

/**
 * Deterministic regression corpus: each case scripts the model's tool sequence
 * and asserts the resulting project state. Real-LLM mode (no `llm`) drives the
 * same prompts/assertions against a BYOK model for live eval runs.
 */
export const SCRIPTED_CASES: EvalCase[] = [
  {
    name: "rename project and add a video track",
    makeProject: () => createEmptyProject("Original"),
    prompt: "Rename the project to Edited and add a video track",
    llm: scripted({
      text: "Renaming and adding a track.",
      stopReason: "tool_use",
      toolUses: [
        { id: "t1", name: "rename_project", input: { name: "Edited" } },
        { id: "t2", name: "add_track", input: { trackType: "video" } },
      ],
    }),
    expectedTools: ["rename_project", "add_track"],
    assert: (project) => {
      const failures: string[] = [];
      if (project.name !== "Edited") failures.push(`name is ${project.name}`);
      if (project.timeline.tracks.length !== 1) {
        failures.push(`expected 1 track, got ${project.timeline.tracks.length}`);
      }
      return failures;
    },
  },
  {
    name: "add a video and an audio track",
    makeProject: () => createEmptyProject("Tracks"),
    prompt: "Add a video track and an audio track",
    llm: scripted({
      text: "Adding both tracks.",
      stopReason: "tool_use",
      toolUses: [
        { id: "t1", name: "add_track", input: { trackType: "video" } },
        { id: "t2", name: "add_track", input: { trackType: "audio" } },
      ],
    }),
    expectedTools: ["add_track", "add_track"],
    assert: (project) =>
      project.timeline.tracks.length === 2
        ? []
        : [`expected 2 tracks, got ${project.timeline.tracks.length}`],
  },
  {
    name: "answer without editing leaves the project untouched",
    makeProject: () => createEmptyProject("Pristine"),
    prompt: "What resolution is this project?",
    llm: scripted(),
    expectedTools: [],
    assert: (project, result) => {
      const failures: string[] = [];
      if (project.timeline.tracks.length !== 0) failures.push("tracks were modified");
      if (result.stoppedReason !== "end_turn") failures.push(`stopped: ${result.stoppedReason}`);
      return failures;
    },
  },
];
