import { CollabEngine, colorForId, type AppliedEvent, type ClientMessage, type CollabNotice, type PresenceState, type ServerMessage } from "@openreel/collab";
import { OPENREEL_CLOUD_URL } from "../../config/api-endpoints";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { toast } from "../../stores/notification-store";
import { setExternalReadOnly } from "../project-lock";
import { createProjectStoreHost, type ProjectStoreHost } from "./collab-host";
import { buildInviteLink, useCollabStore, type CollabInvite } from "./collab-store";

const PRESENCE_INTERVAL_MS = 100;
const PING_INTERVAL_MS = 25_000;
const MAX_BACKOFF_MS = 15_000;
const NAME_KEY = "openreel.collab.name";
const USER_KEY = "openreel.collab.userId";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the value is simply not remembered */
  }
}

export function rememberedName(): string {
  return readStorage(NAME_KEY) ?? "";
}

/** A stable anonymous id for the room-creation call (the cloud auth shim accepts any bearer id). */
function anonymousUserId(): string {
  let id = readStorage(USER_KEY);
  if (!id) {
    id = `anon-${crypto.randomUUID()}`;
    writeStorage(USER_KEY, id);
  }
  return id;
}

/** Only http(s)/ws(s) servers; the WebSocket URL is derived from the same host. */
export function normalizeServer(input: string): string | null {
  try {
    const url = new URL(input || OPENREEL_CLOUD_URL);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return null;
    url.protocol = url.protocol === "ws:" ? "http:" : url.protocol === "wss:" ? "https:" : url.protocol;
    return url.origin;
  } catch {
    return null;
  }
}

function socketUrl(server: string, roomId: string): string {
  return `${server.replace(/^http/, "ws")}/v1/collab/rooms/${roomId}/ws`;
}

export function describeNotice(notice: CollabNotice): { title: string; message?: string; level: "warning" | "error" } | null {
  switch (notice.kind) {
    case "rejected": {
      const title = notice.reason === "conflict" ? "Edit not applied: someone else changed it first"
        : notice.reason === "locked" ? "Edit not applied: that area is locked"
          : notice.reason === "stale" ? "Offline edits were too old to merge"
            : notice.reason === "readonly" ? "This invite is view-only" : "Edit not applied";
      return { title, message: notice.detail, level: "warning" };
    }
    case "inapplicable":
      return { title: "An edit no longer applies", message: notice.detail, level: "warning" };
    case "unsynced":
      return { title: "Not shared with collaborators", message: notice.detail, level: "warning" };
    case "lock-denied":
      return { title: `${notice.heldBy.name} has locked this`, message: "Ask them to release it, or take it over.", level: "warning" };
    case "error":
      return notice.code === "engine" || notice.code === "forbidden" ? { title: "Collaboration error", message: notice.message, level: "error" } : null;
  }
}

class CollabSession {
  private engine: CollabEngine<ReturnType<ProjectStoreHost["getProject"]>>;
  private host: ProjectStoreHost;
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPresence = "";
  private disposers: Array<() => void> = [];
  private subscribedHistory: unknown = null;
  private unsubscribeHistory: (() => void) | null = null;

  constructor(
    private readonly invite: CollabInvite,
    name: string,
    adoptCurrentProject: boolean,
  ) {
    const clientId = `c-${crypto.randomUUID()}`;
    this.host = createProjectStoreHost({ onDocumentReplaced: () => this.subscribeHistory() });
    if (!adoptCurrentProject) this.host.loadNextReplacementAsNewProject();
    this.engine = new CollabEngine(this.host, {
      clientId,
      name,
      color: colorForId(clientId),
      key: invite.key,
      // Only the person who started the room may seed it with their open project.
      allowInit: adoptCurrentProject,
      send: (msg: ClientMessage) => {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
      },
    });
    this.disposers.push(
      this.engine.subscribe(() => {
        const snapshot = this.engine.getSnapshot();
        useCollabStore.getState().setSnapshot(snapshot);
        setExternalReadOnly(snapshot.role === "viewer" ? "You joined as a viewer: this shared project is view-only." : null);
      }),
      this.engine.onNotice((notice) => {
        const described = describeNotice(notice);
        if (!described) return;
        if (notice.kind === "error" && notice.code === "forbidden") this.fail("This invite is not valid any more.");
        if (described.level === "error") toast.error(described.title, described.message);
        else toast.warning(described.title, described.message);
      }),
    );
  }

  start(): void {
    this.subscribeHistory();
    this.watchPresence();
    this.connect();
  }

  private subscribeHistory(): void {
    const history = useProjectStore.getState().actionHistory;
    if (history === this.subscribedHistory) return;
    this.unsubscribeHistory?.();
    this.subscribedHistory = history;
    this.unsubscribeHistory = history.subscribeApplied((event) => this.engine.localApplied(event as AppliedEvent));
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(socketUrl(this.invite.server, this.invite.roomId));
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.engine.handleOpen();
      this.pingTimer = setInterval(() => this.engine.sendPing(), PING_INTERVAL_MS);
    };
    socket.onmessage = (event) => {
      try {
        void this.engine.handleMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        /* ignore a malformed frame */
      }
    };
    socket.onclose = (event) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      this.engine.handleClose();
      if (event.code === 4403) return this.fail("This invite is not valid any more.");
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt++);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
    socket.onerror = () => undefined;
  }

  private fail(message: string): void {
    useCollabStore.getState().setError(message);
    this.stop();
  }

  private watchPresence(): void {
    const publish = () => {
      if (this.presenceTimer) return;
      this.presenceTimer = setTimeout(() => {
        this.presenceTimer = null;
        const presence: PresenceState = {
          playhead: useTimelineStore.getState().playheadPosition,
          selection: useUIStore.getState().selectedItems.map((item) => item.id),
          sequenceId: useProjectStore.getState().project.activeSequenceId ?? null,
        };
        const key = JSON.stringify(presence);
        if (key === this.lastPresence) return;
        this.lastPresence = key;
        this.engine.setPresence(presence);
      }, PRESENCE_INTERVAL_MS);
    };
    this.disposers.push(
      useTimelineStore.subscribe((state, prev) => {
        if (state.playheadPosition !== prev.playheadPosition) publish();
      }),
      useUIStore.subscribe((state, prev) => {
        if (state.selectedItems !== prev.selectedItems) publish();
      }),
      // A (re)connect resets what the room knows about us.
      this.engine.subscribe(() => {
        if (this.engine.getSnapshot().status !== "live") this.lastPresence = "";
        else if (this.lastPresence === "") publish();
      }),
    );
  }

  setLock(resource: string, acquire: boolean, steal = false): void {
    this.engine.setLock(resource, acquire, steal);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.unsubscribeHistory?.();
    this.disposers.forEach((dispose) => dispose());
    this.disposers = [];
    this.engine.stop();
    this.socket?.close(1000, "left");
    this.socket = null;
    setExternalReadOnly(null);
    useCollabStore.getState().setSession(null);
    useCollabStore.getState().setSnapshot(null);
    if (current === this) current = null;
  }
}

let current: CollabSession | null = null;

export function isCollaborating(): boolean {
  return current !== null;
}

export function leaveCollab(): void {
  current?.stop();
}

export function setCollabLock(resource: string, acquire: boolean, steal = false): void {
  current?.setLock(resource, acquire, steal);
}

function begin(invite: CollabInvite, name: string, adoptCurrentProject: boolean, invites: { editor: string; viewer: string } | null): void {
  current?.stop();
  writeStorage(NAME_KEY, name);
  const store = useCollabStore.getState();
  store.setError(null);
  store.setPendingInvite(null);
  const session = new CollabSession(invite, name, adoptCurrentProject);
  current = session;
  store.setSession({ roomId: invite.roomId, server: invite.server, name, invites });
  session.start();
}

/** Create a room from the open project and join it as the first editor. */
export async function startCollab(options: { name: string; server?: string }): Promise<void> {
  const server = normalizeServer(options.server ?? "");
  if (!server) throw new Error("That server address is not valid.");
  const response = await fetch(`${server}/v1/collab/rooms`, { method: "POST", headers: { Authorization: `Bearer ${anonymousUserId()}` } });
  if (!response.ok) {
    throw new Error(response.status === 503 ? "Collaboration is not available on this server." : response.status === 429 ? "Too many rooms created; try again later." : "Could not create a collaboration room.");
  }
  const room = (await response.json()) as { roomId: string; editorKey: string; viewerKey: string };
  const base = `${window.location.origin}${window.location.pathname}`;
  const link = (key: string) => buildInviteLink(base, { roomId: room.roomId, key, server }, OPENREEL_CLOUD_URL);
  begin({ roomId: room.roomId, key: room.editorKey, server }, options.name, true, { editor: link(room.editorKey), viewer: link(room.viewerKey) });
}

/** Join someone else's room; the open project is replaced by the shared one. */
export function joinCollab(invite: CollabInvite, name: string): void {
  const server = normalizeServer(invite.server);
  if (!server) {
    useCollabStore.getState().setError("That invite points at an invalid server.");
    return;
  }
  begin({ ...invite, server }, name, false, null);
}
