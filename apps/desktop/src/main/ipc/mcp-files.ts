import { z } from "zod";
import { handle } from "./index";
import { CHANNELS } from "../../shared/channels";
import {
  mcpFilesPlaceOutputArgsSchema,
  mcpFilesResolveArgsSchema,
  mcpSetPolicyArgsSchema,
  type McpFilesPlaceOutputResult,
  type McpFilesResolveArgs,
  type McpFilesResolveResult,
  type McpPolicy,
} from "../../shared/onboarding";
import { getEffectiveRoots, getMcpPolicy, setMcpPolicy } from "../mcp/policy";
import { resolveMcpPaths } from "../mcp/path-guard";
import { placeOutput } from "../mcp/place-output";
import { getMcpAppInfo } from "../mcp/app-info";

export function resolveFiles(args: McpFilesResolveArgs, roots: readonly string[] = getEffectiveRoots()): Promise<McpFilesResolveResult> {
  return resolveMcpPaths(args, { roots });
}

export function registerMcpFilesIpc(): void {
  handle(CHANNELS.mcpFilesResolve, mcpFilesResolveArgsSchema, (args): Promise<McpFilesResolveResult> => resolveFiles(args));
  handle(
    CHANNELS.mcpFilesPlaceOutput,
    mcpFilesPlaceOutputArgsSchema,
    (args): Promise<McpFilesPlaceOutputResult> => placeOutput(args),
  );
  handle(CHANNELS.mcpAppInfo, z.undefined(), () => getMcpAppInfo());
  handle(CHANNELS.mcpGetPolicy, z.undefined(), (): McpPolicy => getMcpPolicy());
  handle(CHANNELS.mcpSetPolicy, mcpSetPolicyArgsSchema, (args): McpPolicy => setMcpPolicy(args));
}
