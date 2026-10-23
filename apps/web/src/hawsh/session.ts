/**
 * The editor's own Supabase session for the Hawsh project (separate from the site's session, so a token
 * refresh here never signs the user out of the site). Created from the one-time handoff code, then kept in
 * this origin's localStorage like any Supabase app.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { create } from "zustand";
import { HAWSH_SUPABASE_URL } from "./config";
import type { HawshHandoff } from "./handoff";

const KEY_STORE = "hawsh:pk";
const AUTH_STORE = "hawsh-editor-auth";

export type HawshStatus = "off" | "connecting" | "ready" | "error";

interface HawshState {
  status: HawshStatus;
  userId: string | null;
  email: string | null;
  error: string | null;
}

export const useHawshStore = create<HawshState>(() => ({ status: "off", userId: null, email: null, error: null }));

let client: SupabaseClient | null = null;

function readKey(): string | null {
  try { return localStorage.getItem(KEY_STORE); } catch { return null; }
}
function writeKey(key: string | null) {
  try { if (key) localStorage.setItem(KEY_STORE, key); else localStorage.removeItem(KEY_STORE); } catch { /* storage blocked */ }
}

function makeClient(key: string): SupabaseClient {
  return createClient(HAWSH_SUPABASE_URL, key, {
    auth: { storageKey: AUTH_STORE, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}

/** The signed-in client, or null when the editor was opened without the Hawsh site. */
export function hawshClient(): SupabaseClient | null {
  return useHawshStore.getState().status === "ready" ? client : null;
}

function setUser(user: { id: string; email?: string | null } | null) {
  useHawshStore.setState(user
    ? { status: "ready", userId: user.id, email: user.email ?? null, error: null }
    : { status: "off", userId: null, email: null, error: null });
}

/** Starts the session: exchanges a fresh handoff code, or restores the stored session. Never throws. */
export async function initHawsh(handoff: HawshHandoff | null): Promise<void> {
  const key = handoff?.publishableKey ?? readKey();
  if (!key) return;
  client = makeClient(key);
  client.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
  if (handoff) {
    useHawshStore.setState({ status: "connecting", error: null });
    // A new code wins over any stored session (the user may have switched accounts on the site).
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    const { data, error } = await client.auth.verifyOtp({ token_hash: handoff.tokenHash, type: "magiclink" });
    if (error || !data.user) {
      useHawshStore.setState({ status: "error", userId: null, email: null, error: "The sign-in link expired or was already used. Open the editor again from hawsh-khalifa.com." });
      return;
    }
    writeKey(key);
    setUser(data.user);
    return;
  }
  const { data } = await client.auth.getSession();
  setUser(data.session?.user ?? null);
}

/** Signs out of the editor only (the site session is untouched). */
export async function signOutHawsh(): Promise<void> {
  await client?.auth.signOut({ scope: "local" }).catch(() => undefined);
  writeKey(null);
  setUser(null);
}
