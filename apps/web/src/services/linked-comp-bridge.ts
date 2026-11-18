import {
  LINKED_COMP_CHANNEL,
  compositionWindowHash,
  parseLinkedCompMessage,
  type LinkedCompMessage,
} from "./linked-comp-protocol";

/**
 * Transport between the editor and a linked-composition window.
 *
 * Desktop: the main process opens the window and relays messages over IPC
 * (`window.openreel.linkedComp`), so the edit reaches the main window's stores
 * through the same bridge as every other desktop feature.
 * Web: a second browser window of the same origin, talking over a BroadcastChannel.
 */
export interface LinkedCompTransport {
  /** Open (or focus) the window for a composition. */
  open(compositionId: string): Promise<{ ok: boolean; message?: string }>;
  post(message: LinkedCompMessage): void;
  subscribe(listener: (message: LinkedCompMessage) => void): () => void;
}

let override: LinkedCompTransport | null = null;

/** Tests inject a transport. */
export function setLinkedCompTransport(transport: LinkedCompTransport | null): void {
  override = transport;
}

function desktopTransport(bridge: NonNullable<NonNullable<Window["openreel"]>["linkedComp"]>): LinkedCompTransport {
  return {
    open: (compositionId) => bridge.open(compositionId),
    post: (message) => bridge.post(message),
    subscribe: (listener) =>
      bridge.onMessage((raw) => {
        const message = parseLinkedCompMessage(raw);
        if (message) listener(message);
      }),
  };
}

function broadcastTransport(): LinkedCompTransport {
  let channel: BroadcastChannel | null = null;
  const get = (): BroadcastChannel | null => {
    if (channel) return channel;
    if (typeof BroadcastChannel === "undefined") return null;
    channel = new BroadcastChannel(LINKED_COMP_CHANNEL);
    return channel;
  };
  return {
    async open(compositionId) {
      if (typeof window === "undefined") return { ok: false, message: "No window is available." };
      const url = `${window.location.origin}${window.location.pathname}${compositionWindowHash(compositionId)}`;
      const opened = window.open(url, `openreel-composition-${compositionId}`, "popup=yes,width=1180,height=780");
      if (!opened) return { ok: false, message: "The browser blocked the composition window. Allow pop-ups for this site and try again." };
      opened.focus();
      return { ok: true };
    },
    post(message) {
      get()?.postMessage(message);
    },
    subscribe(listener) {
      const target = get();
      if (!target) return () => undefined;
      // One channel object per subscriber. Messages posted by this window reach its own subscribers
      // too; the host only acts on editor messages and a window only on host messages, so they are ignored.
      const own = new BroadcastChannel(LINKED_COMP_CHANNEL);
      own.onmessage = (event: MessageEvent) => {
        const message = parseLinkedCompMessage(event.data);
        if (message) listener(message);
      };
      return () => own.close();
    },
  };
}

export function getLinkedCompTransport(): LinkedCompTransport {
  if (override) return override;
  const bridge = typeof window !== "undefined" ? window.openreel?.linkedComp : undefined;
  return bridge ? desktopTransport(bridge) : broadcastTransport();
}
