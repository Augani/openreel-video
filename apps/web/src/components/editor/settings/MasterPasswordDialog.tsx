import React, { useCallback, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@openreel/ui";

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
  const { t } = useTranslation();
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
          setError(t("settings:security.validation.passwordTooShort"));
          return;
        }
        if (password !== confirmPassword) {
          setError(t("settings:security.validation.passwordsDoNotMatch"));
          return;
        }
      }

      if (mode === "change") {
        if (newPassword.length < 8) {
          setError(t("settings:security.validation.newPasswordTooShort"));
          return;
        }
        if (newPassword !== confirmPassword) {
          setError(t("settings:security.validation.newPasswordsDoNotMatch"));
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
              ? t("settings:security.validation.incorrectPassword")
              : t("settings:security.validation.operationFailed"),
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("settings:security.validation.unknownError"));
      } finally {
        setLoading(false);
      }
    },
    [confirmPassword, mode, newPassword, onSubmit, password, resetForm, t],
  );

  const titles = {
    setup: t("settings:security.setMasterPasswordTitle"),
    unlock: t("settings:security.unlockSettingsTitle"),
    change: t("settings:security.changeMasterPasswordTitle"),
  };

  const descriptions = {
    setup: t("settings:security.setMasterPasswordBody"),
    unlock: t("settings:security.unlockSettingsBody"),
    change: t("settings:security.changeMasterPasswordBody"),
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
                {t("settings:security.currentPassword")}
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("settings:security.enterCurrentPassword")}
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
                {mode === "setup" ? t("settings:security.password") : t("settings:security.masterPassword")}
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === "setup"
                      ? t("settings:security.minimumCharacters")
                      : t("settings:security.enterCurrentPassword")
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
                    ? t("settings:security.newPassword")
                    : t("settings:security.confirmPassword")}
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
                        ? t("settings:security.minimumCharacters")
                        : t("settings:security.repeatPassword")
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
                    {t("settings:security.confirmNewPassword")}
                  </label>
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("settings:security.repeatNewPassword")}
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
              <span>{t("settings:security.passwordGuidance")}</span>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              {t("common:buttons.cancel")}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading
                ? t("settings:security.processing")
                : mode === "setup"
                  ? t("settings:security.setPassword")
                  : mode === "unlock"
                    ? t("settings:security.unlock")
                    : t("settings:security.changePassword")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
