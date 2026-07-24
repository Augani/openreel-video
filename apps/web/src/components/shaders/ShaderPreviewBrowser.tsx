import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  defaultMotionShaderParams,
  type MotionShaderDef,
} from "@openreel/core";
import { MotionShaderRenderer } from "@openreel/core/motion/motion-shader-renderer";

type ShaderPreviewSample = "text" | "shape" | "effect";

function shaderAccessibleName(
  def: MotionShaderDef,
  duplicateNames: ReadonlySet<string>,
  sample: ShaderPreviewSample,
): string {
  const suffix = duplicateNames.has(def.name)
    ? `, ${def.collection ?? "Built-in"} ${def.category}`
    : "";
  const action = sample === "effect" ? "apply" : "select";
  return `Preview and ${action} ${def.name}${suffix}`;
}

let sharedPreviewRenderer: MotionShaderRenderer | null = null;

function previewRenderer(): MotionShaderRenderer {
  sharedPreviewRenderer ??= new MotionShaderRenderer();
  return sharedPreviewRenderer;
}

function previewFallback(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue} 75% 58%), hsl(${(hue + 95) % 360} 80% 42%))`;
}

function makePreviewInput(
  width: number,
  height: number,
  sample: ShaderPreviewSample,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  if (sample === "effect") {
    if (typeof ctx.createLinearGradient === "function") {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#22d3ee");
      gradient.addColorStop(0.5, "#8b5cf6");
      gradient.addColorStop(1, "#fb7185");
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = "#8b5cf6";
    }
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.font = "700 24px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("FX", width / 2, height / 2);
    return canvas;
  }

  ctx.fillStyle = "#ffffff";
  if (sample === "shape") {
    const inset = 10;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(inset, inset, width - inset * 2, height - inset * 2, 12);
      ctx.fill();
    } else {
      ctx.fillRect(inset, inset, width - inset * 2, height - inset * 2);
    }
  } else {
    ctx.font = "800 34px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Aa", width / 2, height / 2 + 1);
  }
  return canvas;
}

function ShaderPreviewCanvas({
  def,
  sample,
}: {
  def: MotionShaderDef;
  sample: ShaderPreviewSample;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    try {
      const input = makePreviewInput(canvas.width, canvas.height, sample);
      const result = previewRenderer().render(def, {
        width: canvas.width,
        height: canvas.height,
        time: 0.72,
        progress: 0.65,
        params: defaultMotionShaderParams(def),
        inputCanvas: input,
      });
      if (!result) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(result, 0, 0, canvas.width, canvas.height);
      if (sample !== "effect" && def.category !== "text") {
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(input, 0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = "source-over";
      }
    } catch {
      // The CSS fallback remains visible when canvas APIs are unavailable.
    }
  }, [def, sample]);

  return (
    <canvas
      ref={canvasRef}
      width={144}
      height={72}
      aria-hidden="true"
      className="h-[56px] w-full rounded-[7px] bg-bg-3 object-cover"
      style={{ backgroundImage: previewFallback(def.id) }}
    />
  );
}

export function ShaderPreviewBrowser({
  defs,
  selectedId,
  onSelect,
  sample = "text",
  label = "Material previews",
}: {
  defs: readonly MotionShaderDef[];
  selectedId?: string;
  onSelect: (shaderId: string) => void;
  sample?: ShaderPreviewSample;
  label?: string;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("All");
  const collections = useMemo(
    () => [
      "All",
      ...Array.from(new Set(defs.map((def) => def.collection ?? "Built-in"))).sort(),
    ],
    [defs],
  );
  const visibleDefs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return defs.filter((def) => {
      const defCollection = def.collection ?? "Built-in";
      if (collection !== "All" && defCollection !== collection) return false;
      return (
        !normalized ||
        `${def.name} ${defCollection} ${def.category}`
          .toLowerCase()
          .includes(normalized)
      );
    });
  }, [collection, defs, query]);
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const def of defs) counts.set(def.name, (counts.get(def.name) ?? 0) + 1);
    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([name]) => name),
    );
  }, [defs]);

  return (
    <div className="space-y-2" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-fg-2">{label}</span>
        <span className="text-[10px] tabular-nums text-fg-4">
          {visibleDefs.length}/{defs.length}
        </span>
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={sample === "effect" ? "Search effects" : "Search materials"}
        aria-label={`Search ${label.toLowerCase()}`}
        className="h-8 w-full rounded-[7px] border border-border bg-bg-2 px-2.5 text-xs text-fg outline-none transition-colors placeholder:text-fg-4 focus:border-accent"
      />
      {collections.length > 2 ? (
        <div
          className="flex gap-1 overflow-x-auto pb-0.5"
          role="group"
          aria-label={`${label} collections`}
        >
          {collections.map((entry) => {
            const count = entry === "All"
              ? defs.length
              : defs.filter((def) => (def.collection ?? "Built-in") === entry).length;
            return (
              <button
                key={entry}
                type="button"
                aria-pressed={collection === entry}
                onClick={() => setCollection(entry)}
                className={`h-6 shrink-0 rounded-md border px-2 text-[10px] font-medium transition-colors ${
                  collection === entry
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-bg-2 text-fg-3 hover:border-accent/50 hover:text-fg"
                }`}
              >
                {entry} · {count}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="grid max-h-[260px] grid-cols-2 gap-2 overflow-y-auto pr-1">
        {visibleDefs.map((def) => {
          const selected = def.id === selectedId;
          return (
            <button
              key={def.id}
              type="button"
              aria-label={shaderAccessibleName(def, duplicateNames, sample)}
              aria-pressed={selectedId === undefined ? undefined : selected}
              onClick={() => onSelect(def.id)}
              className={`min-w-0 rounded-[9px] border p-1.5 text-left transition-colors ${
                selected
                  ? "border-accent bg-accent/10"
                  : "border-border bg-bg-2 hover:border-accent/50 hover:bg-bg-3"
              }`}
            >
              <ShaderPreviewCanvas def={def} sample={sample} />
              <span className="mt-1.5 block truncate text-[11px] font-medium text-fg-2">
                {def.name}
              </span>
              <span className="block truncate text-[9px] text-fg-4">
                {def.collection ?? "Built-in"} · {def.category}
              </span>
            </button>
          );
        })}
      </div>
      {visibleDefs.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-border px-3 py-5 text-center text-[11px] text-fg-4">
          No {sample === "effect" ? "effects" : "materials"} match “{query}”.
        </div>
      ) : null}
    </div>
  );
}
