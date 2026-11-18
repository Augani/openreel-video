import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { importTimeline, validateOtio, validateXmeml } from "@openreel/core/interchange/index";
import { boxOf, chooseFileMenu, clipsOf, diffSnaps, openEditor, readState, seek, settle, setZoom, snap, snapStable, splitIntoThree, undo, redo } from "./helpers";

/**
 * Nest completeness + interchange of a chosen sequence, in real Chrome with a
 * real mouse and real canvas pixels: nest a range holding a title, a masked clip
 * with an effect and a keyframe, a transition, a caption and a marker; the parent
 * renders the SAME pixels before and after (and after undo); a real double-click
 * on the nest clip opens it; the nest sequence is exported to OTIO and XMEML from
 * the sequence picker while the parent is active, validated and re-imported.
 */

interface Hook {
  __openreelE2E: { project: { getState(): any }; ui: { getState(): any; setState(s: unknown): void } };
}

const FRAME_TIMES = [0.5, 1.5, 2.0, 3.0, 3.9];

const projectOf = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Hook).__openreelE2E.project.getState().getFullProject();
    return {
      active: p.activeSequenceId as string,
      sequences: (p.sequences ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
        tracks: s.timeline.tracks.map((t: any) => ({ id: t.id, type: t.type, clips: t.clips.map((c: any) => c.id), transitions: t.transitions.length })),
        subtitles: s.timeline.subtitles.map((c: any) => [c.id, c.startTime, c.endTime]),
        markers: s.timeline.markers.map((m: any) => [m.id, m.time]),
      })),
      text: (p.textClips ?? []).map((t: any) => ({ id: t.id, trackId: t.trackId, startTime: t.startTime })),
      masks: (p.masks ?? []).map((m: any) => m.clipId),
      subtitles: p.timeline.subtitles.length,
      markers: p.timeline.markers.length,
      transitions: p.timeline.tracks.reduce((n: number, t: any) => n + t.transitions.length, 0),
    };
  });

async function decorate(page: Page, ids: { a: string; b: string }): Promise<{ title: string }> {
  // A title on its own text track (the real store API)...
  const title = await page.evaluate(async () => {
    const store = (window as unknown as Hook).__openreelE2E.project.getState();
    await store.addTrack("text", 0, { name: "Titles" });
    const trackId = (window as unknown as Hook).__openreelE2E.project.getState().project.timeline.tracks.find((t: any) => t.type === "text").id;
    const clip = (window as unknown as Hook).__openreelE2E.project.getState().createTextClip(trackId, 0.5, "NEST ME", 3);
    return clip.id as string;
  });
  // ...then the rest as one committed snapshot edit (effect, keyframe, mask, transition, caption, marker).
  await page.evaluate(
    async ([a, b]) => {
      const store = (window as unknown as Hook).__openreelE2E.project.getState();
      const full = store.getFullProject();
      const tracks = full.timeline.tracks.map((t: any) =>
        t.name !== "Main"
          ? t
          : {
              ...t,
              clips: t.clips.map((c: any) =>
                c.id === a
                  ? { ...c, effects: [{ id: "fx-gray", type: "grayscale", enabled: true, params: {} }] }
                  : c.id === b
                    ? { ...c, keyframes: [
                        { id: "kf-x0", time: 0, property: "position.x", value: 0, easing: "linear" },
                        { id: "kf-x1", time: 1, property: "position.x", value: 160, easing: "linear" },
                      ] }
                    : c,
              ),
              transitions: [{ id: "tr-1", clipAId: a, clipBId: b, type: "crossfade", duration: 0.5, params: {} }],
            },
      );
      const snapshot = {
        ...full,
        timeline: {
          ...full.timeline,
          tracks,
          subtitles: [{ id: "cap-1", text: "Caption inside the nest", startTime: 1, endTime: 3 }, { id: "cap-far", text: "later", startTime: 5, endTime: 5.5 }],
          markers: [{ id: "mk-1", time: 1, label: "In range", color: "#ff0000" }, { id: "mk-far", time: 5, label: "Out of range", color: "#00ff00" }],
        },
        masks: [{ id: "mask-1", clipId: a, type: "shape", path: { points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }], closed: true }, feathering: 0, inverted: false, expansion: 0, opacity: 1, keyframes: [] }],
      };
      const outcome = await store.executeAction({ type: "project/applyEditSnapshot", id: crypto.randomUUID(), timestamp: Date.now(), params: { snapshot } });
      if (!outcome.success) throw new Error(outcome.error?.message ?? "decorate failed");
    },
    [ids.a, ids.b],
  );
  await settle(page, 800);
  return { title };
}

async function selectItems(page: Page, items: { type: string; id: string }[]): Promise<void> {
  await page.evaluate((list) => (window as unknown as Hook).__openreelE2E.ui.getState().selectMultiple(list), items);
}

/** Debug: write the program canvas to a PNG (set OPENREEL_E2E_DUMP=<dir>). */
async function dumpFrame(page: Page, name: string): Promise<void> {
  const dir = process.env.OPENREEL_E2E_DUMP;
  if (!dir) return;
  const url = await page.evaluate(() => (document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement).toDataURL("image/png"));
  writeFileSync(join(dir, `${name}.png`), Buffer.from(url.split(",")[1], "base64"));
}

/**
 * Pixels whose largest channel difference exceeds `tol` (0..255) between two stored snapshots, plus that
 * largest difference. The editor's plain-clip path and the nest path clear the empty canvas to slightly
 * different blacks, so an exact byte compare would flag background only; content must still match.
 */
async function toleranceDiff(page: Page, a: string, b: string, tol: number): Promise<{ changed: number; max: number; total: number }> {
  return page.evaluate(
    ([x, y, t]) => {
      const s = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps;
      const p = s[x as string];
      const q = s[y as string];
      let changed = 0;
      let max = 0;
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
        if (d > max) max = d;
        if (d > (t as number)) changed++;
      }
      return { changed, max, total: p.length / 4 };
    },
    [a, b, tol],
  );
}

/** A human double-click: click once (selects), then a second press ~120ms later that the browser counts as click 2. */
async function humanDoubleClick(page: Page, clipId: string): Promise<void> {
  const box = await boxOf(page, clipId);
  await page.mouse.move((box.left + box.right) / 2, box.centerY);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
}

const tabs = (page: Page) => page.getByTestId("sequence-tab");

function xmllintOk(text: string): void {
  const file = join(mkdtempSync(join(tmpdir(), "e2e-nest-")), "t.xml");
  writeFileSync(file, text);
  const r = spawnSync("xmllint", ["--noout", file], { encoding: "utf8" });
  expect(r.error, "xmllint must be installed").toBeUndefined();
  expect(r.status, r.stderr).toBe(0);
}

async function exportFromPicker(page: Page, sequenceName: string, format: "xmeml" | "otio"): Promise<{ name: string; text: string }> {
  await chooseFileMenu(page, ["Export timeline", "Choose sequence…"]);
  const picker = page.getByTestId("interchange-export-picker");
  await picker.waitFor();
  await expect(page.getByTestId("interchange-aaf-note")).toContainText("AAF is available");
  await page.getByTestId("interchange-sequence-select").click();
  await page.getByRole("option", { name: new RegExp(`^${sequenceName}`) }).click();
  await page.getByTestId(`interchange-format-${format}`).check();
  const download = page.waitForEvent("download");
  await page.getByTestId("interchange-export-confirm").click();
  const d = await download;
  return { name: d.suggestedFilename(), text: readFileSync((await d.path())!, "utf8") };
}

test.describe("Nest completeness and chosen-sequence interchange", () => {
  test.describe.configure({ timeout: 240_000 });

  test("nest a rich range: parent frames identical before/after/undo, real double-click opens it, export + re-import the nest sequence", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    await setZoom(page, 100);
    const [a, b] = clipsOf(await readState(page), "Main");
    const { title } = await decorate(page, { a: a.id, b: b.id });
    const before = await projectOf(page);
    expect(before.masks).toEqual([a.id]);
    expect(before.subtitles).toBe(2);

    // ---- frames before nesting (parent), at several times ----
    for (const t of FRAME_TIMES) {
      await seek(page, t);
      await snapStable(page, `before-${t}`);
      await dumpFrame(page, `before-${t}`);
    }
    // The scene is not blank and the effect/mask/title are visible: the frames differ from each other.
    expect((await diffSnaps(page, "before-0.5", "before-3")).changed).toBeGreaterThan(1000);

    // ---- nest: the two clips, the title (selected overlay) ----
    await selectItems(page, [
      { type: "clip", id: a.id },
      { type: "clip", id: b.id },
      { type: "text-clip", id: title },
    ]);
    const historyBefore = (await readState(page)).historyLength;
    const box = await boxOf(page, b.id);
    await page.mouse.click(box.left + 20, box.centerY, { button: "right" });
    await page.getByTestId("nest-clips").click();
    await settle(page, 1200);
    const nested = await projectOf(page);
    const nest = nested.sequences.find((s: any) => s.id !== nested.active)!;
    expect((await readState(page)).historyLength).toBe(historyBefore + 1); // one undo step

    // everything travelled; nothing is left behind in the parent
    const innerClips = nest.tracks.flatMap((t: any) => t.clips);
    expect(innerClips).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(nest.tracks.reduce((n: number, t: any) => n + t.transitions, 0)).toBe(1);
    expect(nested.transitions).toBe(0);
    expect(nest.subtitles.map((c: any) => c[0])).toEqual(["cap-1"]);
    expect(nested.subtitles).toBe(1);
    expect(nest.markers.map((m: any) => m[0])).toEqual(["mk-1"]);
    expect(nested.markers).toBe(1);
    expect(nested.masks).toEqual([a.id]);
    const movedTitle = nested.text.find((t: any) => t.id === title)!;
    expect(nest.tracks.some((t: any) => t.id === movedTitle.trackId)).toBe(true);
    expect(movedTitle.startTime).toBeCloseTo(0.5, 3);

    // ---- the parent renders the same pixels ----
    const rows: Record<string, unknown> = {};
    for (const t of FRAME_TIMES) {
      await seek(page, t);
      await snapStable(page, `after-${t}`);
      await dumpFrame(page, `after-${t}`);
      const exact = await diffSnaps(page, `before-${t}`, `after-${t}`);
      const tol = await toleranceDiff(page, `before-${t}`, `after-${t}`, 16);
      rows[`t=${t}`] = { exactChanged: exact.changed, over16: tol.changed, maxDelta: tol.max };
      expect(tol.changed, `content differs at t=${t}`).toBeLessThanOrEqual(25);
    }
    console.log(`NEST pixel diff (canvas ${(await toleranceDiff(page, "before-0.5", "after-0.5", 16)).total} px):`, JSON.stringify(rows));

    // ---- undo restores the project exactly, and the picture ----
    await undo(page);
    await settle(page, 900);
    const undone = await projectOf(page);
    // back to the single-timeline project it was (the nest sequence is gone)
    expect(undone.sequences.length).toBeLessThanOrEqual(1);
    expect(undone.sequences.some((s: any) => s.id === nest.id)).toBe(false);
    expect(undone.text).toEqual(before.text);
    expect(undone.subtitles).toBe(2);
    expect(undone.markers).toBe(2);
    expect(undone.transitions).toBe(1);
    expect(undone.masks).toEqual([a.id]);
    for (const t of FRAME_TIMES.slice(0, 3)) {
      await seek(page, t);
      await snapStable(page, `undone-${t}`);
      expect((await diffSnaps(page, `before-${t}`, `undone-${t}`)).changed, `undo t=${t}`).toBe(0);
    }
    await redo(page);
    await settle(page, 900);
    expect((await projectOf(page)).sequences).toHaveLength(2);

    // ---- a REAL double-click on the nest clip (on the timeline) opens its tab ----
    const nestClipId = (await readState(page)).tracks.flatMap((t) => t.clips).find((c) => Math.abs(c.start) < 1e-6 && c.duration > 3.9)!.id;
    await seek(page, 0);
    await humanDoubleClick(page, nestClipId); // the clip is selected by the first click, like a user would
    await expect(tabs(page)).toHaveCount(2, { timeout: 8000 });
    expect((await projectOf(page)).active).toBe(nest.id);

    // inside the nest the title and caption are editable content of the nest
    const inside = await readState(page);
    expect(inside.tracks.some((t) => t.type === "text")).toBe(true);

    // ---- back to the parent: it is the ACTIVE sequence while we export the nest ----
    await tabs(page).first().click();
    await settle(page, 800);
    expect((await projectOf(page)).active).not.toBe(nest.id);
    const parentActive = (await projectOf(page)).active;

    // Regression: a nest identified only by its `compound:<id>` media id (legacy / imported nests carry no
    // metadata) used to have NO double-click handler on the timeline, while the project panel opened it.
    await page.evaluate(async (id) => {
      const store = (window as unknown as Hook).__openreelE2E.project.getState();
      const full = store.getFullProject();
      const tracks = full.timeline.tracks.map((t: any) => ({
        ...t,
        clips: t.clips.map((c: any) => (c.id === id ? { ...c, metadata: undefined } : c)),
      }));
      const outcome = await store.executeAction({ type: "project/applyEditSnapshot", id: crypto.randomUUID(), timestamp: Date.now(), params: { snapshot: { ...full, timeline: { ...full.timeline, tracks } } } });
      if (!outcome.success) throw new Error("strip failed");
    }, nestClipId);
    await settle(page, 600);
    expect(await page.evaluate((id) => (window as unknown as Hook).__openreelE2E.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id)?.metadata, nestClipId)).toBeUndefined();
    await humanDoubleClick(page, nestClipId);
    // (the nest's tab is still open from before, so the proof is that the ACTIVE sequence switched to it)
    await expect.poll(async () => (await projectOf(page)).active, { timeout: 8000 }).toBe(nest.id);
    await tabs(page).first().click();
    await settle(page, 800);
    expect((await projectOf(page)).active).toBe(parentActive);

    const otio = await exportFromPicker(page, nest.name, "otio");
    expect(otio.name).toBe(`${nest.name.replace(/[^\w.-]+/g, "_")}.otio`);
    expect(validateOtio(otio.text)).toEqual([]);
    expect((await projectOf(page)).active).toBe(parentActive); // exporting did not switch sequences

    // a report may pop up (title/caption/mask/effects are not carried by the formats): dismiss it
    const dialog = page.getByTestId("interchange-export-report");
    await dialog.waitFor();
    await expect(page.getByTestId("interchange-report-notes")).toContainText("AAF is available");
    await expect(page.getByTestId("interchange-report-group").filter({ hasText: "Text clip" })).toHaveCount(1);
    await page.getByRole("button", { name: "Done" }).click();

    const xml = await exportFromPicker(page, nest.name, "xmeml");
    expect(validateXmeml(xml.text)).toEqual([]);
    xmllintOk(xml.text);
    await page.getByTestId("interchange-export-report").waitFor();
    await page.getByRole("button", { name: "Done" }).click();

    // ---- re-import both and compare with the nest sequence's layout ----
    const expected = await page.evaluate((id) => {
      const p = (window as unknown as Hook).__openreelE2E.project.getState().getFullProject();
      const fps = p.settings.frameRate;
      const seq = p.sequences.find((s: any) => s.id === id);
      return seq.timeline.tracks
        .filter((t: any) => t.type === "video")
        .flatMap((t: any) => t.clips.map((c: any) => [Math.round(c.startTime * fps), Math.round(c.duration * fps), Math.round(c.inPoint * fps)]))
        .sort((x: number[], y: number[]) => x[0] - y[0]);
    }, nest.id);
    expect(expected).toHaveLength(2);
    for (const file of [otio, xml]) {
      const back = importTimeline(file.text, { mediaItems: [] });
      const got = back.tracks
        .filter((t) => t.type === "video")
        .flatMap((t) => t.clips.map((c) => [Math.round(c.startTime * 30), Math.round(c.duration * 30), Math.round(c.inPoint * 30)]))
        .sort((x, y) => x[0] - y[0]);
      expect(got, file.name).toEqual(expected);
      expect(back.markers.map((m) => Math.round(m.time * 30))).toEqual([30]); // the in-range marker travelled with the nest
    }
  });

  test("a nest with another size and frame rate is fitted into the parent and holds its own frames", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    await setZoom(page, 100);
    const [a] = clipsOf(await readState(page), "Main");
    await selectItems(page, [{ type: "clip", id: a.id }]);
    const box = await boxOf(page, a.id);
    await page.mouse.click(box.left + 20, box.centerY, { button: "right" });
    await page.getByTestId("nest-clips").click();
    await settle(page, 1200);
    const nest = (await projectOf(page)).sequences.find((s: any) => s.name.startsWith("Nested"))!;

    const setNestSettings = async (width: number, height: number, frameRate: number) => {
      await page.evaluate(
        async ([id, w, h, fps]) => {
          const store = (window as unknown as Hook).__openreelE2E.project.getState();
          const full = store.getFullProject();
          const sequences = full.sequences.map((s: any) => (s.id === id ? { ...s, settings: { ...s.settings, width: w, height: h, frameRate: fps } } : s));
          const outcome = await store.executeAction({ type: "project/applyEditSnapshot", id: crypto.randomUUID(), timestamp: Date.now(), params: { snapshot: { ...full, sequences } } });
          if (!outcome.success) throw new Error("settings edit failed");
        },
        [nest.id, width, height, frameRate] as [string, number, number, number],
      );
      await settle(page, 700);
    };
    const darkColumns = (from: number, to: number) =>
      page.evaluate(
        ([x0, x1]) => {
          const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
          const t = document.createElement("canvas");
          t.width = c.width;
          t.height = c.height;
          const g = t.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(c, 0, 0);
          const d = g.getImageData(x0 as number, 0, (x1 as number) - (x0 as number), c.height).data;
          let max = 0;
          for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i], d[i + 1], d[i + 2]);
          return max;
        },
        [from, to],
      );

    await seek(page, 1);
    await snap(page, "same-settings");
    // Same aspect, smaller canvas: the nest scales up to the parent frame (no crop, no shrink).
    await setNestSettings(1280, 720, 30);
    await seek(page, 1);
    await snap(page, "same-aspect-720p");
    const scaled = await toleranceDiff(page, "same-settings", "same-aspect-720p", 48);
    console.log("NEST scale 1080p->720p same aspect: pixels over 48 levels:", scaled.changed, "of", scaled.total);
    expect(scaled.changed).toBeLessThan(scaled.total * 0.02);
    // 4:3 nest in a 16:9 parent: fitted (contain) with transparent pillarbox, the content is not stretched.
    await setNestSettings(960, 720, 30);
    await seek(page, 1);
    const canvasWidth = await page.evaluate(() => (document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement).width);
    const pillar = Math.floor((canvasWidth - (360 * 4) / 3) / 2); // canvas is canvasWidth x 360; 4:3 content is 480 wide
    expect(await darkColumns(0, Math.max(1, pillar - 4))).toBeLessThan(20);
    expect(await darkColumns(canvasWidth / 2 - 40, canvasWidth / 2 + 40)).toBeGreaterThan(40);

    // A 24 fps nest in a 30 fps parent holds each of its frames: 1.000s and 1.033s (parent frames 30 and 31) are the same picture,
    // while at the parent's own 30 fps they are different pictures (the moving test pattern).
    await setNestSettings(1920, 1080, 30);
    await seek(page, 1);
    await snap(page, "t30-a");
    await seek(page, 1 + 1 / 30);
    await snap(page, "t30-b");
    const moving = await diffSnaps(page, "t30-a", "t30-b");
    await setNestSettings(1920, 1080, 24);
    await seek(page, 1);
    await snap(page, "t24-a");
    await seek(page, 1 + 1 / 30);
    await snap(page, "t24-b");
    const held = await diffSnaps(page, "t24-a", "t24-b");
    console.log("NEST fps mapping: 30fps nest changed", moving.changed, "px between parent frames; 24fps nest changed", held.changed);
    expect(moving.changed).toBeGreaterThan(held.changed);
    expect(held.changed).toBe(0);
  });
});
