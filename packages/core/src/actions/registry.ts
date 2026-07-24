import type { Action, ValidationResult } from "../types/actions";
import type { Project } from "../types/project";

export interface ActionHandlerContext {
  readonly lastAddedIds: Map<string, string>;
}

export interface ActionHandler {
  readonly type: string;
  apply(
    action: Action,
    project: Project,
    ctx: ActionHandlerContext,
  ): void | Promise<void>;
  validate(action: Action, project: Project): ValidationResult;
  invert(action: Action, projectBefore: Project): Action | null;
}

const registry = new Map<string, ActionHandler>();

export function registerActionHandler(handler: ActionHandler): void {
  registry.set(handler.type, handler);
}

export function getActionHandler(type: string): ActionHandler | undefined {
  return registry.get(type);
}

export function listRegisteredActionTypes(): string[] {
  return Array.from(registry.keys());
}

export function createInverseAction(
  originalAction: Action,
  type: string,
  params: Record<string, unknown>,
): Action {
  return {
    type,
    id: `inverse-${originalAction.id}`,
    timestamp: Date.now(),
    params,
  };
}
