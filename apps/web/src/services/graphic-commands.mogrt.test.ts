import { beforeEach, describe, expect, it } from "vitest";
import { importGraphicTemplateFile } from "./graphic-commands";
import { useGraphicTemplatesStore } from "../stores/graphic-templates-store";
import { afterEffectsMogrt, lowerThirdMogrt } from "../../../../packages/core/src/graphic-templates/mogrt/__fixtures__/build-mogrt";

/** Same as File, but readable in the test environment regardless of its File.arrayBuffer support. */
function fileOf(bytes: Uint8Array, name: string): File {
  const file = new File([bytes as BlobPart], name);
  if (typeof file.arrayBuffer !== "function") {
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
  return file;
}

describe("importGraphicTemplateFile with .mogrt files", () => {
  beforeEach(() => {
    useGraphicTemplatesStore.setState({ userTemplates: [] });
  });

  it("imports a Premiere .mogrt into My templates with its report", async () => {
    const result = await importGraphicTemplateFile(fileOf(lowerThirdMogrt(), "Lower Third.mogrt"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.name).toBe("Broadcast Lower Third");
    expect(result.mogrtReport?.layersImported).toBe(6);
    expect(useGraphicTemplatesStore.getState().userTemplates.map((t) => t.id)).toContain(result.template.id);
  });

  it("imports the same file twice as a copy and never overwrites", async () => {
    const first = await importGraphicTemplateFile(fileOf(lowerThirdMogrt(), "a.mogrt"));
    const second = await importGraphicTemplateFile(fileOf(lowerThirdMogrt(), "a.mogrt"));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.template.id).not.toBe(first.template.id);
    expect(useGraphicTemplatesStore.getState().userTemplates).toHaveLength(2);
  });

  it("refuses an After Effects .mogrt, adds nothing and returns the report", async () => {
    const result = await importGraphicTemplateFile(fileOf(afterEffectsMogrt(), "ae.mogrt"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/After Effects/);
    expect(result.mogrtReport?.controlsTotal).toBe(2);
    expect(useGraphicTemplatesStore.getState().userTemplates).toHaveLength(0);
  });

  it("refuses a non-zip file named .mogrt", async () => {
    const result = await importGraphicTemplateFile(fileOf(new TextEncoder().encode("hello hello hello hello hello"), "x.mogrt"));
    expect(result.ok).toBe(false);
  });
});
