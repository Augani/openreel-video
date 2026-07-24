import type { WebContents } from "electron";
import type {
  AuroraPreviewSessionEvent,
  AuroraPreviewSessionStartArgs,
  AuroraPreviewSessionStartResult,
  AuroraRenderPreviewArgs,
  AuroraRenderPreviewResult,
  AuroraSequenceRenderArgs,
  AuroraSequenceSessionEvent,
  AuroraSequenceSessionStartResult,
} from "../../shared/ipc-contract";
import { CHANNELS } from "../../shared/ipc-contract";
import { getAuroraClient } from "../aurora/client";

const webContentsAuroraSessions = new Map<
  number,
  Map<string, (sessionId: string) => Promise<void>>
>();

function trackAuroraSession(
  wc: WebContents,
  sessionId: string,
  cancel: (sessionId: string) => Promise<void>,
): void {
  let sessions = webContentsAuroraSessions.get(wc.id);
  if (!sessions) {
    sessions = new Map<string, (sessionId: string) => Promise<void>>();
    webContentsAuroraSessions.set(wc.id, sessions);
    wc.once("destroyed", () => {
      const active = webContentsAuroraSessions.get(wc.id);
      webContentsAuroraSessions.delete(wc.id);
      if (!active) return;
      for (const [activeSessionId, activeCancel] of active) {
        void activeCancel(activeSessionId).catch(() => undefined);
      }
    });
  }
  sessions.set(sessionId, cancel);
}

function untrackAuroraSession(wc: WebContents, sessionId: string): void {
  const sessions = webContentsAuroraSessions.get(wc.id);
  if (!sessions) return;
  sessions.delete(sessionId);
  if (sessions.size === 0) {
    webContentsAuroraSessions.delete(wc.id);
  }
}

export async function renderAuroraPreview(
  args: AuroraRenderPreviewArgs,
): Promise<AuroraRenderPreviewResult> {
  return getAuroraClient().renderPreview(args);
}

export async function startAuroraPreviewSession(
  wc: WebContents,
  args: AuroraPreviewSessionStartArgs,
): Promise<AuroraPreviewSessionStartResult> {
  const result = await getAuroraClient().startPreviewSession(
    args,
    (event: AuroraPreviewSessionEvent) => {
      if (event.done) {
        untrackAuroraSession(wc, event.sessionId);
      }
      if (!wc.isDestroyed()) {
        wc.send(CHANNELS.auroraPreviewEvent, event);
      }
    },
  );
  trackAuroraSession(wc, result.sessionId, (sessionId) =>
    getAuroraClient().cancelPreviewSession(sessionId),
  );
  return result;
}

export async function cancelAuroraPreviewSession(
  sessionId: string,
  wc?: WebContents,
): Promise<void> {
  if (wc) {
    untrackAuroraSession(wc, sessionId);
  }
  await getAuroraClient().cancelPreviewSession(sessionId);
}

export async function startAuroraSequenceSession(
  wc: WebContents,
  args: AuroraSequenceRenderArgs & { readonly sessionId?: string },
): Promise<AuroraSequenceSessionStartResult> {
  const result = await getAuroraClient().startSequenceSession(
    args,
    (event: AuroraSequenceSessionEvent) => {
      if (event.done) {
        untrackAuroraSession(wc, event.sessionId);
      }
      if (!wc.isDestroyed()) {
        wc.send(CHANNELS.auroraSequenceEvent, event);
      }
    },
  );
  trackAuroraSession(wc, result.sessionId, (sessionId) =>
    getAuroraClient().cancelSequenceSession(sessionId),
  );
  return result;
}

export async function cancelAuroraSequenceSession(
  sessionId: string,
  wc?: WebContents,
): Promise<void> {
  if (wc) {
    untrackAuroraSession(wc, sessionId);
  }
  await getAuroraClient().cancelSequenceSession(sessionId);
}
