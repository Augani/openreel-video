import React, { useState, useCallback } from "react";
import { Lock, Eye, EyeOff, ShieldCheck, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@openreel/ui";
import { Input } from "@openreel/ui";
import { Button } from "@openreel/ui";

interface MasterPasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "setup" | "unlock" | "change";
  onSubmit: (password: string, newPassword?: string) => Promise<boolean>;
}

export const MasterPasswordDialog: React.FC<MasterPasswordDialogProps> = ({
  isOpen,
  onClose,
  mode,
  onSubmit,
}) => {
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resetForm = useCallback(() => {
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowNewPassword(false);
    setError(null);
    setLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "setup") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
    }

    if (mode === "change") {
      if (newPassword.length < 8) {
        setError("New password must be at least 8 characters");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("New passwords do not match");
        return;
      }
    }

    setLoading(true);
    try {
      const success = await onSubmit(
        password,
        mode === "change" ? newPassword : undefined,
      );
      if (success) {
        resetForm();
      } else {
        setError(
          mode === "unlock"
            ? "Incorrect password"
            : "Operation failed. Check your current password.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [mode, password, newPassword, confirmPassword, onSubmit, resetForm]);

  const titles = {
    setup: "Set Master Password",
    unlock: "Unlock Settings",
    change: "Change Master Password",
  };

  const descriptions = {
    setup: "Create a master password to encrypt your API keys. This password is never stored — only a verification hash is kept.",
    unlock: "Enter your master password to access encrypted API keys.",
    change: "Change your master password. All stored keys will be re-encrypted.",
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md bg-background">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock size={18} className="text-primary" />
            {titles[mode]}
          </DialogTitle>
          <DialogDescription>{descriptions[mode]}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "change" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-secondary">
                Current Password
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter current password"
                  autoFocus
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}

          {(mode === "setup" || mode === "unlock") && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-secondary">
                {mode === "setup" ? "Password" : "Master Password"}
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === "setup"
                      ? "Min. 8 characters"
                      : "Enter master password"
                  }
                  autoFocus
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}

          {(mode === "setup" || mode === "change") && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-secondary">
                  {mode === "change" ? "New Password" : "Confirm Password"}
                </label>
                <div className="relative">
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    value={mode === "change" ? newPassword : confirmPassword}
                    onChange={(e) =>
                      mode === "change"
                        ? setNewPassword(e.target.value)
                        : setConfirmPassword(e.target.value)
                    }
                    placeholder={
                      mode === "change"
                        ? "Min. 8 characters"
                        : "Repeat password"
                    }
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                  >
                    {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {mode === "change" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-text-secondary">
                    Confirm New Password
                  </label>
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                  />
                </div>
              )}
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-error bg-error/10 px-3 py-2 rounded-lg">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          {mode === "setup" && (
            <div className="flex items-start gap-2 text-xs text-text-muted bg-background-secondary px-3 py-2 rounded-lg">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
              <span>
                Your password is used to derive an encryption key via PBKDF2
                (100k iterations). API keys are encrypted with AES-256-GCM.
                If you forget this password, stored keys cannot be recovered.
              </span>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading
                ? "Processing..."
                : mode === "setup"
                  ? "Set Password"
                  : mode === "unlock"
                    ? "Unlock"
                    : "Change Password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
