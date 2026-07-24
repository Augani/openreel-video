import { useEffect, useRef } from "react";

function buildPalette(): Uint8Array {
  const out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    let r: number, g: number, b: number;
    if (i < 8) { r = 0; g = 0; b = 0; }
    else if (i < 32) { r = (i - 8) * 4; g = 0; b = 0; }
    else if (i < 72) { r = 96 + (i - 32) * 3.5; g = (i - 32) * 1.4; b = 0; }
    else if (i < 140) { r = 240; g = 56 + (i - 72) * 1.6; b = 0; }
    else if (i < 200) { r = 252; g = 165 + (i - 140) * 1.0; b = (i - 140) * 0.7; }
    else if (i < 240) { r = 255; g = 225 + (i - 200) * 0.5; b = 50 + (i - 200) * 3.2; }
    else { r = 255; g = 250; b = 180 + (i - 240) * 4.5; }
    out[i * 3] = Math.min(255, r | 0);
    out[i * 3 + 1] = Math.min(255, g | 0);
    out[i * 3 + 2] = Math.min(255, b | 0);
  }
  return out;
}

function makeSubjectMask(W: number, H: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return c;
  ctx.fillStyle = "white";
  const cx = W * 0.5;

  ctx.beginPath();
  ctx.moveTo(cx - W * 0.2, H * 0.45);
  ctx.quadraticCurveTo(cx - W * 0.27, H * 0.55, cx - W * 0.24, H * 0.78);
  ctx.lineTo(cx - W * 0.22, H * 1.0);
  ctx.lineTo(cx + W * 0.22, H * 1.0);
  ctx.lineTo(cx + W * 0.24, H * 0.78);
  ctx.quadraticCurveTo(cx + W * 0.27, H * 0.55, cx + W * 0.2, H * 0.45);
  ctx.closePath();
  ctx.fill();

  ctx.fillRect(cx - W * 0.05, H * 0.36, W * 0.1, H * 0.1);

  ctx.beginPath();
  ctx.ellipse(cx, H * 0.22, W * 0.115, H * 0.135, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(cx - W * 0.06, H * 0.12, W * 0.05, H * 0.04, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + W * 0.05, H * 0.1, W * 0.05, H * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();

  return c;
}

function extractEdgePoints(maskCanvas: HTMLCanvasElement, density = 1): number[] {
  const W = maskCanvas.width;
  const H = maskCanvas.height;
  const ctx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const data = ctx.getImageData(0, 0, W, H).data;
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 4 + 3]);
  const points: number[] = [];
  for (let y = 1; y < H - 1; y += density) {
    for (let x = 1; x < W - 1; x += density) {
      if (a(x, y) === 0) {
        if (a(x - 1, y) > 0 || a(x + 1, y) > 0 || a(x, y - 1) > 0 || a(x, y + 1) > 0) {
          points.push(x, y);
        }
      }
    }
  }
  return points;
}

function FireCanvas({ width = 130, height = 190, intensity = 1 }: { width?: number; height?: number; intensity?: number }) {
  const cRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = cRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const paint = ctx;
    const W = canvas.width;
    const H = canvas.height;

    const palette = buildPalette();
    const maskCanvas = makeSubjectMask(W, H);
    const edges = extractEdgePoints(maskCanvas, 1);

    const heat = new Uint8Array(W * H);
    const img = ctx.createImageData(W, H);

    const skyline = new Int16Array(W);
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (maskCtx) {
      const md = maskCtx.getImageData(0, 0, W, H).data;
      for (let x = 0; x < W; x++) {
        skyline[x] = -1;
        for (let y = 0; y < H; y++) {
          if (md[(y * W + x) * 4 + 3] > 0) {
            skyline[x] = y;
            break;
          }
        }
      }
    }

    let raf = 0;
    let frame = 0;

    function step() {
      frame++;
      for (let y = 0; y < H - 1; y++) {
        const rowAbove = y * W;
        const rowBelow = (y + 1) * W;
        for (let x = 0; x < W; x++) {
          const dx = ((Math.random() * 3) | 0) - 1;
          const sx = (x + dx + W) % W;
          const decay = (Math.random() * 3) | 0;
          const src = heat[rowBelow + sx];
          heat[rowAbove + x] = src > decay ? src - decay : 0;
        }
      }

      const eCount = edges.length / 2;
      const spawnProb = 0.95 * intensity;
      const wobble = Math.sin(frame * 0.07) * 0.04;
      for (let i = 0; i < eCount; i++) {
        if (Math.random() > spawnProb + wobble) continue;
        const ex = edges[i * 2];
        const ey = edges[i * 2 + 1];
        const sideBoost = Math.abs(ex - W / 2) > W * 0.14 ? 30 : 0;
        const base = 230 + sideBoost;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const nx = ex + dx;
            const ny = ey + dy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const dist = Math.abs(dx) + Math.abs(dy) * 2;
            const v = Math.max(0, base - dist * 16) + ((Math.random() * 30) | 0);
            const idx = ny * W + nx;
            if (heat[idx] < v) heat[idx] = Math.min(255, v);
          }
        }
      }

      for (let x = 0; x < W; x++) {
        const sy = skyline[x];
        if (sy < 0) continue;
        if (Math.random() > 0.92 * intensity) continue;
        const v = 225 + ((Math.random() * 30) | 0);
        if (heat[sy * W + x] < v) heat[sy * W + x] = v;
        if (sy > 0 && heat[(sy - 1) * W + x] < v - 8) heat[(sy - 1) * W + x] = v - 8;
        if (sy > 1 && heat[(sy - 2) * W + x] < v - 16) heat[(sy - 2) * W + x] = v - 16;
      }

      const baseY = H - 3;
      for (let x = (W * 0.05) | 0; x < W * 0.95; x++) {
        if (Math.random() > 0.8 * intensity) continue;
        heat[baseY * W + x] = Math.max(heat[baseY * W + x], 230 + ((Math.random() * 25) | 0));
        if (Math.random() < 0.4) heat[(baseY - 1) * W + x] = Math.max(heat[(baseY - 1) * W + x], 200 + ((Math.random() * 50) | 0));
      }

      const buf = img.data;
      for (let i = 0; i < W * H; i++) {
        const h = heat[i];
        const p = h * 3;
        const o = i * 4;
        buf[o] = palette[p];
        buf[o + 1] = palette[p + 1];
        buf[o + 2] = palette[p + 2];
        buf[o + 3] = h < 12 ? 0 : Math.min(255, h * 1.6);
      }
      paint.putImageData(img, 0, 0);
      raf = requestAnimationFrame(step);
    }
    step();
    return () => cancelAnimationFrame(raf);
  }, [intensity]);

  return (
    <canvas
      ref={cRef}
      width={width}
      height={height}
      className="absolute inset-0 h-full w-full"
      style={{
        filter: "blur(0.9px) saturate(1.25) contrast(1.1)",
        mixBlendMode: "screen",
        imageRendering: "auto",
      }}
    />
  );
}

function FireBloomSVG({ intensity = 1 }: { intensity?: number }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 1, mixBlendMode: "screen", filter: "blur(2px)" }}
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 600 400"
    >
      <defs>
        <filter id="fire-turb-1" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.04" numOctaves="3" seed="3">
            <animate attributeName="seed" values="3;103" dur="1.8s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="45" />
        </filter>
        <filter id="fire-turb-2" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.025 0.07" numOctaves="2" seed="17">
            <animate attributeName="seed" values="17;217" dur="1.1s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="30" />
        </filter>
        <filter id="fire-turb-3" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.12" numOctaves="2" seed="31">
            <animate attributeName="seed" values="31;231" dur="0.7s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="18" />
        </filter>
        <linearGradient id="flame-grad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#7c2d12" stopOpacity="0" />
          <stop offset="8%" stopColor="#ea580c" stopOpacity="0.95" />
          <stop offset="22%" stopColor="#f97316" stopOpacity="1" />
          <stop offset="45%" stopColor="#fb923c" stopOpacity="1" />
          <stop offset="68%" stopColor="#fcd34d" stopOpacity="0.9" />
          <stop offset="85%" stopColor="#fef3c7" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="300" cy="260" rx="200" ry="150" fill="url(#flame-grad)" opacity={0.65 * intensity} filter="url(#fire-turb-1)" />
      <ellipse cx="300" cy="230" rx="130" ry="170" fill="url(#flame-grad)" opacity={0.85 * intensity} filter="url(#fire-turb-2)" />
      <ellipse cx="300" cy="230" rx="90" ry="130" fill="url(#flame-grad)" opacity={0.95 * intensity} filter="url(#fire-turb-3)" />
      <ellipse cx="300" cy="320" rx="180" ry="40" fill="#fef3c7" opacity={0.4 * intensity} filter="url(#fire-turb-2)" />
    </svg>
  );
}

function SubjectSilhouette() {
  return (
    <svg className="absolute inset-0 h-full w-full" style={{ zIndex: 2 }} viewBox="0 0 220 320" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="rim" cx="0.5" cy="0.55" r="0.55">
          <stop offset="0%" stopColor="#0b0814" />
          <stop offset="65%" stopColor="#1c1024" />
          <stop offset="90%" stopColor="#3a1a18" />
          <stop offset="100%" stopColor="#7c2410" />
        </radialGradient>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a0e1a" />
          <stop offset="55%" stopColor="#120612" />
          <stop offset="100%" stopColor="#0a040a" />
        </linearGradient>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <g filter="url(#glow)" opacity="0.55">
        <ellipse cx="110" cy="72" rx="32" ry="40" fill="#c2410c" />
        <path d="M 66,150 Q 50,180 53,250 L 56,320 L 164,320 L 167,250 Q 170,180 154,150 Z" fill="#9a3412" />
        <rect x="100" y="118" width="20" height="32" fill="#7c2d12" />
      </g>

      <path d="M 66,150 Q 50,180 53,250 L 56,320 L 164,320 L 167,250 Q 170,180 154,150 L 110,144 Z" fill="url(#body)" />
      <rect x="99" y="115" width="22" height="36" fill="#0e0610" />
      <ellipse cx="110" cy="72" rx="27" ry="40" fill="url(#body)" />
      <ellipse cx="98" cy="42" rx="13" ry="11" fill="#0a040a" />
      <ellipse cx="121" cy="38" rx="13" ry="11" fill="#0a040a" />

      <path d="M 137,72 Q 137,40 124,40 Q 138,50 136,72 Q 138,96 124,108 Q 138,100 137,72 Z" fill="#fbbf24" opacity="0.78" />
      <path d="M 134,68 Q 134,46 124,46 Q 134,52 132,68 Q 134,90 124,102 Q 134,96 134,68 Z" fill="#fef3c7" opacity="0.95">
        <animate attributeName="opacity" values="0.85;1;0.9;0.95" dur="1.4s" repeatCount="indefinite" />
      </path>

      <path d="M 83,72 Q 83,42 96,40 Q 82,50 84,72 Q 82,96 96,108 Q 82,100 83,72 Z" fill="#ea580c" opacity="0.65" />
      <path d="M 86,70 Q 86,46 96,46 Q 86,52 88,70 Q 86,90 96,102 Q 86,96 86,70 Z" fill="#fbbf24" opacity="0.85">
        <animate attributeName="opacity" values="0.7;0.95;0.8;0.9" dur="1.7s" repeatCount="indefinite" />
      </path>

      <path d="M 56,320 L 56,300 Q 60,260 65,210 Q 60,250 60,300 L 60,320 Z" fill="#f97316" opacity="0.85">
        <animate attributeName="opacity" values="0.7;1;0.8;0.95" dur="0.9s" repeatCount="indefinite" />
      </path>
      <path d="M 164,320 L 164,300 Q 160,260 155,210 Q 160,250 160,300 L 160,320 Z" fill="#f97316" opacity="0.85">
        <animate attributeName="opacity" values="0.95;0.7;1;0.8" dur="1.1s" repeatCount="indefinite" />
      </path>

      <ellipse cx="110" cy="148" rx="38" ry="6" fill="#fde047" opacity="0.55">
        <animate attributeName="opacity" values="0.4;0.7;0.5;0.6" dur="0.7s" repeatCount="indefinite" />
      </ellipse>

      <g fill="#fef3c7">
        <circle cx="80" cy="20" r="0.9" opacity="0.7">
          <animate attributeName="cy" values="40;-10" dur="2.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;0.4;0" dur="2.6s" repeatCount="indefinite" />
        </circle>
        <circle cx="140" cy="35" r="0.7" opacity="0.7">
          <animate attributeName="cy" values="40;-5" dur="3.0s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.9;0.3;0" dur="3.0s" repeatCount="indefinite" />
        </circle>
        <circle cx="110" cy="10" r="0.7" opacity="0.7">
          <animate attributeName="cy" values="50;-15" dur="3.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.8;0.3;0" dur="3.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="92" cy="30" r="0.6" opacity="0.7">
          <animate attributeName="cy" values="55;0" dur="2.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.7;0.2;0" dur="2.2s" repeatCount="indefinite" />
        </circle>
        <circle cx="128" cy="25" r="0.5" opacity="0.7">
          <animate attributeName="cy" values="48;-8" dur="2.9s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.9;0.4;0" dur="2.9s" repeatCount="indefinite" />
        </circle>
      </g>
    </svg>
  );
}

export function FireScene({ intensity = 1 }: { intensity?: number }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse 80% 65% at 50% 80%, rgba(124,45,18,0.75) 0%, rgba(28,17,11,0.85) 50%, #050307 90%)," +
          "linear-gradient(180deg, #08040a 0%, #07040c 100%)",
      }}
    >
      <div
        className="absolute bottom-0 left-0 right-0 h-[65%]"
        style={{ background: "radial-gradient(ellipse 55% 100% at 50% 100%, rgba(234,88,12,0.55), transparent 70%)", zIndex: 0 }}
      />

      <FireBloomSVG intensity={intensity} />

      <div className="absolute bottom-0 left-1/2 top-0 -translate-x-1/2" style={{ aspectRatio: "220 / 320", zIndex: 2 }}>
        <FireCanvas intensity={intensity} />
        <SubjectSilhouette />
      </div>

      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(124,45,18,0.20) 88%, rgba(0,0,0,0.35) 100%)", zIndex: 5 }}
      />

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.10 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          mixBlendMode: "overlay",
          opacity: 0.55,
          zIndex: 6,
        }}
      />
    </div>
  );
}
