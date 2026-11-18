import { useEffect, useState, type ReactNode } from "react";
import { hasSecret, isSessionUnlocked, onSessionLock } from "../../services/secure-storage";
import { useSettingsStore } from "../../stores/settings-store";

/**
 * One connection indicator shared by the assistant header and the Generate
 * panel: a dot (accent only when the connection can really serve a request),
 * a truthful label and an optional disclosure caret.
 */
export function ConnectionStatus({ ready, label, caret = true }: { ready: boolean; label: ReactNode; caret?: boolean }) {
  return (
    <>
      <span className={`workspace-status-dot ${ready ? "is-ready" : ""}`} aria-hidden="true" />
      <span className="workspace-status-label">{label}</span>
      {caret && <span className="workspace-status-caret" aria-hidden="true">▾</span>}
    </>
  );
}

export type ServiceKeyStatus = "checking" | "ready" | "locked" | "missing";

/**
 * Real state of a stored API key. The persisted `configuredServices` list is only
 * a hint: the secret itself lives in secure storage and is unreadable while the
 * session is locked, so we ask the store (and re-ask on settings changes, lock
 * events and window focus) instead of trusting the list.
 */
export function useServiceKeyStatus(serviceId: string): ServiceKeyStatus {
  const listed = useSettingsStore((s) => s.configuredServices.includes(serviceId));
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const [status, setStatus] = useState<ServiceKeyStatus>("checking");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener("focus", bump);
    const off = onSessionLock(bump);
    return () => { window.removeEventListener("focus", bump); off(); };
  }, []);

  useEffect(() => {
    let alive = true;
    hasSecret(serviceId)
      .catch(() => false)
      .then((stored) => {
        if (!alive) return;
        setStatus(!stored ? "missing" : isSessionUnlocked() ? "ready" : "locked");
      });
    return () => { alive = false; };
  }, [serviceId, listed, settingsOpen, tick]);

  return status;
}
