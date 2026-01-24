import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";
import {
  useNotificationStore,
  type NotificationType,
  type Notification,
} from "../stores/notification-store";

const ICONS: Record<NotificationType, React.ReactNode> = {
  success: <CheckCircle2 size={20} />,
  error: <XCircle size={20} />,
  warning: <AlertTriangle size={20} />,
  info: <Info size={20} />,
};

const THEME_CONFIG: Record<
  NotificationType,
  {
    light: { bg: string; border: string; icon: string; progress: string };
    dark: { bg: string; border: string; icon: string; progress: string };
  }
> = {
  success: {
    light: {
      bg: "bg-white",
      border: "border-emerald-200",
      icon: "text-emerald-600",
      progress: "bg-emerald-500",
    },
    dark: {
      bg: "bg-zinc-900/95",
      border: "border-emerald-500/30",
      icon: "text-emerald-400",
      progress: "bg-emerald-500",
    },
  },
  error: {
    light: {
      bg: "bg-white",
      border: "border-red-200",
      icon: "text-red-600",
      progress: "bg-red-500",
    },
    dark: {
      bg: "bg-zinc-900/95",
      border: "border-red-500/30",
      icon: "text-red-400",
      progress: "bg-red-500",
    },
  },
  warning: {
    light: {
      bg: "bg-white",
      border: "border-amber-200",
      icon: "text-amber-600",
      progress: "bg-amber-500",
    },
    dark: {
      bg: "bg-zinc-900/95",
      border: "border-amber-500/30",
      icon: "text-amber-400",
      progress: "bg-amber-500",
    },
  },
  info: {
    light: {
      bg: "bg-white",
      border: "border-blue-200",
      icon: "text-blue-600",
      progress: "bg-blue-500",
    },
    dark: {
      bg: "bg-zinc-900/95",
      border: "border-blue-500/30",
      icon: "text-blue-400",
      progress: "bg-blue-500",
    },
  },
};

interface ToastItemProps {
  notification: Notification;
  onRemove: (id: string) => void;
}

const ToastItem = React.forwardRef<HTMLDivElement, ToastItemProps>(
  ({ notification, onRemove }, ref) => {
  const [progress, setProgress] = useState(100);
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");
  const theme = isDark ? "dark" : "light";
  const config = THEME_CONFIG[notification.type][theme];
  const duration = notification.duration || 4000;

  useEffect(() => {
    if (duration <= 0) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [duration]);

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, x: 100, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.9 }}
      transition={{
        type: "spring",
        stiffness: 500,
        damping: 30,
        opacity: { duration: 0.2 },
      }}
      className={`
        relative overflow-hidden
        min-w-[320px] max-w-[420px]
        rounded-xl border shadow-lg
        ${config.bg} ${config.border}
        backdrop-blur-xl
      `}
    >
      <div className="flex items-start gap-3 p-4">
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            type: "spring",
            stiffness: 500,
            damping: 25,
            delay: 0.1,
          }}
          className={`flex-shrink-0 mt-0.5 ${config.icon}`}
        >
          {ICONS[notification.type]}
        </motion.div>

        <div className="flex-1 min-w-0 pr-2">
          <motion.p
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className={`text-sm font-semibold ${isDark ? "text-zinc-100" : "text-zinc-900"}`}
          >
            {notification.title}
          </motion.p>
          {notification.message && (
            <motion.p
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={`text-xs mt-1 leading-relaxed ${isDark ? "text-zinc-400" : "text-zinc-600"}`}
            >
              {notification.message}
            </motion.p>
          )}
        </div>

        {notification.dismissible && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => onRemove(notification.id)}
            className={`
              flex-shrink-0 p-1.5 rounded-lg
              transition-colors duration-150
              ${
                isDark
                  ? "hover:bg-white/10 text-zinc-500 hover:text-zinc-300"
                  : "hover:bg-black/5 text-zinc-400 hover:text-zinc-600"
              }
            `}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </motion.button>
        )}
      </div>

      {duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/5 dark:bg-white/5">
          <motion.div
            initial={{ width: "100%" }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.05, ease: "linear" }}
            className={`h-full ${config.progress}`}
          />
        </div>
      )}
    </motion.div>
  );
});

ToastItem.displayName = "ToastItem";

export const ToastContainer: React.FC = () => {
  const { notifications, removeNotification } = useNotificationStore();

  return (
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-3"
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence mode="popLayout">
        {notifications.map((notification) => (
          <ToastItem
            key={notification.id}
            notification={notification}
            onRemove={removeNotification}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default ToastContainer;
