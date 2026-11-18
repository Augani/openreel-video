import { getLinkedComposition, validateGraphicTemplate, type LinkedComposition } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { getLinkedCompTransport, type LinkedCompTransport } from "./linked-comp-bridge";
import { editLinkedCompositionCommand } from "./linked-comp-commands";
import { LINKED_COMP_MAX_BYTES, type LinkedCompMessage } from "./linked-comp-protocol";

/**
 * Main-window side of linked composition windows. A composition window never edits
 * the project; it asks this host, which applies each edit as ONE undoable
 * `editLinkedComposition` step. The timeline therefore updates the moment the edit
 * lands, through the same store and render path as any other edit, and undo in the
 * main window also undoes composition-window edits (and the window follows).
 */

function stateOf(composition: LinkedComposition, rejected?: string): LinkedCompMessage {
  return {
    type: "state",
    compositionId: composition.id,
    name: composition.name,
    revision: composition.revision,
    template: composition.template,
    ...(rejected ? { rejected } : {}),
  };
}

export function startLinkedCompHost(transport: LinkedCompTransport = getLinkedCompTransport()): () => void {
  // Compositions a window has asked about: only these are pushed on change.
  const watched = new Set<string>();
  const sent = new Map<string, { revision: number; template: unknown }>();
  const current = (id: string): LinkedComposition | undefined =>
    getLinkedComposition(useProjectStore.getState().getFullProject(), id);

  const push = (composition: LinkedComposition, rejected?: string): void => {
    sent.set(composition.id, { revision: composition.revision, template: composition.template });
    transport.post(stateOf(composition, rejected));
  };

  const handle = async (message: LinkedCompMessage): Promise<void> => {
    if (message.type === "hello") {
      const composition = current(message.compositionId);
      if (!composition) {
        transport.post({ type: "gone", compositionId: message.compositionId });
        return;
      }
      watched.add(composition.id);
      push(composition);
      return;
    }
    if (message.type === "closed") {
      watched.delete(message.compositionId);
      sent.delete(message.compositionId);
      return;
    }
    if (message.type !== "edit") return;

    const composition = current(message.compositionId);
    if (!composition) {
      transport.post({ type: "gone", compositionId: message.compositionId });
      return;
    }
    watched.add(composition.id);
    if (message.baseRevision !== composition.revision) {
      push(composition, "The composition changed in the editor while you were editing it, so your last change was not applied.");
      return;
    }
    let size = 0;
    try {
      size = JSON.stringify(message.template).length;
    } catch {
      size = Number.POSITIVE_INFINITY;
    }
    if (size > LINKED_COMP_MAX_BYTES) {
      push(composition, "That change is too large to apply.");
      return;
    }
    const checked = validateGraphicTemplate(message.template as Parameters<typeof validateGraphicTemplate>[0]);
    if (!checked.ok) {
      push(composition, `That change is not valid: ${checked.errors[0]}`);
      return;
    }
    const result = await editLinkedCompositionCommand(
      composition.id,
      message.label || "Edit composition",
      () => checked.template,
      message.baseRevision,
    );
    // The store subscription pushes the new state; a failed edit pushes the unchanged one back.
    if (!result.ok) {
      const latest = current(composition.id);
      if (latest) push(latest, result.message);
    }
  };

  // Messages are applied strictly in arrival order: two quick edits must not interleave their awaits.
  let queue: Promise<void> = Promise.resolve();
  const unsubscribeTransport = transport.subscribe((message) => {
    queue = queue.then(() => handle(message)).catch(() => undefined);
  });

  // Anything that changes a watched composition (including Undo / Redo in the main window) reaches the windows.
  let lastLibrary: unknown = useProjectStore.getState().project.linkedCompositions;
  const unsubscribeStore = useProjectStore.subscribe((state) => {
    if (watched.size === 0) return;
    const library = state.project.linkedCompositions;
    if (library === lastLibrary) return;
    lastLibrary = library;
    for (const id of [...watched]) {
      const composition = library?.find((item) => item.id === id);
      if (!composition) {
        watched.delete(id);
        sent.delete(id);
        transport.post({ type: "gone", compositionId: id });
        continue;
      }
      const previous = sent.get(id);
      if (previous && previous.revision === composition.revision && previous.template === composition.template) continue;
      push(composition);
    }
  });

  return () => {
    unsubscribeTransport();
    unsubscribeStore();
    watched.clear();
    sent.clear();
  };
}
