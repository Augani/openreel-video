import { describe, expect, it } from "vitest";
import { getTool, listTools } from "./registry";
import { AUDIO_REPAIR_TOOLS } from "./audio-repair-tools";
import { GRAPHIC_TOOLS } from "./graphic-tools";
import { MULTICAM_SOURCE_TOOLS } from "./multicam-source-tools";
import { PROXY_TOOLS } from "./proxy-tools";

/**
 * Wave 8 composition: a cold start (the registry module evaluated fresh, as the lazily loaded
 * agent chunk does) exposes every tool of every wave 8 stream, once, with a handler and a schema.
 * A stream merged without its `...TOOLS` spread, or two streams claiming one name, fails here.
 */
describe("wave 8 agent tools after a cold start", () => {
  const groups: Record<string, readonly { name: string }[]> = {
    proxies: PROXY_TOOLS,
    multicam: MULTICAM_SOURCE_TOOLS,
    graphics: GRAPHIC_TOOLS,
    "audio repair": AUDIO_REPAIR_TOOLS,
  };

  it.each(Object.entries(groups))("every %s tool is in the registry with a handler and an object schema", (_group, tools) => {
    expect(tools.length).toBeGreaterThan(0);
    for (const { name } of tools) {
      const tool = getTool(name);
      expect(tool, name).toBeDefined();
      expect(typeof tool!.handler, name).toBe("function");
      expect(tool!.description.length, name).toBeGreaterThan(20);
      expect(tool!.inputSchema.type, name).toBe("object");
    }
  });

  it("tool names are unique across the whole registry", () => {
    const names = listTools().map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("the caption broadcast export tool is registered", () => {
    expect(getTool("export_captions")).toBeDefined();
  });
});
