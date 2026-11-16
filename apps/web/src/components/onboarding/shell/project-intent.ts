/**
 * Marks project creation that the USER started inside onboarding (wizards, custom sequence, format
 * cards). The agent-flip rule ("a project appeared while the welcome screen or a sheet was open means an
 * MCP client did it") must not fire for those.
 *
 *   await withUserProjectCreation(() => createEditorProject({...}));
 */
let active = 0;

export function isUserProjectCreationActive(): boolean {
  return active > 0;
}

export async function withUserProjectCreation<T>(fn: () => Promise<T>): Promise<T> {
  active += 1;
  try {
    return await fn();
  } finally {
    // The project store notifies (and the route flips) synchronously while fn runs, so no grace period.
    active = Math.max(0, active - 1);
  }
}

/**
 * Marks an in-flight MCP tool call. Only a project change that happens during one counts as "the agent
 * did it"; any other project change on a welcome route (recent project, template, open-file) is the user.
 */
let agentCalls = 0;

export function isAgentToolCallActive(): boolean {
  return agentCalls > 0;
}

export async function withAgentToolCall<T>(fn: () => Promise<T>): Promise<T> {
  agentCalls += 1;
  try {
    return await fn();
  } finally {
    agentCalls = Math.max(0, agentCalls - 1);
  }
}
