import type { RegisteredTool } from "./registry";
import type { JSONSchema } from "./types";
import { TRANSITION_TYPES } from "@openreel/core/types/effects";

/**
 * Transition presets and defaults for the agent. The handlers live in transition-impl.ts and load on first use so
 * they stay out of the agent chunk's startup cost. Adding and editing a single transition (with its parameters)
 * is add_transition / update_transition in the registry.
 */

const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
type Impl = typeof import("./transition-impl");
const TYPE: JSONSchema = { type: "string", enum: [...TRANSITION_TYPES] };
const PARAMS = obj({});
const tool = (
  name: string,
  description: string,
  inputSchema: JSONSchema,
  impl: keyof Impl,
  readOnly = false,
  destructive = false,
): RegisteredTool => ({
  name,
  domain: readOnly ? "read" : "transition",
  title: name[0]!.toUpperCase() + name.slice(1).replace(/_/g, " "),
  description,
  inputSchema,
  readOnly,
  destructive,
  expensive: false,
  handler: async (args, host) => (await import("./transition-impl"))[impl](args, host),
});

export const TRANSITION_TOOLS: RegisteredTool[] = [
  tool("list_transitions", "List transition types and params, project and library presets and the default.", obj({}), "listTransitions", true),
  tool("get_morph_cut_status", "Status of every Morph Cut transition's background analysis (analysing, ready, or failed with the reason); until ready it renders as a cross dissolve.", obj({}), "getMorphCutStatus", true),
  tool("save_transition_preset", "Save a named transition preset from transitionId, or type + duration + params. scope \"library\" keeps it for every project.", obj({ name: str, transitionId: str, type: TYPE, duration: num, params: PARAMS, scope: { type: "string", enum: ["project", "library"] } }, ["name"]), "saveTransitionPreset"),
  tool("delete_transition_preset", "Delete a project or library transition preset by id.", obj({ presetId: str }, ["presetId"]), "deleteTransitionPreset", false, true),
  tool("set_default_transition", "Set the default transition (presetId, or type + duration + params; reset true clears).", obj({ presetId: str, type: TYPE, duration: num, params: PARAMS, reset: { type: "boolean" } }), "setDefaultTransition"),
  tool("apply_transition_preset", "Apply a preset at the cut clipAId|clipBId (outro of clipAId without clipBId).", obj({ presetId: str, clipAId: str, clipBId: str, duration: num }, ["presetId", "clipAId"]), "applyTransitionPreset"),
  tool("apply_default_transition", "Apply the default transition at the cut clipAId|clipBId (outro of clipAId without clipBId).", obj({ clipAId: str, clipBId: str, duration: num }, ["clipAId"]), "applyDefaultTransition"),
  tool("export_transition_presets", "Export the app-wide transition preset library as JSON text.", obj({}), "exportTransitionPresets", true),
  tool("import_transition_presets", "Import an exported preset file (json) into the library.", obj({ json: str }, ["json"]), "importTransitionPresets"),
];
