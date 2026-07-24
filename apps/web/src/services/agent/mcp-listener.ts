import {
  executeTool,
  getTool,
  isDestructive,
  isExpensive,
  toMcpTools,
  type ToolResult,
} from "@openreel/agent";
import type { MotionComposition } from "@openreel/core";
import { getLiveEditorHost, runExclusive } from "./host-singleton";
import { useSettingsStore } from "../../stores/settings-store";
import { useMotionStore } from "../../motion/stores/motion-store";
import { useUIStore } from "../../stores/ui-store";
import { resolveMotionCreatorPreviewTime } from "../../motion/composition-selection";

export interface McpBridgeRequest {
  readonly callId: string;
  readonly kind: "listTools" | "callTool";
  readonly name?: string;
  readonly args?: Record<string, unknown>;
}

export interface McpBridgeResponse {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstKeyframeTime(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const time = optionalNumber(asRecord(item)?.time);
    if (time !== null) return time;
  }
  return null;
}

function getResultDataRecord(result: ToolResult): Record<string, unknown> | null {
  return asRecord(result.data);
}

function getMotionCompositionId(
  args: Record<string, unknown>,
  result: ToolResult,
): string | null {
  const data = getResultDataRecord(result);
  const composition = asRecord(data?.composition);
  const syncedCompositionIds = data?.syncedCompositionIds;
  return (
    optionalString(data?.compositionId) ??
    optionalString(data?.syncedCompositionId) ??
    optionalString(composition?.id) ??
    (Array.isArray(syncedCompositionIds)
      ? optionalString(syncedCompositionIds[0])
      : null) ??
    optionalString(args.compositionId)
  );
}

function getMotionComposition(result: ToolResult): MotionComposition | null {
  const composition = asRecord(getResultDataRecord(result)?.composition);
  if (
    !composition ||
    !optionalString(composition.id) ||
    !optionalNumber(composition.duration) ||
    !Array.isArray(composition.layers)
  ) {
    return null;
  }
  return composition as unknown as MotionComposition;
}

function getMotionFocusTime(args: Record<string, unknown>): number | null {
  return (
    optionalNumber(args.timeSeconds) ??
    optionalNumber(args.startTime) ??
    firstKeyframeTime(args.position) ??
    firstKeyframeTime(args.rotation) ??
    firstKeyframeTime(args.scale) ??
    firstKeyframeTime(args.opacity) ??
    firstKeyframeTime(args.lidAngle) ??
    firstKeyframeTime(args.target) ??
    firstKeyframeTime(args.fov)
  );
}

function getMotionLayerId(result: ToolResult): string | null {
  const data = getResultDataRecord(result);
  const layerIds = data?.layerIds;
  const createdLayerIds = data?.createdLayerIds;
  if (Array.isArray(createdLayerIds)) {
    return optionalString(createdLayerIds[0]);
  }
  if (Array.isArray(layerIds)) {
    return optionalString(layerIds[0]);
  }
  const keyedLayerIds = asRecord(layerIds);
  return (
    optionalString(data?.layerId) ??
    optionalString(data?.syncedLayerId) ??
    optionalString(data?.groupId) ??
    optionalString(keyedLayerIds ? Object.values(keyedLayerIds)[0] : undefined)
  );
}

function insertedMotionIntoEditor(
  name: string,
  args: Record<string, unknown>,
  result: ToolResult,
): boolean {
  if (name === "insert_motion_into_editor") return true;
  const data = getResultDataRecord(result);
  return (
    optionalString(data?.insertedInstanceId) !== null ||
    optionalString(data?.insertedClipId) !== null ||
    (args.insertIntoEditor === true && optionalString(data?.instanceId) !== null)
  );
}

function followMcpMotionResult(
  name: string,
  args: Record<string, unknown>,
  result: ToolResult,
): void {
  if (!result.ok || getTool(name)?.domain !== "motion") return;
  const compositionId = getMotionCompositionId(args, result);
  if (!compositionId) return;

  useUIStore
    .getState()
    .setDesktopPage(insertedMotionIntoEditor(name, args, result) ? "edit" : "motion");

  const motion = useMotionStore.getState();
  const activeChanged = motion.activeCompositionId !== compositionId;
  if (motion.activeCompositionId !== compositionId) {
    motion.setActiveCompositionId(compositionId);
  }

  const focusTime = getMotionFocusTime(args);
  if (focusTime !== null) {
    motion.setPlayhead(Math.max(0, focusTime));
  } else if (activeChanged) {
    const composition = getMotionComposition(result);
    if (composition) {
      motion.setPlayhead(resolveMotionCreatorPreviewTime(composition));
    }
  }

  const layerId = getMotionLayerId(result);
  if (layerId) {
    motion.selectLayer(layerId);
  }
}

/**
 * Runs a main-process MCP request against the live editor. listTools returns the
 * registry; callTool gates destructive/expensive tools behind the trusted-local
 * auto-allow setting, then executes against the shared LiveEditorHost.
 */
export async function handleMcpBridgeRequest(
  req: McpBridgeRequest,
): Promise<McpBridgeResponse> {
  try {
    if (req.kind === "listTools") {
      return { ok: true, result: toMcpTools() };
    }
    if (req.kind === "callTool") {
      const name = req.name;
      if (!name) return { ok: false, error: "Missing tool name" };

      const autoAllow = useSettingsStore.getState().mcpAutoAllowTrustedLocal;
      if (!autoAllow && (isDestructive(name) || isExpensive(name))) {
        const blocked: ToolResult = {
          ok: false,
          summary: "Confirmation required",
          error: {
            code: "CONFIRMATION_REQUIRED",
            message: `'${name}' is destructive or expensive. Enable "Trusted local — auto-allow" in Settings → MCP to permit it.`,
          },
        };
        return { ok: true, result: blocked };
      }

      const args = req.args ?? {};
      const result = await runExclusive(() =>
        Promise.resolve(executeTool(name, args, getLiveEditorHost())),
      );
      followMcpMotionResult(name, args, result);
      return { ok: true, result };
    }
    return { ok: false, error: `Unknown MCP bridge kind: ${req.kind}` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Installs the desktop MCP bridge listener. No-op off desktop. */
export function installMcpListener(): () => void {
  const mcp = window.openreel?.mcp;
  if (!mcp) return () => {};
  return mcp.onRequest(handleMcpBridgeRequest);
}
