import type {
  AuroraSequenceRenderArgs,
  AuroraSequenceSessionEvent,
  AuroraSequenceSessionStartResult,
  AuroraPreviewSessionEvent,
  AuroraPreviewSessionStartResult,
  AuroraRenderPreviewArgs,
  AuroraRenderPreviewResult,
} from "../shared/ipc-contract";
import { runAuroraPreviewSession } from "./preview-session";
import { runAuroraSequenceSession } from "./sequence-session";
import { renderAuroraPreview } from "./render-preview";

type AuroraHostRequest =
  | { readonly id: string; readonly kind: "renderPreview"; readonly args: AuroraRenderPreviewArgs }
  | {
      readonly id: string;
      readonly kind: "startPreviewSession";
      readonly sessionId: string;
      readonly args: AuroraRenderPreviewArgs;
    }
  | { readonly id: string; readonly kind: "cancelPreviewSession"; readonly sessionId: string }
  | {
      readonly id: string;
      readonly kind: "startSequenceSession";
      readonly sessionId: string;
      readonly args: AuroraSequenceRenderArgs;
    }
  | { readonly id: string; readonly kind: "cancelSequenceSession"; readonly sessionId: string }
  | { readonly id: string; readonly kind: "shutdown" };

type AuroraHostResponse =
  | {
      readonly kind: "reply";
      readonly id: string;
      readonly ok: true;
      readonly result:
        | AuroraRenderPreviewResult
        | AuroraPreviewSessionStartResult
        | AuroraSequenceSessionStartResult
        | null;
    }
  | { readonly kind: "reply"; readonly id: string; readonly ok: false; readonly error: string }
  | { readonly kind: "previewSessionEvent"; readonly event: AuroraPreviewSessionEvent }
  | { readonly kind: "sequenceSessionEvent"; readonly event: AuroraSequenceSessionEvent };

const previewSessions = new Map<string, AbortController>();
const sequenceSessions = new Map<string, AbortController>();

function send(response: AuroraHostResponse): void {
  if (typeof process.send === "function") {
    process.send(response);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

process.on("message", (request: AuroraHostRequest | undefined) => {
  if (!request) return;
  if (request.kind === "shutdown") {
    for (const controller of previewSessions.values()) {
      controller.abort();
    }
    previewSessions.clear();
    for (const controller of sequenceSessions.values()) {
      controller.abort();
    }
    sequenceSessions.clear();
    process.exit(0);
    return;
  }
  if (request.kind === "cancelPreviewSession") {
    previewSessions.get(request.sessionId)?.abort();
    previewSessions.delete(request.sessionId);
    send({ kind: "reply", id: request.id, ok: true, result: null });
    return;
  }
  if (request.kind === "cancelSequenceSession") {
    sequenceSessions.get(request.sessionId)?.abort();
    sequenceSessions.delete(request.sessionId);
    send({ kind: "reply", id: request.id, ok: true, result: null });
    return;
  }
  if (request.kind === "startPreviewSession") {
    previewSessions.get(request.sessionId)?.abort();
    const controller = new AbortController();
    previewSessions.set(request.sessionId, controller);
    send({
      kind: "reply",
      id: request.id,
      ok: true,
      result: { sessionId: request.sessionId },
    });
    void runAuroraPreviewSession(
      request.args,
      (event) => {
        if (controller.signal.aborted) return;
        send({
          kind: "previewSessionEvent",
          event: { ...event, sessionId: request.sessionId },
        });
        if (event.done) {
          previewSessions.delete(request.sessionId);
        }
      },
      controller.signal,
    ).catch((error) => {
      if (controller.signal.aborted) return;
      previewSessions.delete(request.sessionId);
      send({
        kind: "previewSessionEvent",
        event: {
          kind: "error",
          sessionId: request.sessionId,
          done: true,
          error: errorMessage(error),
        },
      });
    });
    return;
  }
  if (request.kind === "startSequenceSession") {
    sequenceSessions.get(request.sessionId)?.abort();
    const controller = new AbortController();
    sequenceSessions.set(request.sessionId, controller);
    send({
      kind: "reply",
      id: request.id,
      ok: true,
      result: { sessionId: request.sessionId },
    });
    void runAuroraSequenceSession(
      request.args,
      (event) => {
        if (controller.signal.aborted) return;
        send({
          kind: "sequenceSessionEvent",
          event: { ...event, sessionId: request.sessionId },
        });
        if (event.done) {
          sequenceSessions.delete(request.sessionId);
        }
      },
      controller.signal,
    ).catch((error) => {
      if (controller.signal.aborted) return;
      sequenceSessions.delete(request.sessionId);
      send({
        kind: "sequenceSessionEvent",
        event: {
          kind: "error",
          sessionId: request.sessionId,
          done: true,
          error: errorMessage(error),
        },
      });
    });
    return;
  }
  if (request.kind !== "renderPreview") return;
  void renderAuroraPreview(request.args)
    .then((result) => send({ kind: "reply", id: request.id, ok: true, result }))
    .catch((error) =>
      send({ kind: "reply", id: request.id, ok: false, error: errorMessage(error) }),
    );
});

process.on("disconnect", () => {
  process.exit(0);
});
