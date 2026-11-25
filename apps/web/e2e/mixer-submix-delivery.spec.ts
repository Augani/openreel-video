import { expect, test, type Page } from "@playwright/test";
import { openEditor, settle } from "./helpers";
import { AUDIO_FIXTURE_PATH } from "./global-setup";

/**
 * Submix + mixer snapshot + Broadcast WAV delivery, real Chrome:
 *  - a submix is created in the mixer and two tracks are routed into it;
 *  - a snapshot saved at unity is recalled after the submix and a track were turned down (one undo step, exact);
 *  - the exported BWF WAV carries bext (description, originator, time reference = sequence start timecode in samples)
 *    and iXML (track names), and its audio equals the preview render of the same project within tolerance.
 */

interface Hook {
  project: { getState(): any };
  ui: { getState(): any };
  audio: Record<string, any>;
}
declare function E(): Hook;

const TONE = "Select media tone-4s.wav";
const history = (page: Page) => page.evaluate(() => E().project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

async function addToLane(page: Page, lane: string) {
  const result = await page.evaluate(
    async (laneName) => {
      const st = E().project.getState();
      const item = st.project.mediaLibrary.items.find((m: any) => m.name === "tone-4s.wav");
      const target = st.project.timeline.tracks.find((t: any) => t.name === laneName);
      return st.addClip(target.id, item.id, 0);
    },
    lane,
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
  await settle(page, 400);
}

/** RMS of the preview render (the offline mixdown the player and the export share). */
async function previewRms(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const engine = E().audio.getAudioEngine();
    if (!engine.isInitialized()) await engine.initialize();
    const out = await engine.renderAudio(E().project.getState().getFullProject(), 0, 3);
    const left = out.buffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < left.length; i++) sum += left[i] * left[i];
    return Math.sqrt(sum / left.length);
  });
}

test.describe("Submix, mixer snapshots and Broadcast WAV", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
    });
  });

  test("create a submix, route two tracks, recall a snapshot, export a BWF that matches the preview", async ({ page }) => {
    await openEditor(page);
    await page.locator('input[type="file"]').first().setInputFiles(AUDIO_FIXTURE_PATH);
    await page.getByLabel(TONE).waitFor({ timeout: 30_000 });
    await addToLane(page, "Dialogue");
    await addToLane(page, "Music");
    const ids = await page.evaluate(async () => {
      const st = E().project.getState();
      const tracks = st.project.timeline.tracks;
      const main = tracks.find((t: any) => t.name === "Main");
      await st.muteTrack(main.id, true);
      await st.updateSettings({ startTimecode: "01:00:00:00" });
      const id = (name: string) => tracks.find((t: any) => t.name === name).id as string;
      return { dialogue: id("Dialogue"), music: id("Music") };
    });
    const base = await previewRms(page);
    expect(base, "both tones are audible").toBeGreaterThan(0.01);

    // Submix through the mixer UI; both tracks play into it.
    await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
    await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
    const depth0 = await history(page);
    await page.getByTestId("add-bus").click();
    await expect.poll(() => history(page)).toBe(depth0 + 1);
    const bus = await page.evaluate(() => E().project.getState().project.timeline.audioBuses[0] as { id: string; name: string });
    for (const id of [ids.dialogue, ids.music]) {
      await page.getByTestId(`track-output-${id}`).click();
      await page.getByRole("option", { name: bus.name, exact: true }).click();
    }
    await expect.poll(() => page.evaluate(() => E().project.getState().project.timeline.tracks.filter((t: any) => t.output).length)).toBe(2);
    expect(Math.abs((await previewRms(page)) - base) / base, "a unity submix leaves the mix unchanged").toBeLessThan(1e-6);

    // Save a snapshot at unity.
    await page.getByTestId("mixer-snapshots-open").click();
    await page.getByTestId("mixer-snapshot-name").fill("Unity");
    await page.getByTestId("mixer-snapshot-save").click();
    await expect(page.getByTestId("mixer-snapshot-list")).toContainText("Unity");

    // Turn the submix down 12 dB and mute Music.
    await page.evaluate(
      async ([busId, musicId]) => {
        const st = E().project.getState();
        await st.setAudioRack(busId, { effects: [{ id: "g", type: "gain", params: { gainDb: -12 }, bypassed: false }] });
        await st.muteTrack(musicId, true);
      },
      [bus.id, ids.music] as const,
    );
    const turnedDown = await previewRms(page);
    expect(turnedDown).toBeLessThan(base * 0.4);

    // Recall: one undo step, back to the exact unity mix.
    const before = await history(page);
    await page.getByTestId("mixer-snapshot-recall").click();
    await expect.poll(() => history(page)).toBe(before + 1);
    expect(Math.abs((await previewRms(page)) - base) / base).toBeLessThan(1e-6);
    expect(await page.evaluate((id) => E().project.getState().project.timeline.tracks.find((t: any) => t.id === id).muted, ids.music)).toBe(false);
    await page.evaluate(() => E().project.getState().undo());
    await expect.poll(async () => (await previewRms(page)) < base * 0.4).toBe(true);
    await page.evaluate(() => E().project.getState().redo());
    await expect.poll(async () => Math.abs((await previewRms(page)) - base) / base < 1e-6).toBe(true);

    // Export a Broadcast WAV and read the chunks back.
    const exported = await page.evaluate(async () => {
      const engine = E().audio.getExportEngine();
      await engine.initialize?.();
      const project = E().project.getState().getFullProject();
      const gen = engine.exportAudio(project, { format: "wav", sampleRate: 48000, bitDepth: 24, channels: 2, bwf: { enabled: true, description: "Submix delivery", originator: "OpenReel E2E" } });
      let step = await gen.next();
      while (!step.done) step = await gen.next();
      if (!step.value.success) throw new Error(step.value.error?.message ?? "export failed");
      const bytes = new Uint8Array(await step.value.blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    });
    const wav = Buffer.from(exported, "base64");
    const chunks: Record<string, Buffer> = {};
    const order: string[] = [];
    for (let at = 12; at + 8 <= wav.length; ) {
      const id = wav.toString("latin1", at, at + 4);
      const size = wav.readUInt32LE(at + 4);
      chunks[id] = wav.subarray(at + 8, at + 8 + size);
      order.push(id);
      at += 8 + size + (size % 2);
    }
    expect(order).toEqual(["fmt ", "bext", "data", "iXML"]);
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    const bext = chunks["bext"];
    const text = (from: number, len: number) => bext.toString("latin1", from, from + len).replace(/\0+$/, "");
    expect(text(0, 256)).toBe("Submix delivery");
    expect(text(256, 32)).toBe("OpenReel E2E");
    // 01:00:00:00 at 48 kHz = 172,800,000 samples.
    expect(bext.readUInt32LE(338) + bext.readUInt32LE(342) * 2 ** 32).toBe(3600 * 48000);
    const ixml = chunks["iXML"].toString("utf8");
    expect(ixml).toContain("<NAME>Mix L</NAME>");
    expect(ixml).toContain("<SOURCE_TRACK>Dialogue</SOURCE_TRACK>");
    expect(ixml).toContain("<SOURCE_TRACK>Music</SOURCE_TRACK>");

    // The exported audio equals the preview render within tolerance (24-bit quantisation only).
    const data = chunks["data"];
    expect(wav.readUInt16LE(22)).toBe(2);
    const channels = 2;
    let sum = 0;
    let n = 0;
    for (let s = 0; s < 3 * 48000; s++) {
      const o = s * channels * 3;
      const v = data.readIntLE(o, 3) / 8388608;
      sum += v * v;
      n++;
    }
    const exportedRms = Math.sqrt(sum / n);
    expect(Math.abs(exportedRms - base) / base, "export == preview").toBeLessThan(0.01);
  });
});
