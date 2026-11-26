import { useState } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input } from "@openreel/ui";
import { toast } from "../../stores/notification-store";
import { useProjectStore } from "../../stores/project-store";
import { connectionOf, parseInviteLink, useCollabStore, type CollabInvite } from "../../services/collab/collab-store";
import { OPENREEL_CLOUD_URL } from "../../config/api-endpoints";
import { CollaboratorAvatars } from "./CollaboratorAvatars";
import { useT } from "@openreel/i18n/react";
import { translateNow } from "@openreel/i18n/translate";

async function session() {
  return import("../../services/collab/collab-session");
}

function CopyField({ label, value }: { label: string; value: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2" data-testid={`collab-invite-${label.toLowerCase()}`}>
      <span className="w-14 shrink-0 text-xs text-fg-2">{label}</span>
      <Input aria-label={`${label} invite link`} readOnly value={value} onFocus={(event) => event.currentTarget.select()} />
      <Button type="button" size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success(translateNow("Invite link copied")), () => toast.error(translateNow("Could not copy the link")))}>{t("Copy")}</Button>
    </div>
  );
}

/** Lock rows: who holds what, release yours, take over someone else's. */
function LockList() {
  const t = useT();
  const snapshot = useCollabStore((s) => s.snapshot);
  const project = useProjectStore((s) => s.project);
  const [binId, setBinId] = useState("");
  if (!snapshot || snapshot.role !== "editor") return null;
  const bins = project.bins ?? [];
  const sequenceId = project.activeSequenceId;
  const label = (resource: string) => {
    const [kind, id] = resource.split(":");
    if (kind === "bin") return `Bin "${bins.find((b) => b.id === id)?.name ?? id}"`;
    return `Sequence "${project.sequences?.find((s) => s.id === id)?.name ?? id}"`;
  };
  const act = async (resource: string, acquire: boolean, steal = false) => (await session()).setCollabLock(resource, acquire, steal);
  const mine = (clientId: string) => clientId === snapshot.clientId;
  return (
    <section aria-label={t("Soft locks")} className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-2">{t("Soft locks")}</h3>
      <p className="text-xs text-fg-muted">{t("Lock a bin or the active sequence while you work in it. Others can still look, but their edits to it are refused until you release it (locks also expire after two idle minutes).")}</p>
      <ul className="space-y-1" data-testid="collab-locks">
        {snapshot.locks.length === 0 && <li className="text-xs text-fg-muted">{t("Nothing is locked.")}</li>}
        {snapshot.locks.map((lock) => (
          <li key={lock.resource} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{label(lock.resource)} <span className="text-fg-2">{t("held by")} {mine(lock.clientId) ? t("you") : lock.user.name}</span></span>
            {mine(lock.clientId)
              ? <Button type="button" size="sm" variant="secondary" onClick={() => void act(lock.resource, false)}>{t("Release")}</Button>
              : <Button type="button" size="sm" variant="secondary" onClick={() => void act(lock.resource, true, true)}>{t("Take over")}</Button>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {sequenceId && <Button type="button" size="sm" variant="secondary" onClick={() => void act(`sequence:${sequenceId}`, true)}>{t("Lock active sequence")}</Button>}
        {bins.length > 0 && (
          <>
            <select aria-label={t("Bin to lock")} className="h-8 rounded-md border border-border bg-bg-1 px-2 text-sm" value={binId} onChange={(event) => setBinId(event.target.value)}>
              <option value="">{t("Choose a bin…")}</option>
              {bins.map((bin) => <option key={bin.id} value={bin.id}>{bin.name}</option>)}
            </select>
            <Button type="button" size="sm" variant="secondary" disabled={!binId} onClick={() => void act(`bin:${binId}`, true)}>{t("Lock bin")}</Button>
          </>
        )}
      </div>
    </section>
  );
}

export function CollaborationDialog() {
  const t = useT();
  const open = useCollabStore((s) => s.dialogOpen);
  const closeDialog = useCollabStore((s) => s.closeDialog);
  const sessionInfo = useCollabStore((s) => s.session);
  const snapshot = useCollabStore((s) => s.snapshot);
  const pendingInvite = useCollabStore((s) => s.pendingInvite);
  const error = useCollabStore((s) => s.error);
  const [name] = useState(() => {
    try {
      return localStorage.getItem("openreel.collab.name") ?? "";
    } catch {
      return "";
    }
  });
  const [server, setServer] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);

  const resolvedName = displayName ?? name;
  const connection = connectionOf(snapshot);
  const invite: CollabInvite | null = pendingInvite ?? parseInviteLink(link);

  const ensureName = async () => resolvedName.trim() || "Guest";

  const start = async () => {
    setBusy(true);
    try {
      const who = await ensureName();
      await (await session()).startCollab({ name: who, server });
      toast.success(translateNow("Collaboration started"), "Share an invite link to bring people in.");
    } catch (e) {
      useCollabStore.getState().setError(e instanceof Error ? e.message : "Could not start collaborating.");
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!invite) return;
    setBusy(true);
    try {
      const mod = await session();
      const who = await ensureName();
      // The shared project replaces the open one: keep what the user has by saving it first.
      const current = useProjectStore.getState();
      if (current.hasOpenProject) await import("../../services/project-replacement").then((m) => m.saveCurrentProjectForReplacement(current.project.id)).catch(() => undefined);
      mod.joinCollab(invite, who);
      setLink("");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    (await session()).leaveCollab();
    toast.success(translateNow("Left the session"), "You keep your copy of the project.");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeDialog(); }}>
      <DialogContent className="max-w-lg" data-testid="collab-dialog">
        <DialogHeader>
          <DialogTitle>{t("Collaborate")}</DialogTitle>
          <DialogDescription>{t("Edit this project together in real time. Media files are not uploaded: each person links their own copy of the footage.")}</DialogDescription>
        </DialogHeader>

        {error && <p role="alert" className="rounded-md border border-border bg-status-warning/10 px-3 py-2 text-xs" data-testid="collab-error">{error}</p>}

        {sessionInfo ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm" data-testid="collab-status" data-connection={connection}>
              <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: connection === "live" ? "var(--status-success, #30a46c)" : connection === "offline" ? "var(--status-warning, #f76b15)" : "var(--fg-muted, #888)" }} />
              <span>{connection === "live" ? t("Connected") : connection === "offline" ? t("Offline: your edits are kept and will merge when you reconnect") : t("Connecting…")}</span>
              {snapshot && snapshot.pending > 0 && <span className="text-fg-2">· {snapshot.pending} {t("waiting to sync")}</span>}
              {snapshot?.role === "viewer" && <span className="rounded bg-bg-2 px-1.5 py-0.5 text-xs">{t("View only")}</span>}
            </div>
            <CollaboratorAvatars />
            {sessionInfo.invites && (
              <section aria-label={t("Invite people")} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-2">{t("Invite people")}</h3>
                <CopyField label="Editor" value={sessionInfo.invites.editor} />
                <CopyField label="Viewer" value={sessionInfo.invites.viewer} />
                <p className="text-xs text-fg-muted">{t("Anyone with a link can join, so share it only with people you trust. The key lives after the # and is never sent to a web server.")}</p>
              </section>
            )}
            <LockList />
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={() => void leave()}>{t("Leave session")}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-1 text-sm">
              <span className="text-xs text-fg-2">{t("Your name")}</span>
              <Input aria-label={t("Your name")} placeholder={t("Shown to collaborators")} value={resolvedName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} />
            </label>

            {pendingInvite ? (
              <section className="space-y-2" aria-label={t("Join session")}>
                <p className="text-sm">{t("You were invited to a shared project. Joining replaces the project you have open (it is saved first).")}</p>
                {pendingInvite.server && pendingInvite.server !== OPENREEL_CLOUD_URL && (
                  <p className="rounded-md border border-border bg-status-warning/10 px-3 py-2 text-xs" data-testid="collab-invite-server">
                    {t("This invite connects to a different server:")} <strong>{pendingInvite.server}</strong>. Only join if you trust it; everything you edit is sent there.
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => useCollabStore.getState().setPendingInvite(null)}>{t("Not now")}</Button>
                  <Button type="button" disabled={busy} onClick={() => void join()}>{t("Join session")}</Button>
                </div>
              </section>
            ) : (
              <>
                <section className="space-y-2" aria-label={t("Start session")}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-2">{t("Share this project")}</h3>
                  <p className="text-xs text-fg-muted">{t("Starts a room from the open project. You get an editor link and a view-only link.")}</p>
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" className="text-xs text-fg-2 underline" onClick={() => setAdvanced((v) => !v)}>{advanced ? t("Hide server") : t("Server…")}</button>
                    <Button type="button" disabled={busy} onClick={() => void start()}>{t("Start session")}</Button>
                  </div>
                  {advanced && <Input aria-label={t("Collaboration server")} placeholder={OPENREEL_CLOUD_URL} value={server} onChange={(event) => setServer(event.target.value)} />}
                </section>
                <section className="space-y-2" aria-label={t("Join session")}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-2">{t("Join with an invite link")}</h3>
                  <Input aria-label={t("Invite link")} placeholder={t("Paste an invite link")} value={link} onChange={(event) => setLink(event.target.value)} />
                  <div className="flex justify-end">
                    <Button type="button" variant="secondary" disabled={busy || !invite} onClick={() => void join()}>{t("Join session")}</Button>
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
