import type { Action, ValidationResult } from "../../types/actions";
import type { Project } from "../../types/project";
import { motionEngine } from "../../motion/motion-engine";
import type {
  MotionComposition,
  MotionCompositionInstance,
} from "../../motion/types";
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

function removeMotionInstance(project: Project, instanceId: string): Project {
  const nextInstances = (project.motionInstances ?? []).filter(
    (instance) => instance.id !== instanceId,
  );
  const tracks = project.timeline.tracks.map((track) => ({
    ...track,
    clips: track.clips.filter(
      (clip) => clip.metadata?.motionInstanceId !== instanceId,
    ),
  }));
  const duration = tracks.reduce(
    (max, track) =>
      track.clips.reduce(
        (trackMax, clip) => Math.max(trackMax, clip.startTime + clip.duration),
        max,
      ),
    0,
  );

  return {
    ...project,
    motionInstances: nextInstances,
    timeline: {
      ...project.timeline,
      tracks,
      duration,
    },
    modifiedAt: Date.now(),
  };
}

const createComposition: ActionHandler = {
  type: "motion/createComposition",
  validate(action: Action): ValidationResult {
    const composition = (action.params as { composition?: MotionComposition })
      .composition;
    return composition && typeof composition.id === "string"
      ? ok()
      : err("motion/createComposition requires a composition with an id");
  },
  apply(action: Action, project: Project): void {
    const composition = (action.params as { composition: MotionComposition })
      .composition;
    assignProject(project, motionEngine.upsertComposition(project, composition));
  },
  invert(action: Action): Action | null {
    const composition = (action.params as { composition: MotionComposition })
      .composition;
    return {
      type: "motion/removeComposition",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { compositionId: composition.id },
    };
  },
};

const upsertComposition: ActionHandler = {
  type: "motion/upsertComposition",
  validate(action: Action): ValidationResult {
    const composition = (action.params as { composition?: MotionComposition })
      .composition;
    return composition && typeof composition.id === "string"
      ? ok()
      : err("motion/upsertComposition requires a composition with an id");
  },
  apply(action: Action, project: Project): void {
    const composition = (action.params as { composition: MotionComposition })
      .composition;
    assignProject(project, motionEngine.upsertComposition(project, composition));
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const composition = (action.params as { composition: MotionComposition })
      .composition;
    const prior = (projectBefore.motionCompositions ?? []).find(
      (candidate) => candidate.id === composition.id,
    );
    return {
      type: prior ? "motion/upsertComposition" : "motion/removeComposition",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: prior ? { composition: prior } : { compositionId: composition.id },
    };
  },
};

const removeComposition: ActionHandler = {
  type: "motion/removeComposition",
  validate(action: Action, project: Project): ValidationResult {
    const compositionId = (action.params as { compositionId?: string })
      .compositionId;
    return (project.motionCompositions ?? []).some(
      (composition) => composition.id === compositionId,
    )
      ? ok()
      : err(`Motion composition not found: ${String(compositionId)}`);
  },
  apply(action: Action, project: Project): void {
    const compositionId = (action.params as { compositionId: string })
      .compositionId;
    const instanceIds = (project.motionInstances ?? [])
      .filter((instance) => instance.compositionId === compositionId)
      .map((instance) => instance.id);

    let nextProject: Project = {
      ...project,
      motionCompositions: (project.motionCompositions ?? []).filter(
        (composition) => composition.id !== compositionId,
      ),
      modifiedAt: Date.now(),
    };

    for (const instanceId of instanceIds) {
      nextProject = removeMotionInstance(nextProject, instanceId);
    }

    assignProject(project, nextProject);
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const compositionId = (action.params as { compositionId: string })
      .compositionId;
    const prior = (projectBefore.motionCompositions ?? []).find(
      (composition) => composition.id === compositionId,
    );
    if (!prior) return null;
    return {
      type: "motion/createComposition",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { composition: prior },
    };
  },
};

const insertInstance: ActionHandler = {
  type: "motion/insertInstance",
  validate(action: Action, project: Project): ValidationResult {
    const instance = (action.params as { instance?: MotionCompositionInstance })
      .instance;
    if (!instance || typeof instance.id !== "string") {
      return err("motion/insertInstance requires an instance with an id");
    }
    return (project.motionCompositions ?? []).some(
      (composition) => composition.id === instance.compositionId,
    )
      ? ok()
      : err(`Motion composition not found: ${instance.compositionId}`);
  },
  apply(action: Action, project: Project): void {
    const instance = (action.params as { instance: MotionCompositionInstance })
      .instance;
    assignProject(project, motionEngine.insertInstance(project, instance));
  },
  invert(action: Action): Action | null {
    const instance = (action.params as { instance: MotionCompositionInstance })
      .instance;
    return {
      type: "motion/removeInstance",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { instanceId: instance.id },
    };
  },
};

const removeInstance: ActionHandler = {
  type: "motion/removeInstance",
  validate(action: Action, project: Project): ValidationResult {
    const instanceId = (action.params as { instanceId?: string }).instanceId;
    return (project.motionInstances ?? []).some(
      (instance) => instance.id === instanceId,
    )
      ? ok()
      : err(`Motion instance not found: ${String(instanceId)}`);
  },
  apply(action: Action, project: Project): void {
    const instanceId = (action.params as { instanceId: string }).instanceId;
    assignProject(project, removeMotionInstance(project, instanceId));
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const instanceId = (action.params as { instanceId: string }).instanceId;
    const prior = (projectBefore.motionInstances ?? []).find(
      (instance) => instance.id === instanceId,
    );
    if (!prior) return null;
    return {
      type: "motion/insertInstance",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { instance: prior },
    };
  },
};

for (const handler of [
  createComposition,
  upsertComposition,
  removeComposition,
  insertInstance,
  removeInstance,
]) {
  registerActionHandler(handler);
}
