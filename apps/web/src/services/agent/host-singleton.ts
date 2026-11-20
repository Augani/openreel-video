import { LiveEditorHost } from "./live-host";

let hostSingleton: LiveEditorHost | null = null;

/**
 * One shared LiveEditorHost for every in-renderer agent entry point (the BYOK
 * chat panel and the desktop MCP bridge) so their edits land in a single,
 * consistent undo history rather than fighting over transaction bookkeeping.
 */
export function getLiveEditorHost(): LiveEditorHost {
  return (hostSingleton ??= new LiveEditorHost());
}

export { runExclusive } from "./host-lock";
