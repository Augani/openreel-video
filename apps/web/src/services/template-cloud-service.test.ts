import { afterEach, describe, expect, it, vi } from "vitest";
import { TemplateEngine } from "@openreel/core";
import { TemplateCloudService } from "./template-cloud-service";
import { templateProjectFixture } from "../test/template-fixture";
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("cloud template metadata transport", () => {
  it("sends complete editable content and relinkable media without runtime handles or original bytes", async () => {
    const template = new TemplateEngine().createFromProject(
      templateProjectFixture(),
      {
        name: "Cloud metadata",
        description: "Retain shades",
        category: "custom",
        placeholders: [],
        tags: [],
      },
    );
    const fetcher = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) => ({
        ok: true,
        json: async () => ({}),
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    await expect(
      new TemplateCloudService("https://example.test").uploadTemplate(
        template,
        { signal: controller.signal },
      ),
    ).resolves.toEqual({ success: true });
    const init = fetcher.mock.calls[0][1]!;
    const payload = JSON.parse(init.body as string);
    expect(payload.projectContent.textClips).toEqual(
      template.projectContent!.textClips,
    );
    expect(payload.projectContent.mediaLibrary.items[0]).toMatchObject({
      blob: null,
      fileHandle: null,
      thumbnailUrl: null,
      waveformData: null,
      isPlaceholder: true,
      metadata: { codec: "h264", duration: 2 },
    });
    expect(init.signal).toBe(controller.signal);
    expect(template.projectContent!.mediaLibrary.items[0].blob).toBeInstanceOf(
      Blob,
    );
  });
});
