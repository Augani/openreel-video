import { useOnboardingStore, type OnboardingState } from "../../../stores/onboarding-store";
import { isAgentToolCallActive, isUserProjectCreationActive } from "./project-intent";

/** Routes where the welcome UI (band, sheets) is on screen and a new project means the route flips to the editor. */
export const WELCOME_ROUTES = ["", "#/", "#/welcome", "#/recent", "#/templates"];

export function isWelcomeRoute(hash: string): boolean {
  return WELCOME_ROUTES.includes(hash.split("?")[0]);
}

export function shouldSkipForAgent(
  state: Pick<OnboardingState, "status" | "openSheet">,
  hash: string,
  userIntent: boolean,
  agentCall: boolean,
): boolean {
  if (!agentCall || userIntent || !isWelcomeRoute(hash)) return false;
  return state.status === "unseen" || state.status === "in-progress" || Boolean(state.openSheet);
}

/**
 * A project appeared (MCP create_project / open_project) while the welcome route was showing. Close any
 * sheet and mark onboarding skipped by the agent, keeping lesson and AI progress. No toast, no re-nag.
 * Returns true when it acted.
 */
export function handleProjectOpenedOnWelcomeRoute(hash = window.location.hash): boolean {
  const store = useOnboardingStore.getState();
  // The route flips to the editor whatever the outcome, so a re-opened band must not outlive it.
  if (store.bandOpen) useOnboardingStore.setState({ bandOpen: false });
  if (!shouldSkipForAgent(store, hash, isUserProjectCreationActive(), isAgentToolCallActive())) return false;
  store.skip("agent");
  return true;
}
