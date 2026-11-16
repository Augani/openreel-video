import { describe, expect, it } from "vitest";
import { editingToolDefs } from "../../../services/agent/editing-tools";
import { CHAT_STARTER_PROMPTS, ONBOARDING_STARTER_PROMPTS, UNSUPPORTED_PROMISES } from "./starter-prompts";

const catalog = new Set(
  (editingToolDefs("openai") as Array<{ function: { name: string } }>).map((t) => t.function.name),
);

describe("starter prompts", () => {
  it("only depend on tools that exist in the chat catalog", () => {
    for (const prompt of CHAT_STARTER_PROMPTS) {
      for (const tool of prompt.uses) expect(catalog.has(tool), `${prompt.id} uses ${tool}`).toBe(true);
    }
  });

  it("never promise what the chat catalog cannot do", () => {
    for (const prompt of CHAT_STARTER_PROMPTS) {
      for (const banned of UNSUPPORTED_PROMISES) expect(banned.test(prompt.text), `${prompt.id}: ${banned}`).toBe(false);
    }
  });

  it("keeps the three honest onboarding chips", () => {
    expect(ONBOARDING_STARTER_PROMPTS.map((p) => p.text)).toEqual([
      "Cut these into a 30-second highlight with a title and smooth transitions",
      "Make a 9:16 version with a title card",
      "Even out the volume and add fade in and out",
    ]);
  });

  it("the catalog really lacks the features the chips avoid", () => {
    for (const name of ["detect_scenes", "remove_pauses", "transcribe", "auto_caption", "beat_sync", "import_media"]) {
      expect(catalog.has(name)).toBe(false);
    }
  });
});
