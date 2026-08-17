import { useEffect, useRef, type JSX } from "react";
import {
  applyMotionPixelEffectsToBuffer,
  buildMotionCanvasFilter,
  getPrimaryMotionShadow,
  isMotionPixelEffect,
  type MotionEffect,
  type MotionShapeLayer,
} from "@openreel/core";
import { useTranslation } from "react-i18next";

interface MotionEffectPreviewProps {
  effect: MotionEffect;
}

const PREVIEW_WIDTH = 180;
const PREVIEW_HEIGHT = 84;

export function MotionEffectPreview({ effect }: MotionEffectPreviewProps): JSX.Element {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) return;

    const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = PREVIEW_WIDTH * scale;
    canvas.height = PREVIEW_HEIGHT * scale;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    paintPreview(context, effect);
  }, [effect]);

  return (
    <div
      data-testid="motion-effect-preview"
      data-effect-type={effect.type}
      className="relative mb-2 aspect-[15/7] w-full overflow-hidden rounded-md border border-white/10 bg-[#10131d]"
    >
      <canvas
        ref={canvasRef}
        width={PREVIEW_WIDTH}
        height={PREVIEW_HEIGHT}
        aria-hidden="true"
        className="h-full w-full"
      />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-white/80 backdrop-blur-sm">
        {t("Preview")}</span>
    </div>
  );
}

function paintPreview(
  context: CanvasRenderingContext2D,
  effect: MotionEffect,
): void {
  context.save();
  context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  paintBackdrop(context);

  if (effect.type === "backdrop-blur") {
    paintBackdropBlurPreview(context, Math.max(1, effect.radius * 0.45));
    context.restore();
    return;
  }

  const source = document.createElement("canvas");
  source.width = PREVIEW_WIDTH;
  source.height = PREVIEW_HEIGHT;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    context.restore();
    return;
  }
  paintSubject(sourceContext);

  if (isMotionPixelEffect(effect.type)) {
    const imageData = sourceContext.getImageData(
      0,
      0,
      PREVIEW_WIDTH,
      PREVIEW_HEIGHT,
    );
    if (
      imageData.width === PREVIEW_WIDTH &&
      imageData.height === PREVIEW_HEIGHT
    ) {
      applyMotionPixelEffectsToBuffer(imageData, previewLayer(effect), 0);
    }
    sourceContext.putImageData(imageData, 0, 0);
  }

  context.filter = buildMotionCanvasFilter([effect]);
  const shadow = getPrimaryMotionShadow([effect]);
  if (shadow) {
    context.shadowColor = shadow.color;
    context.shadowBlur = Math.min(18, shadow.blur * 0.6);
    context.shadowOffsetX = shadow.offsetX * 0.35;
    context.shadowOffsetY = shadow.offsetY * 0.35;
  }
  context.drawImage(source, 0, 0);
  context.restore();
}

function paintBackdrop(context: CanvasRenderingContext2D): void {
  const gradient = context.createLinearGradient(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  gradient.addColorStop(0, "#111827");
  gradient.addColorStop(0.48, "#1e293b");
  gradient.addColorStop(1, "#090d16");
  context.fillStyle = gradient;
  context.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  context.globalAlpha = 0.18;
  context.strokeStyle = "#94a3b8";
  context.lineWidth = 1;
  for (let x = -PREVIEW_HEIGHT; x < PREVIEW_WIDTH; x += 15) {
    context.beginPath();
    context.moveTo(x, PREVIEW_HEIGHT);
    context.lineTo(x + PREVIEW_HEIGHT, 0);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function paintSubject(context: CanvasRenderingContext2D): void {
  const gradient = context.createLinearGradient(40, 18, 142, 72);
  gradient.addColorStop(0, "#7c3aed");
  gradient.addColorStop(0.5, "#ec4899");
  gradient.addColorStop(1, "#22d3ee");

  context.fillStyle = gradient;
  context.beginPath();
  roundedRect(context, 40, 19, 100, 48, 13);
  context.fill();

  context.strokeStyle = "rgba(255,255,255,0.55)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(132, 24, 13, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = "#ffffff";
  context.font = "700 24px Inter, ui-sans-serif, system-ui";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("Aa", 89, 44);
}

function paintBackdropBlurPreview(
  context: CanvasRenderingContext2D,
  radius: number,
): void {
  context.save();
  context.beginPath();
  roundedRect(context, 35, 17, 110, 52, 12);
  context.clip();
  context.filter = `blur(${radius}px) saturate(1.25)`;
  context.drawImage(context.canvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  context.filter = "none";
  context.fillStyle = "rgba(255,255,255,0.16)";
  context.fillRect(35, 17, 110, 52);
  context.restore();

  context.strokeStyle = "rgba(255,255,255,0.5)";
  context.lineWidth = 1;
  context.beginPath();
  roundedRect(context, 35.5, 17.5, 109, 51, 11.5);
  context.stroke();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
    return;
  }
  context.rect(x, y, width, height);
}

function previewLayer(effect: MotionEffect): MotionShapeLayer {
  return {
    id: `preview-${effect.type}`,
    type: "shape",
    name: `${effect.name} preview`,
    startTime: 0,
    duration: 1,
    visible: true,
    locked: false,
    transform: {
      position: { x: PREVIEW_WIDTH / 2, y: PREVIEW_HEIGHT / 2 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      anchor: { x: 0.5, y: 0.5 },
    },
    keyframes: [],
    effects: [effect],
    shapeType: "rectangle",
    width: 100,
    height: 48,
    style: {
      fill: { type: "solid", color: "#8b5cf6", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
}
