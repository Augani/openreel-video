import type { Project } from "@openreel/core/types/project";
import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import { BUILT_IN_GRAPHIC_TEMPLATES } from "@openreel/core/graphic-templates/built-in-templates";
import { coerceParamValue, protectedDurations, resolveParamValues } from "@openreel/core/graphic-templates/expand";
import {
  getGraphicInstance,
  graphicInstanceToTemplate,
  insertGraphicTemplate,
  setGraphicParameters,
  type GraphicEditResult,
} from "@openreel/core/graphic-templates/instances";
import { applySequenceSettings } from "@openreel/core/graphic-templates/frame-scale";
import type { GraphicInstance, GraphicTemplate } from "@openreel/core/graphic-templates/types";
import { validateGraphicTemplate } from "@openreel/core/graphic-templates/validate";
import type { EditingHost, GraphicTemplateLibrary } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Essential Graphics tools. Each edit is computed with the pure functions in
 * core/graphic-templates and committed as ONE `project/applyEditSnapshot`
 * action (one undo step), exactly like the editor's Browse / Inspector commands.
 */
const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({ ok: false, summary: message, error: { code, message } });
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Headless hosts have no persistent library: keep saved templates for the session. */
const sessionLibraries = new WeakMap<object, Map<string, GraphicTemplate>>();

function library(host: EditingHost): GraphicTemplateLibrary {
  if (host.graphicTemplates) return host.graphicTemplates;
  let map = sessionLibraries.get(host);
  if (!map) {
    map = new Map();
    sessionLibraries.set(host, map);
  }
  const store = map;
  return {
    list: () => [...store.values()],
    save: (template) => {
      store.set(template.id, template);
    },
  };
}

const allTemplates = (host: EditingHost): GraphicTemplate[] => [...BUILT_IN_GRAPHIC_TEMPLATES, ...library(host).list()];

function resolveTemplate(host: EditingHost, ref: unknown): GraphicTemplate {
  if (typeof ref !== "string" || !ref) throw new Error("templateId must be a template id or name.");
  const all = allTemplates(host);
  const byId = all.find((template) => template.id === ref);
  if (byId) return byId;
  const byName = all.filter((template) => template.name.toLowerCase() === ref.toLowerCase());
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new Error(`More than one template is named "${ref}"; use its id.`);
  throw new Error(`No graphic template "${ref}". Use list_graphic_templates to see ids.`);
}

function resolveInstance(project: Project, ref: unknown): GraphicInstance {
  if (typeof ref !== "string" || !ref) throw new Error("graphicId is required. Use list_graphic_templates (instances) or get the id from insert_graphic_template.");
  const byId = getGraphicInstance(project, ref);
  if (byId) return byId;
  // A member clip id (what selection and the timeline use) resolves to its graphic too.
  for (const instance of project.graphicInstances ?? []) if (ref.startsWith(`${instance.id}__`)) return instance;
  throw new Error(`No graphic "${ref}" on the active timeline.`);
}

function describeTemplate(template: GraphicTemplate, builtIn: boolean) {
  const { intro, outro, minDuration } = protectedDurations(template);
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    description: template.description,
    builtIn,
    defaultDuration: template.duration,
    introSec: intro,
    outroSec: outro,
    minDurationSec: minDuration,
    layers: template.layers.map((layer) => ({ id: layer.id, name: layer.name, kind: layer.kind })),
    parameters: template.parameters.map((parameter) => ({
      id: parameter.id,
      label: parameter.label,
      group: parameter.group,
      type: parameter.type,
      default: parameter.defaultValue,
      ...(parameter.min !== undefined ? { min: parameter.min } : {}),
      ...(parameter.max !== undefined ? { max: parameter.max } : {}),
      ...(parameter.options ? { options: parameter.options } : {}),
    })),
  };
}

function describeInstance(instance: GraphicInstance) {
  return {
    id: instance.id,
    name: instance.name,
    templateId: instance.template.id,
    trackId: instance.trackId,
    startSec: instance.startTime,
    durationSec: instance.duration,
    values: resolveParamValues(instance.template, instance.values),
  };
}

async function commit(
  host: EditingHost,
  build: (project: Project) => GraphicEditResult,
): Promise<{ failure: ToolResult } | { failure?: undefined; result: Extract<GraphicEditResult, { ok: true }> }> {
  const result = build(host.getProject());
  if (!result.ok) return { failure: fail(result.message) };
  const applied = await host.applyAction({
    type: "project/applyEditSnapshot",
    id: genId(),
    timestamp: Date.now(),
    params: { snapshot: editSnapshot(result.project) },
  });
  return applied.success
    ? { result }
    : { failure: fail(applied.error?.message ?? "The change failed", applied.error?.code ?? "ACTION_FAILED") };
}

const guarded =
  (run: (args: Record<string, unknown>, host: EditingHost) => Promise<ToolResult> | ToolResult): RegisteredTool["handler"] =>
  async (args, host) => {
    try {
      host.requireOpenProject();
      return await run(args, host);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Invalid request");
    }
  };

export const GRAPHIC_TOOLS: RegisteredTool[] = [
  {
    name: "list_graphic_templates",
    domain: "graphics",
    title: "List graphic templates",
    description:
      "List Essential Graphics templates (built-in lower thirds, titles, callouts, end cards, plus the user's saved ones) with their exposed controls (id, label, type, default, range), the protected intro/outro length and layers, and the graphics already placed on the active timeline. Filter with \"category\" (lower-third, title, callout, end-card, custom). Use the control ids with insert_graphic_template and set_template_parameter.",
    inputSchema: obj({ category: str }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      const project = host.getProject();
      const category = typeof args.category === "string" ? args.category : undefined;
      const builtIds = new Set(BUILT_IN_GRAPHIC_TEMPLATES.map((template) => template.id));
      const templates = allTemplates(host)
        .filter((template) => !category || template.category === category)
        .map((template) => describeTemplate(template, builtIds.has(template.id)));
      const placed = (project.graphicInstances ?? []).map(describeInstance);
      return ok(`${templates.length} template(s), ${placed.length} graphic(s) on the timeline`, { templates, graphics: placed });
    }),
  },
  {
    name: "insert_graphic_template",
    domain: "graphics",
    title: "Insert graphic template",
    description:
      'Place an Essential Graphics template on the active timeline as ONE graphic (its layers are grouped). "templateId" is an id or name from list_graphic_templates. "startTime" (seconds, default 0) and optional "duration" (default: the template length; never shorter than its intro+outro). "values" sets exposed controls by id, e.g. {"name":"Alex Morgan","accent":"#ff6600","showTitle":false}. Optional "trackId"; otherwise a free graphics track is reused or created above the video. Returns the graphic id for set_template_parameter. One undo step.',
    inputSchema: obj(
      { templateId: str, startTime: num, duration: num, trackId: str, name: str, values: { type: "object", additionalProperties: true } },
      ["templateId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const template = resolveTemplate(host, args.templateId);
      const startTime = typeof args.startTime === "number" ? args.startTime : 0;
      const duration = typeof args.duration === "number" && args.duration > 0 ? args.duration : undefined;
      const values = args.values && typeof args.values === "object" ? (args.values as Record<string, unknown>) : undefined;
      if (values) {
        for (const id of Object.keys(values)) {
          const parameter = template.parameters.find((item) => item.id === id);
          if (!parameter) return fail(`"${template.name}" has no control "${id}". Controls: ${template.parameters.map((item) => item.id).join(", ") || "none"}.`);
          if (coerceParamValue(parameter, values[id]) === undefined) return fail(`"${parameter.label}" (${parameter.type}) does not accept ${JSON.stringify(values[id])}.`);
        }
      }
      const committed = await commit(host, (project) =>
        insertGraphicTemplate(project, template, {
          startTime,
          duration,
          values,
          trackId: typeof args.trackId === "string" ? args.trackId : undefined,
          name: typeof args.name === "string" ? args.name : undefined,
        }),
      );
      if (committed.failure) return committed.failure;
      const instance = committed.result.instanceId ? getGraphicInstance(host.getProject(), committed.result.instanceId) : undefined;
      return ok(`Inserted "${template.name}" at ${startTime}s`, instance ? describeInstance(instance) : { id: committed.result.instanceId });
    }),
  },
  {
    name: "set_template_parameter",
    domain: "graphics",
    title: "Set graphic control",
    description:
      'Change exposed controls of a placed graphic. "graphicId" comes from insert_graphic_template / list_graphic_templates. Give either "parameterId" + "value" or "values" ({id: value, ...}) to set several at once in one undo step. Text controls take strings, color controls #hex / rgba(), slider/number controls numbers (clamped to the range), checkbox controls true/false (shows or hides a layer), position controls {"x":960,"y":540} in 1920x1080 design pixels.',
    inputSchema: obj(
      { graphicId: str, parameterId: str, value: {}, values: { type: "object", additionalProperties: true } },
      ["graphicId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const instance = resolveInstance(host.getProject(), args.graphicId);
      const updates: Record<string, unknown> = {};
      if (args.values && typeof args.values === "object") Object.assign(updates, args.values);
      if (typeof args.parameterId === "string") updates[args.parameterId] = args.value;
      if (Object.keys(updates).length === 0) return fail('Give "parameterId" and "value", or "values".');
      const committed = await commit(host, (project) => setGraphicParameters(project, instance.id, updates));
      if (committed.failure) return committed.failure;
      const next = getGraphicInstance(host.getProject(), instance.id);
      return ok(`Updated ${Object.keys(updates).length} control(s) on "${instance.name}"`, next ? describeInstance(next) : undefined);
    }),
  },
  {
    name: "save_graphic_template",
    domain: "graphics",
    title: "Save graphic as template",
    description:
      'Save a placed graphic (with its current control values as the new defaults, its edited layers and controls) as a reusable template in the user\'s library, listed by list_graphic_templates under category "custom". "graphicId" is the placed graphic, "name" the new template name. Does not change the project (no undo step). The user can export it as a .openreel-template file from the Inspector.',
    inputSchema: obj({ graphicId: str, name: str, description: str }, ["graphicId", "name"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      const instance = resolveInstance(host.getProject(), args.graphicId);
      if (typeof args.name !== "string" || !args.name.trim()) return fail("name is required.");
      const template = graphicInstanceToTemplate(instance, {
        name: args.name.trim(),
        description: typeof args.description === "string" ? args.description : undefined,
      });
      const checked = validateGraphicTemplate(template);
      if (!checked.ok) return fail(`The graphic cannot be saved as a template: ${checked.errors[0]}`);
      library(host).save(checked.template);
      return ok(`Saved template "${checked.template.name}"`, describeTemplate(checked.template, false));
    }),
  },
  {
    name: "set_sequence_frame_size",
    domain: "graphics",
    title: "Set frame size (scale graphics)",
    description:
      'Change the active sequence frame size ("width", "height" in pixels). By default ("scaleGraphics" true) every graphic template, text, shape and SVG clip of the sequence is rescaled so it keeps its proportion to the frame (a 1080p title stays inside a 640x360 frame); pass "scaleGraphics": false to change only the canvas. One undo step. Use update_project_settings for fps/sample rate.',
    inputSchema: obj({ width: num, height: num, scaleGraphics: { type: "boolean" } }, ["width", "height"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const { width, height } = args;
      if (typeof width !== "number" || typeof height !== "number" || !(width >= 16) || !(height >= 16) || width > 16384 || height > 16384) {
        return fail("width and height must be numbers between 16 and 16384.");
      }
      const size = { width: Math.round(width), height: Math.round(height) };
      const committed = await commit(host, (project) => ({
        ok: true,
        project: applySequenceSettings(project, size, { scaleGraphics: args.scaleGraphics !== false }),
      }));
      if (committed.failure) return committed.failure;
      return ok(`Frame size is now ${size.width}x${size.height}${args.scaleGraphics === false ? "" : " (graphics scaled)"}`);
    }),
  },
];
