export type MaterialNodeType =
  | "color"
  | "scalar"
  | "mix"
  | "multiply"
  | "output";

export interface MaterialNode {
  readonly id: string;
  readonly type: MaterialNodeType;
  readonly inputs?: readonly string[];
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface MaterialGraph {
  readonly nodes: readonly MaterialNode[];
  readonly output: string;
}

export interface EvaluatedMaterial {
  readonly baseColor: string;
  readonly metallic: number;
  readonly roughness: number;
  readonly emissive: string;
  readonly emissiveIntensity: number;
}

type Rgb = readonly [number, number, number];

type MaterialValue =
  | { readonly kind: "color"; readonly rgb: Rgb }
  | { readonly kind: "scalar"; readonly value: number };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hexToRgb(hex: string | undefined, fallback: Rgb): Rgb {
  if (!hex) return fallback;
  const normalized = hex.replace("#", "");
  if (normalized.length < 6) return fallback;
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return fallback;
  return [r, g, b];
}

function rgbToHex(rgb: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

function asColor(value: MaterialValue | undefined, fallback: Rgb): Rgb {
  if (!value) return fallback;
  if (value.kind === "color") return value.rgb;
  return [value.value, value.value, value.value];
}

function asScalar(value: MaterialValue | undefined, fallback: number): number {
  if (!value) return fallback;
  if (value.kind === "scalar") return value.value;
  return (value.rgb[0] + value.rgb[1] + value.rgb[2]) / 3;
}

function evaluateNode(
  id: string | undefined,
  nodesById: Map<string, MaterialNode>,
  memo: Map<string, MaterialValue>,
  visiting: Set<string>,
): MaterialValue | undefined {
  if (!id) return undefined;
  const cached = memo.get(id);
  if (cached) return cached;
  if (visiting.has(id)) return undefined;
  const node = nodesById.get(id);
  if (!node) return undefined;
  visiting.add(id);
  const inputs = node.inputs ?? [];
  const params = node.params ?? {};
  let result: MaterialValue;
  switch (node.type) {
    case "color":
      result = {
        kind: "color",
        rgb: hexToRgb(typeof params.color === "string" ? params.color : undefined, [0.8, 0.8, 0.8]),
      };
      break;
    case "scalar":
      result = { kind: "scalar", value: typeof params.value === "number" ? params.value : 0 };
      break;
    case "mix": {
      const a = asColor(evaluateNode(inputs[0], nodesById, memo, visiting), [0, 0, 0]);
      const b = asColor(evaluateNode(inputs[1], nodesById, memo, visiting), [1, 1, 1]);
      const factor = clamp01(
        inputs[2] !== undefined
          ? asScalar(evaluateNode(inputs[2], nodesById, memo, visiting), 0.5)
          : typeof params.factor === "number"
            ? params.factor
            : 0.5,
      );
      result = {
        kind: "color",
        rgb: [
          a[0] + (b[0] - a[0]) * factor,
          a[1] + (b[1] - a[1]) * factor,
          a[2] + (b[2] - a[2]) * factor,
        ],
      };
      break;
    }
    case "multiply": {
      const color = asColor(evaluateNode(inputs[0], nodesById, memo, visiting), [1, 1, 1]);
      const scalar = asScalar(evaluateNode(inputs[1], nodesById, memo, visiting), 1);
      result = { kind: "color", rgb: [color[0] * scalar, color[1] * scalar, color[2] * scalar] };
      break;
    }
    default:
      result = { kind: "scalar", value: 0 };
      break;
  }
  visiting.delete(id);
  memo.set(id, result);
  return result;
}

export function evaluateMaterialGraph(graph: MaterialGraph): EvaluatedMaterial {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const memo = new Map<string, MaterialValue>();
  const output = nodesById.get(graph.output);
  if (!output || output.type !== "output") {
    return {
      baseColor: "#cccccc",
      metallic: 0,
      roughness: 0.5,
      emissive: "#000000",
      emissiveIntensity: 0,
    };
  }
  const inputs = output.inputs ?? [];
  const params = output.params ?? {};
  const baseColor = asColor(
    evaluateNode(inputs[0], nodesById, memo, new Set()),
    hexToRgb(typeof params.baseColor === "string" ? params.baseColor : undefined, [0.8, 0.8, 0.8]),
  );
  const metallic = clamp01(
    inputs[1] !== undefined
      ? asScalar(evaluateNode(inputs[1], nodesById, memo, new Set()), 0)
      : typeof params.metallic === "number"
        ? params.metallic
        : 0,
  );
  const roughness = clamp01(
    inputs[2] !== undefined
      ? asScalar(evaluateNode(inputs[2], nodesById, memo, new Set()), 0.5)
      : typeof params.roughness === "number"
        ? params.roughness
        : 0.5,
  );
  const emissive =
    inputs[3] !== undefined
      ? asColor(evaluateNode(inputs[3], nodesById, memo, new Set()), [0, 0, 0])
      : hexToRgb(typeof params.emissive === "string" ? params.emissive : undefined, [0, 0, 0]);
  return {
    baseColor: rgbToHex(baseColor),
    metallic,
    roughness,
    emissive: rgbToHex(emissive),
    emissiveIntensity: typeof params.emissiveIntensity === "number" ? params.emissiveIntensity : 0,
  };
}
