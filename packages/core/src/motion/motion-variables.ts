import type { MotionComposition, MotionVariable } from "./types";

export type MotionVariableType = MotionVariable["type"];

export interface CreateMotionVariableOptions {
  readonly id?: string;
  readonly name?: string;
  readonly value?: MotionVariable["value"];
}

const uid = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function createMotionVariable(
  type: MotionVariableType,
  options: CreateMotionVariableOptions = {},
): MotionVariable {
  return sanitizeMotionVariable({
    id: options.id ?? uid("motion-var"),
    name: options.name ?? defaultVariableName(type),
    type,
    value: options.value ?? defaultVariableValue(type),
  });
}

export function sanitizeMotionVariable(variable: MotionVariable): MotionVariable {
  return {
    ...variable,
    name: variable.name.trim() || defaultVariableName(variable.type),
    value: coerceMotionVariableValue(variable.type, variable.value),
  };
}

export function updateMotionCompositionVariable(
  composition: MotionComposition,
  variableId: string,
  updater: (variable: MotionVariable) => MotionVariable,
): MotionComposition {
  return {
    ...composition,
    variables: composition.variables.map((variable) =>
      variable.id === variableId
        ? sanitizeMotionVariable(updater(variable))
        : variable,
    ),
    modifiedAt: Date.now(),
  };
}

export function removeMotionCompositionVariable(
  composition: MotionComposition,
  variableId: string,
): MotionComposition {
  return {
    ...composition,
    variables: composition.variables.filter((variable) => variable.id !== variableId),
    modifiedAt: Date.now(),
  };
}

export function coerceMotionVariableValue(
  type: MotionVariableType,
  value: MotionVariable["value"],
): MotionVariable["value"] {
  switch (type) {
    case "number": {
      const numeric = typeof value === "number" ? value : Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    }
    case "boolean":
      return typeof value === "boolean" ? value : value === "true";
    case "color":
      return typeof value === "string" && value.trim() ? value.trim() : "#14b8a6";
    case "media":
    case "text":
      return String(value);
  }
}

function defaultVariableName(type: MotionVariableType): string {
  switch (type) {
    case "text":
      return "Text";
    case "number":
      return "Number";
    case "color":
      return "Color";
    case "boolean":
      return "Toggle";
    case "media":
      return "Media";
  }
}

function defaultVariableValue(type: MotionVariableType): MotionVariable["value"] {
  switch (type) {
    case "text":
    case "media":
      return "";
    case "number":
      return 0;
    case "color":
      return "#14b8a6";
    case "boolean":
      return false;
  }
}
