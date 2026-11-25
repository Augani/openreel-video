import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import {
  applySnapshotOp,
  captureMixerState,
  getMixerSnapshots,
  MAX_MIXER_SNAPSHOTS,
  type MixerSnapshotParams,
} from "../../audio/mixer-snapshots";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";

/**
 * Save / recall / rename / delete of Audio Track Mixer snapshots. Every operation is one undo step: the inverse
 * is a `restore` carrying the exact mixer state and snapshot list from before.
 */
const audioMixerSnapshot: ActionHandler = {
  type: "audioMixer/snapshot",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as unknown as MixerSnapshotParams;
    const fail = (message: string): ValidationResult => ({ valid: false, errors: [{ code: "INVALID_MIXER_SNAPSHOT", message }] });
    if (!params || typeof params !== "object") return fail("audioMixer/snapshot needs params");
    const existing = getMixerSnapshots(project.timeline);
    switch (params.op) {
      case "save":
        if (!params.snapshot || typeof params.snapshot.id !== "string") return fail("save needs a snapshot");
        if (existing.length >= MAX_MIXER_SNAPSHOTS && !existing.some((s) => s.id === params.snapshot?.id)) {
          return fail(`A project holds at most ${MAX_MIXER_SNAPSHOTS} mixer snapshots.`);
        }
        break;
      case "recall":
      case "rename":
      case "delete":
        if (!existing.some((s) => s.id === params.snapshotId)) return fail(`Mixer snapshot not found: ${String(params.snapshotId)}`);
        break;
      case "restore":
        if (!params.state) return fail("restore needs a state");
        break;
      default:
        return fail("Unknown mixer snapshot operation");
    }
    return { valid: true, errors: [] };
  },
  apply(action: Action, project: Project): void {
    const problem = applySnapshotOp(project.timeline, action.params as unknown as MixerSnapshotParams);
    if (problem) throw new Error(problem);
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as unknown as MixerSnapshotParams;
    return {
      type: "audioMixer/snapshot",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        op: "restore",
        state: captureMixerState(projectBefore.timeline),
        snapshots: structuredClone([...getMixerSnapshots(projectBefore.timeline)]),
        label: params.op === "recall" ? "Undo mixer snapshot recall" : "Undo mixer snapshot change",
      } as unknown as Action["params"],
    };
  },
};

registerActionHandler(audioMixerSnapshot);
