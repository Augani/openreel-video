import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clickClip, clipsOf, openEditor, readState, settle } from "./helpers";
import { auditLayout, type AuditFinding } from "./ux-sweep-lib";

/**
 * Pro-workflow UX sweep in real Chrome at the viewports people actually edit on. For every workflow screen it takes
 * a screenshot and runs the layout audit (unlabeled icon buttons, controls off screen, text cut off mid-word, controls
 * on top of each other). The audit must come back clean; set OPENREEL_SWEEP_OUT=<dir> to keep the screenshots and
 * the JSON findings (also written when the audit fails, so a failure can be looked at).
 */
const VIEWPORTS = [
  { width: 1024, height: 700 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
] as const;

type Hook = { workspace: { getState(): Record<string, any> }; ui: { getState(): Record<string, any> } };
const hook = <T,>(page: Page, fn: (h: Hook) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__openreelE2E)`) as Promise<T>;

/** Escape also clears the editor selection, so only press it while something is actually open on top. */
const closeOverlays = async (page: Page) => {
  for (let i = 0; i < 3; i++) {
    const open = await page.locator('[role="dialog"], [data-radix-popper-content-wrapper], [data-testid="proxy-panel-body"]').count();
    if (!open) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
};

interface Scene { name: string; run: (page: Page) => Promise<void>; scope?: string; focus?: boolean }

const rail = (label: string): Scene => ({
  name: `rail-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`,
  run: async (page) => {
    await page.getByRole("button", { name: label, exact: true }).first().click();
    await settle(page, 400);
  },
});

const inspectorTab = (label: string): Scene => ({
  name: `inspector-${label.toLowerCase()}`,
  run: async (page) => {
    const tab = page.getByRole("tab", { name: label, exact: true }).first();
    if (await tab.count()) await tab.click();
    await settle(page, 300);
    // Open every collapsed section so the audit and the screenshot see the controls, not just the headers.
    const collapsed = page.locator('[data-tour="inspector"] button[aria-expanded="false"]');
    for (let guard = 0; guard < 8 && (await collapsed.count()) > 0; guard++) {
      await collapsed.first().click({ timeout: 1_500 }).catch(() => undefined);
      await page.waitForTimeout(120);
    }
    await settle(page, 300);
  },
});

const SCENES: Scene[] = [
  { name: "editor", run: async () => undefined, focus: true },
  {
    name: "proxies-popover",
    run: async (page) => {
      await page.getByRole("button", { name: /^Proxies/ }).first().click();
      await page.getByTestId("proxy-panel-body").waitFor();
      await settle(page, 500);
    },
  },
  rail("Audio"),
  rail("Text & captions"),
  rail("Effects"),
  rail("Transitions"),
  rail("Graphics"),
  rail("AI Generate"),
  rail("Recipes"),
  rail("Media"),
  {
    name: "clip-selected",
    run: async (page) => {
      const [clip] = clipsOf(await readState(page), "Main");
      await clickClip(page, clip.id);
      await settle(page, 400);
    },
    focus: true,
  },
  inspectorTab("Audio"),
  inspectorTab("Speed"),
  inspectorTab("Color"),
  inspectorTab("AI"),
  {
    name: "source-monitor",
    run: async (page) => {
      await page.getByRole("tab", { name: "Source", exact: true }).first().click();
      await settle(page, 600);
    },
    focus: true,
  },
  {
    name: "multicam-monitor",
    run: async (page) => {
      await hook(page, (h) => (h as unknown as { source: { getState(): Record<string, any> } }).source.getState().setTab("multicam"));
      await settle(page, 600);
    },
  },
  {
    name: "program-monitor",
    run: async (page) => {
      // The multicam monitor sits over the program monitor and carries its own Program tab: the last one is on top.
      await page.getByRole("tab", { name: "Program", exact: true }).last().click();
      await settle(page, 400);
    },
  },
  {
    name: "audio-mixer",
    run: async (page) => {
      await hook(page, (h) => h.ui.getState().setPanelVisible("audioMixer", true));
      await page.getByTestId("audio-mixer").waitFor({ timeout: 20_000 });
      await settle(page, 400);
    },
  },
  {
    name: "multicam-dialog",
    run: async (page) => {
      await hook(page, (h) => h.workspace.getState().setMulticamSourceOpen(true));
      await page.getByRole("dialog").first().waitFor({ timeout: 10_000 });
      await settle(page, 300);
    },
    scope: '[role="dialog"]',
  },
  {
    name: "export-dialog",
    run: async (page) => {
      await page.getByRole("button", { name: "Export", exact: true }).first().click();
      await settle(page, 800);
    },
  },
  {
    name: "export-queue",
    run: async (page) => {
      const queue = page.getByRole("button", { name: "Export queue", exact: true });
      if (await queue.count()) await queue.first().click();
      await settle(page, 500);
    },
  },
];

for (const viewport of VIEWPORTS) {
  test(`ux sweep ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    testInfo.setTimeout(2_400_000);
    await page.setViewportSize(viewport);
    await openEditor(page);
    // A scene whose control is missing must report itself, not hang until the test times out.
    page.setDefaultTimeout(30_000);
    const outDir = join(process.env.OPENREEL_SWEEP_OUT ?? testInfo.outputDir, `${viewport.width}x${viewport.height}`);
    mkdirSync(outDir, { recursive: true });
    const report: Record<string, AuditFinding[]> = {};
    for (const scene of SCENES) {
      await closeOverlays(page);
      try {
        await scene.run(page);
      } catch (error) {
        report[scene.name] = [{ kind: "scene-failed", target: scene.name, detail: String(error).slice(0, 1400) }];
        continue;
      }
      await page.screenshot({ path: join(outDir, `${scene.name}.png`) });
      report[scene.name] = await auditLayout(page, { focus: scene.focus ?? true, scope: scene.scope });
    }
    writeFileSync(join(outDir, "findings.json"), JSON.stringify(report, null, 2));
    const summary = Object.entries(report).filter(([, findings]) => findings.length).map(([name, findings]) => `${name}: ${findings.length} (${[...new Set(findings.map((f) => f.kind))].join(",")})`);
    console.log(`[ux-sweep ${viewport.width}x${viewport.height}] ${summary.join(" | ") || "clean"}`);
    expect(report, "layout audit findings (see findings.json)").toEqual(Object.fromEntries(Object.keys(report).map((name) => [name, []])));
  });
}
