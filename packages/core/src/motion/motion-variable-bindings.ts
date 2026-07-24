import type {
  MotionComposition,
  MotionLayer,
  MotionVariable,
  MotionVariableBinding,
  MotionVariableBindingTarget,
} from "./types";

export interface MotionVariableBindingTargetDefinition {
  readonly target: MotionVariableBindingTarget;
  readonly label: string;
  readonly variableTypes: readonly MotionVariable["type"][];
  readonly layerTypes: readonly MotionLayer["type"][];
}

export type MotionVariableOverrideMap = Record<
  string,
  string | number | boolean
>;

export const MOTION_VARIABLE_BINDING_TARGETS: readonly MotionVariableBindingTargetDefinition[] =
  [
    {
      target: "layer.visible",
      label: "Layer visibility",
      variableTypes: ["boolean"],
      layerTypes: [
        "text",
        "shape",
        "image",
        "composition",
        "adjustment",
        "group",
        "null",
        "particle",
      ],
    },
    {
      target: "transform.opacity",
      label: "Opacity",
      variableTypes: ["number", "boolean"],
      layerTypes: [
        "text",
        "shape",
        "image",
        "composition",
        "adjustment",
        "group",
        "null",
        "particle",
      ],
    },
    {
      target: "text.content",
      label: "Text content",
      variableTypes: ["text", "number", "boolean"],
      layerTypes: ["text"],
    },
    {
      target: "text.color",
      label: "Text color",
      variableTypes: ["color"],
      layerTypes: ["text"],
    },
    {
      target: "shape.fill.color",
      label: "Shape fill",
      variableTypes: ["color"],
      layerTypes: ["shape"],
    },
    {
      target: "shape.stroke.color",
      label: "Shape stroke",
      variableTypes: ["color"],
      layerTypes: ["shape"],
    },
    {
      target: "shape.width",
      label: "Shape width",
      variableTypes: ["number"],
      layerTypes: ["shape"],
    },
    {
      target: "shape.height",
      label: "Shape height",
      variableTypes: ["number"],
      layerTypes: ["shape"],
    },
    {
      target: "image.assetId",
      label: "Image source",
      variableTypes: ["media"],
      layerTypes: ["image"],
    },
  ];

const uid = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function getMotionVariableBindingTargetDefinition(
  target: MotionVariableBindingTarget,
): MotionVariableBindingTargetDefinition | undefined {
  return MOTION_VARIABLE_BINDING_TARGETS.find(
    (definition) => definition.target === target,
  );
}

export function getCompatibleMotionVariableBindingTargets(
  layer: MotionLayer,
  variable: MotionVariable,
): MotionVariableBindingTargetDefinition[] {
  return MOTION_VARIABLE_BINDING_TARGETS.filter(
    (definition) =>
      definition.layerTypes.includes(layer.type) &&
      definition.variableTypes.includes(variable.type),
  );
}

export function addMotionLayerVariableBinding<T extends MotionLayer>(
  layer: T,
  variable: MotionVariable,
  target: MotionVariableBindingTarget,
  id = uid("motion-binding"),
): T {
  if (!isMotionVariableBindingCompatible(layer, variable, target)) {
    throw new Error(
      `Cannot bind ${variable.type} variable to ${layer.type}.${target}`,
    );
  }

  return {
    ...layer,
    variableBindings: [
      ...(layer.variableBindings ?? []).filter(
        (binding) => binding.target !== target,
      ),
      { id, variableId: variable.id, target },
    ],
  } as T;
}

export function removeMotionLayerVariableBinding<T extends MotionLayer>(
  layer: T,
  bindingId: string,
): T {
  return {
    ...layer,
    variableBindings: (layer.variableBindings ?? []).filter(
      (binding) => binding.id !== bindingId,
    ),
  } as T;
}

export function resolveMotionLayerVariableBindings<T extends MotionLayer>(
  composition: MotionComposition,
  layer: T,
  overrides: MotionVariableOverrideMap = {},
): T {
  if (!layer.variableBindings?.length) return layer;

  const variables = new Map(
    composition.variables.map((variable) => [
      variable.id,
      {
        ...variable,
        value: Object.prototype.hasOwnProperty.call(overrides, variable.id)
          ? overrides[variable.id]
          : variable.value,
      } satisfies MotionVariable,
    ]),
  );

  return layer.variableBindings.reduce<T>((currentLayer, binding) => {
    const variable = variables.get(binding.variableId);
    if (
      !variable ||
      !isMotionVariableBindingCompatible(currentLayer, variable, binding.target)
    ) {
      return currentLayer;
    }
    return applyMotionVariableBinding(currentLayer, variable, binding);
  }, layer);
}

export function isMotionVariableBindingCompatible(
  layer: MotionLayer,
  variable: MotionVariable,
  target: MotionVariableBindingTarget,
): boolean {
  const definition = getMotionVariableBindingTargetDefinition(target);
  return Boolean(
    definition &&
      definition.layerTypes.includes(layer.type) &&
      definition.variableTypes.includes(variable.type),
  );
}

function applyMotionVariableBinding<T extends MotionLayer>(
  layer: T,
  variable: MotionVariable,
  binding: MotionVariableBinding,
): T {
  switch (binding.target) {
    case "layer.visible":
      return { ...layer, visible: Boolean(variable.value) } as T;
    case "transform.opacity":
      return {
        ...layer,
        transform: {
          ...layer.transform,
          opacity:
            variable.type === "boolean"
              ? Number(variable.value)
              : clampNumber(variable.value, 0, 1),
        },
      } as T;
    case "text.content":
      return layer.type === "text"
        ? ({ ...layer, text: String(variable.value) } as T)
        : layer;
    case "text.color":
      return layer.type === "text"
        ? ({
            ...layer,
            style: { ...layer.style, color: String(variable.value) },
          } as T)
        : layer;
    case "shape.fill.color":
      return layer.type === "shape"
        ? ({
            ...layer,
            style: {
              ...layer.style,
              fill: {
                ...layer.style.fill,
                type: "solid",
                color: String(variable.value),
              },
            },
          } as T)
        : layer;
    case "shape.stroke.color":
      return layer.type === "shape"
        ? ({
            ...layer,
            style: {
              ...layer.style,
              stroke: {
                ...layer.style.stroke,
                color: String(variable.value),
              },
            },
          } as T)
        : layer;
    case "shape.width":
      return layer.type === "shape"
        ? ({ ...layer, width: Math.max(1, Number(variable.value) || 1) } as T)
        : layer;
    case "shape.height":
      return layer.type === "shape"
        ? ({ ...layer, height: Math.max(1, Number(variable.value) || 1) } as T)
        : layer;
    case "image.assetId":
      return layer.type === "image"
        ? ({ ...layer, assetId: String(variable.value) } as T)
        : layer;
  }
}

function clampNumber(
  value: MotionVariable["value"],
  min: number,
  max: number,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}
