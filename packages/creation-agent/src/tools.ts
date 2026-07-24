import {
  createPhoneProductCinematicScene,
  summarizeCreationScene,
  validateCreationScene,
  type CreationScene,
  type ProductCinematicSpec,
} from "@openreel/creation-schema";
import type { CreationJsonSchema, CreationToolResult, RegisteredCreationTool } from "./types";

const str: CreationJsonSchema = { type: "string" };
const num: CreationJsonSchema = { type: "number" };
const bool: CreationJsonSchema = { type: "boolean" };
const obj = (
  properties: Record<string, CreationJsonSchema>,
  required: readonly string[] = [],
): CreationJsonSchema => ({ type: "object", properties, required, additionalProperties: true });

function ok(summary: string, data?: unknown, scene?: CreationScene): CreationToolResult {
  return { ok: true, summary, ...(data !== undefined ? { data } : {}), ...(scene ? { scene } : {}) };
}

function fail(code: string, message: string): CreationToolResult {
  return { ok: false, summary: message, error: { code, message } };
}

function asScene(value: unknown): CreationScene | null {
  return value && typeof value === "object" ? (value as CreationScene) : null;
}

function productSpec(args: Record<string, unknown>): ProductCinematicSpec {
  return {
    id: typeof args.id === "string" ? args.id : undefined,
    name: typeof args.name === "string" ? args.name : undefined,
    productKind:
      args.productKind === "phone" ||
      args.productKind === "watch" ||
      args.productKind === "laptop" ||
      args.productKind === "headphones" ||
      args.productKind === "custom"
        ? args.productKind
        : undefined,
    style: typeof args.style === "string" ? args.style : undefined,
    duration: typeof args.duration === "number" ? args.duration : undefined,
    frameRate: typeof args.frameRate === "number" ? args.frameRate : undefined,
    seed: typeof args.seed === "number" ? args.seed : undefined,
    includeInternals: typeof args.includeInternals === "boolean" ? args.includeInternals : undefined,
    includeCallouts: typeof args.includeCallouts === "boolean" ? args.includeCallouts : undefined,
  };
}

const createProductCinematic: RegisteredCreationTool = {
  name: "create_product_cinematic_scene",
  domain: "product",
  title: "Create product cinematic scene",
  description:
    "Create an editable semantic product cinematic scene with product parts, materials, callouts, an exploded-view animation, and a macro camera path.",
  inputSchema: obj({
    id: str,
    name: str,
    productKind: { type: "string", enum: ["phone", "watch", "laptop", "headphones", "custom"] },
    style: str,
    duration: num,
    frameRate: num,
    seed: num,
    includeInternals: bool,
    includeCallouts: bool,
  }),
  readOnly: false,
  handler: (args) => {
    const scene = createPhoneProductCinematicScene(productSpec(args));
    const issues = validateCreationScene(scene);
    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      return fail("INVALID_GENERATED_SCENE", errors.map((issue) => issue.message).join("; "));
    }
    return ok(summarizeCreationScene(scene), { issues }, scene);
  },
};

const validateScene: RegisteredCreationTool = {
  name: "validate_creation_scene",
  domain: "validation",
  title: "Validate creation scene",
  description: "Validate an OpenReel creation scene for broken references, missing semantic parts, and animation issues.",
  inputSchema: obj({ scene: { type: "object" } }, ["scene"]),
  readOnly: true,
  handler: (args) => {
    const scene = asScene(args.scene);
    if (!scene) return fail("INVALID_PARAMS", "scene must be an object");
    const issues = validateCreationScene(scene);
    return ok(
      issues.length === 0
        ? "Creation scene is valid"
        : `Creation scene has ${issues.length} issue(s)`,
      { issues },
    );
  },
};

export const CREATION_TOOLS: readonly RegisteredCreationTool[] = [
  createProductCinematic,
  validateScene,
];

export function listCreationTools(): readonly RegisteredCreationTool[] {
  return CREATION_TOOLS;
}

export function getCreationTool(name: string): RegisteredCreationTool | undefined {
  return CREATION_TOOLS.find((tool) => tool.name === name);
}

export async function executeCreationTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<CreationToolResult> {
  const tool = getCreationTool(name);
  if (!tool) return fail("UNKNOWN_TOOL", `No creation tool named "${name}"`);
  try {
    return await tool.handler(args);
  } catch (error) {
    return fail("TOOL_ERROR", error instanceof Error ? error.message : "Creation tool failed");
  }
}

export function toMcpCreationTools(): Array<{
  readonly name: string;
  readonly description: string;
  readonly inputSchema: CreationJsonSchema;
}> {
  return CREATION_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
