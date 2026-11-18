import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { handle } from "./index";
import { CHANNELS } from "../../shared/channels";
import {
  onboardingMirrorSchema,
  pickFilesArgsSchema,
  type OnboardingMirror,
  type PickFilesArgs,
  type PickFilesResult,
} from "../../shared/onboarding";
import { withNativeDialog } from "../native-dialog-state";

/** Env vars whose presence (set and not "0"/"false") marks a perf, e2e, CI or agent-driven launch. */
export const AUTOMATION_ENV_VARS = [
  "OPENREEL_PERF",
  "OPENREEL_ELECTRON_TEST",
  "OPENREEL_E2E",
  "CI",
  "OPENREEL_SKIP_ONBOARDING",
  "OPENREEL_MCP_ENDPOINT_FILE",
] as const;
export const NO_ONBOARDING_ARG = "--no-onboarding";
export const FORCE_ONBOARDING_ENV = "OPENREEL_FORCE_ONBOARDING";

function envOn(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false";
}

/**
 * Pure so it can be unit tested. `OPENREEL_FORCE_ONBOARDING=1` always wins, so onboarding itself can
 * be tested under CI. Otherwise any automation env var or `--no-onboarding` suppresses it.
 */
export function computeAutomation(
  env: Record<string, string | undefined>,
  argv: readonly string[],
): boolean {
  if (envOn(env[FORCE_ONBOARDING_ENV])) return false;
  if (argv.includes(NO_ONBOARDING_ARG)) return true;
  return AUTOMATION_ENV_VARS.some((name) => envOn(env[name]));
}

let cachedAutomation: boolean | undefined;
export function isAutomationLaunch(): boolean {
  cachedAutomation ??= computeAutomation(process.env, process.argv);
  return cachedAutomation;
}

const MIRROR_FILE = "onboarding.json";
const mirrorPath = (): string => path.join(app.getPath("userData"), MIRROR_FILE);

export async function readOnboardingMirror(file = mirrorPath()): Promise<OnboardingMirror | null> {
  try {
    const parsed = onboardingMirrorSchema.safeParse(JSON.parse(await fs.readFile(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeOnboardingMirror(mirror: OnboardingMirror, file = mirrorPath()): Promise<void> {
  // Automation sessions hold an in-memory "skipped" that must never reach disk.
  if (mirror.skippedBy === "automation") return;
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(mirror), "utf8");
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

const MEDIA_EXTENSIONS = {
  video: ["mp4", "mov", "m4v", "webm", "mkv", "avi", "mxf", "mpg", "mpeg", "ts", "mts", "m2ts", "wmv", "flv", "3gp"],
  audio: ["mp3", "wav", "aac", "m4a", "flac", "ogg", "opus", "aif", "aiff"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "avif"],
} as const;

export function buildPickFilesOptions(args: PickFilesArgs): OpenDialogOptions {
  const kinds = args?.kinds?.length ? args.kinds : (["video", "audio", "image"] as const);
  const all = kinds.flatMap((k) => [...MEDIA_EXTENSIONS[k]]);
  const filters = [{ name: "Media", extensions: all }];
  if (kinds.length > 1) {
    for (const k of kinds) filters.push({ name: k[0].toUpperCase() + k.slice(1), extensions: [...MEDIA_EXTENSIONS[k]] });
  }
  return {
    title: args?.title,
    filters,
    properties: args?.multiple === false ? ["openFile"] : ["openFile", "multiSelections"],
  };
}

function dialogOwner(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  const requester = BrowserWindow.fromWebContents(event.sender);
  return requester && !requester.isDestroyed() ? requester : undefined;
}

async function pickFiles(args: PickFilesArgs, event: IpcMainInvokeEvent): Promise<PickFilesResult> {
  const owner = dialogOwner(event);
  const options = buildPickFilesOptions(args);
  const res = await withNativeDialog(() => (owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)));
  return res.canceled ? { canceled: true, paths: [] } : { canceled: false, paths: res.filePaths };
}

async function pickProject(event: IpcMainInvokeEvent): Promise<string | null> {
  const owner = dialogOwner(event);
  const options: OpenDialogOptions = {
    title: "Open project",
    filters: [{ name: "OpenReel Project", extensions: ["oreel", "json"] }],
    properties: ["openFile"],
  };
  const res = await withNativeDialog(() => (owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)));
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
}

export function registerOnboardingIpc(): void {
  // Synchronous so window.openreel.automation is known before first render.
  ipcMain.on(CHANNELS.onboardingAutomation, (event) => {
    event.returnValue = isAutomationLaunch();
  });
  handle(CHANNELS.onboardingGet, z.undefined(), (): Promise<OnboardingMirror | null> => readOnboardingMirror());
  handle(CHANNELS.onboardingSet, onboardingMirrorSchema, (mirror): Promise<void> => writeOnboardingMirror(mirror));
  handle(CHANNELS.fsPickFiles, pickFilesArgsSchema, (args, event) => pickFiles(args, event));
  handle(CHANNELS.fsPickProject, z.undefined(), (_args, event) => pickProject(event));
}
