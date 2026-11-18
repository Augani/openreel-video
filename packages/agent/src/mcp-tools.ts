import { listTools } from "./registry";
import type { JSONSchema } from "./types";

/** MCP tool annotations (spec 2025-03-26 and later). All hints are advisory. */
export interface McpToolAnnotations {
  readonly title: string;
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface McpAnnotatedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JSONSchema;
  annotations: McpToolAnnotations;
  /** Vendor metadata. `openreel/expensive` lets the desktop bridge grant long-running budgets without a name list. */
  _meta: { "openreel/expensive": boolean };
}

/**
 * MCP tools/list with the ToolDef flags that `toMcpTools()` drops. Read-only
 * tools are idempotent by definition; a tool is never open-world because every
 * tool acts on the local project.
 */
export function toMcpToolsAnnotated(): McpAnnotatedTool[] {
  return listTools().map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      title: t.title,
      readOnlyHint: t.readOnly,
      destructiveHint: t.readOnly ? false : t.destructive,
      idempotentHint: t.readOnly,
      openWorldHint: false,
    },
    _meta: { "openreel/expensive": t.expensive },
  }));
}
