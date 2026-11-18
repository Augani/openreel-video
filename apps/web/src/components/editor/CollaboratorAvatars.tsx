import { useCollabStore } from "../../services/collab/collab-store";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Who is in the project right now. `compact` renders only the avatar stack (toolbar). */
export function CollaboratorAvatars({ compact = false }: { compact?: boolean }) {
  const snapshot = useCollabStore((s) => s.snapshot);
  const peers = snapshot?.peers ?? [];
  if (!snapshot || snapshot.status === "idle") return null;
  const others = peers.filter((p) => p.clientId !== snapshot.clientId);
  if (compact) {
    if (others.length === 0) return null;
    const shown = others.slice(0, 4);
    return (
      <div className="flex items-center -space-x-1.5" data-testid="collab-avatars" aria-label={`${others.length} collaborator${others.length === 1 ? "" : "s"} in this project`}>
        {shown.map((peer) => (
          <span key={peer.clientId} title={`${peer.user.name}${peer.role === "viewer" ? " (viewing)" : ""}`} className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-1 text-[10px] font-semibold text-white" style={{ background: peer.user.color }}>{initials(peer.user.name)}</span>
        ))}
        {others.length > shown.length && <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-1 bg-bg-3 text-[10px]">+{others.length - shown.length}</span>}
      </div>
    );
  }
  return (
    <ul className="space-y-1" data-testid="collab-people" aria-label="People in this project">
      {peers.map((peer) => (
        <li key={peer.clientId} className="flex items-center gap-2 text-sm">
          <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: peer.user.color }}>{initials(peer.user.name)}</span>
          <span className="min-w-0 flex-1 truncate">{peer.user.name}{peer.clientId === snapshot.clientId ? " (you)" : ""}</span>
          {peer.role === "viewer" && <span className="text-xs text-fg-2">viewing</span>}
        </li>
      ))}
    </ul>
  );
}
