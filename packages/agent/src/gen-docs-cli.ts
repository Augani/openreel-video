import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateCapabilityMarkdown } from "./gen-docs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../../docs/AGENT-CAPABILITIES.md");
writeFileSync(out, generateCapabilityMarkdown(), "utf8");
process.stdout.write(`Wrote ${out}\n`);
