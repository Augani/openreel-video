import type { z } from "zod";
import type { GraphEdge, GraphNode } from "@openreel/fxpkg";
import type { IconName } from "../../icons";
import type { AtomicKind, Subject, SubjectKind } from "../scene";
import { ALL_ATOMICS } from "./atomics";
import { ALL_PRESETS } from "./presets";

export type DetectorRequirement = "subject_mask" | "face_landmarks";

export interface DetectionInput {
  node: string;
  port: string;
  require: DetectorRequirement;
}

export interface GraphFragment {
  nodes: GraphNode[];
  edges: GraphEdge[];
  inputPorts: Array<{ node: string; port: string }>;
  outputPort: { node: string; port: string };
  detectionInputs?: DetectionInput[];
}

export interface EmitCtx {
  uniqueId(prefix: string): string;
  paramRef(paramId: string): string;
}

export interface BehaviorDef<P = unknown> {
  id: string;
  kind: "preset" | "atomic";
  atomicKind?: AtomicKind;
  label: string;
  iconName: IconName;
  acceptsSubjects: SubjectKind[];
  paramSchema: z.ZodType<P>;
  defaultParams: P;
  thumbnailUrl: string;
  emit(ctx: EmitCtx, subject: Subject, params: P): GraphFragment;
}

const REGISTRY = new Map<string, BehaviorDef>();

export function defineBehavior<P>(def: BehaviorDef<P>): BehaviorDef<P> {
  return def;
}

export function register<P>(def: BehaviorDef<P>): void {
  REGISTRY.set(def.id, def as BehaviorDef);
}

export function getBehavior(id: string): BehaviorDef | undefined {
  return REGISTRY.get(id);
}

export function listBehaviors(): BehaviorDef[] {
  return [...REGISTRY.values()];
}

export function listBehaviorsForSubject(kind: SubjectKind): BehaviorDef[] {
  return [...REGISTRY.values()].filter((b) => b.acceptsSubjects.includes(kind));
}

let registered = false;

export function registerAllBehaviors(): void {
  if (registered) return;
  registered = true;
  for (const def of [...ALL_ATOMICS, ...ALL_PRESETS]) register(def);
}
