export type JSONSchema = Record<string, unknown>;

export type ToolDomain =
  | "read"
  | "project"
  | "media"
  | "track"
  | "clip"
  | "transform"
  | "effect"
  | "color"
  | "speed"
  | "audio"
  | "text"
  | "subtitle"
  | "graphics"
  | "motion"
  | "transition"
  | "keyframe"
  | "marker"
  | "ai"
  | "export"
  | "raw";

export interface ToolDef {
  readonly name: string;
  readonly domain: ToolDomain;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JSONSchema;
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly expensive: boolean;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export interface ToolError {
  readonly code: string;
  readonly message: string;
}

export interface ToolResultImage {
  readonly dataUrl: string;
  readonly mimeType?: string;
}

export interface ToolResult {
  readonly ok: boolean;
  /** Short, model- and human-readable summary of the outcome. */
  readonly summary: string;
  readonly data?: unknown;
  readonly error?: ToolError;
  /** Rendered image the model can SEE (e.g. render_motion_frame). */
  readonly image?: ToolResultImage;
}

export interface AgentMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; call: ToolCall; result: ToolResult }
  | { type: "awaiting_confirmation"; call: ToolCall }
  | { type: "error"; error: ToolError }
  | { type: "turn_complete"; text: string };

export type ConfirmDecision = "approve" | "reject" | "approve_for_turn";
