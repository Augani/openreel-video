import type { Action, ValidationResult } from "../../types/actions";
import type { Project } from "../../types/project";
import {
  applyCreationOperation,
  createEmptyCreationState,
  normalizeCreationState,
  validateCreationState,
  type CreationOperation,
  type CreationProjectState,
} from "../../creation";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function err(message: string): ValidationResult {
  return { valid: false, errors: [{ code: "INVALID_PARAMS", message }] };
}

function assignProject(project: Project, nextProject: Project): void {
  Object.assign(project as unknown as Record<string, unknown>, nextProject);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function operationFrom(action: Action): CreationOperation | undefined {
  const operation = action.params.operation;
  if (!isRecord(operation)) return undefined;
  if (typeof operation.id !== "string" || typeof operation.type !== "string") {
    return undefined;
  }
  if (typeof operation.timestamp !== "number" || !Number.isFinite(operation.timestamp)) {
    return undefined;
  }
  if (
    operation.source !== "agent" &&
    operation.source !== "user" &&
    operation.source !== "system"
  ) {
    return undefined;
  }
  return operation as unknown as CreationOperation;
}

function stateFrom(action: Action): CreationProjectState | undefined {
  if (action.params.state === null || action.params.state === undefined) {
    return undefined;
  }
  return normalizeCreationState(action.params.state as Partial<CreationProjectState>);
}

function creationValidationResult(state: CreationProjectState | undefined): ValidationResult {
  if (!state) return ok();
  const errors = validateCreationState(state).filter((issue) => issue.severity === "error");
  return errors.length === 0
    ? ok()
    : {
        valid: false,
        errors: errors.map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path,
        })),
      };
}

function applyCreationState(project: Project, state: CreationProjectState | undefined): void {
  assignProject(project, {
    ...project,
    creation: state,
    modifiedAt: Date.now(),
  });
}

const replaceState: ActionHandler = {
  type: "creation/replaceState",
  validate(action: Action): ValidationResult {
    return creationValidationResult(stateFrom(action));
  },
  apply(action: Action, project: Project): void {
    applyCreationState(project, stateFrom(action));
  },
  invert(action: Action, projectBefore: Project): Action | null {
    return {
      type: "creation/replaceState",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { state: projectBefore.creation ?? null },
    };
  },
};

const applyOperation: ActionHandler = {
  type: "creation/applyOperation",
  validate(action: Action, project: Project): ValidationResult {
    const operation = operationFrom(action);
    if (!operation) {
      return err("creation/applyOperation requires a valid operation");
    }
    try {
      const current = normalizeCreationState(project.creation) ?? createEmptyCreationState();
      const next = applyCreationOperation(current, operation);
      return creationValidationResult(next);
    } catch (error) {
      return err(error instanceof Error ? error.message : "Invalid creation operation");
    }
  },
  apply(action: Action, project: Project): void {
    const operation = operationFrom(action);
    if (!operation) throw new Error("creation/applyOperation requires a valid operation");
    const current = normalizeCreationState(project.creation) ?? createEmptyCreationState();
    applyCreationState(project, applyCreationOperation(current, operation));
  },
  invert(action: Action, projectBefore: Project): Action | null {
    return {
      type: "creation/replaceState",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { state: projectBefore.creation ?? null },
    };
  },
};

registerActionHandler(replaceState);
registerActionHandler(applyOperation);
