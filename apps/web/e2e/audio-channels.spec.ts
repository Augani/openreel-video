import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, importInput, openEditor, settle, undo } from "./helpers";

/**
 * Modify > Audio Channels, checked in real Chrome with a stereo file whose left channel is 440 Hz and right 1000 Hz:
 *  - Swap L/R, Left only and mono Mix through the dialog change the export mixdown exactly as mapped;
 *  - one undo restores the previous mapping, a multi-selection maps every selected clip in one step;
 *  - Split to mono clips turns the stereo interview into two mono clips on two tracks (and undoes as one);
 *  - the default-on-import preference stamps new files and the mixdown follows it.
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

const SR = 48000;
const workDir = mkdtempSync(join(tmpdir(), "openreel-channels-"));

/** Stereo 16-bit WAV: 440 Hz on the left, 1000 Hz on the right. */
function writeStereo(name: string, seconds: number): string {
  const n = SR * seconds;
  const pcm = Buffer.alloc(44 + n * 4);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 4, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(2, 22);
  pcm.writeUInt32LE(SR, 24);
  pcm.writeUInt32LE(SR * 4, 28);
  pcm.writeUInt16LE(4, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    pcm.writeInt16LE(Math.round(0.4 * Math.sin((2 * Math.PI * 440 * i) / SR) * 32767), 44 + i * 4);
    pcm.writeInt16LE(Math.round(0.4 * Math.sin((2 * Math.PI * 1000 * i) / SR) * 32767), 46 + i * 4);
  }
  const path = join(workDir, name);
  writeFileSync(path, pcm);
  return path;
}

/** 6-channel 16-bit WAV (L R C LFE Ls Rs): a distinct tone on each channel, 300/500/700/900/1100/1300 Hz. */
const SIX_TONES = [300, 500, 700, 900, 1100, 1300] as const;
function writeFiveOne(name: string, seconds: number): string {
  const n = SR * seconds;
  const frame = 12;
  const pcm = Buffer.alloc(44 + n * frame);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * frame, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(6, 22);
  pcm.writeUInt32LE(SR, 24);
  pcm.writeUInt32LE(SR * frame, 28);
  pcm.writeUInt16LE(frame, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * frame, 40);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 6; c++) pcm.writeInt16LE(Math.round(0.3 * Math.sin((2 * Math.PI * SIX_TONES[c] * i) / SR) * 32767), 44 + i * frame + c * 2);
  }
  const path = join(workDir, name);
  writeFileSync(path, pcm);
  return path;
}

async function importAudio(page: Page, path: string) {
  const name = path.split("/").pop()!;
  await importInput(page).setInputFiles(path);
  await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 30_000 });
}

async function addToLane(page: Page, mediaName: string, lane: string, start: number): Promise<string> {
  const result = await page.evaluate(
    async ([media, laneName, at]) => {
      const st = E().project.getState();
      const item = st.project.mediaLibrary.items.find((m: any) => m.name === media);
      const target = st.project.timeline.tracks.find((t: any) => t.name === laneName);
      const added = await st.addClip(target.id, item.id, at);
      const clips = E().project.getState().project.timeline.tracks.find((t: any) => t.name === laneName).clips;
      return { success: added.success, id: clips.find((c: any) => c.mediaId === item.id && Math.abs(c.startTime - at) < 0.01)?.id as string | undefined };
    },
    [mediaName, lane, start] as const,
  );
  expect(result.success && result.id, JSON.stringify(result)).toBeTruthy();
  await settle(page, 300);
  return result.id!;
}

async function muteMain(page: Page) {
  await page.evaluate(async () => {
    const st = E().project.getState();
    await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Main").id, true);
  });
}

const clipState = (page: Page, id: string) =>
  page.evaluate((clipId) => {
    const clip = E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === clipId);
    return JSON.parse(JSON.stringify(clip));
  }, id);

/** Both mixdown channels of [from, from+length] exactly as the export engine renders them. */
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

/** Amplitude of one frequency (single-bin DFT) over [from, to) seconds. */
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

async function tones(page: Page, from = 0.5, to = 2.5) {
  const m = await mixdown(page, 0, 3);
  return {
    leftLow: toneAmp(m.left, m.rate, 440, from, to),
    leftHigh: toneAmp(m.left, m.rate, 1000, from, to),
    rightLow: toneAmp(m.right, m.rate, 440, from, to),
    rightHigh: toneAmp(m.right, m.rate, 1000, from, to),
  };
}

async function openDialog(page: Page, clipId: string) {
  await clickClip(page, clipId);
  await page.getByRole("tab", { name: /^Audio$/ }).click();
  const section = page.getByTestId("audio-channels-section");
  if (!(await section.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /Audio channels/i }).first().click();
    await page.waitForTimeout(1200);
  }
  await page.getByTestId("audio-channels-open").click();
  await page.getByTestId("audio-channels-dialog").waitFor({ timeout: 15_000 });
}

test("Swap, Left only and Mix change the mixdown as mapped; undo restores each", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await openEditor(page);
  await muteMain(page);
  await importAudio(page, writeStereo("interview.wav", 3));
  const clip = await addToLane(page, "interview.wav", "Dialogue", 0);

  const base = await tones(page);
  expect(base.leftLow, "file plays left on the left").toBeGreaterThan(0.3);
  expect(base.rightHigh, "file plays right on the right").toBeGreaterThan(0.3);
  expect(base.leftHigh).toBeLessThan(0.02);
  expect(base.rightLow).toBeLessThan(0.02);

  await openDialog(page, clip);
  await expect(page.getByTestId("audio-channels-apply")).toBeDisabled();
  await page.getByTestId("audio-channels-swap").click();
  await expect(page.getByTestId("audio-channels-custom")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("audio-channels-dialog.png") });
  await page.getByTestId("audio-channels-apply").click();
  await expect(page.getByTestId("audio-channels-dialog")).toBeHidden();
  expect((await clipState(page, clip)).channelMap).toEqual({ format: "stereo", sources: [1, 0] });
  const swapped = await tones(page);
  expect(swapped.leftHigh, "swapped: right source on the left").toBeGreaterThan(0.3);
  expect(swapped.rightLow, "swapped: left source on the right").toBeGreaterThan(0.3);
  expect(swapped.leftLow).toBeLessThan(0.02);
  expect(swapped.rightHigh).toBeLessThan(0.02);

  await undo(page);
  await settle(page, 300);
  expect((await clipState(page, clip)).channelMap).toBeUndefined();
  const restored = await tones(page);
  expect(restored.leftLow).toBeGreaterThan(0.3);

  await openDialog(page, clip);
  await page.getByTestId("audio-channels-left-only").click();
  await page.getByTestId("audio-channels-apply").click();
  await expect(page.getByTestId("audio-channels-dialog")).toBeHidden();
  expect((await clipState(page, clip)).channelMap).toEqual({ format: "mono", sources: [0] });
  const leftOnly = await tones(page);
  expect(leftOnly.leftLow, "left only plays on both sides").toBeGreaterThan(0.2);
  expect(leftOnly.rightLow).toBeGreaterThan(0.2);
  expect(leftOnly.leftHigh, "right channel is gone").toBeLessThan(0.02);
  expect(leftOnly.rightHigh).toBeLessThan(0.02);

  await openDialog(page, clip);
  await page.getByTestId("audio-channels-format-mono").click();
  await page.getByTestId("audio-channels-cell-0-mix").click();
  await page.getByTestId("audio-channels-apply").click();
  await expect(page.getByTestId("audio-channels-dialog")).toBeHidden();
  const mix = await tones(page);
  expect(mix.leftLow, "mono fold-down keeps both channels").toBeGreaterThan(0.1);
  expect(mix.leftHigh).toBeGreaterThan(0.1);
  expect(mix.rightHigh).toBeGreaterThan(0.1);
  await expect(page.getByTestId("audio-channels-current")).toContainText("Mono");
});

test("Split to mono clips makes two mono clips on two tracks, one undo", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await openEditor(page);
  await muteMain(page);
  await importAudio(page, writeStereo("two-people.wav", 3));
  const clip = await addToLane(page, "two-people.wav", "Dialogue", 0);
  const tracksBefore = await page.evaluate(() => E().project.getState().project.timeline.tracks.length as number);
  await openDialog(page, clip);
  await page.getByTestId("audio-channels-split").click();
  await expect(page.getByTestId("audio-channels-dialog")).toBeHidden();
  const maps = await page.evaluate((id) => {
    const tracks = E().project.getState().project.timeline.tracks as any[];
    return {
      count: tracks.length,
      clips: tracks.flatMap((t) => t.clips).filter((c: any) => c.mediaId === tracks.flatMap((x) => x.clips).find((k: any) => k.id === id).mediaId).map((c: any) => ({ id: c.id, map: c.channelMap })),
    };
  }, clip);
  expect(maps.count).toBe(tracksBefore + 1);
  expect(maps.clips.map((c: any) => c.map.sources[0]).sort()).toEqual([0, 1]);
  const split = await tones(page);
  expect(split.leftLow, "first clip: the left channel").toBeGreaterThan(0.2);
  expect(split.rightHigh, "second clip: the right channel").toBeGreaterThan(0.2);
  await undo(page);
  await settle(page, 300);
  expect(await page.evaluate(() => E().project.getState().project.timeline.tracks.length as number)).toBe(tracksBefore);
  expect((await clipState(page, clip)).channelMap).toBeUndefined();
});

test("Split to mono clips works on a video clip with embedded stereo audio", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  const out = join(workDir, "interview.mp4");
  try {
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=gray:s=320x180:r=24:d=3", "-i", writeStereo("interview-src.wav", 3), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out], { stdio: "ignore" });
  } catch {
    test.skip(true, "ffmpeg is not available to build the stereo video fixture");
  }
  await openEditor(page);
  await importAudio(page, out);
  const clip = await addToLane(page, "interview.mp4", "Main", 0);
  const tracksBefore = await page.evaluate(() => E().project.getState().project.timeline.tracks.length as number);
  await openDialog(page, clip);
  await page.getByTestId("audio-channels-split").click();
  await expect(page.getByTestId("audio-channels-dialog")).toBeHidden();
  const after = await page.evaluate((id) => {
    const tracks = E().project.getState().project.timeline.tracks as any[];
    const mediaId = tracks.flatMap((t) => t.clips).find((k: any) => k.id === id).mediaId;
    return { count: tracks.length, sources: tracks.flatMap((t) => t.clips).filter((c: any) => c.mediaId === mediaId).map((c: any) => c.channelMap?.sources?.[0]).sort() };
  }, clip);
  expect(after.count).toBe(tracksBefore + 1);
  expect(after.sources).toEqual([0, 1]);
  await undo(page);
  await settle(page, 300);
  expect(await page.evaluate(() => E().project.getState().project.timeline.tracks.length as number)).toBe(tracksBefore);
});

test("Default audio channels preference stamps new imports and the mixdown follows it", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await openEditor(page);
  await muteMain(page);
  await page.evaluate(() => {
    const store = (window as any).__openreelE2E.settings;
    store.getState().setDefaultAudioChannels("mono");
  });
  await importAudio(page, writeStereo("default-mono.wav", 3));
  const clip = await addToLane(page, "default-mono.wav", "Dialogue", 0);
  const preset = await page.evaluate(() => E().project.getState().project.mediaLibrary.items.find((m: any) => m.name === "default-mono.wav").channelPreset);
  expect(preset).toBe("mono");
  const mix = await tones(page);
  expect(mix.leftLow, "mono preset plays the first channel on both sides").toBeGreaterThan(0.1);
  expect(mix.rightLow).toBeGreaterThan(0.1);
  expect(mix.leftHigh).toBeLessThan(0.02);
  await openDialog(page, clip);
  await expect(page.getByTestId("audio-channels-preset-mono")).toHaveAttribute("aria-checked", "true");
});

test("a 5.1 source reaches every channel through the mapping in the export mixdown", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  await openEditor(page);
  await muteMain(page);
  await importAudio(page, writeFiveOne("surround.wav", 3));
  const clip = await addToLane(page, "surround.wav", "Dialogue", 0);
  const channels = await page.evaluate(() => E().project.getState().project.mediaLibrary.items.find((m: any) => m.name === "surround.wav").metadata.channels);
  expect(channels).toBe(6);
  const at = async (freqs: readonly number[]) => {
    const m = await mixdown(page, 0, 3);
    return freqs.map((f) => ({ f, left: toneAmp(m.left, m.rate, f, 0.5, 2.5), right: toneAmp(m.right, m.rate, f, 0.5, 2.5) }));
  };

  // Mono <- source 3 (Centre, 700 Hz) through the dialog.
  await openDialog(page, clip);
  await page.getByTestId("audio-channels-format-mono").click();
  await page.getByTestId("audio-channels-cell-0-2").click();
  await page.getByTestId("audio-channels-apply").click();
  await expect(page.getByTestId("audio-channels-dialog")).toBeHidden();
  expect((await clipState(page, clip)).channelMap).toEqual({ format: "mono", sources: [2] });
  const centre = await at(SIX_TONES);
  expect(centre[2].left, "Centre plays on the left").toBeGreaterThan(0.1);
  expect(centre[2].right, "Centre plays on the right").toBeGreaterThan(0.1);
  for (const i of [0, 1, 3, 4, 5]) expect(Math.max(centre[i].left, centre[i].right), `tone ${SIX_TONES[i]} is gone`).toBeLessThan(0.02);

  // Stereo <- Ls (1100 Hz) and Rs (1300 Hz).
  await openDialog(page, clip);
  await page.getByTestId("audio-channels-format-stereo").click();
  await page.getByTestId("audio-channels-cell-0-4").click();
  await page.getByTestId("audio-channels-cell-1-5").click();
  await page.getByTestId("audio-channels-apply").click();
  await expect(page.getByTestId("audio-channels-dialog")).toBeHidden();
  expect((await clipState(page, clip)).channelMap).toEqual({ format: "stereo", sources: [4, 5] });
  const rear = await at(SIX_TONES);
  expect(rear[4].left, "Ls on the left").toBeGreaterThan(0.1);
  expect(rear[5].right, "Rs on the right").toBeGreaterThan(0.1);
  for (const i of [0, 1, 2, 3]) expect(Math.max(rear[i].left, rear[i].right), `tone ${SIX_TONES[i]} is gone`).toBeLessThan(0.02);
  expect(rear[4].right).toBeLessThan(0.02);
  expect(rear[5].left).toBeLessThan(0.02);
});

test("realtime preview plays the mapped channels (swap and a 5.1 source) frequency-exact", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  const out = await page.evaluate(async ({ sr, six }) => {
    const { RealtimeAudioGraph } = E().audio;
    const render = async (tones: number[], channelMap: unknown) => {
      const ctx = new OfflineAudioContext(2, sr * 2, sr);
      const clock = { getAudioContext: () => ctx, currentTime: 0, isPlaying: true };
      const graph = new RealtimeAudioGraph(clock as any);
      const buffer = ctx.createBuffer(tones.length, sr * 2, sr);
      tones.forEach((hz, c) => {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] = 0.3 * Math.sin((2 * Math.PI * hz * i) / sr);
      });
      graph.scheduleClip({ clipId: "c", trackId: "t", audioBuffer: buffer, channelMap, startTime: 0, endTime: 2, mediaOffset: 0, volume: 1, volumeAutomation: [], pan: 0, effects: [], speed: 1 });
      const rendered = await ctx.startRendering();
      const amp = (data: Float32Array, hz: number) => {
        let re = 0;
        let im = 0;
        const a = Math.floor(0.5 * sr);
        const b = Math.floor(1.5 * sr);
        for (let i = a; i < b; i++) {
          const w = (2 * Math.PI * hz * (i - a)) / sr;
          re += data[i] * Math.cos(w);
          im -= data[i] * Math.sin(w);
        }
        return (2 * Math.hypot(re, im)) / (b - a);
      };
      const l = rendered.getChannelData(0);
      const r = rendered.getChannelData(1);
      return tones.map((hz) => ({ hz, left: amp(l, hz), right: amp(r, hz) }));
    };
    return {
      plain: await render([440, 1000], undefined),
      swapped: await render([440, 1000], { format: "stereo", sources: [1, 0] }),
      rear: await render(six, { format: "stereo", sources: [4, 5] }),
      centre: await render(six, { format: "mono", sources: [2] }),
    };
  }, { sr: SR, six: [...SIX_TONES] });
  expect(out.plain[0].left).toBeGreaterThan(0.2);
  expect(out.plain[1].right).toBeGreaterThan(0.2);
  expect(out.swapped[1].left, "swap: right source plays on the left").toBeGreaterThan(0.2);
  expect(out.swapped[0].right, "swap: left source plays on the right").toBeGreaterThan(0.2);
  expect(out.swapped[0].left).toBeLessThan(0.02);
  expect(out.swapped[1].right).toBeLessThan(0.02);
  expect(out.rear[4].left, "Ls on the left").toBeGreaterThan(0.2);
  expect(out.rear[5].right, "Rs on the right").toBeGreaterThan(0.2);
  expect(Math.max(out.rear[0].left, out.rear[0].right, out.rear[2].left)).toBeLessThan(0.02);
  expect(out.centre[2].left).toBeGreaterThan(0.1);
  expect(out.centre[2].right).toBeGreaterThan(0.1);
  expect(Math.max(out.centre[4].left, out.centre[4].right)).toBeLessThan(0.02);
});

test("Preferences shows accurate Default audio channels copy and the picker stamps a UI import", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await openEditor(page);
  await muteMain(page);
  await page.evaluate(() => (window as any).__openreelE2E.settings.getState().openSettings());
  const trigger = page.getByRole("combobox", { name: "Default audio channels" });
  await trigger.scrollIntoViewIfNeeded();
  const copy = page.getByText(/Applies to files you import from now on/);
  await expect(copy).toContainText("Mono plays the first channel only");
  await expect(copy).not.toContainText("folds");
  await trigger.click();
  await page.getByRole("option", { name: "Mono" }).click();
  await expect(trigger).toContainText("Mono");
  await page.screenshot({ path: testInfo.outputPath("prefs-audio-channels.png") });
  await page.keyboard.press("Escape");
  await importAudio(page, writeStereo("via-ui.wav", 3));
  const preset = await page.evaluate(() => E().project.getState().project.mediaLibrary.items.find((m: any) => m.name === "via-ui.wav").channelPreset);
  expect(preset).toBe("mono");
});
