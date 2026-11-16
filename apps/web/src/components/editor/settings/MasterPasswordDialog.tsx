import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Lock, Eye, EyeOff, ShieldCheck, AlertTriangle, X } from "@/icons/lucide-compat";
import { Alert, AlertDescription, Button, Card, Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Input, Label } from "@openreel/ui";

interface MasterPasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "setup" | "unlock" | "change";
  onSubmit: (password: string, newPassword?: string) => Promise<boolean>;
}
const TITLES = { setup: "Set Master Password", unlock: "Unlock Settings", change: "Change Master Password" };
const DESCRIPTIONS = {
  setup: "Create a master password to encrypt your API keys. This password is never stored — only a verification hash is kept.",
  unlock: "Enter your master password to access encrypted API keys.",
  change: "Change your master password. All stored keys will be re-encrypted.",
};
function PasswordField({ label, value, onChange, visible, onToggle, disabled, placeholder, autoComplete }: {
  label: string; value: string; onChange: (value: string) => void; visible: boolean; onToggle?: () => void; disabled: boolean; placeholder: string; autoComplete: string;
}) {
  const id = useId();
  return <div className="space-y-1.5"><Label htmlFor={id} className="text-xs text-fg-2">{label}</Label><div className="relative">
    <Input id={id} type={visible ? "text" : "password"} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} disabled={disabled} autoComplete={autoComplete} className="h-8 rounded-md bg-bg-2 pr-10 text-xs md:text-xs" />
    {onToggle && <Button variant="ghost" size="icon-sm" type="button" disabled={disabled} onClick={onToggle} aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2">{visible ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}</Button>}
  </div></div>;
}

export function MasterPasswordDialog({ isOpen, onClose, mode, onSubmit }: MasterPasswordDialogProps) {
  const [password, setPassword] = useState(""), [newPassword, setNewPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false), [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const lifecycle = useRef({ active: false }), inFlight = useRef(false), opener = useRef<HTMLElement | null>(null);
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const reset = useCallback(() => { setPassword(""); setNewPassword(""); setConfirmation(""); setShowPassword(false); setShowNewPassword(false); setError(null); setLoading(false); inFlight.current = false; }, []);
  useEffect(() => { const owner = { active: true }; lifecycle.current = owner; reset(); return () => { owner.active = false; }; }, [isOpen, mode, reset]);
  const close = () => { if (inFlight.current) return; reset(); onClose(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (inFlight.current) return; setError(null);
    if (mode === "setup" && password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (mode === "setup" && password !== confirmation) { setError("Passwords do not match"); return; }
    if (mode === "change" && newPassword.length < 8) { setError("New password must be at least 8 characters"); return; }
    if (mode === "change" && newPassword !== confirmation) { setError("New passwords do not match"); return; }
    const owner = lifecycle.current; const current = () => owner.active && lifecycle.current === owner; inFlight.current = true; setLoading(true);
    try {
      const success = await onSubmit(password, mode === "change" ? newPassword : undefined);
      if (!current()) return;
      if (success) reset(); else setError(mode === "unlock" ? "Incorrect password" : "Operation failed. Check your current password.");
    } catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : "An error occurred"); }
    finally { if (current()) { inFlight.current = false; setLoading(false); } }
  };
  return <Dialog open={isOpen} onOpenChange={open => { if (!open) close(); }}>
    <DialogContent hideCloseButton className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[448px] flex-col gap-0 overflow-y-auto rounded-xl border-border bg-bg-1 p-0"
      onOpenAutoFocus={event => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; event.preventDefault(); form.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }}
      onEscapeKeyDown={event => { if (inFlight.current) event.preventDefault(); }} onInteractOutside={event => { if (inFlight.current) event.preventDefault(); }}>
      <DialogHeader className="border-b border-border px-5 py-4 pr-12 text-left"><DialogTitle className="flex items-center gap-2 text-sm"><Lock size={18} className="text-primary" aria-hidden />{TITLES[mode]}</DialogTitle><DialogDescription className="text-xs leading-5 text-fg-2">{DESCRIPTIONS[mode]}</DialogDescription></DialogHeader>
      <DialogClose asChild><Button type="button" variant="ghost" size="icon-sm" disabled={loading} aria-label="Close" className="absolute right-3 top-3"><X size={14} aria-hidden /></Button></DialogClose>
      <form ref={form} id={formId} onSubmit={submit} className="space-y-4 px-5 py-4">
        <PasswordField label={mode === "change" ? "Current Password" : mode === "setup" ? "Password" : "Master Password"} value={password} onChange={setPassword} visible={showPassword} onToggle={() => setShowPassword(value => !value)} disabled={loading} placeholder={mode === "setup" ? "Min. 8 characters" : mode === "change" ? "Enter current password" : "Enter master password"} autoComplete={mode === "setup" ? "new-password" : "current-password"} />
        {mode !== "unlock" && <PasswordField label={mode === "change" ? "New Password" : "Confirm Password"} value={mode === "change" ? newPassword : confirmation} onChange={mode === "change" ? setNewPassword : setConfirmation} visible={showNewPassword} onToggle={() => setShowNewPassword(value => !value)} disabled={loading} placeholder={mode === "change" ? "Min. 8 characters" : "Repeat password"} autoComplete="new-password" />}
        {mode === "change" && <PasswordField label="Confirm New Password" value={confirmation} onChange={setConfirmation} visible={showNewPassword} disabled={loading} placeholder="Repeat new password" autoComplete="new-password" />}
        {error && <Alert variant="destructive"><AlertTriangle size={14} aria-hidden /><AlertDescription>{error}</AlertDescription></Alert>}
        {mode === "setup" && <Card className="flex items-start gap-2 rounded-md bg-bg-2 p-3 shadow-none"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" aria-hidden /><p className="text-[11px] leading-5 text-fg-2">Your password is used to derive an encryption key via PBKDF2 (100k iterations). API keys are encrypted with AES-256-GCM. If you forget this password, stored keys cannot be recovered.</p></Card>}
      </form>
      <DialogFooter className="flex-row justify-end gap-2 border-t border-border px-5 py-3 sm:space-x-0"><Button type="button" variant="outline" onClick={close} disabled={loading} className="h-8 text-xs">Cancel</Button><Button type="submit" form={formId} disabled={loading} className="h-8 text-xs">{loading ? "Processing..." : mode === "setup" ? "Set Password" : mode === "unlock" ? "Unlock" : "Change Password"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
