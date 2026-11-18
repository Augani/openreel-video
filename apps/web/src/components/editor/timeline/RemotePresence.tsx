import { useCollabStore } from "../../../services/collab/collab-store";

/** Collaborators' playheads on the timeline: a coloured line with a name flag. Positions mirror the local Playhead maths. */
export function RemotePlayheads({ pixelsPerSecond, scrollX, headerOffset }: { pixelsPerSecond: number; scrollX: number; headerOffset: number }) {
  const snapshot = useCollabStore((s) => s.snapshot);
  if (!snapshot || snapshot.status === "idle") return null;
  const peers = snapshot.peers.filter((p) => p.clientId !== snapshot.clientId && p.presence.playhead !== null);
  if (peers.length === 0) return null;
  return (
    <>
      {peers.map((peer) => {
        const x = (peer.presence.playhead as number) * pixelsPerSecond - scrollX;
        if (x < 0) return null;
        return (
          <div key={peer.clientId} data-testid="remote-playhead" data-peer={peer.user.name} className="pointer-events-none absolute bottom-0 top-0 z-40" style={{ left: headerOffset, transform: `translateX(${x}px)` }}>
            <div className="absolute bottom-0 top-0 w-px opacity-80" style={{ background: peer.user.color }} />
            <span className="absolute left-0 top-0 max-w-[96px] -translate-y-px truncate rounded-br px-1 text-[10px] font-medium leading-4 text-white" style={{ background: peer.user.color }}>{peer.user.name}</span>
          </div>
        );
      })}
    </>
  );
}

/** A coloured ring on a clip that a collaborator has selected. Render inside the (relatively positioned) clip. */
export function RemoteClipSelection({ clipId }: { clipId: string }) {
  const holders = useCollabStore((s) => {
    const snapshot = s.snapshot;
    if (!snapshot || snapshot.status === "idle") return null;
    const peers = snapshot.peers.filter((p) => p.clientId !== snapshot.clientId && p.presence.selection.includes(clipId));
    return peers.length === 0 ? null : peers;
  });
  if (!holders) return null;
  const first = holders[0];
  return (
    <div data-testid="remote-selection" data-peer={first.user.name} title={`${holders.map((p) => p.user.name).join(", ")} selected this`} className="pointer-events-none absolute inset-0 z-30 rounded-lg" style={{ boxShadow: `inset 0 0 0 2px ${first.user.color}` }}>
      <span className="absolute -top-px right-0 rounded-bl px-1 text-[9px] leading-3 text-white" style={{ background: first.user.color }}>{first.user.name}</span>
    </div>
  );
}
