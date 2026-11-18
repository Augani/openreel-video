import { create } from "zustand";
import type { CollabSnapshot } from "@openreel/collab";

/**
 * UI-facing collaboration state. Deliberately free of runtime imports from the
 * engine so the toolbar and timeline can read it without pulling the session
 * code (loaded on demand by `collab-session`).
 */
export interface CollabInvite {
  roomId: string;
  key: string;
  server: string;
}

export interface CollabSessionInfo {
  roomId: string;
  server: string;
  name: string;
  /** Invite links; only the creator of a room has them. */
  invites: { editor: string; viewer: string } | null;
}

export type CollabConnection = "off" | "connecting" | "live" | "offline";

interface CollabUiState {
  dialogOpen: boolean;
  /** An invite link opened with the app, waiting for the user to confirm joining. */
  pendingInvite: CollabInvite | null;
  session: CollabSessionInfo | null;
  snapshot: CollabSnapshot | null;
  error: string | null;
  openDialog: () => void;
  closeDialog: () => void;
  setPendingInvite: (invite: CollabInvite | null) => void;
  setSession: (session: CollabSessionInfo | null) => void;
  setSnapshot: (snapshot: CollabSnapshot | null) => void;
  setError: (error: string | null) => void;
}

export const useCollabStore = create<CollabUiState>((set) => ({
  dialogOpen: false,
  pendingInvite: null,
  session: null,
  snapshot: null,
  error: null,
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
  setPendingInvite: (pendingInvite) => set({ pendingInvite, ...(pendingInvite ? { dialogOpen: true } : {}) }),
  setSession: (session) => set({ session }),
  setSnapshot: (snapshot) => set({ snapshot }),
  setError: (error) => set({ error }),
}));

export function connectionOf(snapshot: CollabSnapshot | null): CollabConnection {
  if (!snapshot || snapshot.status === "idle") return "off";
  if (snapshot.status === "live") return "live";
  if (snapshot.status === "offline") return "offline";
  return "connecting";
}

/** Parse `#/editor?collab=…&ck=…&cs=…` (the invite fragment). Never sent to a server. */
export function parseInviteHash(hash: string): CollabInvite | null {
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);
  const roomId = params.get("collab");
  const key = params.get("ck");
  if (!roomId || !key || !/^r_[0-9a-f]{32}$/.test(roomId)) return null;
  return { roomId, key, server: params.get("cs") ?? "" };
}

/** Accept a pasted invite link (or just its fragment). */
export function parseInviteLink(text: string): CollabInvite | null {
  const trimmed = text.trim();
  const index = trimmed.indexOf("#");
  return parseInviteHash(index >= 0 ? trimmed.slice(index) : trimmed);
}

export function buildInviteLink(base: string, invite: CollabInvite, defaultServer: string): string {
  const params = new URLSearchParams({ collab: invite.roomId, ck: invite.key });
  if (invite.server && invite.server !== defaultServer) params.set("cs", invite.server);
  return `${base.split("#")[0]}#/editor?${params.toString()}`;
}
