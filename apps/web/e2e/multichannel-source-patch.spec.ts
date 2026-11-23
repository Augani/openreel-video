import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateXmeml } from "@openreel/core/interchange/index";
import { chooseFileMenu, importInput, openEditor, readSource, seek, settle, undo } from "./helpers";

/**
 * Multichannel source patching, checked in real Chrome with ffmpeg-generated media:
 *  - poly8.wav: 8 mono channels, channel c a sine at 300 + 150 c Hz;
 *  - two-stereo.mov: a picture and two stereo audio streams (440/660 Hz and 880/1100 Hz).
 * The Source monitor shows one patch indicator per audio clip (A1..An), each patchable to a track or switched off;
 * Insert places one linked audio clip per enabled indicator (new tracks when needed), respects Sync Lock, and is one
 * undo step; Modify > Audio Channels regroups the channels (presets) and changes what is placed; the exported XML /
 * FCPXML keep which file channel each clip plays. Every claim about sound is measured on the export mixdown.
 */

interface Hook {
  project: { getState(): Record<string, any> };
  audio: Record<string, any>;
}
declare function E(): Hook;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

const workDir = mkdtempSync(join(tmpdir(), "openreel-multichannel-"));
const POLY = join(workDir, "poly8.wav");
const MOV = join(workDir, "two-stereo.mov");
const freqOf = (channel: number) => 300 + 150 * channel;

function generateMedia(): void {
  const sines = Array.from({ length: 8 }, (_, c) => ["-f", "lavfi", "-i", `sine=frequency=${freqOf(c)}:sample_rate=48000:duration=4`]).flat();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...sines, "-filter_complex", "[0:a][1:a][2:a][3:a][4:a][5:a][6:a][7:a]amerge=inputs=8[a]", "-map", "[a]", "-c:a", "pcm_s16le", POLY]);
  const tone = (f: number) => ["-f", "lavfi", "-i", `sine=frequency=${f}:sample_rate=48000:duration=4`];
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4",
    ...tone(440), ...tone(660), ...tone(880), ...tone(1100),
    "-filter_complex", "[1:a][2:a]amerge=inputs=2[s0];[3:a][4:a]amerge=inputs=2[s1]",
    "-map", "0:v", "-map", "[s0]", "-map", "[s1]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", MOV,
  ]);
}

async function importMedia(page: Page, path: string) {
  const name = path.split("/").pop()!;
  await importInput(page).setInputFiles(path);
  await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 60_000 });
}

async function openInSource(page: Page, name: string) {
  await page.getByLabel(`Select media ${name}`).dblclick();
  await expect(page.getByTestId("source-monitor")).toBeVisible();
  await expect.poll(async () => (await readSource(page)).tab).toBe("source");
  await settle(page, 400);
}

async function muteMain(page: Page) {
  await page.evaluate(async () => {
    const st = E().project.getState();
    await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Main").id, true);
  });
}

const snapshot = (page: Page, mediaName: string) =>
  page.evaluate((name) => {
    const st = E().project.getState();
    const media = st.project.mediaLibrary.items.find((m: any) => m.name === name);
    const tracks = st.project.timeline.tracks;
    return JSON.parse(
      JSON.stringify({
        trackCount: tracks.length,
        undoSteps: st.actionExecutor.getHistory().getUndoStackSize(),
        mediaId: media?.id,
        layout: media?.channelLayout ?? null,
        clips: tracks.flatMap((t: any) =>
          t.clips.filter((c: any) => c.mediaId === media?.id).map((c: any) => ({
            id: c.id, track: t.name, trackType: t.type, trackId: t.id, start: c.startTime, duration: c.duration, inPoint: c.inPoint,
            volume: c.volume, opacity: c.transform.opacity, channelMap: c.channelMap ?? null, audioTrackIndex: c.audioTrackIndex ?? 0,
            link: c.metadata?.separatedFromClipId ?? null, group: c.metadata?.sourceChannelGroup ?? null,
          })),
        ),
        main: tracks.find((t: any) => t.name === "Main").clips.map((c: any) => [Math.round(c.startTime * 100) / 100, Math.round((c.startTime + c.duration) * 100) / 100]),
      }),
    );
  }, mediaName);

async function mixdown(page: Page, from: number, length: number) {
  return page.evaluate(
    async ([start, len]) => {
      const engine = E().audio.getAudioEngine();
      if (!engine.isInitialized()) await engine.initialize();
      const rendered = await engine.renderAudio(E().project.getState().getFullProject(), start, len);
      const buffer = rendered.buffer as AudioBuffer;
      return { rate: buffer.sampleRate, left: Array.from(buffer.getChannelData(0)) as number[], right: Array.from(buffer.getChannelData(1)) as number[] };
    },
    [from, length] as const,
  );
}
const toneAmp = (x: number[], rate: number, freq: number, from: number, to: number): number => {
  const a = Math.floor(from * rate);
  const b = Math.floor(to * rate);
  let re = 0;
  let im = 0;
  for (let i = a; i < b; i++) {
    const w = (2 * Math.PI * freq * (i - a)) / rate;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / (b - a);
};
/** Amplitudes of the given frequencies in both mixdown channels over [from, to) seconds of the mixdown. */
async function spectrum(page: Page, at: number, freqs: number[]) {
  const m = await mixdown(page, at, 3);
  return freqs.map((f) => ({ f, left: toneAmp(m.left, m.rate, f, 0.4, 2.4), right: toneAmp(m.right, m.rate, f, 0.4, 2.4) }));
}

const insertButton = (page: Page) => page.getByRole("button", { name: "Insert (,)" });

test.describe("Multichannel source patching", () => {
  test.beforeAll(() => generateMedia());

  test("8 mono channels: eight patch indicators, per-channel patch / off, one linked mono clip per enabled channel, Sync Lock, one undo step", async ({ page }, testInfo) => {
    testInfo.setTimeout(300_000);
    await openEditor(page);
    await muteMain(page);
    await importMedia(page, POLY);
    await openInSource(page, "poly8.wav");

    // One indicator per audio channel.
    const patch = page.getByTestId("source-patch");
    await expect(patch).toHaveAttribute("data-multichannel", "8");
    for (let c = 0; c < 8; c++) await expect(page.getByTestId(`source-patch-channel-toggle-${c}`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("source-patch-8-channels.png") });

    // Switch A8 off from the Source monitor; patch A1 to the track named Dialogue from its select.
    await page.getByTestId("source-patch-channel-toggle-7").click();
    await expect(page.getByTestId("source-patch-channel-toggle-7")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("source-patch-audio").click();
    await page.getByRole("option", { name: "Dialogue" }).click();
    // The timeline header of that track now reads A1.
    await expect(page.getByRole("button", { name: "Source patch Dialogue" })).toHaveText("A1");

    // Sync Lock: Main (the three-scenes clip) is sync-locked, so the insert at 2 s splits it and ripples the tail.
    await seek(page, 2);
    const before = await snapshot(page, "poly8.wav");
    await insertButton(page).click();
    await expect.poll(async () => (await snapshot(page, "poly8.wav")).clips.length).toBe(7);
    const after = await snapshot(page, "poly8.wav");
    expect(after.undoSteps, "one undo step").toBe(before.undoSteps + 1);
    expect(after.clips.map((c: any) => c.channelMap?.sources[0]).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(new Set(after.clips.map((c: any) => c.trackId)).size, "each on its own track").toBe(7);
    expect(after.clips.every((c: any) => c.trackType === "audio" && Math.abs(c.start - 2) < 0.01 && Math.abs(c.duration - 4) < 0.01)).toBe(true);
    expect(after.clips.find((c: any) => c.channelMap.sources[0] === 0).track).toBe("Dialogue");
    const anchors = after.clips.filter((c: any) => c.link === null);
    expect(anchors, "one anchor, the rest linked to it").toHaveLength(1);
    expect(after.clips.filter((c: any) => c.link === anchors[0].id)).toHaveLength(6);
    expect(after.main, "Main split at 2 s and its tail rippled by the 4 s clip").toEqual([[0, 2], [6, 10]]);
    expect(after.trackCount, "tracks were created for channels without a free audio track").toBeGreaterThanOrEqual(before.trackCount);

    // The sound: channels 0..6 are present, the switched-off channel 7 is not.
    const heard = await spectrum(page, 2, Array.from({ length: 8 }, (_, c) => freqOf(c)));
    heard.slice(0, 7).forEach(({ f, left, right }) => expect(Math.max(left, right), `${f} Hz plays`).toBeGreaterThan(0.01));
    expect(Math.max(heard[7].left, heard[7].right), "A8 was switched off").toBeLessThan(0.003);

    // One undo removes every clip, the created tracks and the ripple.
    await undo(page);
    await settle(page, 400);
    const undone = await snapshot(page, "poly8.wav");
    expect(undone.clips).toHaveLength(0);
    expect(undone.trackCount).toBe(before.trackCount);
    expect(undone.main).toEqual(before.main);
    expect(undone.undoSteps).toBe(before.undoSteps);
  });

  test("Sync Lock off leaves the track alone; a locked track receives nothing", async ({ page }, testInfo) => {
    testInfo.setTimeout(240_000);
    await openEditor(page);
    await muteMain(page);
    await importMedia(page, POLY);
    await openInSource(page, "poly8.wav");
    await page.evaluate(async () => {
      const st = E().project.getState();
      const main = st.project.timeline.tracks.find((t: any) => t.name === "Main");
      await st.setTrackSyncLock(main.id, false);
      const dialogue = st.project.timeline.tracks.find((t: any) => t.name === "Dialogue");
      await st.lockTrack(dialogue.id, true);
    });
    await seek(page, 2);
    await insertButton(page).click();
    await expect.poll(async () => (await snapshot(page, "poly8.wav")).clips.length).toBe(8);
    const after = await snapshot(page, "poly8.wav");
    expect(after.main, "Sync Lock off: Main untouched").toEqual([[0, 6]]);
    expect(after.clips.some((c: any) => c.track === "Dialogue"), "locked track skipped").toBe(false);
  });

  test("Modify > Audio Channels: Stereo pairs preset regroups the source into four stereo patch indicators and four clips", async ({ page }, testInfo) => {
    testInfo.setTimeout(300_000);
    await openEditor(page);
    await muteMain(page);
    await importMedia(page, POLY);
    await openInSource(page, "poly8.wav");
    await page.getByTestId("source-patch-channels").click();
    const dialog = page.getByTestId("source-channels-dialog");
    await dialog.waitFor();
    await expect(page.getByTestId("source-channels-preset-file")).toHaveAttribute("data-state", "on");
    await page.getByTestId("source-channels-preset-stereo").click();
    await expect(page.getByTestId("source-channels-group-3")).toBeVisible();
    await expect(page.getByTestId("source-channels-summary")).toContainText("4 audio clips");
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath("source-channels-dialog.png") });
    await page.getByTestId("source-channels-apply").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("source-patch")).toHaveAttribute("data-multichannel", "4");
    const stored = await snapshot(page, "poly8.wav");
    expect(stored.layout.map((g: any) => g.map.sources)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7]]);

    await seek(page, 0);
    await insertButton(page).click();
    await expect.poll(async () => (await snapshot(page, "poly8.wav")).clips.length).toBe(4);
    const placed = await snapshot(page, "poly8.wav");
    expect(placed.clips.map((c: any) => c.channelMap.sources).sort()).toEqual([[0, 1], [2, 3], [4, 5], [6, 7]]);
    // Left carries channels 0, 2, 4, 6 and right 1, 3, 5, 7 of each pair.
    const heard = await spectrum(page, 0, Array.from({ length: 8 }, (_, c) => freqOf(c)));
    heard.forEach(({ f, left, right }, c) => {
      const [wanted, other] = c % 2 === 0 ? [left, right] : [right, left];
      expect(wanted, `${f} Hz on ${c % 2 === 0 ? "left" : "right"}`).toBeGreaterThan(0.01);
      expect(other, `${f} Hz not on the other side`).toBeLessThan(0.004);
    });

    // The layout change is its own undo step and restores the 8-mono indicators.
    await undo(page); // the insert
    await undo(page); // the layout
    await settle(page, 300);
    await expect(page.getByTestId("source-patch")).toHaveAttribute("data-multichannel", "8");
    expect((await snapshot(page, "poly8.wav")).layout).toBeNull();
  });

  test("a MOV with two stereo tracks: two indicators, the picture plus one linked stereo clip per stream", async ({ page }, testInfo) => {
    testInfo.setTimeout(300_000);
    await openEditor(page);
    await muteMain(page);
    await importMedia(page, MOV);
    await openInSource(page, "two-stereo.mov");
    await expect(page.getByTestId("source-patch")).toHaveAttribute("data-multichannel", "2");
    await page.screenshot({ path: testInfo.outputPath("source-patch-two-stereo.png") });

    await seek(page, 8);
    await insertButton(page).click();
    await expect.poll(async () => (await snapshot(page, "two-stereo.mov")).clips.length).toBe(3);
    const placed = await snapshot(page, "two-stereo.mov");
    const picture = placed.clips.find((c: any) => c.trackType === "video");
    const sounds = placed.clips.filter((c: any) => c.trackType === "audio");
    expect(picture.volume).toBe(0);
    expect(sounds.map((c: any) => c.audioTrackIndex).sort()).toEqual([0, 1]);
    expect(new Set(sounds.map((c: any) => c.trackId)).size).toBe(2);
    expect(sounds.every((c: any) => c.link === picture.id && c.opacity === 0)).toBe(true);
    const heard = await spectrum(page, 8, [440, 660, 880, 1100]);
    expect(heard[0].left, "stream 1 left").toBeGreaterThan(0.01);
    expect(heard[1].right, "stream 1 right").toBeGreaterThan(0.01);
    expect(heard[2].left, "stream 2 left").toBeGreaterThan(0.01);
    expect(heard[3].right, "stream 2 right").toBeGreaterThan(0.01);
    expect(heard[0].right).toBeLessThan(0.004);
    expect(heard[2].right).toBeLessThan(0.004);

    // Interchange: XML and FCPXML keep which file channel each clip plays.
    const xml = await exportFile(page, ["Export timeline", "Timeline XML (Premiere/Resolve)"]);
    expect(validateXmeml(xml)).toEqual([]);
    expect(xml).toMatch(/<channelcount>4<\/channelcount>/);
    expect(xml).toMatch(/premiereChannelType="stereo">[\s\S]*?<trackindex>3<\/trackindex>/);
    const fcp = await exportFile(page, ["Export timeline", "FCPXML (Final Cut)"]);
    expect(fcp).toContain('srcCh="3, 4" outCh="L, R"');
  });

  test("XML and FCPXML export of an 8-mono edit keep each clip's file channel", async ({ page }, testInfo) => {
    testInfo.setTimeout(300_000);
    await openEditor(page);
    await importMedia(page, POLY);
    await openInSource(page, "poly8.wav");
    await seek(page, 6);
    await insertButton(page).click();
    await expect.poll(async () => (await snapshot(page, "poly8.wav")).clips.length).toBe(8);
    const xml = await exportFile(page, ["Export timeline", "Timeline XML (Premiere/Resolve)"]);
    expect(validateXmeml(xml)).toEqual([]);
    const monos = [...xml.matchAll(/premiereChannelType="mono">[\s\S]*?<trackindex>(\d+)<\/trackindex>/g)].map((m) => Number(m[1])).sort();
    expect(monos).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(xml).toMatch(/<channelcount>8<\/channelcount>/);
    const fcp = await exportFile(page, ["Export timeline", "FCPXML (Final Cut)"]);
    for (let c = 1; c <= 8; c++) expect(fcp).toContain(`srcCh="${c}" outCh="C"`);
  });
});

async function exportFile(page: Page, label: string[]): Promise<string> {
  const download = page.waitForEvent("download");
  await chooseFileMenu(page, label);
  const d = await download;
  const text = readFileSync((await d.path())!, "utf8");
  const report = page.getByTestId("interchange-export-report");
  if (await report.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Done" }).click();
    await expect(report).toHaveCount(0);
  }
  return text;
}
