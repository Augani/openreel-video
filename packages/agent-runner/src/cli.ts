#!/usr/bin/env node
import process from "node:process";
import { runHeadlessEditFile } from "./run";
import type { LlmProvider } from "./node-llm";

interface CliArgs {
  project?: string;
  prompt?: string;
  provider: LlmProvider;
  model?: string;
  out?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { provider: "anthropic", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => argv[++i] ?? "";
    switch (arg) {
      case "--project":
      case "-p":
        args.project = next();
        break;
      case "--prompt":
      case "-m":
        args.prompt = next();
        break;
      case "--provider":
        {
          const provider = next();
          args.provider =
            provider === "openai" || provider === "atlascloud"
              ? provider
              : "anthropic";
        }
        break;
      case "--model":
        args.model = next();
        break;
      case "--out":
      case "-o":
        args.out = next();
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function apiKeyEnvVar(provider: LlmProvider): string {
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  if (provider === "atlascloud") return "ATLASCLOUD_API_KEY";
  return "OPENAI_API_KEY";
}

function resolveApiKey(provider: LlmProvider): string {
  return (
    process.env.OPENREEL_API_KEY ??
    process.env[apiKeyEnvVar(provider)] ??
    ""
  );
}

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  atlascloud: "deepseek-ai/deepseek-v4-pro",
};

const USAGE = `openreel-agent — headless project editing

Usage:
  openreel-agent --project <file.json> --prompt "<instruction>" [options]

Options:
  -p, --project <path>   Project JSON to edit (required)
  -m, --prompt  <text>   Natural-language editing instruction (required)
      --provider <name>  anthropic | openai | atlascloud (default: anthropic)
      --model <id>       Model id (default: provider default)
  -o, --out <path>       Output path (default: edit in place)
      --dry-run          Plan without applying mutations

API key (never stored): OPENREEL_API_KEY, or ANTHROPIC_API_KEY / OPENAI_API_KEY / ATLASCLOUD_API_KEY.`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.prompt) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(args.project || args.prompt ? 1 : 0);
  }
  const apiKey = resolveApiKey(args.provider);
  if (!apiKey) {
    process.stderr.write(
      `No API key found. Set OPENREEL_API_KEY (or ${apiKeyEnvVar(args.provider)}).\n`,
    );
    process.exit(1);
  }

  const model = args.model ?? DEFAULT_MODEL[args.provider];
  try {
    const { result, saved } = await runHeadlessEditFile({
      projectPath: args.project,
      prompt: args.prompt,
      provider: args.provider,
      model,
      apiKey,
      outPath: args.out,
      dryRun: args.dryRun,
    });
    const usage = `${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens`;
    process.stdout.write(
      `Done (${result.stoppedReason}). ${result.toolCalls} tool call(s), ${usage}.\n` +
        (saved
          ? `Saved to ${args.out ?? args.project}.\n`
          : `Not saved${args.dryRun ? " (dry-run)" : result.stoppedReason === "error" ? " (turn errored)" : ""}.\n`),
    );
    process.exit(result.stoppedReason === "error" ? 1 : 0);
  } catch (error) {
    process.stderr.write(
      `Headless run failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
