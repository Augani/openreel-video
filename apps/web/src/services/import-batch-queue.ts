/**
 * Import batches picked while another batch is still importing.
 *
 * The Import media picker (and a drop) can deliver a second batch while the first one is still being
 * read, probed and added to the project. That batch must wait its turn, not be discarded: the file
 * input is cleared as soon as the change handler returns, so a dropped batch is the user's files
 * silently never arriving.
 */

export interface PendingImportBatch<Owner> {
  owner: Owner;
  files: readonly File[];
}

/** Hold a batch until the running one finishes. Empty batches are ignored. */
export function enqueueImportBatch<Owner>(pending: PendingImportBatch<Owner>[], owner: Owner, files: readonly File[]): void {
  if (files.length) pending.push({ owner, files });
}

/** The next batch whose editing session is still the live one; batches of a replaced project are dropped. */
export function takeNextImportBatch<Owner>(pending: PendingImportBatch<Owner>[], isLive: (owner: Owner) => boolean): PendingImportBatch<Owner> | null {
  while (pending.length) {
    const next = pending.shift()!;
    if (isLive(next.owner)) return next;
  }
  return null;
}
