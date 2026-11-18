/** Focused editor properties opt in without taking shortcuts from text tools. */
export interface EditorDraftOwner { projectId: string; history: object }
const fields = new WeakMap<Element, () => void>();
const pending = new Map<Promise<unknown>, EditorDraftOwner>();
export function registerEditorFieldDraft(element: Element, commit: () => void): () => void {
  fields.set(element, commit);
  return () => { if (fields.get(element) === commit) fields.delete(element); };
}
export function hasEditorFieldDraft(target: unknown): boolean {
  return target instanceof Element && target.isConnected && fields.has(target);
}
export function trackEditorDraftWrite<T>(operation: Promise<T>, owner: EditorDraftOwner): Promise<T> {
  if (!pending.has(operation)) {
    pending.set(operation, owner);
    void operation.then(() => pending.delete(operation), () => pending.delete(operation));
  }
  return operation;
}
export function flushEditorFieldDrafts(owner: EditorDraftOwner): Promise<void> | undefined {
  const active = document.activeElement;
  if (active && active.isConnected) fields.get(active)?.();
  const writes = [...pending].filter(([, scope]) => scope.projectId === owner.projectId && scope.history === owner.history).map(([operation]) => operation);
  if (!writes.length) return undefined;
  const completion = Promise.all(writes).then(() => undefined);
  // A picker may stay open or be cancelled before it consumes the snapshot.
  void completion.catch(() => {});
  return completion;
}
