import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanFile } from "./i18n-scan.mjs";

test("scans unwrapped UI text, ignores technical tokens and ignored lines", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "i18n-scan-"));
  try {
    const file = path.join(dir, "fixture.tsx");
    writeFileSync(file, `
export function A({ name, open }: { name: string; open: boolean }) {
  return <div title="Undo">
    Save project
    <span>{name}</span>
    <button>{"Back"}</button>
    <span>{open ? "Hide" : "Show"}</span>
  </div>;
}
export function B() {
  // i18n-ignore
  return <div>H.264</div>;
}
const x = t("Save project");
const y = translate("zh-CN", "Mute {name}", { name: "File" });
`);
    const result = scanFile(file);
    assert.deepEqual(result.jsxText.map((entry) => entry.text), ["Save project"]);
    assert.deepEqual(
      result.attributes.map((entry) => [entry.name, entry.text]),
      [["title", "Undo"]],
    );
    assert.deepEqual(result.expressions.map((entry) => entry.text), ["Back", "Hide", "Show"]);
    assert.deepEqual(
      result.calls.map((entry) => [entry.fn, entry.key]),
      [["t", "Save project"], ["translate", "Mute {name}"]],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
