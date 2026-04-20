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
import { useI18n } from "../../../i18n";

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
  const { t } = useI18n();
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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (mode === "setup") {
        if (password.length < 8) {
          setError(t("masterPassword.error.passwordLength"));
          return;
        }
        if (password !== confirmPassword) {
          setError(t("masterPassword.error.passwordMismatch"));
          return;
        }
      }

      if (mode === "change") {
        if (newPassword.length < 8) {
          setError(t("masterPassword.error.newPasswordLength"));
          return;
        }
        if (newPassword !== confirmPassword) {
          setError(t("masterPassword.error.newPasswordMismatch"));
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
              ? t("masterPassword.error.incorrectPassword")
              : t("masterPassword.error.operationFailed"),
          );
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("masterPassword.error.generic"),
        );
      } finally {
        setLoading(false);
      }
    },
    [mode, password, newPassword, confirmPassword, onSubmit, resetForm, t],
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md bg-background">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock size={18} className="text-primary" />
            {mode === "setup"
              ? t("masterPassword.title.setup")
              : mode === "unlock"
                ? t("masterPassword.title.unlock")
                : t("masterPassword.title.change")}
          </DialogTitle>
          <DialogDescription>
            {mode === "setup"
              ? t("masterPassword.description.setup")
              : mode === "unlock"
                ? t("masterPassword.description.unlock")
                : t("masterPassword.description.change")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "change" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-secondary">
                {t("masterPassword.label.currentPassword")}
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("masterPassword.placeholder.currentPassword")}
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
                {mode === "setup"
                  ? t("masterPassword.label.password")
                  : t("masterPassword.label.masterPassword")}
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === "setup"
                      ? t("masterPassword.placeholder.minLength")
                      : t("masterPassword.placeholder.masterPassword")
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
                  {mode === "change"
                    ? t("masterPassword.label.newPassword")
                    : t("masterPassword.label.confirmPassword")}
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
                        ? t("masterPassword.placeholder.minLength")
                        : t("masterPassword.placeholder.repeatPassword")
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
                    {t("masterPassword.label.confirmNewPassword")}
                  </label>
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("masterPassword.placeholder.repeatNewPassword")}
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
              <span>{t("masterPassword.securityNote")}</span>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading
                ? t("masterPassword.processing")
                : mode === "setup"
                  ? t("masterPassword.submit.setup")
                  : mode === "unlock"
                    ? t("masterPassword.submit.unlock")
                    : t("masterPassword.submit.change")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
