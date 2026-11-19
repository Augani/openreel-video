import { expect, test, type Page } from "@playwright/test";
import { openEditor, settle } from "./helpers";
import { AUDIO_FIXTURE_PATH } from "./global-setup";

/**
 * Audio output device picker + solo-safe tracks, real Chrome:
 *  - solo on one track silences the others in the offline (export) mixdown, except a solo-safe track,
 *    and mute still beats solo-safe; toggling solo-safe is one undo step and is saved with the project;
 *  - the output device chosen in Preferences is applied with AudioContext.setSinkId, remembered across
 *    a reload, falls back to the system default with a toast when the device is unplugged, and
 *    switches back when it returns.
 */

interface Hook {
  project: { getState(): any };
  ui: { getState(): any };
  audio: Record<string, any>;
}
declare function E(): Hook;

const TONE = "Select media tone-4s.wav";

const history = (page: Page) =>
  page.evaluate(() => E().project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

async function rms(page: Page, start: number, duration: number): Promise<number> {
  return page.evaluate(
    async ([s, d]) => {
      const engine = E().audio.getAudioEngine();
      if (!engine.isInitialized()) await engine.initialize();
      const project = E().project.getState().getFullProject();
      const out = await engine.renderAudio(project, s, d);
      const left = out.buffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < left.length; i++) sum += left[i] * left[i];
      return Math.sqrt(sum / left.length);
    },
    [start, duration] as const,
  );
}

async function addToLane(page: Page, lane: string) {
  const result = await page.evaluate(
    async ([laneName]) => {
      const st = E().project.getState();
      const item = st.project.mediaLibrary.items.find((m: any) => m.name === "tone-4s.wav");
      const target = st.project.timeline.tracks.find((t: any) => t.name === laneName);
      return st.addClip(target.id, item.id, 0);
    },
    [lane] as const,
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
  await settle(page, 400);
}

/** Open the mixer panel; it stays open across a reload, so only toggle when it is not already showing. */
const openMixer = async (page: Page) => {
  const mixer = page.getByTestId("audio-mixer");
  const alreadyOpen = await mixer.waitFor({ timeout: 2_000 }).then(() => true, () => false);
  if (!alreadyOpen) await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
  await mixer.waitFor({ timeout: 15_000 });
};

const trackState = (page: Page, name: string) =>
  page.evaluate((n) => {
    const t = E().project.getState().project.timeline.tracks.find((x: any) => x.name === n);
    return { muted: t.muted as boolean, solo: t.solo as boolean, soloSafe: t.soloSafe as boolean | undefined };
  }, name);

test.describe("Solo-safe tracks", () => {
  test.describe.configure({ timeout: 240_000 });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
    });
  });

  test("a solo-safe track keeps playing in the export mixdown while another track is soloed", async ({ page }) => {
    await openEditor(page);
    await page.locator('input[type="file"]').first().setInputFiles(AUDIO_FIXTURE_PATH);
    await page.getByLabel(TONE).waitFor({ timeout: 30_000 });
    await addToLane(page, "Dialogue");
    await addToLane(page, "Music");
    await page.evaluate(async () => {
      const st = E().project.getState();
      await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Main").id, true);
    });
    const both = await rms(page, 0, 3);
    expect(both, "both tones are audible").toBeGreaterThan(0.01);

    await openMixer(page);
    const depth = await history(page);

    // Solo Dialogue: Music is silenced, so the mix is one tone instead of two (half the level).
    await page.getByRole("button", { name: "Solo Dialogue", exact: true }).click();
    await expect.poll(() => history(page)).toBe(depth + 1);
    expect(await rms(page, 0, 3)).toBeCloseTo(both / 2, 2);

    // Solo Safe on Music: it plays again although Dialogue is still soloed. One undo step.
    await page.getByRole("button", { name: "Solo Safe Music", exact: true }).click();
    await expect.poll(() => history(page)).toBe(depth + 2);
    await expect(page.getByRole("button", { name: "Solo Safe Music", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await rms(page, 0, 3)).toBeCloseTo(both, 2);
    expect((await trackState(page, "Music")).soloSafe).toBe(true);

    // Saved with the project.
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify(E().project.getState().getFullProject())).timeline.tracks.find((t: any) => t.name === "Music").soloSafe);
    expect(saved).toBe(true);

    // Mute still wins over solo-safe.
    await page.getByRole("button", { name: "Mute Music", exact: true }).click();
    expect(await rms(page, 0, 3)).toBeCloseTo(both / 2, 2);
    await page.getByRole("button", { name: "Mute Music", exact: true }).click();
    expect(await rms(page, 0, 3)).toBeCloseTo(both, 2);

    // Undo (unmute, mute, solo-safe) returns Music to "silenced by the solo".
    for (let i = 0; i < 3; i++) await page.evaluate(() => E().project.getState().undo());
    await expect(page.getByRole("button", { name: "Solo Safe Music", exact: true })).toHaveAttribute("aria-pressed", "false");
    expect(await rms(page, 0, 3)).toBeCloseTo(both / 2, 2);

    // Clearing the solo plays everything again.
    await page.getByRole("button", { name: "Solo Dialogue", exact: true }).click();
    expect(await rms(page, 0, 3)).toBeCloseTo(both, 2);
  });
});

test.describe("Audio output device", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, any>;
      w.E = () => w.__openreelE2E;
      const device = (deviceId: string, label: string) => ({ deviceId, label, kind: "audiooutput", groupId: "g", toJSON: () => ({}) });
      w.__devices = [device("default", "Default - Speakers"), device("speakers-id", "Built-in Speakers"), device("headset-id", "USB Headset")];
      w.__sinkCalls = [] as string[];
      const media = navigator.mediaDevices;
      media.enumerateDevices = async () => w.__devices;
      // Headless Chrome has no real outputs: record the sink instead of asking the OS for a fake id.
      (AudioContext.prototype as any).setSinkId = async function (id: unknown) {
        w.__sinkCalls.push(typeof id === "string" ? id : JSON.stringify(id));
      };
      w.__plug = (list: string[]) => {
        const all = [device("default", "Default - Speakers"), device("speakers-id", "Built-in Speakers"), device("headset-id", "USB Headset")];
        w.__devices = all.filter((d) => d.deviceId === "default" || list.includes(d.deviceId));
        media.dispatchEvent(new Event("devicechange"));
      };
    });
  });

  const sinkCalls = (page: Page) => page.evaluate(() => (window as any).__sinkCalls as string[]);

  async function openPreferences(page: Page) {
    await page.evaluate(() => (window as any).__openreelE2E.settings.getState().openSettings("general"));
    await page.getByTestId("prefs-audio-output").waitFor({ timeout: 10_000 });
  }

  test("picker applies setSinkId, is remembered, falls back with a toast on unplug and returns on replug", async ({ page }) => {
    await openEditor(page);
    await openMixer(page); // creates the preview graph the sink is applied to
    await openPreferences(page);

    await page.getByTestId("prefs-audio-output-trigger").click();
    await expect(page.getByRole("option", { name: "System default" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Built-in Speakers" })).toBeVisible();
    await page.getByRole("option", { name: "USB Headset" }).click();
    await expect.poll(async () => (await sinkCalls(page)).at(-1)).toBe("headset-id");
    await expect(page.getByTestId("prefs-audio-output-trigger")).toContainText("USB Headset");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("openreel-settings") ?? "{}").state.audioOutputDeviceId)).toBe("headset-id");

    // The mixer carries the same picker, showing the same device.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mixer-audio-output-trigger")).toContainText("USB Headset");

    // Unplug: audio moves to the system default and the user is told.
    await page.evaluate(() => (window as any).__plug(["speakers-id"]));
    await expect.poll(async () => (await sinkCalls(page)).at(-1)).toBe("");
    await expect(page.getByText("USB Headset disconnected")).toBeVisible();
    await expect(page.getByTestId("mixer-audio-output-status")).toContainText("disconnected");
    // The choice is still remembered.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("openreel-settings") ?? "{}").state.audioOutputDeviceId)).toBe("headset-id");

    // Replug: back on the chosen device.
    await page.evaluate(() => (window as any).__plug(["speakers-id", "headset-id"]));
    await expect.poll(async () => (await sinkCalls(page)).at(-1)).toBe("headset-id");
    await expect(page.getByText("Back on USB Headset")).toBeVisible();

    // A fresh session applies the remembered device without opening Preferences.
    await page.reload();
    await page.getByRole("button", { name: /Horizontal/ }).click();
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
    await openMixer(page);
    await expect.poll(async () => (await sinkCalls(page)).at(-1)).toBe("headset-id");
    await expect(page.getByTestId("mixer-audio-output-trigger")).toContainText("USB Headset");

    // Choosing the system default switches back and forgets the device.
    await page.getByTestId("mixer-audio-output-trigger").click();
    await page.getByRole("option", { name: "System default" }).click();
    await expect.poll(async () => (await sinkCalls(page)).at(-1)).toBe("");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("openreel-settings") ?? "{}").state.audioOutputDeviceId)).toBe("");
  });
});
