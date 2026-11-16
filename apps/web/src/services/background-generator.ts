export interface BackgroundPreset {
  id: string;
  name: string;
  category: "solid" | "gradient" | "pattern" | "mesh";
  generate: (width: number, height: number) => HTMLCanvasElement;
  thumbnail: string;
}

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const generateSolidBackground =
  (color: string) => (width: number, height: number) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    return canvas;
  };

const generateLinearGradient =
  (colors: string[], angle: number = 180) =>
  (width: number, height: number) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d")!;

    const radians = (angle - 90) * (Math.PI / 180);
    const x1 = width / 2 - Math.cos(radians) * width;
    const y1 = height / 2 - Math.sin(radians) * height;
    const x2 = width / 2 + Math.cos(radians) * width;
    const y2 = height / 2 + Math.sin(radians) * height;

    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    colors.forEach((color, i) =>
      gradient.addColorStop(i / (colors.length - 1), color),
    );

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return canvas;
  };

const generateRadialGradient =
  (colors: string[]) => (width: number, height: number) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d")!;

    const gradient = ctx.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      Math.max(width, height) / 2,
    );
    colors.forEach((color, i) =>
      gradient.addColorStop(i / (colors.length - 1), color),
    );

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return canvas;
  };

const generateMeshGradient =
  (colors: string[]) => (width: number, height: number) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, width, height);

    const blobs = [
      { x: 0.2, y: 0.3, r: 0.6, color: colors[1] || colors[0] },
      { x: 0.8, y: 0.2, r: 0.5, color: colors[2] || colors[1] || colors[0] },
      { x: 0.5, y: 0.8, r: 0.55, color: colors[3] || colors[2] || colors[0] },
      { x: 0.1, y: 0.9, r: 0.4, color: colors[4] || colors[1] || colors[0] },
    ];

    for (const blob of blobs) {
      const gradient = ctx.createRadialGradient(
        blob.x * width,
        blob.y * height,
        0,
        blob.x * width,
        blob.y * height,
        blob.r * Math.max(width, height),
      );
      gradient.addColorStop(0, blob.color);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    return canvas;
  };

const generateNoisePattern =
  (baseColor: string, noiseIntensity: number = 0.1) =>
  (width: number, height: number) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 255 * noiseIntensity;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  };

const generateGridPattern =
  (bgColor: string, lineColor: string, spacing: number = 40) =>
  (width: number, height: number) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;

    for (let x = 0; x <= width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let y = 0; y <= height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    return canvas;
  };

const generateDotsPattern =
  (
    bgColor: string,
    dotColor: string,
    spacing: number = 30,
    dotSize: number = 3,
  ) =>
  (width: number, height: number) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = dotColor;
    for (let x = spacing / 2; x < width; x += spacing) {
      for (let y = spacing / 2; y < height; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    return canvas;
  };

const generateWavesPattern =
  (colors: string[]) => (width: number, height: number) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d")!;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    colors.forEach((color, i) =>
      gradient.addColorStop(i / (colors.length - 1), color),
    );
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.3;
    const waveColors = [
      "rgba(255,255,255,0.1)",
      "rgba(255,255,255,0.15)",
      "rgba(255,255,255,0.08)",
    ];

    for (let w = 0; w < 3; w++) {
      ctx.fillStyle = waveColors[w];
      ctx.beginPath();
      ctx.moveTo(0, height);

      const amplitude = 30 + w * 20;
      const frequency = 0.005 - w * 0.001;
      const offset = w * 100;

      for (let x = 0; x <= width; x += 5) {
        const y =
          height * (0.5 + w * 0.15) +
          Math.sin(x * frequency + offset) * amplitude;
        ctx.lineTo(x, y);
      }

      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    return canvas;
  };

const generateAuroraPattern =
  (colors: string[]) => (width: number, height: number) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d")!;

    const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
    bgGradient.addColorStop(0, "#0f0c29");
    bgGradient.addColorStop(0.5, "#302b63");
    bgGradient.addColorStop(1, "#24243e");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < colors.length; i++) {
      ctx.globalAlpha = 0.4;
      const gradient = ctx.createRadialGradient(
        width * (0.2 + i * 0.3),
        height * 0.3,
        0,
        width * (0.2 + i * 0.3),
        height * 0.3,
        height * 0.8,
      );
      gradient.addColorStop(0, colors[i]);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    ctx.globalAlpha = 1;
    return canvas;
  };

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  // Solid Colors
  {
    id: "solid-black",
    name: "Black",
    category: "solid",
    generate: generateSolidBackground("#000000"),
    thumbnail: "linear-gradient(#000000, #000000)",
  },
  {
    id: "solid-white",
    name: "White",
    category: "solid",
    generate: generateSolidBackground("#ffffff"),
    thumbnail: "linear-gradient(#ffffff, #ffffff)",
  },
  {
    id: "solid-slate",
    name: "Slate",
    category: "solid",
    generate: generateSolidBackground("#1e293b"),
    thumbnail: "linear-gradient(#1e293b, #1e293b)",
  },
  {
    id: "solid-zinc",
    name: "Zinc",
    category: "solid",
    generate: generateSolidBackground("#27272a"),
    thumbnail: "linear-gradient(#27272a, #27272a)",
  },
  {
    id: "solid-red",
    name: "Red",
    category: "solid",
    generate: generateSolidBackground("#dc2626"),
    thumbnail: "linear-gradient(#dc2626, #dc2626)",
  },
  {
    id: "solid-blue",
    name: "Blue",
    category: "solid",
    generate: generateSolidBackground("#2563eb"),
    thumbnail: "linear-gradient(#2563eb, #2563eb)",
  },
  {
    id: "solid-green",
    name: "Green",
    category: "solid",
    generate: generateSolidBackground("#16a34a"),
    thumbnail: "linear-gradient(#16a34a, #16a34a)",
  },
  {
    id: "solid-purple",
    name: "Purple",
    category: "solid",
    generate: generateSolidBackground("#9333ea"),
    thumbnail: "linear-gradient(#9333ea, #9333ea)",
  },

  // Linear Gradients
  {
    id: "gradient-sunset",
    name: "Sunset",
    category: "gradient",
    generate: generateLinearGradient(["#f97316", "#ec4899", "#8b5cf6"], 135),
    thumbnail: "linear-gradient(135deg, #f97316, #ec4899, #8b5cf6)",
  },
  {
    id: "gradient-ocean",
    name: "Ocean",
    category: "gradient",
    generate: generateLinearGradient(["#0ea5e9", "#06b6d4", "#14b8a6"], 180),
    thumbnail: "linear-gradient(180deg, #0ea5e9, #06b6d4, #14b8a6)",
  },
  {
    id: "gradient-forest",
    name: "Forest",
    category: "gradient",
    generate: generateLinearGradient(["#166534", "#15803d", "#22c55e"], 180),
    thumbnail: "linear-gradient(180deg, #166534, #15803d, #22c55e)",
  },
  {
    id: "gradient-lavender",
    name: "Lavender",
    category: "gradient",
    generate: generateLinearGradient(["#c084fc", "#a78bfa", "#818cf8"], 135),
    thumbnail: "linear-gradient(135deg, #c084fc, #a78bfa, #818cf8)",
  },
  {
    id: "gradient-midnight",
    name: "Midnight",
    category: "gradient",
    generate: generateLinearGradient(["#0f172a", "#1e3a5f", "#1e40af"], 180),
    thumbnail: "linear-gradient(180deg, #0f172a, #1e3a5f, #1e40af)",
  },
  {
    id: "gradient-rose",
    name: "Rose",
    category: "gradient",
    generate: generateLinearGradient(["#fda4af", "#fb7185", "#e11d48"], 180),
    thumbnail: "linear-gradient(180deg, #fda4af, #fb7185, #e11d48)",
  },
  {
    id: "gradient-gold",
    name: "Gold",
    category: "gradient",
    generate: generateLinearGradient(["#fbbf24", "#f59e0b", "#d97706"], 135),
    thumbnail: "linear-gradient(135deg, #fbbf24, #f59e0b, #d97706)",
  },
  {
    id: "gradient-noir",
    name: "Noir",
    category: "gradient",
    generate: generateLinearGradient(["#18181b", "#27272a", "#3f3f46"], 180),
    thumbnail: "linear-gradient(180deg, #18181b, #27272a, #3f3f46)",
  },

  // Radial Gradients
  {
    id: "radial-spotlight",
    name: "Spotlight",
    category: "gradient",
    generate: generateRadialGradient(["#374151", "#111827"]),
    thumbnail: "radial-gradient(circle, #374151, #111827)",
  },
  {
    id: "radial-glow",
    name: "Glow",
    category: "gradient",
    generate: generateRadialGradient(["#7c3aed", "#4c1d95", "#1e1b4b"]),
    thumbnail: "radial-gradient(circle, #7c3aed, #4c1d95, #1e1b4b)",
  },

  // Mesh Gradients
  {
    id: "mesh-aurora",
    name: "Aurora",
    category: "mesh",
    generate: generateMeshGradient([
      "#0f172a",
      "#06b6d4",
      "#8b5cf6",
      "#ec4899",
      "#f97316",
    ]),
    thumbnail: "linear-gradient(135deg, #06b6d4, #8b5cf6, #ec4899)",
  },
  {
    id: "mesh-nebula",
    name: "Nebula",
    category: "mesh",
    generate: generateMeshGradient([
      "#0c0a1d",
      "#7c3aed",
      "#db2777",
      "#f97316",
      "#06b6d4",
    ]),
    thumbnail: "linear-gradient(135deg, #7c3aed, #db2777, #f97316)",
  },
  {
    id: "mesh-candy",
    name: "Candy",
    category: "mesh",
    generate: generateMeshGradient([
      "#fdf2f8",
      "#f472b6",
      "#a78bfa",
      "#38bdf8",
      "#34d399",
    ]),
    thumbnail: "linear-gradient(135deg, #f472b6, #a78bfa, #38bdf8)",
  },
  {
    id: "mesh-sunset-beach",
    name: "Beach",
    category: "mesh",
    generate: generateMeshGradient([
      "#1e3a5f",
      "#f97316",
      "#fbbf24",
      "#ec4899",
      "#06b6d4",
    ]),
    thumbnail: "linear-gradient(135deg, #f97316, #ec4899, #06b6d4)",
  },

  // Patterns
  {
    id: "pattern-grid-dark",
    name: "Grid Dark",
    category: "pattern",
    generate: generateGridPattern("#0f0f11", "rgba(255,255,255,0.1)"),
    thumbnail: "linear-gradient(#0f0f11, #0f0f11)",
  },
  {
    id: "pattern-grid-light",
    name: "Grid Light",
    category: "pattern",
    generate: generateGridPattern("#f8fafc", "rgba(0,0,0,0.08)"),
    thumbnail: "linear-gradient(#f8fafc, #f8fafc)",
  },
  {
    id: "pattern-dots-dark",
    name: "Dots Dark",
    category: "pattern",
    generate: generateDotsPattern("#18181b", "rgba(255,255,255,0.15)"),
    thumbnail: "linear-gradient(#18181b, #18181b)",
  },
  {
    id: "pattern-dots-light",
    name: "Dots Light",
    category: "pattern",
    generate: generateDotsPattern("#ffffff", "rgba(0,0,0,0.1)"),
    thumbnail: "linear-gradient(#ffffff, #ffffff)",
  },
  {
    id: "pattern-noise-dark",
    name: "Film Grain",
    category: "pattern",
    generate: generateNoisePattern("#1a1a1a", 0.15),
    thumbnail: "linear-gradient(#1a1a1a, #1a1a1a)",
  },

  // Special
  {
    id: "waves-ocean",
    name: "Ocean Waves",
    category: "mesh",
    generate: generateWavesPattern(["#0c4a6e", "#0284c7", "#38bdf8"]),
    thumbnail: "linear-gradient(180deg, #0c4a6e, #0284c7, #38bdf8)",
  },
  {
    id: "waves-sunset",
    name: "Sunset Waves",
    category: "mesh",
    generate: generateWavesPattern(["#7c2d12", "#ea580c", "#fbbf24"]),
    thumbnail: "linear-gradient(180deg, #7c2d12, #ea580c, #fbbf24)",
  },
  {
    id: "aurora-borealis",
    name: "Borealis",
    category: "mesh",
    generate: generateAuroraPattern(["#22d3ee", "#a78bfa", "#34d399"]),
    thumbnail: "linear-gradient(180deg, #0f0c29, #302b63, #24243e)",
  },
];

export async function generateBackgroundBlob(
  preset: BackgroundPreset,
  width: number = 1920,
  height: number = 1080,
): Promise<Blob> {
  const canvas = preset.generate(width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to generate background blob"));
      },
      "image/png",
      1.0,
    );
  });
}
