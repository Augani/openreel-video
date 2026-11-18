import { describe, it, expect } from "vitest";
import { buildInviteLink, connectionOf, parseInviteHash, parseInviteLink, useCollabStore } from "./collab-store";
import type { CollabSnapshot } from "@openreel/collab";

const ROOM = `r_${"a".repeat(32)}`;
const snap = (status: CollabSnapshot["status"]): CollabSnapshot => ({ status, role: "editor", clientId: "me", confirmedSeq: 0, pending: 0, peers: [], locks: [] });

describe("collaboration invite links", () => {
  it("round-trips a link and keeps the key in the fragment", () => {
    const link = buildInviteLink("https://app.openreel.video/", { roomId: ROOM, key: "secret", server: "https://api.openreel.video" }, "https://api.openreel.video");
    expect(link).toBe(`https://app.openreel.video/#/editor?collab=${ROOM}&ck=secret`);
    expect(new URL(link).search).toBe("");
    expect(parseInviteLink(link)).toEqual({ roomId: ROOM, key: "secret", server: "" });
  });

  it("carries a non-default server in the link", () => {
    const link = buildInviteLink("http://localhost:5173/", { roomId: ROOM, key: "k", server: "http://localhost:8787" }, "https://api.openreel.video");
    expect(parseInviteLink(link)?.server).toBe("http://localhost:8787");
  });

  it("rejects links without a valid room id or key", () => {
    expect(parseInviteHash("#/editor")).toBeNull();
    expect(parseInviteHash(`#/editor?collab=${ROOM}`)).toBeNull();
    expect(parseInviteHash("#/editor?collab=../../etc&ck=k")).toBeNull();
    expect(parseInviteLink("not a link")).toBeNull();
  });
});

describe("collaboration UI state", () => {
  it("maps engine status to a connection label", () => {
    expect(connectionOf(null)).toBe("off");
    expect(connectionOf(snap("idle"))).toBe("off");
    expect(connectionOf(snap("live"))).toBe("live");
    expect(connectionOf(snap("offline"))).toBe("offline");
    expect(connectionOf(snap("syncing"))).toBe("connecting");
    expect(connectionOf(snap("connecting"))).toBe("connecting");
  });

  it("opens the dialog when an invite arrives", () => {
    useCollabStore.setState({ dialogOpen: false, pendingInvite: null });
    useCollabStore.getState().setPendingInvite({ roomId: ROOM, key: "k", server: "" });
    expect(useCollabStore.getState().dialogOpen).toBe(true);
    useCollabStore.getState().setPendingInvite(null);
    expect(useCollabStore.getState().pendingInvite).toBeNull();
  });
});
