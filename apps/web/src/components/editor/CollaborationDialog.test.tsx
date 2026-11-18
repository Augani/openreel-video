// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { CollabSnapshot } from "@openreel/collab";

const startCollab = vi.fn(async () => undefined);
const joinCollab = vi.fn();
const leaveCollab = vi.fn();
const setCollabLock = vi.fn();
vi.mock("../../services/collab/collab-session", () => ({ startCollab, joinCollab, leaveCollab, setCollabLock, rememberedName: () => "" }));
vi.mock("../../services/project-replacement", () => ({ saveCurrentProjectForReplacement: vi.fn(async () => undefined) }));

const { CollaborationDialog } = await import("./CollaborationDialog");
const { RemotePlayheads, RemoteClipSelection } = await import("./timeline/RemotePresence");
const { CollaboratorAvatars } = await import("./CollaboratorAvatars");
const { useCollabStore } = await import("../../services/collab/collab-store");

const alice = { id: "ua", name: "Alice Adams", color: "#e5484d" };
const bob = { id: "ub", name: "Bob", color: "#3e63dd" };
const snapshot = (over: Partial<CollabSnapshot> = {}): CollabSnapshot => ({
  status: "live",
  role: "editor",
  clientId: "me",
  confirmedSeq: 3,
  pending: 0,
  peers: [
    { clientId: "me", user: bob, role: "editor", presence: { playhead: 1, selection: [] } },
    { clientId: "other", user: alice, role: "editor", presence: { playhead: 4, selection: ["clip-9"] } },
  ],
  locks: [],
  ...over,
});

const ROOM = `r_${"c".repeat(32)}`;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useCollabStore.setState({ dialogOpen: true, pendingInvite: null, session: null, snapshot: null, error: null });
});

describe("Collaborate dialog", () => {
  it("starts a session under the name the user typed", async () => {
    render(<CollaborationDialog />);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() => expect(startCollab).toHaveBeenCalledWith({ name: "Bob", server: "" }));
  });

  it("shows a start failure instead of closing", async () => {
    startCollab.mockRejectedValueOnce(new Error("Collaboration is not available on this server."));
    render(<CollaborationDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    expect(await screen.findByTestId("collab-error")).toHaveTextContent("not available");
  });

  it("only enables Join for a valid pasted invite", async () => {
    render(<CollaborationDialog />);
    const join = screen.getAllByRole("button", { name: "Join session" })[0];
    expect(join).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Invite link"), { target: { value: `https://app.openreel.video/#/editor?collab=${ROOM}&ck=KEY` } });
    expect(join).toBeEnabled();
    fireEvent.click(join);
    await waitFor(() => expect(joinCollab).toHaveBeenCalledWith({ roomId: ROOM, key: "KEY", server: "" }, "Guest"));
  });

  it("asks before joining an invite that arrived with the app", async () => {
    useCollabStore.getState().setPendingInvite({ roomId: ROOM, key: "K", server: "" });
    render(<CollaborationDialog />);
    expect(screen.getByText(/replaces the project you have open/)).toBeInTheDocument();
    expect(joinCollab).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Join session" }));
    await waitFor(() => expect(joinCollab).toHaveBeenCalled());
  });

  it("names the server when an invite points somewhere other than the default", () => {
    useCollabStore.getState().setPendingInvite({ roomId: ROOM, key: "K", server: "https://evil.example" });
    render(<CollaborationDialog />);
    expect(screen.getByTestId("collab-invite-server")).toHaveTextContent("https://evil.example");
  });

  it("does not warn for an invite on the default server", () => {
    useCollabStore.getState().setPendingInvite({ roomId: ROOM, key: "K", server: "" });
    render(<CollaborationDialog />);
    expect(screen.queryByTestId("collab-invite-server")).toBeNull();
  });

  it("lists collaborators, invite links and locks while live, and lets you take over or release", async () => {
    useCollabStore.setState({
      session: { roomId: ROOM, server: "https://api.openreel.video", name: "Bob", invites: { editor: "https://x/#/editor?collab=1&ck=e", viewer: "https://x/#/editor?collab=1&ck=v" } },
      snapshot: snapshot({
        locks: [
          { resource: "bin:b1", clientId: "other", user: alice, expiresAt: 1 },
          { resource: "sequence:s1", clientId: "me", user: bob, expiresAt: 1 },
        ],
      }),
    });
    render(<CollaborationDialog />);
    expect(screen.getByTestId("collab-status")).toHaveAttribute("data-connection", "live");
    expect(screen.getByTestId("collab-people")).toHaveTextContent("Alice Adams");
    expect(screen.getByTestId("collab-people")).toHaveTextContent("Bob (you)");
    expect(screen.getByLabelText("Editor invite link")).toHaveValue("https://x/#/editor?collab=1&ck=e");
    expect(screen.getByLabelText("Viewer invite link")).toHaveValue("https://x/#/editor?collab=1&ck=v");
    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    await waitFor(() => expect(setCollabLock).toHaveBeenCalledWith("bin:b1", true, true));
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(setCollabLock).toHaveBeenCalledWith("sequence:s1", false, false));
    fireEvent.click(screen.getByRole("button", { name: "Leave session" }));
    await waitFor(() => expect(leaveCollab).toHaveBeenCalled());
  });

  it("explains offline mode and the sync backlog", () => {
    useCollabStore.setState({ session: { roomId: ROOM, server: "s", name: "Bob", invites: null }, snapshot: snapshot({ status: "offline", pending: 2 }) });
    render(<CollaborationDialog />);
    expect(screen.getByTestId("collab-status")).toHaveAttribute("data-connection", "offline");
    expect(screen.getByTestId("collab-status")).toHaveTextContent("2 waiting to sync");
  });

  it("hides lock controls from view-only guests", () => {
    useCollabStore.setState({ session: { roomId: ROOM, server: "s", name: "V", invites: null }, snapshot: snapshot({ role: "viewer" }) });
    render(<CollaborationDialog />);
    expect(screen.queryByRole("region", { name: "Soft locks" })).toBeNull();
    expect(screen.getByText("View only")).toBeInTheDocument();
  });
});

describe("collaborator presence on the timeline", () => {
  it("draws other people's playheads, not your own", () => {
    useCollabStore.setState({ snapshot: snapshot() });
    render(<RemotePlayheads pixelsPerSecond={100} scrollX={50} headerOffset={169} />);
    const heads = screen.getAllByTestId("remote-playhead");
    expect(heads).toHaveLength(1);
    expect(heads[0]).toHaveAttribute("data-peer", "Alice Adams");
    expect(heads[0].style.transform).toBe("translateX(350px)");
    expect(heads[0].style.left).toBe("169px");
  });

  it("marks a clip a collaborator selected, and nothing else", () => {
    useCollabStore.setState({ snapshot: snapshot() });
    const { rerender } = render(<RemoteClipSelection clipId="clip-9" />);
    expect(screen.getByTestId("remote-selection")).toHaveAttribute("data-peer", "Alice Adams");
    rerender(<RemoteClipSelection clipId="clip-1" />);
    expect(screen.queryByTestId("remote-selection")).toBeNull();
  });

  it("shows an avatar stack for the others in the toolbar, empty when alone", () => {
    useCollabStore.setState({ snapshot: snapshot() });
    const { unmount } = render(<CollaboratorAvatars compact />);
    expect(screen.getByTestId("collab-avatars")).toHaveTextContent("AA");
    unmount();
    useCollabStore.setState({ snapshot: snapshot({ peers: [] }) });
    render(<CollaboratorAvatars compact />);
    expect(screen.queryByTestId("collab-avatars")).toBeNull();
  });
});
