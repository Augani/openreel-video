import { expect, test } from "@playwright/test";
import { GPU_ARGS } from "./env";

test.use({ launchOptions: { args: [...GPU_ARGS, "--autoplay-policy=no-user-gesture-required"] } });

for (const format of ["audio/webm", "audio/mp4"]) {
  test(`recorded ${format} shows both loud and quiet phrases with silence between`, async ({ page }) => {
    await page.addInitScript((mimeType) => {
      const supports = MediaRecorder.isTypeSupported.bind(MediaRecorder);
      MediaRecorder.isTypeSupported = type => type.startsWith(mimeType) && supports(type);
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        await context.resume();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain).connect(destination);
        const now = context.currentTime;
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.setValueAtTime(0, now + 1.2);
        gain.gain.setValueAtTime(0.012, now + 2.4);
        oscillator.start();
        return destination.stream;
      };
    }, format);
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");
    const supported = await page.evaluate(mime => MediaRecorder.isTypeSupported(mime), format);
    test.skip(!supported, `This browser cannot record ${format}`);
    await page.getByRole("button", { name: /Horizontal/ }).click();
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await page.getByRole("menuitem", { name: "Record voice-over" }).click();
    await page.getByTestId("voiceover-preroll").selectOption("0");
    await page.getByRole("button", { name: "Record Voice Over", exact: true }).click();
    await expect(page.getByTestId("voiceover-panel")).toHaveAttribute("data-phase", "recording");
    await page.waitForTimeout(3800);
    await page.getByRole("button", { name: "Stop & Add to Timeline" }).click();
    const wave = page.getByRole("button", { name: /Select clip Voice Over Take 1/ }).locator('[data-clip-waveform="audio"]');
    await expect(wave).toBeVisible();
    const heights = await wave.locator("rect").evaluateAll(bars => bars.map(bar => Number(bar.getAttribute("height"))));
    const peak = (start: number, end: number) => {
      const from = Math.floor(start * heights.length);
      const to = Math.ceil(end * heights.length);
      return Math.max(...heights.slice(from, to));
    };
    expect(peak(0.08, 0.22)).toBeGreaterThan(3);
    expect(peak(0.40, 0.50)).toBeLessThan(1);
    expect(peak(0.78, 0.92)).toBeGreaterThan(2);
    expect(peak(0.78, 0.92)).toBeLessThan(peak(0.08, 0.22));

    // Scroll just short of the next lane update. The last visible bars still need to be mounted.
    await page.evaluate(() => {
      const { timeline } = (window as unknown as {
        __openreelE2E: { timeline: { getState(): { setZoom(value: number): void } } };
      }).__openreelE2E;
      timeline.getState().setZoom(500);
    });
    const viewport = page.getByTestId("timeline-tracks-scroll");
    await viewport.evaluate(element => { element.scrollLeft = 767; });
    await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBe(767);
    await expect.poll(() => wave.evaluate(svg => {
      const viewport = svg.closest('[data-testid="timeline-tracks-scroll"]')!;
      const visibleEnd = Math.min(viewport.getBoundingClientRect().right, svg.getBoundingClientRect().right);
      const lastBar = svg.querySelector("rect:last-of-type")!;
      return visibleEnd - lastBar.getBoundingClientRect().right;
    })).toBeLessThan(10);
  });
}
