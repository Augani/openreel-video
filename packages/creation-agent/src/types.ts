import type { CreationScene } from "@openreel/creation-schema";

export type CreationToolDomain = "creation" | "product" | "validation";

export interface CreationJsonSchema {
  readonly type?: string;
  readonly properties?: Record<string, CreationJsonSchema>;
  readonly required?: readonly string[];
  readonly enum?: readonly string[];
  readonly items?: CreationJsonSchema;
  readonly additionalProperties?: boolean;
  readonly description?: string;
}

export interface CreationToolDef {
  readonly name: string;
  readonly domain: CreationToolDomain;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: CreationJsonSchema;
  readonly readOnly: boolean;
}

export interface CreationToolResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly scene?: CreationScene;
  readonly data?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export type CreationToolHandler = (
  args: Record<string, unknown>,
) => CreationToolResult | Promise<CreationToolResult>;

export interface RegisteredCreationTool extends CreationToolDef {
  readonly handler: CreationToolHandler;
}
