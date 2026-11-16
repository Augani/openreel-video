/** Display a playback rate with at most three decimals ("0.606", "1.5", "2").
 * Display only: the stored speed keeps its full precision. */
export function formatSpeed(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Number(value.toFixed(3)));
}
