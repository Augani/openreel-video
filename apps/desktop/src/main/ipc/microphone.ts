import { shell, systemPreferences, session, type Session } from "electron";
import { z } from "zod";
import { handle } from "./index";
import { CHANNELS } from "../../shared/channels";
import type { MicrophoneAccess } from "../../shared/microphone";

/** Origins the app itself is served from: the packaged `app://` scheme and the Vite dev/preview hosts. */
export function isTrustedAppOrigin(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "app:") return parsed.hostname === "openreel";
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    }
  } catch {
    // fall through
  }
  return false;
}

export interface MediaPermissionRequest {
  permission: string;
  requestingUrl: string;
  /** "audio" / "video" entries of a `media` request. */
  mediaTypes?: readonly string[];
  /** macOS TCC state for the microphone; other platforms report "granted". */
  micAccess: MicrophoneAccess;
}

/**
 * Whether a permission request may be granted. The app only ever loads its own pages, so those keep
 * Electron's default (grant); any other origin is refused. A microphone request additionally needs
 * the operating system to have granted access, so the renderer gets a clean NotAllowedError instead
 * of silence when macOS or Windows privacy settings block the device.
 */
export function decidePermission(request: MediaPermissionRequest): boolean {
  if (!isTrustedAppOrigin(request.requestingUrl)) return false;
  if (request.permission !== "media") return true;
  const wantsAudio = (request.mediaTypes ?? ["audio"]).includes("audio");
  if (wantsAudio && (request.micAccess === "denied" || request.micAccess === "restricted")) return false;
  return true;
}

export function readMicrophoneAccess(platform: NodeJS.Platform = process.platform): MicrophoneAccess {
  if (platform !== "darwin" && platform !== "win32") return "granted";
  try {
    const status = systemPreferences.getMediaAccessStatus("microphone");
    return status === "unknown" ? "not-determined" : status;
  } catch {
    return "not-determined";
  }
}

/**
 * `getMediaAccessStatus` is a synchronous OS (TCC) query that blocks the main thread for 6-18 ms, and Chromium's
 * permission CHECK handler is asked about audio several times while the editor boots (three calls in the first
 * 700 ms, in the middle of the chunk burst the main thread serves). The answer only changes when the user flips the
 * switch in System Settings, so a short-lived cache keeps those repeats off the startup path while a change still
 * shows up within `MIC_STATUS_TTL_MS`. The explicit status IPC and the request flow always read fresh.
 */
const MIC_STATUS_TTL_MS = 3000;
let micStatusCache: { at: number; value: MicrophoneAccess } | null = null;

export function readMicrophoneAccessCached(now: number = Date.now(), platform: NodeJS.Platform = process.platform): MicrophoneAccess {
  if (micStatusCache && now - micStatusCache.at >= 0 && now - micStatusCache.at < MIC_STATUS_TTL_MS) return micStatusCache.value;
  const value = readMicrophoneAccess(platform);
  micStatusCache = { at: now, value };
  return value;
}

export function resetMicrophoneAccessCache(): void {
  micStatusCache = null;
}

/** Resolves once the OS prompt (macOS only) has been answered; elsewhere reports the current state. */
export async function requestMicrophoneAccess(): Promise<MicrophoneAccess> {
  const current = readMicrophoneAccess();
  if (process.platform === "darwin" && current === "not-determined") {
    try {
      await systemPreferences.askForMediaAccess("microphone");
    } catch {
      // The status read below reports the outcome either way.
    }
    resetMicrophoneAccessCache();
    return readMicrophoneAccess();
  }
  return current;
}

export function microphoneSettingsUrl(platform: NodeJS.Platform = process.platform): string | null {
  if (platform === "darwin") return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
  if (platform === "win32") return "ms-settings:privacy-microphone";
  return null;
}

export function installMediaPermissionHandlers(target: Session = session.defaultSession): void {
  target.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes;
    const wantsAudio = permission === "media" && (mediaTypes ?? ["audio"]).includes("audio");
    // Only an audio request depends on the OS microphone state (decidePermission ignores it otherwise), so
    // every other request skips the blocking OS query.
    void (wantsAudio ? requestMicrophoneAccess() : Promise.resolve<MicrophoneAccess>("granted")).then((micAccess) => {
      callback(
        decidePermission({ permission, requestingUrl: details.requestingUrl || webContents.getURL(), mediaTypes, micAccess }),
      );
    });
  });
  target.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const mediaType = (details as { mediaType?: string }).mediaType;
    return decidePermission({
      permission,
      requestingUrl: requestingOrigin || webContents?.getURL() || "",
      mediaTypes: mediaType && mediaType !== "unknown" ? [mediaType] : undefined,
      micAccess: mediaType === "audio" ? readMicrophoneAccessCached() : "granted",
    });
  });
}

export function registerMicrophoneIpc(): void {
  handle(CHANNELS.microphoneStatus, z.undefined(), (): MicrophoneAccess => readMicrophoneAccess());
  handle(CHANNELS.microphoneRequest, z.undefined(), (): Promise<MicrophoneAccess> => requestMicrophoneAccess());
  handle(CHANNELS.microphoneOpenSettings, z.undefined(), async (): Promise<boolean> => {
    const url = microphoneSettingsUrl();
    if (!url) return false;
    await shell.openExternal(url);
    return true;
  });
}
