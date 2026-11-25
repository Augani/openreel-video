import { expect, test, type Page } from "@playwright/test";
import { GPU_ARGS } from "./env";
import { openEditor, readState, settle } from "./helpers";
import { installFakeMicFallback } from "./voiceover-lib";

/**
 * Voice-over recording against Chrome's fake microphone (--use-fake-device-for-media-stream feeds a beep
 * stream and --use-fake-ui-for-media-stream answers the permission prompt):
 *  - the input device is chosen from enumerateDevices and remembered (parsing on reload is unit tested);
 *  - the pre-roll counts down while the timeline plays, then recording starts at the playhead;
 *  - the take is a normal clip named "Voice Over Take N" on a new Voice Over track, removed by ONE undo;
 *  - a re-take of the same range stacks on a new track instead of overlapping;
 *  - "mute playback while recording" silences the preview only for the take;
 *  - punch in/out records exactly between the In and Out marks and stops by itself.
 */
test.use({
  launchOptions: { args: [...GPU_ARGS, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
  permissions: ["microphone"],
});

test.beforeEach(async ({ page }) => {
  // CI (or VO_STRICT_FAKE_MIC=1) lets only Chrome's real fake device answer; elsewhere a tone stands in for a
  // host whose microphone privacy state stalls the request, and the spec says which one it used.
  await installFakeMicFallback(page, process.env.CI || process.env.VO_STRICT_FAKE_MIC ? 0 : 2500);
  if (process.env.VO_DEBUG) { page.on("console", (m) => { if (m.type() !== "debug") console.log("CONSOLE", m.type(), m.text().slice(0, 300)); }); page.on("pageerror", (e) => console.log("PAGEERR", e.message)); }
});

interface E2EWindow {
  __openreelE2E: {
    voiceover: { getState(): Record<string, any> };
    timeline: { getState(): Record<string, any> };
    workspace: { getState(): Record<string, any> };
    project: { getState(): Record<string, any> };
  };
}

async function openVoiceOverPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("menuitem", { name: "Record voice-over" }).click();
  await expect(page.getByTestId("voiceover-panel")).toBeVisible();
}

/** Records every recorder state change (phase, countdown, transport) so a stalled page cannot miss the 1 s steps. */
async function traceRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as E2EWindow & { __voTrace: Array<{ phase: string; countdown: number; playing: boolean; playhead: number }> };
    w.__voTrace = [];
    w.__openreelE2E.voiceover.subscribe((state: Record<string, any>) => {
      const t = w.__openreelE2E.timeline.getState();
      w.__voTrace.push({ phase: state.phase, countdown: state.countdown, playing: t.playbackState === "playing", playhead: t.playheadPosition });
    });
  });
}
const readTrace = (page: Page) =>
  page.evaluate(() => (window as unknown as { __voTrace: Array<{ phase: string; countdown: number; playing: boolean; playhead: number }> }).__voTrace);

const phase = (page: Page) => page.getByTestId("voiceover-panel").getAttribute("data-phase");

async function timeline(page: Page): Promise<{ playhead: number; playing: boolean }> {
  return page.evaluate(() => {
    const t = (window as unknown as E2EWindow).__openreelE2E.timeline.getState();
    return { playhead: t.playheadPosition as number, playing: t.playbackState === "playing" };
  });
}

const voiceTracks = async (page: Page) =>
  (await readState(page)).tracks.filter((track) => track.name.startsWith("Voice Over") && track.clips.length > 0);

test("records a take with pre-roll, stacks a re-take, mutes playback and undoes in one step", async ({ page }) => {
  test.setTimeout(420_000);
  await openEditor(page);
  await openVoiceOverPanel(page);

  // Input devices come from enumerateDevices; the fake device is listed once the microphone is open.
  await page.getByTestId("voiceover-monitor").click();
  await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "monitoring", { timeout: 20_000 });
  const device = page.getByTestId("voiceover-device");
  await expect.poll(async () => device.locator("option").count()).toBeGreaterThan(1);
  const micSource = await page.evaluate(() => (window as unknown as { __voiceOverFakeMic: string }).__voiceOverFakeMic);
  test.info().annotations.push({ type: "mic-source", description: micSource });
  // The meter reads the live input, so the beep stream must light it.
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as E2EWindow).__openreelE2E.voiceover.getState().level as number), { timeout: 20_000 })
    .toBeGreaterThan(0.02);
  await page.getByTestId("voiceover-monitor").click();
  await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "idle");

  const chosen = await device.locator("option").nth(1).getAttribute("value");
  await device.selectOption(chosen!);
  await page.getByTestId("voiceover-preroll").selectOption("2");
  const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem("openreel:voiceover:prefs:v1") ?? "{}"));
  expect(remembered).toMatchObject({ deviceId: chosen, preRoll: 2, muteDuringRecord: true });

  const before = await readState(page);
  await page.evaluate(() => (window as unknown as E2EWindow).__openreelE2E.timeline.getState().seekTo(3));
  await settle(page, 300);

  await traceRecorder(page);
  await page.getByRole("button", { name: "Record Voice Over" }).click();
  await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "recording", { timeout: 60_000 });
  // The countdown ran 2, 1 with the transport playing, and the timeline was parked 2 s before the take (3 - 2 = 1 s).
  const trace = await readTrace(page);
  const countdown = trace.filter((entry) => entry.phase === "countdown");
  expect(countdown.map((entry) => entry.countdown)).toContain(2);
  expect(countdown.map((entry) => entry.countdown)).toContain(1);
  expect(countdown.some((entry) => entry.playing)).toBe(true);
  expect(countdown[0].playhead).toBeGreaterThanOrEqual(0.99);
  expect(countdown[0].playhead).toBeLessThan(3);
  // Playback runs through the pre-roll: the playhead advances toward the take start while counting down.
  const advanced = Math.max(...trace.map((entry) => entry.playhead)) - countdown[0].playhead;
  expect(advanced).toBeGreaterThan(0.3);
  // Playback is silenced for the take only.
  await expect(page.getByRole("button", { name: "Unmute", exact: true })).toBeVisible();
  await page.waitForTimeout(1600);
  await page.getByRole("button", { name: "Stop & Add to Timeline" }).click();

  await expect.poll(async () => (await voiceTracks(page)).length, { timeout: 30_000 }).toBe(1);
  await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "idle", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Mute", exact: true })).toBeVisible();
  expect((await timeline(page)).playing).toBe(false);

  const first = (await voiceTracks(page))[0];
  expect(first.name).toBe("Voice Over");
  expect(first.type).toBe("audio");
  expect(first.clips[0].start).toBeGreaterThan(2.7);
  expect(first.clips[0].start).toBeLessThanOrEqual(3.001);
  expect(first.clips[0].duration).toBeGreaterThan(1);
  await expect(page.getByTestId("voiceover-take").first()).toContainText("Voice Over Take 1");

  // Re-take over the same range on the same track: stacked on a new track, never overlapping.
  await page.getByTestId("voiceover-track").selectOption(first.id);
  await page.getByTestId("voiceover-preroll").selectOption("0");
  await page.evaluate((t) => (window as unknown as E2EWindow).__openreelE2E.timeline.getState().seekTo(t), first.clips[0].start + 0.2);
  await settle(page, 300);
  await page.getByRole("button", { name: "Record Voice Over" }).click();
  await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "recording", { timeout: 60_000 });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop & Add to Timeline" }).click();
  await expect.poll(async () => (await voiceTracks(page)).length, { timeout: 30_000 }).toBe(2);
  const tracks = await voiceTracks(page);
  expect(tracks.map((t) => t.name).sort()).toEqual(["Voice Over", "Voice Over 2"]);
  await expect(page.getByTestId("voiceover-take")).toHaveCount(2);
  await expect(page.getByTestId("voiceover-take").nth(1)).toContainText("Voice Over Take 2");
  await expect(page.getByTestId("voiceover-note")).toContainText("stacked on a new track");

  // One undo removes the whole second take (new track, rename and clip together), leaving the first take.
  await page.getByTestId("voiceover-panel").click({ position: { x: 4, y: 4 } });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await voiceTracks(page)).length, { timeout: 10_000 }).toBe(1);
  expect((await readState(page)).tracks.length).toBe(before.tracks.length + 1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await readState(page)).tracks.length, { timeout: 10_000 }).toBe(before.tracks.length);
});

test("punch in/out records only between the In and Out marks and stops by itself", async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await openVoiceOverPanel(page);

  // Punch needs a valid In/Out range.
  await expect(page.getByTestId("voiceover-punch")).toBeDisabled();
  await page.evaluate(() => (window as unknown as E2EWindow).__openreelE2E.timeline.getState().setLoopRange(1, 2.6));
  await expect(page.getByTestId("voiceover-punch")).toBeEnabled();
  await page.getByTestId("voiceover-punch").check();
  await page.getByTestId("voiceover-preroll").selectOption("1");
  await page.evaluate(() => (window as unknown as E2EWindow).__openreelE2E.timeline.getState().seekTo(5));
  await expect(page.getByTestId("voiceover-subline")).toContainText("Punches 0:01.0 to 0:02.6");

  await page.getByRole("button", { name: "Record Voice Over" }).click();
  await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "recording", { timeout: 60_000 });
  // No Stop click: the take ends at Out by itself, about 1.6 s after it began.
  await expect.poll(async () => (await voiceTracks(page)).length, { timeout: 30_000 }).toBe(1);
  const clip = (await voiceTracks(page))[0].clips[0];
  expect(clip.start).toBeGreaterThan(0.74);
  expect(clip.start).toBeLessThanOrEqual(1.001);
  expect(clip.duration).toBeGreaterThan(0.9);
  expect(clip.duration).toBeLessThan(2.4);
  await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "idle", { timeout: 15_000 });
});

test("a device picked during a level check is the one the take is recorded from", async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await openVoiceOverPanel(page);

  await page.getByTestId("voiceover-monitor").click();
  await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "monitoring", { timeout: 20_000 });
  const device = page.getByTestId("voiceover-device");
  await expect.poll(async () => device.locator("option").count()).toBeGreaterThan(2);
  // The "default" alias is the same microphone as "System default": it is listed once.
  const values = await device.locator("option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  expect(values).not.toContain("default");
  expect(values.filter((v) => v === "").length).toBe(1);

  const gum = () => page.evaluate(() => (window as unknown as { __voiceOverGum: Array<{ deviceId: string | null; echoCancellation: boolean | null }> }).__voiceOverGum);
  const callsBefore = (await gum()).length;
  const chosen = values.find((v) => v !== "")!;
  await device.selectOption(chosen);
  // The monitor reopens on the new microphone right away.
  await expect.poll(async () => (await gum()).length, { timeout: 15_000 }).toBeGreaterThan(callsBefore);
  expect((await gum()).at(-1)?.deviceId).toBe(chosen);
  await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "monitoring", { timeout: 20_000 });

  // Toggling mute-input changes the echo-cancellation constraint, which also reopens the stream.
  const callsMid = (await gum()).length;
  await page.getByTestId("voiceover-mute").click();
  await expect.poll(async () => (await gum()).length, { timeout: 15_000 }).toBeGreaterThan(callsMid);
  await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "monitoring", { timeout: 20_000 });

  await page.getByTestId("voiceover-preroll").selectOption("0");
  await page.getByRole("button", { name: "Record Voice Over" }).click();
  await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "recording", { timeout: 60_000 });
  expect((await gum()).at(-1)?.deviceId).toBe(chosen);
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Stop & Add to Timeline" }).click();
  await expect.poll(async () => (await voiceTracks(page)).length, { timeout: 30_000 }).toBe(1);
  // The inspector/take list shows the clean take name, without the file extension.
  await expect(page.getByTestId("voiceover-take").first()).not.toContainText(".webm");
  const mediaNames = await page.evaluate(() =>
    ((window as unknown as E2EWindow).__openreelE2E.project.getState().project.mediaLibrary.items as Array<{ name: string }>).map((i) => i.name),
  );
  expect(mediaNames).toContain("Voice Over Take 1");
});
