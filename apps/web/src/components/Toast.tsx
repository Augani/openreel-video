import React from "react";
import { Alert, AlertDescription, AlertTitle, Button, Progress } from "@openreel/ui";
import { X, CheckCircle2, XCircle, AlertTriangle, Info } from "@/icons/lucide-compat";
import { useNotificationStore, type NotificationType, type Notification } from "../stores/notification-store";
import "./Toast.css";

const tones: Record<NotificationType, { Icon: typeof Info; color: string }> = {
  success: { Icon: CheckCircle2, color: "text-emerald-500" },
  error: { Icon: XCircle, color: "text-red-500" },
  warning: { Icon: AlertTriangle, color: "text-amber-500" },
  info: { Icon: Info, color: "text-blue-500" },
};

const ToastItem = React.memo(function ToastItem({ notification, onRemove }: {
  notification: Notification;
  onRemove: (id: string) => void;
}) {
  const { Icon, color } = tones[notification.type];
  const duration = notification.duration ?? 4000;
  return <Alert
    role={notification.type === "error" ? "alert" : "status"}
    className="app-toast pointer-events-none overflow-hidden border-border bg-bg-1 text-fg shadow-lg animate-in fade-in slide-in-from-right-2"
  >
    <div className="flex items-start gap-3">
      <Icon size={20} className={`mt-0.5 shrink-0 ${color}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <AlertTitle className="text-sm leading-5 tracking-normal">{notification.title}</AlertTitle>
        {notification.message && <AlertDescription className="text-xs leading-relaxed text-fg-muted">{notification.message}</AlertDescription>}
      </div>
      {notification.dismissible && <Button
        variant="ghost" size="icon-sm" aria-label="Dismiss notification"
        className="pointer-events-auto -mr-2 -mt-2 shrink-0"
        onClick={() => onRemove(notification.id)}
      ><X size={16} /></Button>}
    </div>
    {duration > 0 && <Progress
      value={100} aria-hidden
      className={`app-toast-progress absolute inset-x-0 bottom-0 h-1 rounded-none ${color}`}
      style={{ "--toast-duration": `${duration}ms` } as React.CSSProperties}
    />}
  </Alert>;
});

export function ToastContainer() {
  const notifications = useNotificationStore(state => state.notifications);
  const removeNotification = useNotificationStore(state => state.removeNotification);
  return <div className="app-toast-viewport pointer-events-none fixed z-[9999] flex flex-col gap-3" role="region" aria-label="Notifications">
    {notifications.map(notification => <ToastItem key={notification.id} notification={notification} onRemove={removeNotification} />)}
  </div>;
}
