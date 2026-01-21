import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { Activity, Circle, BarChart3 } from "lucide-react";
import { getEffectsBridge } from "../../../bridges/effects-bridge";
import type {
  WaveformScopeData,
  VectorscopeData,
  HistogramData,
} from "@openreel/core";

/**
 * Scope view types
 */
export type ScopeViewType = "waveform" | "vectorscope" | "histogram";

/**
 * ScopesPanel Props
 */
interface ScopesPanelProps {
  /** Current frame image to analyze */
  frameImage?: ImageBitmap | null;
  /** Default view to show */
  defaultView?: ScopeViewType;
  /** Callback when scope data is generated */
  onScopeDataGenerated?: (
    data: WaveformScopeData | VectorscopeData | HistogramData,
  ) => void;
}

/**
 * View toggle button component
 */
const ViewToggleButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
      active
        ? "bg-primary text-white"
        : "bg-background-tertiary border border-border text-text-secondary hover:text-text-primary"
    }`}
    title={label}
  >
    {icon}
    <span className="hidden sm:inline">{label}</span>
  </button>
);

/**
 * Waveform renderer component
 *
 * Display waveform showing luminance distribution
 */
const WaveformRenderer: React.FC<{
  data: WaveformScopeData | null;
  showRGB?: boolean;
}> = ({ data, showRGB = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height, luminance, red, green, blue } = data;
    const displayWidth = canvas.width;
    const displayHeight = canvas.height;

    // Clear canvas with dark background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    // Draw grid lines
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const y = (i / 10) * displayHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(displayWidth, y);
      ctx.stroke();
    }

    // Scale factor for x-axis
    const xScale = displayWidth / width;
    const yScale = displayHeight / height;

    // Find max value for normalization
    let maxVal = 1;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const idx = y * width + x;
        maxVal = Math.max(maxVal, luminance[idx]);
        if (showRGB) {
          maxVal = Math.max(maxVal, red[idx], green[idx], blue[idx]);
        }
      }
    }

    // Draw waveform data
    const drawChannel = (
      channelData: Uint8Array,
      color: string,
      alpha: number = 0.8,
    ) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;

      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const idx = y * width + x;
          const intensity = channelData[idx] / maxVal;
          if (intensity > 0) {
            const displayX = x * xScale;
            const displayY = displayHeight - y * yScale;
            const brightness = Math.min(255, intensity * 255);
            ctx.globalAlpha = (brightness / 255) * alpha;
            ctx.fillRect(displayX, displayY, Math.max(1, xScale), 1);
          }
        }
      }
    };

    if (showRGB) {
      // Draw RGB channels
      drawChannel(red, "#ff4444", 0.6);
      drawChannel(green, "#44ff44", 0.6);
      drawChannel(blue, "#4444ff", 0.6);
    } else {
      // Draw luminance only
      drawChannel(luminance, "#ffffff", 0.8);
    }

    ctx.globalAlpha = 1;

    // Draw reference lines (0%, 50%, 100%)
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    [0, 0.5, 1].forEach((level) => {
      const y = displayHeight - level * displayHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(displayWidth, y);
      ctx.stroke();
    });

    ctx.setLineDash([]);

    // Draw labels
    ctx.fillStyle = "#888";
    ctx.font = "9px monospace";
    ctx.fillText("100%", 4, 12);
    ctx.fillText("50%", 4, displayHeight / 2 + 4);
    ctx.fillText("0%", 4, displayHeight - 4);
  }, [data, showRGB]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={180}
      className="w-full h-auto rounded-lg border border-border"
    />
  );
};

/**
 * Vectorscope renderer component
 *
 * Display vectorscope showing color saturation and hue
 */
const VectorscopeRenderer: React.FC<{
  data: VectorscopeData | null;
}> = ({ data }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { size, data: scopeData } = data;
    const displaySize = canvas.width;
    const scale = displaySize / size;
    const center = displaySize / 2;

    // Clear canvas with dark background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, displaySize, displaySize);

    // Draw circular grid
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;

    // Concentric circles
    for (let r = 0.25; r <= 1; r += 0.25) {
      ctx.beginPath();
      ctx.arc(center, center, center * r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cross lines
    ctx.beginPath();
    ctx.moveTo(0, center);
    ctx.lineTo(displaySize, center);
    ctx.moveTo(center, 0);
    ctx.lineTo(center, displaySize);
    ctx.stroke();

    // Draw color targets (standard color positions)
    const colorTargets = [
      { angle: 103, label: "R", color: "#ff0000" }, // Red
      { angle: 61, label: "Yl", color: "#ffff00" }, // Yellow
      { angle: 167, label: "G", color: "#00ff00" }, // Green
      { angle: 241, label: "Cy", color: "#00ffff" }, // Cyan
      { angle: 283, label: "B", color: "#0000ff" }, // Blue
      { angle: 347, label: "Mg", color: "#ff00ff" }, // Magenta
    ];

    colorTargets.forEach(({ angle, label, color }) => {
      const rad = ((angle - 90) * Math.PI) / 180;
      const x = center + Math.cos(rad) * center * 0.75;
      const y = center + Math.sin(rad) * center * 0.75;

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = "#888";
      ctx.font = "8px monospace";
      ctx.fillText(label, x + 6, y + 3);
    });

    // Draw vectorscope data
    ctx.globalAlpha = 1;

    // Find max value for normalization
    let maxVal = 1;
    for (let i = 0; i < scopeData.length; i++) {
      maxVal = Math.max(maxVal, scopeData[i]);
    }

    // Draw each point
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        const intensity = scopeData[idx];
        if (intensity > 0) {
          const brightness = Math.min(255, (intensity / maxVal) * 255);
          const displayX = x * scale;
          const displayY = y * scale;

          // Color based on position (hue)
          const dx = x - size / 2;
          const dy = y - size / 2;
          const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;

          ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${brightness / 255})`;
          ctx.fillRect(
            displayX,
            displayY,
            Math.max(1, scale),
            Math.max(1, scale),
          );
        }
      }
    }
  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={256}
      className="w-full max-w-[256px] h-auto rounded-lg border border-border mx-auto"
    />
  );
};

/**
 * Histogram renderer component
 *
 * Display RGB and luminance histograms
 */
const HistogramRenderer: React.FC<{
  data: HistogramData | null;
  showChannels?: "all" | "luminance" | "rgb";
}> = ({ data, showChannels = "all" }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { red, green, blue, luminance } = data;
    const displayWidth = canvas.width;
    const displayHeight = canvas.height;

    // Clear canvas with dark background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    // Draw grid lines
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * displayHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(displayWidth, y);
      ctx.stroke();
    }

    // Find max value for normalization
    let maxVal = 1;
    for (let i = 0; i < 256; i++) {
      if (showChannels === "all" || showChannels === "rgb") {
        maxVal = Math.max(maxVal, red[i], green[i], blue[i]);
      }
      if (showChannels === "all" || showChannels === "luminance") {
        maxVal = Math.max(maxVal, luminance[i]);
      }
    }

    const barWidth = displayWidth / 256;

    // Draw histogram bars
    const drawHistogram = (
      channelData: Uint32Array,
      color: string,
      alpha: number = 0.7,
    ) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;

      for (let i = 0; i < 256; i++) {
        const value = channelData[i];
        const height = (value / maxVal) * displayHeight;
        const x = i * barWidth;
        const y = displayHeight - height;
        ctx.fillRect(x, y, barWidth, height);
      }
    };

    if (showChannels === "all" || showChannels === "rgb") {
      // Draw RGB channels with blending
      ctx.globalCompositeOperation = "lighter";
      drawHistogram(red, "#ff0000", 0.5);
      drawHistogram(green, "#00ff00", 0.5);
      drawHistogram(blue, "#0000ff", 0.5);
      ctx.globalCompositeOperation = "source-over";
    }

    if (showChannels === "all" || showChannels === "luminance") {
      // Draw luminance on top
      drawHistogram(luminance, "#ffffff", showChannels === "all" ? 0.3 : 0.7);
    }

    ctx.globalAlpha = 1;

    // Draw labels
    ctx.fillStyle = "#888";
    ctx.font = "9px monospace";
    ctx.fillText("0", 4, displayHeight - 4);
    ctx.fillText("255", displayWidth - 24, displayHeight - 4);
  }, [data, showChannels]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={120}
      className="w-full h-auto rounded-lg border border-border"
    />
  );
};

/**
 * ScopesPanel Component
 *
 * - 8.1: Generate and display waveform showing luminance distribution
 * - 8.2: Display vectorscope showing color saturation and hue distribution
 * - 8.3: Display RGB and luminance histograms
 */
export const ScopesPanel: React.FC<ScopesPanelProps> = ({
  frameImage,
  defaultView = "waveform",
  onScopeDataGenerated,
}) => {
  const [activeView, setActiveView] = useState<ScopeViewType>(defaultView);
  const [waveformData, setWaveformData] = useState<WaveformScopeData | null>(
    null,
  );
  const [vectorscopeData, setVectorscopeData] =
    useState<VectorscopeData | null>(null);
  const [histogramData, setHistogramData] = useState<HistogramData | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [showRGBWaveform, setShowRGBWaveform] = useState(false);

  // Generate scope data when frame image changes
  useEffect(() => {
    if (!frameImage) {
      setWaveformData(null);
      setVectorscopeData(null);
      setHistogramData(null);
      return;
    }

    const generateScopeData = async () => {
      setIsLoading(true);
      const bridge = getEffectsBridge();

      try {
        // Generate data for the active view
        switch (activeView) {
          case "waveform": {
            const data = await bridge.generateWaveform(frameImage);
            setWaveformData(data);
            if (data && onScopeDataGenerated) {
              onScopeDataGenerated(data);
            }
            break;
          }
          case "vectorscope": {
            const data = await bridge.generateVectorscope(frameImage, 256);
            setVectorscopeData(data);
            if (data && onScopeDataGenerated) {
              onScopeDataGenerated(data);
            }
            break;
          }
          case "histogram": {
            const data = await bridge.generateHistogram(frameImage);
            setHistogramData(data);
            if (data && onScopeDataGenerated) {
              onScopeDataGenerated(data);
            }
            break;
          }
        }
      } catch (error) {
        console.error("[ScopesPanel] Error generating scope data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    generateScopeData();
  }, [frameImage, activeView, onScopeDataGenerated]);

  // View toggle handlers
  const handleViewChange = useCallback((view: ScopeViewType) => {
    setActiveView(view);
  }, []);

  // Memoized view content
  const viewContent = useMemo(() => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-40 text-text-muted text-xs">
          Generating scope data...
        </div>
      );
    }

    if (!frameImage) {
      return (
        <div className="flex items-center justify-center h-40 text-text-muted text-xs">
          No frame to analyze
        </div>
      );
    }

    switch (activeView) {
      case "waveform":
        return (
          <div className="space-y-2">
            <WaveformRenderer data={waveformData} showRGB={showRGBWaveform} />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted">
                {showRGBWaveform ? "RGB Parade" : "Luminance"}
              </span>
              <button
                onClick={() => setShowRGBWaveform(!showRGBWaveform)}
                className="text-[10px] text-text-secondary hover:text-text-primary transition-colors"
              >
                {showRGBWaveform ? "Show Luma" : "Show RGB"}
              </button>
            </div>
          </div>
        );
      case "vectorscope":
        return <VectorscopeRenderer data={vectorscopeData} />;
      case "histogram":
        return <HistogramRenderer data={histogramData} showChannels="all" />;
      default:
        return null;
    }
  }, [
    activeView,
    frameImage,
    isLoading,
    waveformData,
    vectorscopeData,
    histogramData,
    showRGBWaveform,
  ]);

  return (
    <div className="space-y-3">
      {/* View Toggle Buttons */}
      <div className="flex gap-2">
        <ViewToggleButton
          active={activeView === "waveform"}
          onClick={() => handleViewChange("waveform")}
          icon={<Activity size={12} />}
          label="Waveform"
        />
        <ViewToggleButton
          active={activeView === "vectorscope"}
          onClick={() => handleViewChange("vectorscope")}
          icon={<Circle size={12} />}
          label="Vectorscope"
        />
        <ViewToggleButton
          active={activeView === "histogram"}
          onClick={() => handleViewChange("histogram")}
          icon={<BarChart3 size={12} />}
          label="Histogram"
        />
      </div>

      {/* Scope View */}
      <div className="bg-background-tertiary rounded-lg p-3">{viewContent}</div>

      {/* Info Text */}
      <p className="text-[9px] text-text-muted">
        {activeView === "waveform" &&
          "Waveform shows luminance distribution across the frame width."}
        {activeView === "vectorscope" &&
          "Vectorscope shows color saturation and hue distribution."}
        {activeView === "histogram" &&
          "Histogram shows RGB and luminance value distribution."}
      </p>
    </div>
  );
};

export default ScopesPanel;
