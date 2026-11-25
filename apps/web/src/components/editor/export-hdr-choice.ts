/**
 * Remembers, per sequence, that the user explicitly chose SDR in the export dialog's Color / HDR control, so
 * reopening the dialog on an HDR sequence does not re-apply the HDR default over that choice. Held for the
 * session; choosing an HDR transfer again forgets it.
 */
const sdrChosen = new Set<string>();

export function rememberExportSdrChoice(sequenceKey: string, sdr: boolean): void {
  if (sdr) sdrChosen.add(sequenceKey);
  else sdrChosen.delete(sequenceKey);
}

export function hasExportSdrChoice(sequenceKey: string): boolean {
  return sdrChosen.has(sequenceKey);
}

export function resetExportSdrChoices(): void {
  sdrChosen.clear();
}
