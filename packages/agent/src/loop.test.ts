import { describe, it, expect, vi } from "vitest";
import { HeadlessHost } from "./headless-host";
import { runTurn } from "./loop";
import { executeTool } from "./executor";
import { MockLLMClient } from "./llm";
import type { LLMClient, LLMResponse, LoopMessage, LoopToolResultBlock } from "./llm";
import { toAnthropicTools } from "./registry";
import { makeEmptyProject, makeProjectWithClip } from "./test-fixtures";
import type { AgentEvent } from "./types";

const tools = toAnthropicTools();
const userMsg = (content: string): LoopMessage[] => [{ role: "user", content }];

describe("runTurn", () => {
  it("executes a multi-tool turn and commits", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const script: LLMResponse[] = [
      {
        text: "Adding a track and slowing the clip.",
        stopReason: "tool_use",
        toolUses: [
          { id: "t1", name: "add_track", input: { trackType: "text" } },
          { id: "t2", name: "set_clip_speed", input: { clipId: "c1", speed: 0.5 } },
        ],
      },
      { text: "Done.", stopReason: "end_turn", toolUses: [] },
    ];
    const events: AgentEvent[] = [];
    const result = await runTurn({
      host,
      llm: new MockLLMClient(script),
      tools,
      messages: userMsg("slow the clip and add a text track"),
      onEvent: (e) => events.push(e),
    });

    expect(result.stoppedReason).toBe("end_turn");
    expect(result.committed).toBe(true);
    expect(result.toolCalls).toBe(2);
    expect(host.getProject().timeline.tracks).toHaveLength(2);
    expect(host.getProject().timeline.tracks[0].clips[0].speed).toBe(0.5);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
    expect(events.at(-1)?.type).toBe("turn_complete");
  });

  it("dry-run does not mutate the project", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const script: LLMResponse[] = [
      {
        text: "",
        stopReason: "tool_use",
        toolUses: [{ id: "t1", name: "set_clip_speed", input: { clipId: "c1", speed: 4 } }],
      },
      { text: "Planned.", stopReason: "end_turn", toolUses: [] },
    ];
    await runTurn({
      host,
      llm: new MockLLMClient(script),
      tools,
      messages: userMsg("4x speed"),
      dryRun: true,
    });
    expect(host.getProject().timeline.tracks[0].clips[0].speed ?? 1).toBe(1);
  });

  it("gates destructive tools and honors rejection", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const script: LLMResponse[] = [
      {
        text: "",
        stopReason: "tool_use",
        toolUses: [{ id: "t1", name: "remove_clip", input: { clipId: "c1" } }],
      },
      { text: "Cancelled.", stopReason: "end_turn", toolUses: [] },
    ];
    const confirmGate = vi.fn(() => "reject" as const);
    const result = await runTurn({
      host,
      llm: new MockLLMClient(script),
      tools,
      messages: userMsg("delete the clip"),
      confirmGate,
    });
    expect(confirmGate).toHaveBeenCalledOnce();
    expect(host.getProject().timeline.tracks[0].clips).toHaveLength(1);
    expect(result.committed).toBe(true);
  });

  it("performs >=5 cross-domain edits in one turn and reverts them atomically on error", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    let call = 0;
    const llm: LLMClient = {
      complete: async () => {
        call++;
        if (call === 1) {
          return {
            text: "Applying a batch of edits.",
            stopReason: "tool_use",
            toolUses: [
              { id: "t1", name: "add_track", input: { trackType: "text" } },
              { id: "t2", name: "set_clip_speed", input: { clipId: "c1", speed: 2 } },
              { id: "t3", name: "set_clip_reverse", input: { clipId: "c1", reversed: true } },
              { id: "t4", name: "set_clip_stabilization", input: { clipId: "c1", stabilization: { enabled: true } } },
              { id: "t5", name: "set_clip_chroma_key", input: { clipId: "c1", chromaKey: { enabled: true } } },
              { id: "t6", name: "add_marker", input: { time: 1, label: "M", color: "#fff" } },
            ],
          };
        }
        throw new Error("provider exploded after edits applied");
      },
    };

    const result = await runTurn({ host, llm, tools, messages: userMsg("do a lot") });

    expect(result.toolCalls).toBe(6);
    expect(result.committed).toBe(false);
    // every edit reverted atomically
    const p = host.getProject();
    expect(p.timeline.tracks).toHaveLength(1);
    expect(p.timeline.tracks[0].clips[0].speed ?? 1).toBe(1);
    expect(p.timeline.tracks[0].clips[0].reversed ?? false).toBe(false);
    expect(p.timeline.tracks[0].clips[0].stabilization ?? undefined).toBeUndefined();
    expect(p.timeline.tracks[0].clips[0].chromaKey ?? undefined).toBeUndefined();
    expect(p.timeline.markers ?? []).toHaveLength(0);
  });

  it("emits an image content block when a tool result carries an image", async () => {
    const host = new HeadlessHost(makeEmptyProject(), {
      jobRunner: async () => ({
        ok: true,
        data: {
          dataUrl: "data:image/png;base64,SGVsbG8=",
          width: 1920,
          height: 1080,
        },
      }),
    });
    const created = await executeTool("create_motion_composition", {}, host);
    const compositionId = (created.data as { compositionId: string }).compositionId;

    const script: LLMResponse[] = [
      {
        text: "Rendering the frame to check it.",
        stopReason: "tool_use",
        toolUses: [
          { id: "t1", name: "render_motion_frame", input: { compositionId } },
        ],
      },
      { text: "Looks good.", stopReason: "end_turn", toolUses: [] },
    ];

    const result = await runTurn({
      host,
      llm: new MockLLMClient(script),
      tools,
      messages: userMsg("render the motion frame"),
    });

    const toolMessage = result.messages.find(
      (message): message is Extract<LoopMessage, { role: "tool" }> =>
        message.role === "tool",
    );
    expect(toolMessage).toBeDefined();
    const content = toolMessage?.results[0].content;
    expect(Array.isArray(content)).toBe(true);
    const blocks = content as LoopToolResultBlock[];
    expect(blocks[0].type).toBe("text");
    const imageBlock = blocks.find((block) => block.type === "image");
    expect(imageBlock).toBeDefined();
    if (imageBlock?.type === "image") {
      expect(imageBlock.source.type).toBe("base64");
      expect(imageBlock.source.media_type).toBe("image/png");
      expect(imageBlock.source.data).toBe("SGVsbG8=");
      expect(imageBlock.source.data.startsWith("data:")).toBe(false);
    }
  });

  it("rolls back the whole turn on a fatal LLM error", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    // First completion applies an edit (tool), second throws.
    let call = 0;
    const llm: LLMClient = {
      complete: async () => {
        call++;
        if (call === 1) {
          return {
            text: "",
            stopReason: "tool_use",
            toolUses: [{ id: "t1", name: "set_clip_speed", input: { clipId: "c1", speed: 2 } }],
          };
        }
        throw new Error("provider exploded");
      },
    };
    const result = await runTurn({
      host,
      llm,
      tools,
      messages: userMsg("do stuff"),
    });
    expect(result.stoppedReason).toBe("error");
    expect(result.committed).toBe(false);
    // the tool edit applied mid-turn is rolled back
    expect(host.getProject().timeline.tracks[0].clips[0].speed ?? 1).toBe(1);
  });
});
