import React, { useState, useEffect } from "react";
import { Activity, Cpu, HardDrive, X, AlertTriangle } from "lucide-react";
import {
  performanceMonitor,
  formatBytes,
  type PerformanceMetrics,
  type PerformanceWarning,
} from "../../services/performance-monitor";

interface PerformanceOverlayProps {
  isVisible: boolean;
  onClose: () => void;
  compact?: boolean;
}

export const PerformanceOverlay: React.FC<PerformanceOverlayProps> = ({
  isVisible,
  onClose,
  compact = false,
}) => {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [warnings, setWarnings] = useState<PerformanceWarning[]>([]);

  useEffect(() => {
    if (isVisible) {
      performanceMonitor.start();
      const unsubMetrics = performanceMonitor.onMetrics(setMetrics);
      const unsubWarnings = performanceMonitor.onWarning((warning) => {
        setWarnings((prev) => [...prev.slice(-4), warning]);
      });

      return () => {
        unsubMetrics();
        unsubWarnings();
      };
    } else {
      performanceMonitor.stop();
    }
  }, [isVisible]);

  if (!isVisible) return null;

  const fpsColor =
    !metrics || metrics.fps >= 30
      ? "text-pink-400"
      : metrics.fps >= 24
        ? "text-yellow-400"
        : "text-red-400";

  const memoryColor =
    !metrics || metrics.memoryPercent < 0.7
      ? "text-pink-400"
      : metrics.memoryPercent < 0.9
        ? "text-yellow-400"
        : "text-red-400";

  const score = performanceMonitor.getPerformanceScore();
  const scoreColor =
    score >= 70
      ? "text-pink-400"
      : score >= 40
        ? "text-yellow-400"
        : "text-red-400";

  if (compact) {
    return (
      <div className="fixed bottom-4 right-4 z-40 bg-black/80 rounded-lg px-3 py-2 backdrop-blur-sm border border-border">
        <div className="flex items-center gap-4 text-xs">
          <div className={`flex items-center gap-1 ${fpsColor}`}>
            <Activity size={12} />
            <span>{metrics?.fps ?? 0} fps</span>
          </div>
          <div className={`flex items-center gap-1 ${memoryColor}`}>
            <HardDrive size={12} />
            <span>{metrics ? formatBytes(metrics.memoryUsed) : "0 MB"}</span>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 bg-background-secondary rounded-xl border border-border shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-border bg-background-tertiary">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-primary" />
          <span className="text-sm font-medium text-text-primary">
            Performance
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${scoreColor}`}>
            Score: {score}
          </span>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 bg-background-tertiary rounded-lg">
            <div className="flex items-center gap-1 text-[10px] text-text-muted mb-1">
              <Activity size={10} />
              Frame Rate
            </div>
            <div className={`text-lg font-bold ${fpsColor}`}>
              {metrics?.fps ?? 0}
              <span className="text-xs font-normal ml-1">fps</span>
            </div>
            <div className="text-[10px] text-text-muted">
              {metrics
                ? `${metrics.frameTime.toFixed(1)}ms/frame`
                : "0ms/frame"}
            </div>
          </div>

          <div className="p-2 bg-background-tertiary rounded-lg">
            <div className="flex items-center gap-1 text-[10px] text-text-muted mb-1">
              <HardDrive size={10} />
              Memory
            </div>
            <div className={`text-lg font-bold ${memoryColor}`}>
              {metrics ? Math.round(metrics.memoryPercent * 100) : 0}
              <span className="text-xs font-normal ml-1">%</span>
            </div>
            <div className="text-[10px] text-text-muted">
              {metrics ? formatBytes(metrics.memoryUsed) : "0 MB"}
            </div>
          </div>

          <div className="p-2 bg-background-tertiary rounded-lg">
            <div className="flex items-center gap-1 text-[10px] text-text-muted mb-1">
              <Cpu size={10} />
              Render Time
            </div>
            <div className="text-lg font-bold text-text-primary">
              {metrics?.renderTime ?? 0}
              <span className="text-xs font-normal ml-1">ms</span>
            </div>
          </div>

          <div className="p-2 bg-background-tertiary rounded-lg">
            <div className="flex items-center gap-1 text-[10px] text-text-muted mb-1">
              <Activity size={10} />
              Active Clips
            </div>
            <div className="text-lg font-bold text-text-primary">
              {metrics?.activeClips ?? 0}
            </div>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-text-muted flex items-center gap-1">
              <AlertTriangle size={10} />
              Recent Warnings
            </div>
            {warnings.slice(-3).map((warning, i) => (
              <div
                key={i}
                className={`p-2 rounded text-[10px] ${
                  warning.severity === "high"
                    ? "bg-red-500/10 text-red-400 border border-red-500/20"
                    : warning.severity === "medium"
                      ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                      : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                }`}
              >
                <p className="font-medium">{warning.message}</p>
                {warning.suggestion && (
                  <p className="mt-0.5 opacity-80">{warning.suggestion}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {performanceMonitor.getOptimizationSuggestions().length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-text-muted">Suggestions</div>
            <ul className="text-[10px] text-text-secondary space-y-0.5">
              {performanceMonitor
                .getOptimizationSuggestions()
                .slice(0, 3)
                .map((suggestion, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span className="text-primary">•</span>
                    {suggestion}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default PerformanceOverlay;
