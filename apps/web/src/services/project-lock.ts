/**
 * Renderer half of desktop project locking (the main process owns the lock files).
 *
 * ProjectManager reports the native file the open project is tied to (`trackProjectFile`). Taking the
 * lock either succeeds, or reports who has the project open: then this window stays read-only. Edits,
 * undo and redo are refused in one place (LazyActionExecutor asks `readOnlyReason`), saving over the
 * file is refused, and the editor shows a banner with a Retry and a Save a copy action.
 */
import { create } from "zustand";
import type { OpenReelProjectLockResult } from "../types/global";
import { toast } from "../stores/notification-store";

export type ProjectLockHolder = Extract<OpenReelProjectLockResult, { status: "held" }>["holder"];

interface ProjectLockState {
  /** The native project file this window has open, or null. */
  path: string | null;
  readOnly: boolean;
  holder: ProjectLockHolder | null;
}

export const useProjectLockStore = create<ProjectLockState>(() => ({ path: null, readOnly: false, holder: null }));

type FsBridge = NonNullable<NonNullable<Window["openreel"]>["fs"]>;

function bridge(): FsBridge | null {
  if (typeof window === "undefined") return null;
  const fs = window.openreel?.fs;
  return fs?.lockProject ? fs : null;
}

export function describeHolder(holder: ProjectLockHolder | null): string {
  if (!holder) return "another window";
  if (holder.sameApp) return "another OpenReel window";
  const who = holder.user ? `${holder.user}${holder.sameHost ? "" : ` on ${holder.host}`}` : holder.sameHost ? "another OpenReel instance" : holder.host;
  return holder.sameHost && holder.user ? `another OpenReel instance (${who})` : who;
}

export function readOnlyMessage(holder: ProjectLockHolder | null = useProjectLockStore.getState().holder): string {
  return `This project is open in ${describeHolder(holder)}, so it is read-only here.`;
}

/** The reason edits are refused, or null when the project is editable. */
export function readOnlyReason(): string | null {
  const state = useProjectLockStore.getState();
  return state.readOnly ? readOnlyMessage(state.holder) : externalReadOnly;
}

let externalReadOnly: string | null = null;

/** Another subsystem (a view-only collaboration invite) can make the project read-only; null clears it. */
export function setExternalReadOnly(reason: string | null): void {
  externalReadOnly = reason;
}

let sequence = 0;

async function take(path: string, notify: boolean): Promise<boolean> {
  const fs = bridge();
  if (!fs?.lockProject) return true;
  const ticket = ++sequence;
  let result: OpenReelProjectLockResult;
  try {
    result = await fs.lockProject(path);
  } catch {
    // The lock service failed: do not lock the user out of their own project.
    result = { status: "unsupported", reason: "ipc" };
  }
  // A newer open (or close) superseded this one while the lock was in flight.
  if (ticket !== sequence || useProjectLockStore.getState().path !== path) {
    if (result.status === "acquired") void fs.unlockProject?.(path).catch(() => undefined);
    return false;
  }
  if (result.status === "held") {
    useProjectLockStore.setState({ readOnly: true, holder: result.holder });
    if (notify) toast.warning("Project is open elsewhere", `${readOnlyMessage(result.holder)} Close it there and choose Retry, or Save As a copy.`);
    return false;
  }
  useProjectLockStore.setState({ readOnly: false, holder: null });
  return true;
}

/**
 * The project file this window works on changed (open, open recent, Save As, close). Pass the native
 * path, or null for a project with no desktop file (web, unsaved, imported copy).
 */
export function trackProjectFile(path: string | null): void {
  const previous = useProjectLockStore.getState().path;
  if (previous === path) return;
  const fs = bridge();
  if (previous && fs) void fs.unlockProject?.(previous).catch(() => undefined);
  useProjectLockStore.setState({ path, readOnly: false, holder: null });
  sequence++;
  if (path) void take(path, true);
}

/** Try the lock again (the other window may have closed). Returns true when this window can edit. */
export async function retryProjectLock(): Promise<boolean> {
  const { path } = useProjectLockStore.getState();
  if (!path) return true;
  const ok = await take(path, false);
  if (ok) toast.success("Project unlocked", "You can edit this project now.");
  else toast.warning("Still open elsewhere", readOnlyMessage());
  return ok;
}

/**
 * Before Save As writes over `path`: refuse when another window holds that file. On success the lock
 * stays held for this window (the caller's next `trackProjectFile(path)` is then a no-op acquire).
 */
export async function assertCanWriteProject(path: string): Promise<void> {
  const fs = bridge();
  if (!fs?.lockProject) return;
  if (useProjectLockStore.getState().path === path) {
    if (useProjectLockStore.getState().readOnly) throw new Error(readOnlyMessage());
    return;
  }
  const result = await fs.lockProject(path).catch((): OpenReelProjectLockResult => ({ status: "unsupported", reason: "ipc" }));
  if (result.status === "held") throw new Error(`${path.split(/[\\/]/).pop()} is open in ${describeHolder(result.holder)}. Choose another name or close it there first.`);
}

/** Test hook. */
export function resetProjectLockForTests(): void {
  sequence = 0;
  useProjectLockStore.setState({ path: null, readOnly: false, holder: null });
}
