import { expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { openEditor, seek, settle, waitForPresentedPlayhead } from "./helpers";
import { hideMain, insertFromBrowse, graphicState } from "./essential-graphics-lib";

const PROGRAM = 'canvas[aria-label^="Program frame"]';

export interface ParityRow {
  label: string;
  /** Mean absolute RGB difference (0-255) between the editor preview and the export renderer. */
  mad: number;
  /** Share of lit pixels within 40/255 on every channel (1px anti-aliasing shift allowed). */
  within: number;
  /** Share of lit pixels within 24/255 at the SAME pixel (no neighbourhood allowance). */
  exact: number;
  /** Share of the frame the export render lights up (so a blank frame cannot pass). */
  coverage: number;
}

/**
 * Preview vs export: the program canvas (the editor's preview renderer) and
 * VideoEngine.renderFrame (the renderer the export pipeline calls for every frame)
 * must agree on a graphic's intro, hold and outro frames.
 */
export async function previewExportParity(page: Page, templateName: string, times: Array<[string, number]>): Promise<ParityRow[]> {
  const rows: ParityRow[] = [];
  for (const [label, time] of times) {
    await seek(page, time);
    await waitForPresentedPlayhead(page);
    const row = await page.evaluate(
      async ([sel, t] ) => {
        const e = (window as any).__openreelE2E;
        const c = document.querySelector(sel as string) as HTMLCanvasElement;
        const w = c.width;
        const h = c.height;
        const read = (source: HTMLCanvasElement | ImageBitmap) => {
          const canvas = new OffscreenCanvas(w, h);
          const g = canvas.getContext("2d", { willReadFrequently: true })!;
          g.fillStyle = "#000";
          g.fillRect(0, 0, w, h);
          g.drawImage(source, 0, 0, w, h);
          return g.getImageData(0, 0, w, h).data;
        };
        // The preview renders asynchronously (SVG layers rasterise per frame); on a CPU-only
        // runner a seek can still be painting 600ms later. Measure the settled frame: wait
        // until the program canvas stops changing between reads before comparing it.
        let preview = read(c);
        let steady = 0;
        for (let i = 0; i < 40 && steady < 3; i++) {
          await new Promise((r) => setTimeout(r, 150));
          const next = read(c);
          let same = next.length === preview.length;
          for (let k = 0; same && k < next.length; k++) if (next[k] !== preview[k]) same = false;
          steady = same ? steady + 1 : 0;
          preview = next;
        }
        const engine = e.engine.getState().videoEngine;
        const project = e.project.getState().getFullProject();
        // The export renderer rasterises graphic layers asynchronously too: a render issued while they
        // are still loading is a blank frame. Render until two consecutive renders agree and are not
        // blank (bounded: a genuinely blank frame is returned and fails the caller's coverage check).
        const litPixels = (d: Uint8ClampedArray) => {
          let k = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) k++;
          return k;
        };
        let exported = new Uint8ClampedArray(0);
        let prevExport: Uint8ClampedArray | null = null;
        let exportStable = 0;
        for (let i = 0; i < 40 && exportStable < 2; i++) {
          // The export renders frame N at N / fps: the instant the preview samples for a playhead inside that frame.
          const fps = project.settings.frameRate as number;
          const fresh = await engine.renderFrame(project, Math.floor((t as number) * fps + 1e-6) / fps, w, h);
          exported = read(fresh.image);
          let same = prevExport !== null && prevExport.length === exported.length;
          for (let k = 0; same && k < exported.length; k++) if (exported[k] !== prevExport![k]) same = false;
          exportStable = same && litPixels(exported) / (w * h) > 0.0005 ? exportStable + 1 : 0;
          prevExport = exported;
          if (exportStable < 2) await new Promise((r) => setTimeout(r, 200));
        }
        // The export renderer paints on black, the preview on its stage colour: compare only
        // where the graphic is (the export frame is lit), plus the stage-colour constancy elsewhere.
        let sum = 0;
        let within = 0;
        let exact = 0;
        let lit = 0;
        const n = preview.length / 4;
        const near = (i: number, x: number, y: number): boolean => {
          // Edge-tolerant: anti-aliasing may land one pixel apart between the two rasterisers.
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              const j = (yy * w + xx) * 4;
              if (Math.abs(preview[i] - exported[j]) <= 40 && Math.abs(preview[i + 1] - exported[j + 1]) <= 40 && Math.abs(preview[i + 2] - exported[j + 2]) <= 40) return true;
            }
          }
          return false;
        };
        for (let i = 0; i < preview.length; i += 4) {
          if (exported[i] + exported[i + 1] + exported[i + 2] <= 24) continue;
          lit++;
          sum += Math.abs(preview[i] - exported[i]) + Math.abs(preview[i + 1] - exported[i + 1]) + Math.abs(preview[i + 2] - exported[i + 2]);
          const p = i / 4;
          if (near(i, p % w, Math.floor(p / w))) within++;
          // Same pixel, no neighbourhood allowance: 24/255 covers the stage colour behind soft edges.
          if (Math.abs(preview[i] - exported[i]) <= 24 && Math.abs(preview[i + 1] - exported[i + 1]) <= 24 && Math.abs(preview[i + 2] - exported[i + 2]) <= 24) exact++;
        }
        const litSafe = Math.max(1, lit);
        const png = async (data: Uint8ClampedArray) => {
          const canvas = new OffscreenCanvas(w, h);
          canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
          const blob = await canvas.convertToBlob({ type: "image/png" });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (const b of bytes) bin += String.fromCharCode(b);
          return btoa(bin);
        };
        const dump = (window as any).__EG_DUMP__ ? { preview: await png(preview), exported: await png(exported) } : undefined;
        return { mad: sum / (litSafe * 3), within: within / litSafe, exact: exact / litSafe, coverage: lit / n, dump };
      },
      [PROGRAM, time] as const,
    );
    if (row.dump) {
      const base = `${process.env.EG_DUMP_DIR}/${templateName.replace(/\W+/g, "_")}-${label.replace(/\W+/g, "_")}`;
      writeFileSync(`${base}-preview.png`, Buffer.from(row.dump.preview, "base64"));
      writeFileSync(`${base}-export.png`, Buffer.from(row.dump.exported, "base64"));
    }
    const { dump: _dump, ...stats } = row;
    void _dump;
    rows.push({ label: `${templateName} @ ${label}`, ...stats });
  }
  return rows;
}

/**
 * The main clip is nested, the nest is opened and a graphic is inserted inside it. The
 * parent sequence then shows that graphic through the nest clip, pixel for pixel the same
 * picture as the nest itself.
 */
export async function runNestParity(page: Page): Promise<{ within: number; changed: number; ownChanged: number }> {
  await openEditor(page);
  const sample = (t: number) => (async () => {
    await seek(page, t);
    await settle(page, 700);
    return page.evaluate(async (sel) => {
      const c = document.querySelector(sel) as HTMLCanvasElement;
      const t2 = new OffscreenCanvas(c.width, c.height);
      const g = t2.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(c, 0, 0);
      return Array.from(g.getImageData(0, 0, c.width, c.height).data);
    }, PROGRAM);
  })();
  const HOLD = 2.5; // inside the solid red scene, so the graphic stands out from a constant backdrop
  const plain = await sample(HOLD);

  const nestInfo = await page.evaluate(async () => {
    const e = (window as any).__openreelE2E;
    const main = e.project.getState().project.timeline.tracks.find((t: any) => t.name === "Main");
    e.ui.getState().select({ type: "clip", id: main.clips[0].id, trackId: main.id });
    const nested = await e.sequences.nestSelectedClips("Nest with graphic");
    if (!nested.ok) throw new Error(nested.message);
    const project = e.project.getState().getFullProject();
    return { parentId: project.activeSequenceId, nestClipId: nested.clipId };
  });
  await settle(page, 600);
  const opened = await page.evaluate(async (clipId) => {
    const r = await (window as any).__openreelE2E.sequences.openNestClip(clipId);
    return r.ok ? null : r.message;
  }, nestInfo.nestClipId);
  expect(opened, "the nest opens").toBeNull();
  await settle(page, 800);
  await seek(page, 0);
  await insertFromBrowse(page, "Classic Bar");
  const inNest = await sample(HOLD);

  await page.evaluate(async (parentId) => {
    const r = await (window as any).__openreelE2E.sequences.openSequence(parentId);
    if (!r.ok) throw new Error(r.message);
  }, nestInfo.parentId);
  await settle(page, 800);
  const viaNest = await sample(HOLD);

  const frac = (a: number[], b: number[], tol: number) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > tol || Math.abs(a[i + 1] - b[i + 1]) > tol || Math.abs(a[i + 2] - b[i + 2]) > tol) n++;
    return n / (a.length / 4);
  };
  const result = {
    within: 1 - frac(inNest, viaNest, 24),
    changed: frac(plain, viaNest, 24),
    ownChanged: frac(plain, inNest, 24),
  };
  console.log(`[nest] graphic inside the opened nest vs through the nest clip in the parent: ${(result.within * 100).toFixed(2)}% identical (within 24/255); graphic changes ${(result.ownChanged * 100).toFixed(1)}% of the frame inside the nest, ${(result.changed * 100).toFixed(1)}% via the parent`);
  return result;
}

/** Insert a built-in template over hidden video and compare preview vs export at its key frames. */
export async function runParity(page: Page, templateNames: string[]): Promise<ParityRow[]> {
  await openEditor(page);
  await hideMain(page);
  if (process.env.EG_DUMP_DIR) await page.evaluate(() => { (window as any).__EG_DUMP__ = true; });
  const all: ParityRow[] = [];
  for (const templateName of templateNames) {
    await seek(page, 0);
    await insertFromBrowse(page, templateName);
    const { instances } = await graphicState(page);
    const { id, startTime, duration } = instances[0];
    const rows = await previewExportParity(page, templateName, [
      ["in+0.25s", startTime + 0.25],
      ["hold", startTime + duration / 2],
      ["out-0.25s", startTime + duration - 0.25],
    ]);
    for (const row of rows) {
      console.log(`[parity] ${row.label}: MAD ${row.mad.toFixed(3)}, ${(row.within * 100).toFixed(2)}% within 40/255, ${(row.exact * 100).toFixed(2)}% same-pixel within 24/255, graphic covers ${(row.coverage * 100).toFixed(1)}%`);
      expect(row.coverage, `${row.label}: the export render must not be blank`).toBeGreaterThan(0.0005);
    }
    all.push(...rows);
    // Remove it again (the project's undo) so the next template starts from an empty frame.
    await page.evaluate(async (graphicId) => {
      await (window as any).__openreelE2E.graphics.removeGraphicCommand(graphicId);
    }, id);
    await settle(page, 400);
  }
  return all;
}
