import { evaluateKeyframesAt } from "../animation/evaluate-keyframes";
import {
  getMotionEffectKeyframeProperty,
  getMotionEffectParameterDescriptor,
  getMotionEffectParameterValue,
  type MotionEffectParameterName,
} from "./motion-effects";
import type { Keyframe } from "../types/timeline";
import type {
  MotionComposition,
  MotionEffect,
  MotionExpression,
  MotionExpressionType,
  MotionLayer,
} from "./types";

export interface MotionExpressionContext {
  readonly composition: MotionComposition;
  readonly layer: MotionLayer;
}

let motionExpressionBaseValueResolver:
  | ((layer: MotionLayer, property: string) => number)
  | null = null;

export function registerMotionExpressionBaseValueResolver(
  resolver: (layer: MotionLayer, property: string) => number,
): void {
  motionExpressionBaseValueResolver = resolver;
}

function resolveMotionPropertyBaseValue(
  layer: MotionLayer,
  property: string,
): number {
  return motionExpressionBaseValueResolver?.(layer, property) ?? 0;
}

interface MotionExpressionGuardState {
  readonly visited: Set<string>;
  depth: number;
  readonly memo: Map<string, number>;
  readonly cycleFlagged: Set<string>;
  activeExpressionId: string | null;
}

function createMotionExpressionGuardState(): MotionExpressionGuardState {
  return {
    visited: new Set<string>(),
    depth: 0,
    memo: new Map<string, number>(),
    cycleFlagged: new Set<string>(),
    activeExpressionId: null,
  };
}

const MOTION_EXPRESSION_MAX_DEPTH = 8;

export interface MotionExpressionPreset {
  readonly type: MotionExpressionType;
  readonly name: string;
  readonly description: string;
  readonly create: (property: string, id?: string) => MotionExpression;
}

export interface EvaluateMotionPropertyOptions {
  readonly keyframes: readonly Keyframe[];
  readonly expressions?: readonly MotionExpression[];
  readonly property: string;
  readonly localTime: number;
  readonly fallback: number;
  readonly duration: number;
  readonly context?: MotionExpressionContext;
}

const createExpressionId = (): string =>
  `motion-expr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const MOTION_EXPRESSION_PRESETS: readonly MotionExpressionPreset[] = [
  {
    type: "sine",
    name: "Sine Wave",
    description: "Oscillates around the keyed value with smooth periodic motion.",
    create: (property, id = createExpressionId()) => ({
      id,
      property,
      type: "sine",
      name: "Sine Wave",
      enabled: true,
      amplitude: 24,
      frequency: 1,
      phase: 0,
      seed: 1,
      decay: 3,
    }),
  },
  {
    type: "wiggle",
    name: "Wiggle",
    description: "Adds deterministic organic variation for handheld or lively motion.",
    create: (property, id = createExpressionId()) => ({
      id,
      property,
      type: "wiggle",
      name: "Wiggle",
      enabled: true,
      amplitude: 18,
      frequency: 2,
      phase: 0,
      seed: 7,
      decay: 3,
    }),
  },
  {
    type: "drift",
    name: "Drift",
    description: "Moves continuously over time without manual keyframes.",
    create: (property, id = createExpressionId()) => ({
      id,
      property,
      type: "drift",
      name: "Drift",
      enabled: true,
      amplitude: 30,
      frequency: 1,
      phase: 0,
      seed: 1,
      decay: 3,
    }),
  },
  {
    type: "spring",
    name: "Spring",
    description: "Adds a damped bounce around the keyed value.",
    create: (property, id = createExpressionId()) => ({
      id,
      property,
      type: "spring",
      name: "Spring",
      enabled: true,
      amplitude: 30,
      frequency: 2,
      phase: 0,
      seed: 1,
      decay: 3,
    }),
  },
  {
    type: "loop",
    name: "Loop Keyframes",
    description: "Repeats this property's keyframed motion after the final key.",
    create: (property, id = createExpressionId()) => ({
      id,
      property,
      type: "loop",
      name: "Loop Keyframes",
      enabled: true,
      amplitude: 0,
      frequency: 1,
      phase: 0,
      seed: 1,
      decay: 3,
    }),
  },
  {
    type: "ping-pong",
    name: "Ping-Pong Keyframes",
    description: "Repeats keyframes forward and backward for seamless oscillation.",
    create: (property, id = createExpressionId()) => ({
      id,
      property,
      type: "ping-pong",
      name: "Ping-Pong Keyframes",
      enabled: true,
      amplitude: 0,
      frequency: 1,
      phase: 0,
      seed: 1,
      decay: 3,
    }),
  },
  {
    type: "random",
    name: "Random Jitter",
    description: "Adds deterministic stepped random offsets for punchy movement.",
    create: (property, id = createExpressionId()) => ({
      id,
      property,
      type: "random",
      name: "Random Jitter",
      enabled: true,
      amplitude: 18,
      frequency: 8,
      phase: 0,
      seed: 13,
      decay: 3,
    }),
  },
  {
    type: "posterize",
    name: "Posterize Time",
    description: "Samples this property at a lower rate for stop-motion timing.",
    create: (property, id = createExpressionId()) => ({
      id,
      property,
      type: "posterize",
      name: "Posterize Time",
      enabled: true,
      amplitude: 0,
      frequency: 12,
      phase: 0,
      seed: 1,
      decay: 3,
    }),
  },
  {
    type: "expression",
    name: "Expression",
    description:
      "Write a JavaScript expression. Available: value, time, wiggle(freq, amp), loopOut(), linear(), ease(), clamp(), random(), Math.",
    create: (property, id = createExpressionId()) => ({
      id,
      property,
      type: "expression",
      name: "Expression",
      enabled: true,
      amplitude: 0,
      frequency: 1,
      phase: 0,
      seed: 1,
      decay: 3,
      code: "value + wiggle(2, 20)",
    }),
  },
];

export function createMotionExpression(
  type: MotionExpressionType,
  property: string,
  id?: string,
): MotionExpression {
  const preset = MOTION_EXPRESSION_PRESETS.find((item) => item.type === type);
  if (!preset) {
    throw new Error(`Unsupported motion expression type: ${type}`);
  }
  return preset.create(property, id);
}

export function addMotionLayerExpression<T extends MotionLayer>(
  layer: T,
  expression: MotionExpression,
): T {
  const expressions = (layer.expressions ?? []).filter(
    (candidate) => candidate.property !== expression.property,
  );
  return {
    ...layer,
    expressions: [...expressions, sanitizeMotionExpression(expression)],
  } as T;
}

export function updateMotionLayerExpression<T extends MotionLayer>(
  layer: T,
  expressionId: string,
  updater: (expression: MotionExpression) => MotionExpression,
): T {
  return {
    ...layer,
    expressions: (layer.expressions ?? []).map((expression) =>
      expression.id === expressionId
        ? sanitizeMotionExpression(updater(expression))
        : expression,
    ),
  } as T;
}

export function removeMotionLayerExpression<T extends MotionLayer>(
  layer: T,
  expressionId: string,
): T {
  clearMotionExpressionError(expressionId);
  return {
    ...layer,
    expressions: (layer.expressions ?? []).filter(
      (expression) => expression.id !== expressionId,
    ),
  } as T;
}

export function toggleMotionLayerExpression<T extends MotionLayer>(
  layer: T,
  expressionId: string,
  enabled: boolean,
): T {
  if (!enabled) {
    clearMotionExpressionError(expressionId);
  }
  return updateMotionLayerExpression(layer, expressionId, (expression) => ({
    ...expression,
    enabled,
  }));
}

export function getMotionLayerExpression(
  layer: MotionLayer,
  property: string,
): MotionExpression | undefined {
  return (layer.expressions ?? []).find(
    (expression) => expression.property === property,
  );
}

export function evaluateMotionPropertyValueAtTime(
  options: EvaluateMotionPropertyOptions,
): number {
  return evaluateMotionPropertyWithGuard(options, null);
}

function evaluateMotionPropertyWithGuard(
  {
    keyframes,
    expressions,
    property,
    localTime,
    fallback,
    duration,
    context,
  }: EvaluateMotionPropertyOptions,
  guard: MotionExpressionGuardState | null,
): number {
  const propertyKeyframes = keyframes.filter(
    (keyframe) => keyframe.property === property,
  );
  const time = Math.max(0, localTime);
  const baseValue = evaluatePropertyKeyframesAt(propertyKeyframes, time, fallback);
  const expression = expressions?.find(
    (candidate) => candidate.enabled && candidate.property === property,
  );
  if (!expression) return baseValue;
  const result = evaluateMotionExpression(
    sanitizeMotionExpression(expression),
    propertyKeyframes,
    time,
    baseValue,
    fallback,
    Math.max(0.001, duration),
    context,
    guard ?? createMotionExpressionGuardState(),
  );
  return Number.isFinite(result) ? result : fallback;
}

function evaluateMotionExpression(
  expression: MotionExpression,
  propertyKeyframes: readonly Keyframe[],
  localTime: number,
  baseValue: number,
  fallback: number,
  duration: number,
  context: MotionExpressionContext | undefined,
  guard: MotionExpressionGuardState,
): number {
  const phaseRadians = (expression.phase * Math.PI) / 180;
  const frequency = Math.max(0, expression.frequency);

  switch (expression.type) {
    case "sine":
      return (
        baseValue +
        expression.amplitude *
          Math.sin(Math.PI * 2 * frequency * localTime + phaseRadians)
      );
    case "wiggle":
      return baseValue + expression.amplitude * smoothNoise(
        localTime * Math.max(0.001, frequency),
        expression.seed,
      );
    case "drift":
      return baseValue + expression.amplitude * frequency * localTime;
    case "spring":
      return (
        baseValue +
        expression.amplitude *
          Math.exp(-Math.max(0, expression.decay) * localTime) *
          Math.sin(Math.PI * 2 * frequency * localTime + phaseRadians)
      );
    case "loop":
      return evaluateLoopExpression(
        propertyKeyframes,
        localTime,
        fallback,
        duration,
      );
    case "ping-pong":
      return evaluatePingPongExpression(
        propertyKeyframes,
        localTime,
        fallback,
        duration,
      );
    case "random":
      return baseValue + expression.amplitude * hashNoise(
        Math.floor(localTime * Math.max(0.001, frequency) + expression.phase / 360),
        expression.seed,
      );
    case "posterize":
      return evaluatePosterizeExpression(
        propertyKeyframes,
        localTime,
        fallback,
        Math.max(0.001, frequency),
      );
    case "expression":
      return evaluateCodeExpression(
        expression,
        propertyKeyframes,
        localTime,
        baseValue,
        fallback,
        duration,
        context,
        guard,
      );
  }
}

export const MOTION_EXPRESSION_SCOPE_KEYS = [
  "value",
  "time",
  "wiggle",
  "loopOut",
  "linear",
  "ease",
  "clamp",
  "random",
  "Math",
  "valueAtTime",
  "thisLayer",
  "key",
  "numKeys",
  "nearestKey",
  "thisComp",
  "layer",
  "effect",
] as const;

type MotionExpressionScopeKey = (typeof MOTION_EXPRESSION_SCOPE_KEYS)[number];

interface MotionLayerHandle {
  readonly index: number;
  readonly name: string;
  readonly value: (propertyId: string) => number;
  readonly valueAtTime: (propertyId: string, atTime: number) => number;
}

interface MotionKeyframeHandle {
  readonly index: number;
  readonly time: number;
  readonly value: number;
}

interface MotionCompHandle {
  readonly numLayers: number;
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly layer: (nameOrIndex: string | number) => MotionLayerHandle;
}

type MotionExpressionScope = {
  readonly value: number;
  readonly time: number;
  readonly wiggle: (freq: number, amp: number) => number;
  readonly loopOut: (type?: string) => number;
  readonly linear: (...args: number[]) => number;
  readonly ease: (...args: number[]) => number;
  readonly clamp: (value: number, low: number, high: number) => number;
  readonly random: (low?: number, high?: number) => number;
  readonly Math: typeof Math;
  readonly valueAtTime: (atTime: number) => number;
  readonly thisLayer: MotionLayerHandle;
  readonly key: (index: number) => MotionKeyframeHandle;
  readonly numKeys: number;
  readonly nearestKey: (atTime: number) => MotionKeyframeHandle;
  readonly thisComp: MotionCompHandle;
  readonly layer: (nameOrIndex: string | number) => MotionLayerHandle;
  readonly effect: (name: string) => (paramName: string) => number;
};

type CompiledMotionExpression = (scope: MotionExpressionScope) => unknown;

const compiledExpressionCache = new Map<string, CompiledMotionExpression | null>();

const compileErrorCache = new Map<string, string>();

const motionExpressionErrors = new Map<string, string>();

export function getMotionExpressionError(expressionId: string): string | null {
  return motionExpressionErrors.get(expressionId) ?? null;
}

function recordMotionExpressionError(expressionId: string, message: string): void {
  motionExpressionErrors.set(expressionId, message);
}

export function clearMotionExpressionError(expressionId: string): void {
  motionExpressionErrors.delete(expressionId);
}

function buildScopeArgs(scope: MotionExpressionScope): readonly unknown[] {
  return MOTION_EXPRESSION_SCOPE_KEYS.map(
    (key: MotionExpressionScopeKey) => scope[key],
  );
}

interface CompiledMotionExpressionBody {
  readonly compiled: CompiledMotionExpression | null;
  readonly syntaxError: SyntaxError | null;
}

function compileMotionExpressionBody(body: string): CompiledMotionExpressionBody {
  try {
    const evaluator = new Function(
      ...MOTION_EXPRESSION_SCOPE_KEYS,
      body,
    ) as (...args: unknown[]) => unknown;
    return {
      compiled: (scope) => evaluator(...buildScopeArgs(scope)),
      syntaxError: null,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { compiled: null, syntaxError: error };
    }
    throw error;
  }
}

function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? message;
}

function compileMotionExpression(code: string): CompiledMotionExpression | null {
  if (compiledExpressionCache.has(code)) {
    return compiledExpressionCache.get(code) ?? null;
  }
  const returnForm = compileMotionExpressionBody(`"use strict"; return (${code});`);
  let compiled = returnForm.compiled;
  if (!compiled) {
    const bodyForm = compileMotionExpressionBody(`"use strict"; ${code}`);
    compiled = bodyForm.compiled;
    if (!compiled) {
      const message = firstLine(
        returnForm.syntaxError?.message ??
          bodyForm.syntaxError?.message ??
          "unknown syntax error",
      );
      compileErrorCache.set(code, message);
    }
  }
  if (compiled) {
    compileErrorCache.delete(code);
  }
  compiledExpressionCache.set(code, compiled);
  return compiled;
}

function getMotionExpressionCompileError(code: string): string | null {
  return compileErrorCache.get(code) ?? null;
}

function expressionLinear(args: readonly number[], eased: boolean): number {
  let t: number;
  let tMin: number;
  let tMax: number;
  let v1: number;
  let v2: number;
  if (args.length >= 5) {
    [t, tMin, tMax, v1, v2] = args;
  } else if (args.length === 3) {
    [t, v1, v2] = args;
    tMin = 0;
    tMax = 1;
  } else {
    return finite(args[0] ?? 0, 0);
  }
  const span = tMax - tMin;
  if (span === 0) return v1;
  let progress = clamp((t - tMin) / span, 0, 1);
  if (eased) progress = progress * progress * (3 - 2 * progress);
  return v1 + (v2 - v1) * progress;
}

function requireExpressionContext(
  context: MotionExpressionContext | undefined,
  globalName: string,
): MotionExpressionContext {
  if (!context) {
    throw new Error(`${globalName} requires composition context`);
  }
  return context;
}

function throwMissingContext(): never {
  throw new Error("This expression global requires composition context");
}

function createMissingLayerHandle(): MotionLayerHandle {
  return {
    get index(): number {
      return throwMissingContext();
    },
    get name(): string {
      return throwMissingContext();
    },
    value: () => throwMissingContext(),
    valueAtTime: () => throwMissingContext(),
  };
}

function createMissingCompHandle(): MotionCompHandle {
  return {
    get numLayers(): number {
      return throwMissingContext();
    },
    get duration(): number {
      return throwMissingContext();
    },
    get width(): number {
      return throwMissingContext();
    },
    get height(): number {
      return throwMissingContext();
    },
    get frameRate(): number {
      return throwMissingContext();
    },
    layer: () => throwMissingContext(),
  };
}

function getSortedPropertyKeyframes(
  keyframes: readonly Keyframe[],
): readonly Keyframe[] {
  return [...keyframes].sort((left, right) => left.time - right.time);
}

function keyframeNumericValue(keyframe: Keyframe, fallback: number): number {
  return typeof keyframe.value === "number" && Number.isFinite(keyframe.value)
    ? keyframe.value
    : fallback;
}

function buildKeyframeHandle(
  sorted: readonly Keyframe[],
  index: number,
  fallback: number,
): MotionKeyframeHandle {
  if (!Number.isInteger(index) || index < 1 || index > sorted.length) {
    throw new Error(
      `key(${index}): property has only ${sorted.length} keyframes`,
    );
  }
  const keyframe = sorted[index - 1];
  return {
    index,
    time: keyframe.time,
    value: keyframeNumericValue(keyframe, fallback),
  };
}

function findNearestKeyframe(
  sorted: readonly Keyframe[],
  atTime: number,
  fallback: number,
): MotionKeyframeHandle {
  if (sorted.length === 0) {
    throw new Error("nearestKey(t): property has no keyframes");
  }
  let bestIndex = 0;
  let bestDistance = Math.abs(sorted[0].time - atTime);
  for (let index = 1; index < sorted.length; index += 1) {
    const distance = Math.abs(sorted[index].time - atTime);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return {
    index: bestIndex + 1,
    time: sorted[bestIndex].time,
    value: keyframeNumericValue(sorted[bestIndex], fallback),
  };
}

function buildOwnLayerHandle(
  context: MotionExpressionContext,
  currentTime: number,
): MotionLayerHandle {
  const { composition, layer } = context;
  const index = composition.layers.findIndex(
    (candidate) => candidate.id === layer.id,
  );
  return {
    index: index >= 0 ? index + 1 : 1,
    name: layer.name,
    value: (propertyId) =>
      evaluateOwnLayerPreExpression(layer, propertyId, currentTime),
    valueAtTime: (propertyId, atTime) =>
      evaluateOwnLayerPreExpression(layer, propertyId, finite(atTime, 0)),
  };
}

function evaluateOwnLayerPreExpression(
  layer: MotionLayer,
  propertyId: string,
  atTime: number,
): number {
  if (typeof propertyId !== "string" || propertyId.length === 0) {
    throw new Error("value(property): property must be a non-empty string");
  }
  const propertyKeyframes = layer.keyframes.filter(
    (keyframe) => keyframe.property === propertyId,
  );
  return evaluatePropertyKeyframesAt(
    propertyKeyframes,
    Math.max(0, atTime),
    resolveMotionPropertyBaseValue(layer, propertyId),
  );
}

function resolveCompositionLayer(
  composition: MotionComposition,
  nameOrIndex: string | number,
): MotionLayer {
  if (typeof nameOrIndex === "number") {
    if (!Number.isInteger(nameOrIndex) || nameOrIndex < 1) {
      throw new Error(`layer(${nameOrIndex}): index must be a 1-based integer`);
    }
    const found = composition.layers[nameOrIndex - 1];
    if (!found) {
      throw new Error(
        `layer(${nameOrIndex}): composition has only ${composition.layers.length} layers`,
      );
    }
    return found;
  }
  const found = composition.layers.find(
    (candidate) => candidate.name === nameOrIndex,
  );
  if (!found) {
    throw new Error(`layer("${nameOrIndex}"): no layer named "${nameOrIndex}"`);
  }
  return found;
}

function evaluateCrossLayerProperty(
  composition: MotionComposition,
  target: MotionLayer,
  propertyId: string,
  atTime: number,
  guard: MotionExpressionGuardState,
): number {
  if (typeof propertyId !== "string" || propertyId.length === 0) {
    throw new Error("value(property): property must be a non-empty string");
  }
  const time = Math.max(0, finite(atTime, 0));
  const visitKey = `${target.id}:${propertyId}`;
  const memoKey = `${visitKey}@${time}`;
  const memoized = guard.memo.get(memoKey);
  if (memoized !== undefined) return memoized;

  if (guard.visited.has(visitKey) || guard.depth >= MOTION_EXPRESSION_MAX_DEPTH) {
    if (guard.activeExpressionId) {
      guard.cycleFlagged.add(guard.activeExpressionId);
      recordMotionExpressionError(
        guard.activeExpressionId,
        `cycle detected while resolving ${visitKey}`,
      );
    }
    return evaluateOwnLayerPreExpression(target, propertyId, time);
  }

  guard.visited.add(visitKey);
  guard.depth += 1;
  const previousActive = guard.activeExpressionId;
  try {
    const result = evaluateMotionPropertyWithGuard(
      {
        keyframes: target.keyframes,
        expressions: target.expressions,
        property: propertyId,
        localTime: time,
        fallback: resolveMotionPropertyBaseValue(target, propertyId),
        duration: Math.max(0.001, composition.duration),
        context: { composition, layer: target },
      },
      guard,
    );
    guard.memo.set(memoKey, result);
    return result;
  } finally {
    guard.visited.delete(visitKey);
    guard.depth -= 1;
    guard.activeExpressionId = previousActive;
  }
}

function buildCrossLayerHandle(
  context: MotionExpressionContext,
  nameOrIndex: string | number,
  currentTime: number,
  guard: MotionExpressionGuardState,
): MotionLayerHandle {
  const target = resolveCompositionLayer(context.composition, nameOrIndex);
  const index = context.composition.layers.findIndex(
    (candidate) => candidate.id === target.id,
  );
  return {
    index: index >= 0 ? index + 1 : 1,
    name: target.name,
    value: (propertyId) =>
      evaluateCrossLayerProperty(
        context.composition,
        target,
        propertyId,
        currentTime,
        guard,
      ),
    valueAtTime: (propertyId, atTime) =>
      evaluateCrossLayerProperty(
        context.composition,
        target,
        propertyId,
        finite(atTime, 0),
        guard,
      ),
  };
}

function buildCompHandle(
  context: MotionExpressionContext,
  currentTime: number,
  guard: MotionExpressionGuardState,
): MotionCompHandle {
  const { composition } = context;
  return {
    numLayers: composition.layers.length,
    duration: composition.duration,
    width: composition.width,
    height: composition.height,
    frameRate: composition.frameRate,
    layer: (nameOrIndex) =>
      buildCrossLayerHandle(context, nameOrIndex, currentTime, guard),
  };
}

function evaluateGuardedEffectParameter(
  context: MotionExpressionContext,
  effect: MotionEffect,
  param: MotionEffectParameterName,
  localTime: number,
  guard: MotionExpressionGuardState,
): number {
  const { composition, layer } = context;
  const time = Math.max(0, finite(localTime, 0));
  const property = getMotionEffectKeyframeProperty(effect.id, param);
  const preExpressionValue = getMotionEffectParameterValue(effect, param);
  const visitKey = `${layer.id}:${property}`;
  const memoKey = `${visitKey}@${time}`;
  const memoized = guard.memo.get(memoKey);
  if (memoized !== undefined) return memoized;

  if (guard.visited.has(visitKey) || guard.depth >= MOTION_EXPRESSION_MAX_DEPTH) {
    if (guard.activeExpressionId) {
      guard.cycleFlagged.add(guard.activeExpressionId);
      recordMotionExpressionError(
        guard.activeExpressionId,
        `cycle detected while resolving ${visitKey}`,
      );
    }
    return preExpressionValue;
  }

  guard.visited.add(visitKey);
  guard.depth += 1;
  const previousActive = guard.activeExpressionId;
  try {
    const evaluated = evaluateMotionPropertyWithGuard(
      {
        keyframes: layer.keyframes,
        expressions: layer.expressions,
        property,
        localTime: time,
        fallback: preExpressionValue,
        duration: Math.max(0.001, composition.duration),
        context: { composition, layer },
      },
      guard,
    );
    const result =
      effect.type === "checkbox-control"
        ? evaluated >= 0.5
          ? 1
          : 0
        : evaluated;
    guard.memo.set(memoKey, result);
    return result;
  } finally {
    guard.visited.delete(visitKey);
    guard.depth -= 1;
    guard.activeExpressionId = previousActive;
  }
}

function buildEffectAccessor(
  context: MotionExpressionContext,
  localTime: number,
  name: string,
  guard: MotionExpressionGuardState,
): (paramName: string) => number {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("effect(name): name must be a non-empty string");
  }
  const { layer } = context;
  const effect = (layer.effects ?? []).find(
    (candidate) => candidate.enabled && candidate.name === name,
  );
  if (!effect) {
    throw new Error(`effect("${name}"): no enabled effect named "${name}"`);
  }
  return (paramName) => {
    if (typeof paramName !== "string" || paramName.length === 0) {
      throw new Error("effect(name)(param): param must be a non-empty string");
    }
    if (!getMotionEffectParameterDescriptor(effect, paramName)) {
      throw new Error(
        `effect("${name}")("${paramName}"): unknown parameter "${paramName}"`,
      );
    }
    return evaluateGuardedEffectParameter(
      context,
      effect,
      paramName,
      localTime,
      guard,
    );
  };
}

function evaluateCodeExpression(
  expression: MotionExpression,
  propertyKeyframes: readonly Keyframe[],
  localTime: number,
  baseValue: number,
  fallback: number,
  duration: number,
  context: MotionExpressionContext | undefined,
  guard: MotionExpressionGuardState,
): number {
  const code = expression.code;
  if (typeof code !== "string" || code.trim().length === 0) {
    return baseValue;
  }
  const compiled = compileMotionExpression(code);
  if (!compiled) {
    recordMotionExpressionError(
      expression.id,
      `Expression failed to compile: ${
        getMotionExpressionCompileError(code) ?? "unknown syntax error"
      }`,
    );
    return baseValue;
  }

  const sortedKeyframes = getSortedPropertyKeyframes(propertyKeyframes);
  const previousActiveExpressionId = guard.activeExpressionId;
  guard.activeExpressionId = expression.id;

  const scope: MotionExpressionScope = {
    value: baseValue,
    time: localTime,
    Math,
    wiggle: (freq, amp) =>
      baseValue +
      finite(amp, 0) *
        smoothNoise(localTime * Math.max(0.001, finite(freq, 0)), expression.seed),
    loopOut: (type) =>
      type === "pingpong"
        ? evaluatePingPongExpression(propertyKeyframes, localTime, fallback, duration)
        : evaluateLoopExpression(propertyKeyframes, localTime, fallback, duration),
    linear: (...args) => expressionLinear(args, false),
    ease: (...args) => expressionLinear(args, true),
    clamp: (value, low, high) => clamp(value, low, high),
    random: (low = 0, high = 1) => {
      const noise = (hashNoise(Math.floor(localTime * 30), expression.seed) + 1) / 2;
      return low + (high - low) * noise;
    },
    valueAtTime: (atTime) => {
      requireExpressionContext(context, "valueAtTime(t)");
      return evaluatePropertyKeyframesAt(
        propertyKeyframes,
        Math.max(0, finite(atTime, 0)),
        fallback,
      );
    },
    thisLayer: context
      ? buildOwnLayerHandle(context, localTime)
      : createMissingLayerHandle(),
    key: (index) => {
      requireExpressionContext(context, "key(n)");
      return buildKeyframeHandle(sortedKeyframes, index, fallback);
    },
    numKeys: sortedKeyframes.length,
    nearestKey: (atTime) => {
      requireExpressionContext(context, "nearestKey(t)");
      return findNearestKeyframe(sortedKeyframes, finite(atTime, 0), fallback);
    },
    thisComp: context
      ? buildCompHandle(context, localTime, guard)
      : createMissingCompHandle(),
    layer: (nameOrIndex) => {
      const resolved = requireExpressionContext(context, "layer(nameOrIndex)");
      return buildCrossLayerHandle(resolved, nameOrIndex, localTime, guard);
    },
    effect: (name) => {
      const resolved = requireExpressionContext(context, "effect(name)");
      return buildEffectAccessor(resolved, localTime, name, guard);
    },
  };

  try {
    const result = compiled(scope);
    if (!guard.cycleFlagged.has(expression.id)) {
      clearMotionExpressionError(expression.id);
    }
    return typeof result === "number" && Number.isFinite(result) ? result : baseValue;
  } catch (error) {
    recordMotionExpressionError(
      expression.id,
      error instanceof Error ? String(error.message) : String(error),
    );
    return baseValue;
  } finally {
    guard.activeExpressionId = previousActiveExpressionId;
  }
}

function evaluateLoopExpression(
  propertyKeyframes: readonly Keyframe[],
  localTime: number,
  fallback: number,
  duration: number,
): number {
  const sorted = [...propertyKeyframes].sort((a, b) => a.time - b.time);
  if (sorted.length < 2) {
    return evaluatePropertyKeyframesAt(sorted, localTime, fallback);
  }

  const firstTime = sorted[0].time;
  const lastTime = sorted[sorted.length - 1].time;
  const span = Math.max(0.001, lastTime - firstTime);
  if (localTime <= lastTime) {
    return evaluatePropertyKeyframesAt(sorted, localTime, fallback);
  }

  const boundedTime = Math.min(duration, localTime);
  const wrappedTime = firstTime + ((boundedTime - firstTime) % span);
  return evaluatePropertyKeyframesAt(sorted, wrappedTime, fallback);
}

function evaluatePingPongExpression(
  propertyKeyframes: readonly Keyframe[],
  localTime: number,
  fallback: number,
  duration: number,
): number {
  const sorted = [...propertyKeyframes].sort((a, b) => a.time - b.time);
  if (sorted.length < 2) {
    return evaluatePropertyKeyframesAt(sorted, localTime, fallback);
  }

  const firstTime = sorted[0].time;
  const lastTime = sorted[sorted.length - 1].time;
  const span = Math.max(0.001, lastTime - firstTime);
  if (localTime <= lastTime) {
    return evaluatePropertyKeyframesAt(sorted, localTime, fallback);
  }

  const boundedTime = Math.min(duration, localTime);
  const cycleTime = (boundedTime - firstTime) % (span * 2);
  const wrappedTime =
    cycleTime <= span
      ? firstTime + cycleTime
      : lastTime - (cycleTime - span);
  return evaluatePropertyKeyframesAt(sorted, wrappedTime, fallback);
}

function evaluatePosterizeExpression(
  propertyKeyframes: readonly Keyframe[],
  localTime: number,
  fallback: number,
  samplesPerSecond: number,
): number {
  const sampleDuration = 1 / samplesPerSecond;
  const sampledTime = Math.floor(localTime / sampleDuration) * sampleDuration;
  return evaluatePropertyKeyframesAt(propertyKeyframes, sampledTime, fallback);
}

function evaluatePropertyKeyframesAt(
  keyframes: readonly Keyframe[],
  localTime: number,
  fallback: number,
): number {
  if (keyframes.length === 0) return fallback;
  const values = evaluateKeyframesAt(keyframes, localTime);
  const value = values.get(keyframes[0].property);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeMotionExpression(
  expression: MotionExpression,
): MotionExpression {
  return {
    ...expression,
    amplitude: finite(expression.amplitude, 0),
    frequency: clamp(expression.frequency, 0, 120),
    phase: finite(expression.phase, 0),
    seed: Math.round(clamp(expression.seed, -1_000_000, 1_000_000)),
    decay: clamp(expression.decay, 0, 120),
  };
}

function smoothNoise(value: number, seed: number): number {
  const left = Math.floor(value);
  const right = left + 1;
  const ratio = value - left;
  const smoothed = ratio * ratio * (3 - 2 * ratio);
  return lerp(hashNoise(left, seed), hashNoise(right, seed), smoothed);
}

function hashNoise(index: number, seed: number): number {
  const value = Math.sin(index * 127.1 + seed * 311.7) * 43_758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, min)));
}
