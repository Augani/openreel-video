import { describe, it, expect } from "vitest";
import {
  buildAnthropicBody,
  parseAnthropicResponse,
  buildOpenAIBody,
  parseOpenAIResponse,
  AnthropicClient,
  OpenAIClient,
  type LoopMessage,
} from "./llm";

const convo: LoopMessage[] = [
  { role: "user", content: "trim clip" },
  {
    role: "assistant",
    content: "trimming",
    toolUses: [{ id: "tu1", name: "trim_clip", input: { clipId: "c1", inPoint: 1 } }],
  },
  { role: "tool", results: [{ toolUseId: "tu1", content: '{"ok":true}', isError: false }] },
];

describe("Anthropic normalization", () => {
  it("builds the request body with tool_use + tool_result blocks", () => {
    const body = buildAnthropicBody({ system: "sys", messages: convo, tools: [] }, "claude", 1024) as {
      system: string;
      max_tokens: number;
      messages: Array<{ role: string; content: Array<{ type: string }> }>;
    };
    expect(body.system).toBe("sys");
    expect(body.max_tokens).toBe(1024);
    expect(body.messages[1].content.some((b) => b.type === "tool_use")).toBe(true);
    expect(body.messages[2].content[0].type).toBe("tool_result");
  });

  it("parses a tool-use response", () => {
    const parsed = parseAnthropicResponse({
      content: [
        { type: "text", text: "ok" },
        { type: "tool_use", id: "x", name: "add_track", input: { trackType: "video" } },
      ],
      stop_reason: "tool_use",
    });
    expect(parsed.text).toBe("ok");
    expect(parsed.toolUses).toHaveLength(1);
    expect(parsed.toolUses[0].name).toBe("add_track");
    expect(parsed.stopReason).toBe("tool_use");
  });

  it("AnthropicClient round-trips through an injected transport", async () => {
    const client = new AnthropicClient({
      model: "claude",
      send: async () => ({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }),
    });
    const res = await client.complete({ messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(res.text).toBe("hi");
    expect(res.stopReason).toBe("end_turn");
  });
});

describe("OpenAI normalization", () => {
  it("builds messages with tool_calls + tool role", () => {
    const body = buildOpenAIBody({ system: "sys", messages: convo, tools: [] }, "gpt") as {
      messages: Array<{ role: string; tool_calls?: unknown[]; tool_call_id?: string }>;
    };
    expect(body.messages[0].role).toBe("system");
    const assistant = body.messages.find((m) => m.role === "assistant");
    expect(assistant?.tool_calls).toBeTruthy();
    expect(body.messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("parses tool_calls with JSON arguments", () => {
    const parsed = parseOpenAIResponse({
      choices: [
        {
          message: {
            content: "sure",
            tool_calls: [
              { id: "c", function: { name: "set_clip_speed", arguments: '{"clipId":"c1","speed":2}' } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    expect(parsed.text).toBe("sure");
    expect(parsed.toolUses[0].input).toEqual({ clipId: "c1", speed: 2 });
    expect(parsed.stopReason).toBe("tool_use");
  });

  it("OpenAIClient round-trips through an injected transport", async () => {
    const client = new OpenAIClient({
      model: "gpt",
      send: async () => ({ choices: [{ message: { content: "yo" }, finish_reason: "stop" }] }),
    });
    const res = await client.complete({ messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(res.text).toBe("yo");
  });
});
