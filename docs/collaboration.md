# Real-time collaboration

Several people edit one OpenReel project at the same time. Open **File > Collaborate…** (shift-cmd-J; the toolbar button next to Share shows the connection state). Start a session to get an *editor* link and a *view-only* link; send either to a teammate, who pastes it into the same dialog or opens it. Joining replaces the project they have open (it is saved first). Media files are never uploaded: each person relinks their own copy of the footage (media arrive as placeholders carrying name, size and modified time, the same hints the project already uses for relinking).

## How it works

The unit of sync is the core undoable **action**. Every local edit, undo and redo is published as an *op* (one or more actions). A Durable Object per project room puts all ops into one total order; every client applies that same sequence through the same `ActionExecutor`, so all copies converge.

```
 editor ──op──▶ ProjectRoom (Durable Object, RoomCore) ──sequenced op──▶ every editor/viewer
```

| Piece | Where | Role |
| --- | --- | --- |
| `RoomCore` | `packages/collab/src/room-core.ts` | Pure sequencing, conflict check, soft locks, presence, snapshot + log retention. |
| `CollabEngine` | `packages/collab/src/client-engine.ts` | Client protocol: pending ops, base/live copies, rebase, reconnect. |
| `computeTouches` | `packages/collab/src/touches.ts` | Which entities an op writes (conflict keys) and which bin/sequence it edits (lock keys). |
| `ProjectRoom` | `apps/cloud/src/collab/room-do.ts` | Durable Object: hibernatable WebSockets, invite-key check, storage. |
| Routes | `apps/cloud/src/collab/routes.ts` | `POST /v1/collab/rooms`, `GET /v1/collab/rooms/:id/ws`. |
| Session + host | `apps/web/src/services/collab/` | Socket, reconnect, presence feed; applies remote actions to the project store. |
| UI | `CollaborationDialog`, `CollaboratorAvatars`, `timeline/RemotePresence` | Dialog, avatars, remote playheads and selections. |

`ActionExecutor` gained `applyRemote()` (apply a sequenced action with no history entry) and `ActionHistory` gained `subscribeApplied()` / `discard()`. Ids the executor generates (new tracks, split halves, markers, effects, subtitles, transitions) are derived from the action id, so every machine creates identical entities.

### Undo

Remote actions never enter your undo stack, and your undo never undoes someone else's work: undo applies *your* inverse action, which is published as a new op like any edit. If a collaborator has since changed the same item, that op is rejected like any other conflicting edit: you get a notice and the change is rolled back on screen (the history entry itself is not restored, so a following redo may report nothing to do).

### Conflicts: rebase or reject

Each client keeps two copies: **base** (the server-confirmed state) and the **live** project you see (base plus your unconfirmed edits). When a remote op arrives while you have unconfirmed edits, base advances and live is rebuilt as *base + your pending edits replayed* ("rebase"). Every client runs the same ordered sequence against the same state, so results are identical.

The room decides which concurrent edits may enter the sequence. An op carries `baseSeq` (the last sequence its author had seen) and the entity keys it writes. The room **rejects** it if any op sequenced after `baseSeq` by *someone else* writes an overlapping key:

- Editing a clip also writes that clip's **track**, because overlap and ripple outcomes depend on order. Two people cannot concurrently change clips on the *same track*; different tracks proceed in parallel.
- Media and bin edits write the media item (and bin tree if replaced).
- Project-wide replacements (`project/applyEditSnapshot`, `project/create`) conflict with everything concurrent.
- Edits that touch nothing shared (adding a marker, adding a track) never conflict.

A rejected op is removed from your live project, dropped from your undo stack, and you get a notice. If a *sequenced* op later stops applying on your copy (for example its target was deleted by an earlier op), it is a deterministic no-op on every machine and the author is told.

### Offline

Edits made while disconnected are kept as pending ops and shown as "waiting to sync". On reconnect the client asks for what it missed (log tail since its last sequence, or a snapshot) and resends pending ops with their *original* `baseSeq`. They are merged if nothing conflicts and rejected with a notice if they do. Ops are idempotent by id, so an op whose acknowledgement was lost is never applied twice. If the room has compacted its history past your last sync (it keeps about the last 500 ops), the offline edits are rejected as **stale** and you receive the current shared project.

### Soft locks

A person can lock a **bin** or the **active sequence** (dialog > Soft locks). While locked, other editors' ops that edit it are rejected with "locked by NAME"; the holder keeps editing. Locks are *soft*: anyone can **take over**, locks expire after two idle minutes, and they survive a 20 second disconnect. Viewers cannot lock.

### Presence

Each client publishes its playhead, selection and active sequence (throttled to 10 per second). Collaborators appear as avatars in the toolbar, as coloured playheads with name flags on the timeline, and as a coloured ring on clips they have selected.

### Resync and storage

The room stores a snapshot plus an op log in Durable Object storage after every change, so an evicted object resumes exactly. Past 1,000 ops the room asks a client for a snapshot of its confirmed state and trims the log. A sequence gap on the client triggers a resync from its last confirmed sequence.

## Security model

- A room is a **capability**. `POST /v1/collab/rooms` (requires an identity, rate limited to 20 per hour) returns a room id and two random 192-bit keys, one for editors and one for view-only guests. Only SHA-256 hashes are stored. Anyone holding a key can join with that role; there are no accounts inside a room.
- Keys travel in the invite link's **fragment** (`#/editor?collab=…&ck=…`), which browsers never send to servers, and in the first WebSocket message, never in a URL or query string. The app removes the fragment from the address bar when it opens.
- Roles are enforced **on the server**: a view-only key cannot send ops, locks or snapshots whatever a modified client does. The viewer's own editor is also made read-only.
- The WebSocket handshake rejects browser origins outside the API's allow-list (cross-site socket hijacking); non-browser clients have no `Origin`. The user id forwarded to the room comes from the API's own auth, never from a client-supplied header.
- **The server does not validate actions.** It sequences and routes them. Any editor can send any action, and `touches` are declared by the author, so an editor can bypass conflict checks or lock checks for their own ops. Editor invites should go only to people you trust with the project.
- The auth in `apps/cloud` is still the existing dev shim (`Authorization: Bearer <id>`); swap `getIdentity` for real verification before relying on identities. The shared transport must be `wss://` (the production API is).
- Message size is capped at 8 MB (the initial project upload is the largest message). A single edit larger than about 900 KB (for example a whole-project replacement) is rejected as `invalid`, because each op is one storage value.
- An invite link may name another server (`cs=`). The confirmation names that server, and a joiner never uploads the project they have open: only the person who started a session can seed an empty room, so a hostile server cannot ask a joiner for their project.
- A client id cannot be taken over by a member with a different role, so a viewer cannot evict or impersonate an editor. Editors still trust each other completely.
- Hibernation: each socket's attachment carries its member (id, role, name, colour), so a woken Durable Object re-registers surviving sockets instead of answering "send hello first". Verified with a fake `DurableObjectState`, not on workerd.

## Not deployed

Nothing here has been deployed. `apps/cloud/wrangler.jsonc` declares the `COLLAB_ROOMS` Durable Object (SQLite-backed `ProjectRoom`) and a `v1-collab-rooms` migration, which take effect on the next `pnpm deploy`.
