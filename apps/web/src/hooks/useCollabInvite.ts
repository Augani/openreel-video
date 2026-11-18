import { useEffect } from "react";
import { parseInviteHash, useCollabStore } from "../services/collab/collab-store";
import { useProjectStore } from "../stores/project-store";

/**
 * An invite link looks like `#/editor?collab=…&ck=…`. On load, lift it out of the address bar
 * (so the key does not linger in history or screenshots), make sure there is an editor to show it
 * in, and ask the user to confirm joining. Nothing connects without that click.
 */
export function useCollabInvite(): void {
  useEffect(() => {
    const invite = parseInviteHash(window.location.hash);
    if (!invite) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/editor`);
    const store = useProjectStore.getState();
    if (!store.hasOpenProject) store.createNewProject("Shared project");
    useCollabStore.getState().setPendingInvite(invite);
  }, []);
}
