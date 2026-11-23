/**
 * Real-Electron e2e for the Media Browser and XMP metadata (Playwright _electron, the BUILT app).
 *
 * Generates a Sony XAVC S card and an AVCHD card (one recording spanning two stream files) with ffmpeg,
 * browses them in the Media Browser (clips, not folders), scrubs a thumbnail, previews the spanned clip in
 * the Source monitor before import, imports it as ONE item, edits its keywords in the Metadata panel and
 * finds it again with the Project panel search. Also checks the sidecar .xmp is written next to the media
 * and the media file itself is untouched.
 *
 *   VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 *   pnpm --filter @openreel/desktop test:media-browser-e2e
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const root = path.resolve(__dirname, "../../..");
const bundled = path.join(root, `apps/desktop/resources/bin/${process.platform}-${process.arch}/ffmpeg`);
const FFMPEG = process.env.FFMPEG ?? [bundled, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => fs.existsSync(p)) ?? "ffmpeg";
const enabled =
  process.env.OPENREEL_DESKTOP_MEDIA_BROWSER_E2E === "1" &&
  fs.existsSync(FFMPEG) &&
  fs.existsSync(path.join(root, "apps/desktop/dist/main/index.js")) &&
  fs.existsSync(path.join(root, "apps/web/dist/index.html"));
const d = enabled ? describe : describe.skip;

const require = createRequire(path.join(root, "package.json"));
function loadPlaywright(): { _electron: any } {
  const pnpmDir = path.join(root, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((name) => name.startsWith("playwright@"));
  return require(path.join(pnpmDir, dir!, "node_modules/playwright"));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(label: string, read: () => Promise<T> | T, timeout = 60_000): Promise<NonNullable<T>> {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (value) return value as NonNullable<T>;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(150);
  }
}
const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function ff(args: string[]): void {
  execFileSync(FFMPEG, ["-y", "-v", "error", ...args], { stdio: "pipe" });
}
function mp4(out: string, seconds: number, hue: number): void {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  ff(["-f", "lavfi", "-i", `testsrc2=s=320x180:r=25,hue=h=${hue}`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", String(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out]);
}
function mts(out: string, seconds: number, hue: number): void {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  ff(["-f", "lavfi", "-i", `testsrc2=s=320x180:r=25,hue=h=${hue}`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", String(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-f", "mpegts", out]);
}
const playlist = (...ids: string[]): Buffer => Buffer.from(`MPLS0100\0\0\0\0${ids.map((id) => `${id}M2TS\0\0\0`).join("")}`, "latin1");

d("Media Browser and XMP (real Electron)", () => {
  let app: any;
  let page: any;
  let work = "";
  let sonyCard = "";
  let avchdCard = "";
  let firstStream = "";
  let firstStreamHash = "";

  const E = (expression: string): Promise<any> => page.evaluate(`(async (h) => (${expression}))(window.__openreelE2E)`);
  const entries = async (): Promise<Array<{ name: string; kind: string; segments: string }>> =>
    page.locator('[data-testid="media-browser-entry"]').evaluateAll((nodes: Element[]) =>
      nodes.map((n) => ({ name: n.getAttribute("data-entry-name")!, kind: n.getAttribute("data-entry-clip")!, segments: n.getAttribute("data-entry-segments")! })),
    );
  const goTo = async (folder: string): Promise<void> => {
    await page.getByTestId("media-browser-path").fill(folder);
    await page.getByTestId("media-browser-path").press("Enter");
  };

  beforeAll(async () => {
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "openreel-mbe2e-")));
    sonyCard = path.join(work, "SONY_SD");
    avchdCard = path.join(work, "AVCHD_SD");
    mp4(path.join(sonyCard, "PRIVATE/M4ROOT/CLIP/C0001.MP4"), 2, 0);
    mp4(path.join(sonyCard, "PRIVATE/M4ROOT/CLIP/C0002.MP4"), 1.5, 120);
    mp4(path.join(sonyCard, "PRIVATE/M4ROOT/SUB/C0001S03.MP4"), 2, 0);
    const stream = path.join(avchdCard, "PRIVATE/AVCHD/BDMV/STREAM");
    firstStream = path.join(stream, "00001.MTS");
    mts(path.join(stream, "00000.MTS"), 1, 40);
    mts(firstStream, 2, 0);
    mts(path.join(stream, "00002.MTS"), 1.5, 200);
    const plDir = path.join(avchdCard, "PRIVATE/AVCHD/BDMV/PLAYLIST");
    fs.mkdirSync(plDir, { recursive: true });
    fs.writeFileSync(path.join(plDir, "00000.MPL"), playlist("00000"));
    fs.writeFileSync(path.join(plDir, "00001.MPL"), playlist("00001", "00002"));
    firstStreamHash = sha(firstStream);

    const userData = path.join(work, "profile");
    const { _electron } = loadPlaywright();
    app = await _electron.launch({
      args: [path.join(root, "apps/desktop"), `--user-data-dir=${userData}`],
      env: { ...process.env, OPENREEL_FFMPEG_PATH: FFMPEG, OPENREEL_SKIP_ONBOARDING: "1" },
      timeout: 120_000,
    });
    page = await app.firstWindow();
    await page.addInitScript(() => {
      try {
        localStorage.setItem("openreel-onboarding-complete", "true");
        localStorage.setItem("openreel-mograph-tour-complete", "true");
      } catch {
        /* storage unavailable */
      }
    });
    await page.reload();
    await page.getByRole("button", { name: /Horizontal/ }).click({ timeout: 60_000 });
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.project), undefined, { timeout: 30_000 });
  });

  afterAll(async () => {
    try {
      await Promise.race([app?.evaluate(({ app: a }: any) => a.exit(0)).catch(() => undefined), sleep(4000)]);
      app?.process().kill("SIGKILL");
    } catch {
      /* already gone */
    }
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it("shows a Sony card as clips and scrubs a thumbnail on hover", async () => {
    await page.getByRole("button", { name: "Media Browser" }).click();
    await page.getByTestId("media-browser").waitFor({ timeout: 30_000 });
    await goTo(sonyCard);
    await page.getByTestId("media-browser-card-banner").waitFor({ timeout: 30_000 });
    expect(await page.getByTestId("media-browser-card-banner").innerText()).toContain("Sony XAVC");
    await until("two clips", async () => (await entries()).length === 2);
    expect(await entries()).toEqual([
      { name: "C0001", kind: "sony-xavc", segments: "1" },
      { name: "C0002", kind: "sony-xavc", segments: "1" },
    ]);
    const thumb = page.getByTestId("media-browser-entry").first().getByTestId("media-browser-thumb");
    await until("a thumbnail", async () => (await thumb.locator("img").count()) > 0);
    const src = (): Promise<string | null> => thumb.locator("img").getAttribute("src");
    const poster = await src();
    expect(poster?.startsWith("data:image/jpeg")).toBe(true);
    const box = (await thumb.boundingBox())!;
    await thumb.hover({ position: { x: 2, y: box.height / 2 } });
    await until("scrub frames", async () => {
      await thumb.hover({ position: { x: box.width - 3, y: box.height / 2 } });
      const now = await src();
      return now && now !== poster ? now : null;
    }, 30_000);
    const late = await src();
    await thumb.hover({ position: { x: 2, y: box.height / 2 } });
    await until("the first scrub frame", async () => (await src()) !== late);
    // Folder view of the same card, then back to clips.
    await page.getByTestId("media-browser-raw").check();
    await until("folders", async () => (await entries()).every((e) => e.kind === "") && (await entries()).some((e) => e.name === "PRIVATE"));
    await page.getByTestId("media-browser-raw").uncheck();
    await until("clips again", async () => (await entries()).length === 2);
  });

  it("shows an AVCHD card with the spanned recording as ONE clip and previews it in the Source monitor before import", async () => {
    await goTo(avchdCard);
    await until("AVCHD banner", async () => (await page.getByTestId("media-browser-card-banner").innerText().catch(() => "")).includes("AVCHD"));
    await until("AVCHD clips", async () => (await entries()).length === 2);
    expect(await entries()).toEqual([
      { name: "00000", kind: "avchd", segments: "1" },
      { name: "00001", kind: "avchd", segments: "2" },
    ]);
    await page.getByTestId("media-browser-entry").nth(1).click();
    await page.getByTestId("media-browser-preview").click();
    await page.getByTestId("source-external-banner").waitFor({ timeout: 120_000 });
    expect(await page.getByTestId("source-external-banner").innerText()).toContain("2 files joined");
    const video = page.getByTestId("source-video");
    await until("preview metadata", async () => (await video.evaluate((el: HTMLVideoElement) => el.readyState >= 1 && el.duration > 0)).valueOf());
    const duration = await video.evaluate((el: HTMLVideoElement) => el.duration);
    expect(duration).toBeGreaterThan(3.2);
    expect(duration).toBeLessThan(3.8);
    // Seeking into the second file works: the preview is the whole recording.
    await video.evaluate((el: HTMLVideoElement) => { el.currentTime = 3.0; });
    await until("seek", async () => (await video.evaluate((el: HTMLVideoElement) => Math.abs(el.currentTime - 3.0) < 0.2)).valueOf());
    expect(await E("h.project.getState().project.mediaLibrary.items.length")).toBe(0);
    // Previewing is read-only: no edit buttons.
    expect(await page.getByRole("button", { name: "Insert (,)" }).isDisabled()).toBe(true);
    await page.getByTestId("source-external-close").click();
    await page.getByTestId("source-external-banner").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Media Browser" }).click();
  });

  it("imports the spanned clip as one item and keeps the camera files untouched", async () => {
    await page.getByTestId("media-browser").waitFor();
    await page.getByTestId("media-browser-entry").nth(1).click();
    await page.getByTestId("media-browser-import").click();
    const item: any[] = await until(
      "the imported item",
      async () => {
        const items = await E("h.project.getState().project.mediaLibrary.items.map(i => ({ id: i.id, name: i.name, duration: i.metadata.duration, path: i.sourceFile && i.sourceFile.path }))");
        // The item appears before its sourceFile.path is attached, so wait for both.
        return items.length && items.every((i) => typeof i.path === "string") ? items : null;
      },
      120_000,
    );
    expect(item).toHaveLength(1);
    expect(item[0].name).toBe("00001.mts");
    expect(item[0].duration).toBeGreaterThan(3.3);
    expect(item[0].duration).toBeLessThan(3.7);
    expect(item[0].path).toContain("joined");
    expect(sha(firstStream)).toBe(firstStreamHash);
  });

  it("edits keywords in the Metadata panel, finds the clip by search and writes a sidecar next to a real file", async () => {
    await page.getByRole("button", { name: "Media", exact: true }).click();
    await page.getByLabel("Select media 00001.mts").first().click();
    await page.getByRole("button", { name: "Metadata" }).click();
    await page.getByTestId("metadata-panel").waitFor();
    const input = page.getByTestId("metadata-keyword-input");
    await input.fill("wedding, ceremony");
    await input.press("Enter");
    await until("keywords in the project", async () => ((await E("h.project.getState().project.mediaLibrary.items[0].keywords")) as string[] | undefined)?.join(",") === "wedding,ceremony");
    await page.getByTestId("metadata-scene").fill("12A");
    await page.getByTestId("metadata-scene").blur();
    await page.getByTestId("metadata-reel").fill("A007");
    await page.getByTestId("metadata-reel").blur();
    await until("scene and reel", async () => (await E("(() => { const i = h.project.getState().project.mediaLibrary.items[0]; return i.scene === '12A' && i.reel === 'A007'; })()")) === true);

    // The Project panel finds it by keyword; another word finds nothing.
    await page.getByRole("button", { name: "Media", exact: true }).click();
    const search = page.getByLabel("Search media");
    await search.fill("ceremony");
    await page.getByLabel("Select media 00001.mts").first().waitFor({ timeout: 10_000 });
    await search.fill("keyword:funeral");
    await until("no match", async () => (await page.getByLabel("Select media 00001.mts").count()) === 0);
    await search.fill("reel:a007");
    await page.getByLabel("Select media 00001.mts").first().waitFor({ timeout: 10_000 });
    await search.fill("");

    // Undo reverts the reel edit, then the scene edit.
    await E("h.project.getState().undo()");
    await E("h.project.getState().undo()");
    expect(await E("h.project.getState().project.mediaLibrary.items[0].scene ?? null")).toBeNull();
    await E("h.project.getState().redo()");
    await E("h.project.getState().redo()");
    expect(await E("h.project.getState().project.mediaLibrary.items[0].scene")).toBe("12A");

    // Sidecar next to a real file (the Sony clip, imported straight from the card).
    const sonyClip = path.join(sonyCard, "PRIVATE/M4ROOT/CLIP/C0002.MP4");
    const before = sha(sonyClip);
    await page.getByRole("button", { name: "Media Browser" }).click();
    await goTo(sonyCard);
    await until("Sony clips", async () => (await entries()).length === 2);
    await page.getByTestId("media-browser-entry").nth(1).click();
    await page.getByTestId("media-browser-import").click();
    await until("two items", async () => (await E("h.project.getState().project.mediaLibrary.items.length")) === 2, 120_000);
    const id = await E("h.project.getState().project.mediaLibrary.items.find(i => i.name === 'C0002.MP4').id");
    await page.getByRole("button", { name: "Media", exact: true }).click();
    await page.getByLabel("Select media C0002.MP4").first().click();
    await page.getByRole("button", { name: "Metadata" }).click();
    await page.getByTestId("metadata-keyword-input").fill("b-roll");
    await page.getByTestId("metadata-keyword-input").press("Enter");
    await until("keyword", async () => ((await E(`h.project.getState().project.mediaLibrary.items.find(i => i.id === ${JSON.stringify(id)}).keywords`)) as string[] | undefined)?.[0] === "b-roll");
    await page.getByTestId("metadata-write-sidecar").click();
    const sidecar = path.join(sonyCard, "PRIVATE/M4ROOT/CLIP/C0002.xmp");
    await until("the sidecar file", () => fs.existsSync(sidecar));
    const xml = fs.readFileSync(sidecar, "utf8");
    expect(xml).toContain("<rdf:li>b-roll</rdf:li>");
    expect(xml).toContain("<rdf:Bag>");
    expect(sha(sonyClip)).toBe(before);
    // The sidecar is read back on the next import-time read.
    const read = await page.evaluate((p: string) => (window as any).openreel.mediaBrowser.readXmp(p), sonyClip);
    expect(read).toMatchObject({ source: "sidecar", fields: { keywords: ["b-roll"] } });
  });
});
