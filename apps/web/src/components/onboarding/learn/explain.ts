import { useAIConnectionStore } from "../../../stores/ai-connection-store";
import { useChatStore } from "../../../stores/chat-store";
import { useUIStore } from "../../../stores/ui-store";
import type { LessonDef } from "./lessons";
import { lessonTextToString, resolveLessonKeys } from "./lesson-keys";

/** The same readiness rule the chat panel uses before it offers to send a message. */
export function isAiConnected(): boolean {
  const c = useAIConnectionStore.getState();
  return !!c.baseUrl.trim() && !!c.model.trim() && (!!c.apiKey || c.provider === "compatible");
}

/**
 * The optional "Ask AI to explain" prompt. It is explain-only: it says so, and it only asks how to do the
 * step, so a well-behaved model answers in the chat without calling any editing tool.
 */
export function buildExplainPrompt(lesson: LessonDef): string {
  const step = lessonTextToString(lesson.instruction, resolveLessonKeys());
  return [
    "I'm learning OpenReel. Please only explain. Do not edit, add, move or delete anything in my project, and do not use any editing tools.",
    `In two or three short, plain sentences, tell me ${lesson.explainTopic}.`,
    `The lesson I'm on says: "${step}"`,
  ].join(" ");
}

/** Opens the chat panel and sends the explain question. Resolves once the chat accepted it. */
export async function askAiToExplain(lesson: LessonDef): Promise<void> {
  useUIStore.getState().setPanelVisible("agentChat", true);
  await useChatStore.getState().send(buildExplainPrompt(lesson));
}

/** "Do this step for me": a scoped edit request. The chat shows the change summary with Undo. */
export function buildDoStepPrompt(lesson: LessonDef): string | null {
  if (!lesson.doPrompt) return null;
  return `I'm learning OpenReel and want you to do just this one step for me, then stop and tell me in one sentence what you changed: ${lesson.doPrompt} Do not make any other changes.`;
}

/** Opens the chat panel and asks the AI to perform the lesson step. The project change completes the lesson. */
export async function askAiToDoStep(lesson: LessonDef): Promise<void> {
  const prompt = buildDoStepPrompt(lesson);
  if (!prompt) return;
  useUIStore.getState().setPanelVisible("agentChat", true);
  await useChatStore.getState().send(prompt);
}
