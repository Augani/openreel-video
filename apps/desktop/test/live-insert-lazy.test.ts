/**
 * Startup must not load any live plugin insert code. The built renderer is checked statically: the closure of everything the entry
 * page loads eagerly (script and modulepreload tags, then every static import, never `import()`) must not contain the live insert
 * controller, the AudioWorklet node factory or the worklet processor. They are reached only through dynamic imports.
 *
 * Runs against apps/web/dist when a build exists (pnpm --filter @openreel/desktop build), skipped otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dist = path.resolve(__dirname, "../../web/dist");
const enabled = fs.existsSync(path.join(dist, "index.html"));
const d = enabled ? describe : describe.skip;

const STATIC_IMPORT = /(?:^|[;}\s])(?:import|export)\s*(?:[^"'`()]*?\sfrom\s*)?["'](\.[^"']+\.js)["']/g;

function eagerClosure(): Map<string, string> {
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const queue = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1].replace(/^\.?\//, "").replace(/^app:\/\/openreel\//, ""));
  const seen = new Map<string, string>();
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const full = path.join(dist, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8");
    seen.set(file, text);
    for (const m of text.matchAll(STATIC_IMPORT)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
  }
  return seen;
}

d("live plugin inserts are a lazy chunk", () => {
  it("nothing the entry page loads eagerly contains the live insert controller, node factory or worklet", () => {
    const closure = eagerClosure();
    expect(closure.size).toBeGreaterThan(3);
    for (const [file, text] of closure) {
      // the worklet processor's registered name (node factory and worklet) and the controller's port message type
      expect(text, `${file} is loaded at startup`).not.toMatch(/["']openreel-live-insert["']/);
      expect(text, `${file} is loaded at startup`).not.toContain("openreel:plughost-live-port");
      // the audio-thread DSP state machine and the ring buffer must not ride along in a barrel re-export
      expect(text, `${file} is loaded at startup`).not.toContain("decidedUpTo");
    }
  });

  it("the live insert code does exist in the build, in chunks reached by dynamic import", () => {
    const files = fs.readdirSync(path.join(dist, "assets")).filter((f) => f.endsWith(".js"));
    const holders = files.filter((f) => fs.readFileSync(path.join(dist, "assets", f), "utf8").includes("openreel:plughost-live-port"));
    expect(holders.length).toBeGreaterThan(0);
    const closure = eagerClosure();
    for (const holder of holders) expect(closure.has(`assets/${holder}`)).toBe(false);
  });
});
