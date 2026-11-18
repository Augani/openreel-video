import { toMcpTools, type AppStateSnapshot } from "@openreel/agent";
import { useProjectStore } from "../../stores/project-store";
import { useOnboardingStore } from "../../stores/onboarding-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useAIConnectionStore } from "../../stores/ai-connection-store";

/** The route name from the location hash: "#/editor?x=1" -> "editor"; the start screen is "welcome". */
export function routeFromHash(hash: string): string {
  const route = hash.split("?")[0].replace(/^#\/?/, "").split("/")[0];
  return route === "" ? "welcome" : route;
}

/** Same rule as the chat panel's "Connect a model" state. */
function aiConfigured(): { configured: boolean; provider: string | null } {
  const connection = useAIConnectionStore.getState();
  const ready =
    !!connection.baseUrl.trim() && !!connection.model.trim() && (!!connection.apiKey || connection.provider === "compatible");
  return { configured: ready, provider: ready ? connection.provider : null };
}

/**
 * Snapshot for `get_app_state`: version, window and route, project, onboarding, AI and MCP policy.
 * Everything comes from state that exists with no project open and with the window hidden.
 */
export async function buildAppState(): Promise<AppStateSnapshot> {
  const mcp = typeof window === "undefined" ? undefined : window.openreel?.mcp;
  const [info, policy] = await Promise.all([
    mcp?.getAppInfo?.().catch(() => null) ?? Promise.resolve(null),
    mcp?.getPolicy?.().catch(() => null) ?? Promise.resolve(null),
  ]);
  const project = useProjectStore.getState();
  const onboarding = useOnboardingStore.getState();
  return {
    appVersion: info?.appVersion ?? "unknown",
    platform: info?.platform ?? (typeof navigator === "undefined" ? "unknown" : navigator.platform),
    route: routeFromHash(typeof window === "undefined" ? "" : window.location.hash),
    windows: { editor: info?.editorWindow ?? true, count: info?.windowCount ?? 1 },
    projectOpen: project.hasOpenProject,
    projectId: project.hasOpenProject ? project.project.id : null,
    onboarding: { status: onboarding.status, path: onboarding.path ?? null, skippedBy: onboarding.skippedBy ?? null },
    ai: aiConfigured(),
    mcp: {
      toolCount: toMcpTools().length,
      autoAllow: useSettingsStore.getState().mcpAutoAllowTrustedLocal,
      allowedRoots: policy?.allowedRoots ?? [],
      protocolVersion: info?.protocolVersion ?? "",
    },
  };
}

/** `dismiss_onboarding`: idempotent; keeps lesson and AI progress; never touches a project. */
export async function dismissOnboardingForAgent(): Promise<{ status: string; changed: boolean }> {
  const before = useOnboardingStore.getState();
  const changed = before.status === "unseen" || before.status === "in-progress" || !!before.openSheet;
  before.skip("agent");
  return { status: useOnboardingStore.getState().status, changed };
}
