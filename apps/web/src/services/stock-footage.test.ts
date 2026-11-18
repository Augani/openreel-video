import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadStockFootage,
  preferredFootageSource,
  searchStockFootage,
  stockCreditText,
  type StockFootage,
} from "./stock-footage";

const url = "https://upload.wikimedia.org/wikipedia/commons/a/ab/source.webm";
const page = (id = 1, index = 1) => ({
  pageid: id,
  index,
  title: "File:Ocean.webm",
  videoinfo: [
    {
      mediatype: "VIDEO",
      duration: 5.5,
      width: 3840,
      height: 2160,
      mime: "video/webm",
      url,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:Ocean${id}.webm`,
      thumburl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/ocean.jpg",
      derivatives: [
        {
          src: `${url}?480`,
          type: 'video/webm; codecs="vp9,opus"',
          width: 854,
          height: 480,
        },
        { src: `${url}?1080`, type: "video/webm", width: 1920, height: 1080 },
      ],
      extmetadata: {
        ObjectName: { value: "<b>Ocean &amp; sky</b>" },
        Artist: {
          value: '<a href="javascript:bad">A Creator</a><script>bad()</script>',
        },
        LicenseShortName: { value: "CC BY 4.0" },
        LicenseUrl: { value: "http://creativecommons.org/licenses/by/4.0/" },
      },
    },
  ],
});
const fetchMock = () => {
  const fn = vi.fn();
  vi.stubGlobal("fetch", fn);
  return fn;
};
async function fixture(): Promise<StockFootage> {
  fetchMock().mockResolvedValue(
    new Response(JSON.stringify({ query: { pages: [page()] } })),
  );
  return (await searchStockFootage("ocean", new AbortController().signal))
    .items[0];
}
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Commons stock footage", () => {
  it("orders real video results, retains plain-text credits and selects the1080p derivative", async () => {
    const fetch = fetchMock().mockResolvedValue(
      new Response(
        JSON.stringify({
          query: { pages: [page(2, 2), page(1, 1)] },
          continue: { gsroffset: 8 },
        }),
      ),
    );
    const signal = new AbortController().signal;
    const result = await searchStockFootage("ocean", signal);
    expect(result.items.map((item) => item.id)).toEqual([
      "commons-1",
      "commons-2",
    ]);
    expect(result.nextOffset).toBe(8);
    expect(result.items[0].credit).toMatchObject({
      title: "Ocean & sky",
      creator: "A Creator",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    });
    expect(preferredFootageSource(result.items[0])).toMatchObject({
      url: `${url}?1080`,
      width: 1920,
      height: 1080,
    });
    const requested = new URL(fetch.mock.calls[0][0]);
    expect(requested.searchParams.get("gsrsearch")).toBe(
      "ocean filetype:video",
    );
    expect(requested.searchParams.get("origin")).toBe("*");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      signal,
      credentials: "omit",
    });
    expect(stockCreditText(result.items[0].credit)).toContain(
      "A Creator\nhttps://commons.wikimedia.org/wiki/File:Ocean1.webm\nCC BY 4.0",
    );
  });
  it("rejects audio, missing licences and foreign or unsafe URLs", async () => {
    const audio = page(2);
    audio.videoinfo[0].mediatype = "AUDIO";
    const unlicensed = page(3);
    unlicensed.videoinfo[0].extmetadata.LicenseShortName.value = "";
    const foreign = page(4);
    foreign.videoinfo[0].url =
      "https://upload.wikimedia.org.evil.test/video.webm";
    foreign.videoinfo[0].derivatives = [];
    const unsafe = page(5);
    unsafe.videoinfo[0].descriptionurl = "javascript:alert(1)";
    fetchMock().mockResolvedValue(
      new Response(
        JSON.stringify({
          query: { pages: [audio, unlicensed, foreign, unsafe] },
        }),
      ),
    );
    expect(
      (await searchStockFootage("ocean", new AbortController().signal)).items,
    ).toEqual([]);
  });
  it.each([
    new Response("blocked", { status: 429 }),
    new Response(JSON.stringify({ error: { code: "maxlag" } })),
    new Response(JSON.stringify({ query: { pages: {} } })),
  ])("reports retryable search errors", async (response) => {
    fetchMock().mockResolvedValue(response);
    await expect(
      searchStockFootage("ocean", new AbortController().signal),
    ).rejects.toThrow(/Try again/);
  });
  it("downloads actual bytes with the derivative mime and a portable filename", async () => {
    const item = await fixture();
    item.title = "Ocean:/sky.webm";
    const fetch = fetchMock().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "video/webm", "Content-Length": "3" },
      }),
    );
    const signal = new AbortController().signal,
      progress = vi.fn();
    const file = await downloadStockFootage(item, signal, progress);
    expect(file.name).toBe("Ocean__sky.webm");
    expect(file.type).toBe("video/webm");
    expect(file.size).toBe(3);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      signal,
      credentials: "omit",
    });
  });
  it.each([
    new Response("wrong", { headers: { "Content-Type": "text/html" } }),
    new Response("large", {
      headers: { "Content-Length": String(201 * 1024 * 1024) },
    }),
    new Response(new Uint8Array()),
  ])("rejects invalid, oversized and empty downloads", async (response) => {
    const item = await fixture();
    fetchMock().mockResolvedValue(response);
    await expect(
      downloadStockFootage(item, new AbortController().signal, vi.fn()),
    ).rejects.toThrow();
  });
  it("cancels a streamed download before it becomes an imported file", async () => {
    const item = await fixture();
    const controller = new AbortController();
    fetchMock().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new Uint8Array([1]));
            stream.close();
          },
        }),
      ),
    );
    await expect(
      downloadStockFootage(item, controller.signal, () => controller.abort()),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
