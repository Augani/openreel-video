import { app } from "electron";
import os from "node:os";

const CRASH_ENDPOINT =
  process.env.OPENREEL_CRASH_ENDPOINT ?? "https://api.openreel.video/crash";
const REPORT_TIMEOUT_MS = 4000;

export interface CrashReportInput {
  type: string;
  source: string;
  message: string;
  stack?: string;
  context?: unknown;
}

function appVersionSafe(): string {
  try {
    return app.getVersion();
  } catch {
    return "unknown";
  }
}

export function describeError(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.message || value.name || "Error", stack: value.stack };
  }
  if (typeof value === "object" && value !== null) {
    const maybe = value as { message?: unknown; stack?: unknown };
    if (typeof maybe.message === "string") {
      return {
        message: maybe.message,
        stack: typeof maybe.stack === "string" ? maybe.stack : undefined,
      };
    }
    try {
      return { message: JSON.stringify(value) };
    } catch {
      return { message: String(value) };
    }
  }
  return { message: String(value) };
}

async function send(report: CrashReportInput): Promise<void> {
  try {
    const payload = {
      ...report,
      message: report.message?.slice(0, 8000) ?? "unknown",
      stack: report.stack?.slice(0, 16000),
      appVersion: appVersionSafe(),
      platform: process.platform,
      arch: process.arch,
      osVersion: os.release(),
      electronVersion: process.versions.electron,
      timestamp: new Date().toISOString(),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
    try {
      await fetch(CRASH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // The reporter must never throw — a failed report cannot escalate a crash.
  }
}

export function reportError(report: CrashReportInput): void {
  void send(report);
}

export function initCrashReporter(): void {
  process.on("uncaughtException", (error) => {
    console.error("[main] uncaughtException:", error);
    reportError({ type: "uncaughtException", source: "main", ...describeError(error) });
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[main] unhandledRejection:", reason);
    reportError({ type: "unhandledRejection", source: "main", ...describeError(reason) });
  });
  app.on("render-process-gone", (_event, _webContents, details) => {
    reportError({
      type: "render-process-gone",
      source: "renderer",
      message: `render process gone: ${details.reason} (exitCode ${details.exitCode})`,
      context: details,
    });
  });
  app.on("child-process-gone", (_event, details) => {
    reportError({
      type: "child-process-gone",
      source: details.type ?? "child",
      message: `child process gone: ${details.reason} (exitCode ${details.exitCode ?? "?"})`,
      context: details,
    });
  });
}
